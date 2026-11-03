use std::path::PathBuf;
use std::process::Command;

use devops_core::{
    OpsError, OpsResult, ScheduledTask, StartupItem, StartupLocation, StartupManager, StartupScope,
};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

use super::registry;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED_RUN: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const APPROVED_FOLDER: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct StartupManagerImpl;

impl StartupManager for StartupManagerImpl {
    fn startup_items(&self) -> OpsResult<Vec<StartupItem>> {
        let mut items = Vec::new();
        read_run_items(
            HKEY_CURRENT_USER,
            StartupScope::User,
            None,
            APPROVED_RUN,
            &mut items,
        )?;
        read_run_items(
            HKEY_LOCAL_MACHINE,
            StartupScope::Machine,
            Some(64),
            APPROVED_RUN,
            &mut items,
        )?;
        read_run_items(
            HKEY_LOCAL_MACHINE,
            StartupScope::Machine,
            Some(32),
            APPROVED_RUN,
            &mut items,
        )?;
        read_startup_folder(
            user_startup_folder(),
            StartupScope::User,
            APPROVED_FOLDER,
            &mut items,
        )?;
        read_startup_folder(
            machine_startup_folder(),
            StartupScope::Machine,
            APPROVED_FOLDER,
            &mut items,
        )?;
        items.sort_by_key(|item| item.name.to_lowercase());
        Ok(items)
    }

    fn set_startup_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<StartupItem>> {
        let items = self.startup_items()?;
        let item = items
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| OpsError::InvalidInput("启动项不存在，请刷新后重试".into()))?;

        let bytes = if enabled {
            vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        } else {
            vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        };

        let (root, path) = match item.location {
            StartupLocation::RegistryRun => {
                let (scope, view) = parse_run_id(&item.id)?;
                (
                    if scope == StartupScope::Machine {
                        HKEY_LOCAL_MACHINE
                    } else {
                        HKEY_CURRENT_USER
                    },
                    view.map(|_| APPROVED_RUN).unwrap_or(APPROVED_RUN),
                )
            }
            StartupLocation::StartupFolder => (
                if item.scope == StartupScope::Machine {
                    HKEY_LOCAL_MACHINE
                } else {
                    HKEY_CURRENT_USER
                },
                APPROVED_FOLDER,
            ),
        };

        let key = registry::create_key(root, path)?;
        let result = registry::write_binary(key, &item.name, &bytes);
        registry::close(key);
        result?;
        self.startup_items()
    }

    fn scheduled_tasks(&self) -> OpsResult<Vec<ScheduledTask>> {
        match scheduled_tasks_powershell() {
            Ok(tasks) => Ok(tasks),
            Err(primary) => scheduled_tasks_files().map_err(|fallback| {
                OpsError::Platform(format!("{primary}; 读取任务文件也失败: {fallback}"))
            }),
        }
    }

    fn set_task_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<ScheduledTask>> {
        let task = self
            .scheduled_tasks()?
            .into_iter()
            .find(|task| task.id == id)
            .ok_or_else(|| OpsError::InvalidInput("计划任务不存在，请刷新后重试".into()))?;
        let full_name = format!("{}{}", task.path, task.name);
        if full_name.contains('"') || full_name.chars().any(|c| c.is_control()) {
            return Err(OpsError::InvalidInput("计划任务名称包含非法字符".into()));
        }

        let mut command = Command::new("schtasks.exe");
        command.args([
            "/Change",
            "/TN",
            &full_name,
            if enabled { "/ENABLE" } else { "/DISABLE" },
        ]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let output = command
            .output()
            .map_err(|error| OpsError::Platform(format!("无法修改计划任务: {error}")))?;
        if !output.status.success() {
            return Err(OpsError::Platform(format!(
                "修改计划任务失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        self.scheduled_tasks()
    }
}

fn read_run_items(
    root: windows::Win32::System::Registry::HKEY,
    scope: StartupScope,
    view: Option<u32>,
    approved_path: &str,
    items: &mut Vec<StartupItem>,
) -> OpsResult<()> {
    let key = match registry::open_view(root, RUN_KEY, view.unwrap_or(64), false) {
        Ok(key) => key,
        Err(_) => return Ok(()),
    };
    let values = registry::enum_values(key);
    registry::close(key);
    let values = values?;

    let approved = registry::open_view(root, approved_path, view.unwrap_or(64), false).ok();
    for (name, command) in values {
        let enabled = approved
            .and_then(|key| registry::read_binary(key, &name).ok().flatten())
            .map(|bytes| bytes.first().map(|byte| byte & 1 == 0).unwrap_or(true))
            .unwrap_or(true);
        items.push(StartupItem {
            id: match view {
                Some(view) => format!(
                    "run:{}:{view}:{name}",
                    if scope == StartupScope::Machine {
                        "machine"
                    } else {
                        "user"
                    }
                ),
                None => format!(
                    "run:{}:{name}",
                    if scope == StartupScope::Machine {
                        "machine"
                    } else {
                        "user"
                    }
                ),
            },
            name,
            command,
            location: StartupLocation::RegistryRun,
            scope,
            enabled,
            editable: true,
        });
    }
    if let Some(key) = approved {
        registry::close(key);
    }
    Ok(())
}

fn read_startup_folder(
    folder: PathBuf,
    scope: StartupScope,
    approved_path: &str,
    items: &mut Vec<StartupItem>,
) -> OpsResult<()> {
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return Ok(());
    };
    let root = if scope == StartupScope::Machine {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    };
    let approved = registry::open(root, approved_path, false).ok();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let enabled = approved
            .as_ref()
            .and_then(|key| registry::read_binary(*key, &name).ok().flatten())
            .map(|bytes| bytes.first().map(|byte| byte & 1 == 0).unwrap_or(true))
            .unwrap_or(true);
        items.push(StartupItem {
            id: format!(
                "folder:{}:{name}",
                if scope == StartupScope::Machine {
                    "machine"
                } else {
                    "user"
                }
            ),
            name,
            command: path.display().to_string(),
            location: StartupLocation::StartupFolder,
            scope,
            enabled,
            editable: true,
        });
    }
    if let Some(key) = approved {
        registry::close(key);
    }
    Ok(())
}

fn parse_run_id(id: &str) -> OpsResult<(StartupScope, Option<u32>)> {
    let parts: Vec<&str> = id.splitn(4, ':').collect();
    if parts.len() < 3 || parts[0] != "run" {
        return Err(OpsError::InvalidInput("启动项标识无效".into()));
    }
    let scope = if parts[1] == "machine" {
        StartupScope::Machine
    } else {
        StartupScope::User
    };
    let view = parts.get(2).and_then(|value| value.parse().ok());
    Ok((scope, view))
}

fn user_startup_folder() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(r"Microsoft\Windows\Start Menu\Programs\Startup")
}

fn machine_startup_folder() -> PathBuf {
    std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(r"Microsoft\Windows\Start Menu\Programs\Startup")
}

fn decode_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

fn scheduled_tasks_powershell() -> OpsResult<Vec<ScheduledTask>> {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-ScheduledTask | Select-Object TaskName,TaskPath,State,Description,Author | ConvertTo-Json -Compress",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|error| OpsError::Platform(format!("无法读取计划任务: {error}")))?;
    if !output.status.success() {
        return Err(OpsError::Platform(format!(
            "读取计划任务失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let text = decode_output(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| OpsError::Platform(format!("解析计划任务失败: {error}")))?;
    let list = match value {
        serde_json::Value::Array(list) => list,
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    };

    let mut tasks = Vec::new();
    for item in list {
        let name = item
            .get("TaskName")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let path = item
            .get("TaskPath")
            .and_then(|value| value.as_str())
            .unwrap_or("\\")
            .to_string();
        let state = item
            .get("State")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown")
            .to_string();
        tasks.push(ScheduledTask {
            id: format!("task:{path}{name}"),
            name,
            path,
            enabled: !state.eq_ignore_ascii_case("Disabled"),
            state,
            description: item
                .get("Description")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            author: item
                .get("Author")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        });
    }
    tasks.sort_by_key(|task| task.name.to_lowercase());
    Ok(tasks)
}

fn scheduled_tasks_files() -> OpsResult<Vec<ScheduledTask>> {
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join(r"System32\Tasks");
    if !root.is_dir() {
        return Err(OpsError::Platform("未找到计划任务目录".into()));
    }

    let mut tasks = Vec::new();
    collect_task_files(&root, &root, &mut tasks)?;
    tasks.sort_by_key(|task| task.name.to_lowercase());
    Ok(tasks)
}

fn collect_task_files(
    root: &std::path::Path,
    directory: &std::path::Path,
    tasks: &mut Vec<ScheduledTask>,
) -> OpsResult<()> {
    let entries = std::fs::read_dir(directory)
        .map_err(|error| OpsError::Platform(format!("读取任务目录失败: {error}")))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_task_files(root, &path, tasks)?;
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let xml = decode_output(&bytes);
        let relative = path
            .parent()
            .and_then(|parent| parent.strip_prefix(root).ok());
        let task_path = relative
            .map(|relative| {
                let suffix = relative
                    .components()
                    .map(|component| component.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("\\");
                if suffix.is_empty() {
                    "\\".to_string()
                } else {
                    format!("\\{suffix}\\")
                }
            })
            .unwrap_or_else(|| "\\".to_string());
        let enabled = !matches!(
            tag_value(&xml, "Enabled").as_deref(),
            Some("false") | Some("0")
        );
        tasks.push(ScheduledTask {
            id: format!("task:{task_path}{name}"),
            name: name.to_string(),
            path: task_path,
            state: if enabled { "Ready" } else { "Disabled" }.to_string(),
            description: tag_value(&xml, "Description").unwrap_or_default(),
            author: tag_value(&xml, "Author").unwrap_or_default(),
            enabled,
        });
    }
    Ok(())
}

fn tag_value(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let raw = xml[start..end].trim();
    if raw.is_empty() {
        None
    } else {
        Some(
            raw.replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'"),
        )
    }
}
