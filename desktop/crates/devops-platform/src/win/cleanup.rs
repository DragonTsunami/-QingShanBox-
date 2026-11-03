use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use devops_core::{
    Cleanup, CleanupCategory, CleanupOutcome, CleanupReport, CleanupScan, CleanupTarget, OpsError,
    OpsResult,
};
use windows::core::PCWSTR;
use windows::Win32::UI::Shell::{
    SHQueryRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHQUERYRBINFO,
};

const MAX_SCAN_ENTRIES: u64 = 200_000;

#[derive(Default)]
pub struct CleanupImpl;

struct KnownTarget {
    id: &'static str,
    name: &'static str,
    path: PathBuf,
    category: CleanupCategory,
    requires_admin: bool,
    note: &'static str,
}

impl Cleanup for CleanupImpl {
    fn scan(&self) -> OpsResult<CleanupScan> {
        let targets = targets()
            .into_iter()
            .map(scan_target)
            .collect::<OpsResult<Vec<_>>>()?;
        let total_bytes = targets.iter().map(|target| target.bytes).sum();
        let total_files = targets.iter().map(|target| target.files).sum();
        Ok(CleanupScan {
            targets,
            total_bytes,
            total_files,
            scanned_at: now(),
        })
    }

    fn clean(&self, ids: &[String]) -> OpsResult<CleanupReport> {
        if ids.is_empty() {
            return Err(OpsError::InvalidInput("请选择要清理的项目".into()));
        }
        if ids.len() > 16 {
            return Err(OpsError::InvalidInput("单次最多清理 16 个项目".into()));
        }

        let known = targets();
        let mut outcomes = Vec::new();
        let mut freed_bytes = 0u64;
        let mut removed_files = 0u64;
        let mut errors = Vec::new();

        for id in ids {
            let Some(target) = known.iter().find(|target| target.id == id.as_str()) else {
                return Err(OpsError::InvalidInput(format!("未知的清理项目: {id}")));
            };
            let outcome = if target.category == CleanupCategory::Recycle {
                empty_recycle_bin(target)
            } else {
                clean_directory(target)
            };
            match outcome {
                Ok(outcome) => {
                    freed_bytes += outcome.freed_bytes;
                    removed_files += outcome.removed_files;
                    errors.extend(outcome.errors.clone());
                    outcomes.push(outcome);
                }
                Err(error) => {
                    errors.push(format!("{}: {error}", target.name));
                    outcomes.push(CleanupOutcome {
                        id: target.id.into(),
                        name: target.name.into(),
                        freed_bytes: 0,
                        removed_files: 0,
                        errors: vec![error.to_string()],
                    });
                }
            }
        }

        Ok(CleanupReport {
            outcomes,
            freed_bytes,
            removed_files,
            errors,
        })
    }
}

fn targets() -> Vec<KnownTarget> {
    let windir = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default();
    let temp = std::env::temp_dir();

    vec![
        KnownTarget {
            id: "user-temp",
            name: "用户临时文件",
            path: temp,
            category: CleanupCategory::Temp,
            requires_admin: false,
            note: "当前用户的临时目录；正在使用的文件会跳过。",
        },
        KnownTarget {
            id: "windows-temp",
            name: "Windows 临时文件",
            path: windir.join("Temp"),
            category: CleanupCategory::Temp,
            requires_admin: true,
            note: "系统级临时目录，需要管理员权限。",
        },
        KnownTarget {
            id: "edge-cache",
            name: "Edge 浏览器缓存",
            path: local.join(r"Microsoft\Edge\User Data\Default\Cache"),
            category: CleanupCategory::Browser,
            requires_admin: false,
            note: "仅清理默认配置的缓存目录，不涉及历史记录与密码。",
        },
        KnownTarget {
            id: "chrome-cache",
            name: "Chrome 浏览器缓存",
            path: local.join(r"Google\Chrome\User Data\Default\Cache"),
            category: CleanupCategory::Browser,
            requires_admin: false,
            note: "仅清理默认配置的缓存目录，不涉及历史记录与密码。",
        },
        KnownTarget {
            id: "crash-dumps",
            name: "应用崩溃转储",
            path: local.join("CrashDumps"),
            category: CleanupCategory::Windows,
            requires_admin: false,
            note: "用于故障排查的转储文件；删除后不影响当前运行。",
        },
        KnownTarget {
            id: "windows-update",
            name: "Windows Update 缓存",
            path: windir.join(r"SoftwareDistribution\Download"),
            category: CleanupCategory::Windows,
            requires_admin: true,
            note: "更新下载缓存；删除后系统会在需要时重新下载。",
        },
        KnownTarget {
            id: "recycle-bin",
            name: "回收站",
            path: PathBuf::new(),
            category: CleanupCategory::Recycle,
            requires_admin: false,
            note: "清空所有驱动器的回收站；此操作不可撤销。",
        },
    ]
}

fn scan_target(target: KnownTarget) -> OpsResult<CleanupTarget> {
    if target.category == CleanupCategory::Recycle {
        let (bytes, files) = recycle_bin_size()?;
        return Ok(CleanupTarget {
            id: target.id.into(),
            name: target.name.into(),
            path: "回收站".into(),
            category: target.category,
            requires_admin: target.requires_admin,
            available: true,
            bytes,
            files,
            note: target.note.into(),
        });
    }

    let available = target.path.is_dir();
    let (bytes, files) = if available {
        directory_size(&target.path)
    } else {
        (0, 0)
    };
    Ok(CleanupTarget {
        id: target.id.into(),
        name: target.name.into(),
        path: target.path.display().to_string(),
        category: target.category,
        requires_admin: target.requires_admin,
        available,
        bytes,
        files,
        note: target.note.into(),
    })
}

fn directory_size(root: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                bytes = bytes.saturating_add(metadata.len());
                files += 1;
            }
            if files >= MAX_SCAN_ENTRIES {
                return (bytes, files);
            }
        }
    }
    (bytes, files)
}

fn clean_directory(target: &KnownTarget) -> OpsResult<CleanupOutcome> {
    if !target.path.is_dir() {
        return Ok(CleanupOutcome {
            id: target.id.into(),
            name: target.name.into(),
            freed_bytes: 0,
            removed_files: 0,
            errors: Vec::new(),
        });
    }
    let metadata = std::fs::symlink_metadata(&target.path).map_err(|error| {
        OpsError::Platform(format!("无法访问 {}: {error}", target.path.display()))
    })?;
    if metadata.file_type().is_symlink() {
        return Err(OpsError::Platform("清理目录是符号链接，已拒绝".into()));
    }

    let (freed_bytes, removed_files) = directory_size(&target.path);
    let mut errors = Vec::new();
    let entries = std::fs::read_dir(&target.path)
        .map_err(|error| OpsError::Platform(format!("无法读取目录: {error}")))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let result = if metadata.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(error) = result {
            errors.push(format!("{}: {error}", path.display()));
        }
    }

    Ok(CleanupOutcome {
        id: target.id.into(),
        name: target.name.into(),
        freed_bytes,
        removed_files,
        errors,
    })
}

fn recycle_bin_size() -> OpsResult<(u64, u64)> {
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    unsafe {
        SHQueryRecycleBinW(PCWSTR::null(), &mut info)
            .map_err(|error| OpsError::Platform(format!("读取回收站失败: {error}")))?;
    }
    Ok((info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64))
}

fn empty_recycle_bin(target: &KnownTarget) -> OpsResult<CleanupOutcome> {
    let (bytes, files) = recycle_bin_size()?;
    unsafe {
        windows::Win32::UI::Shell::SHEmptyRecycleBinW(
            None,
            PCWSTR::null(),
            SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
        )
        .map_err(|error| OpsError::Platform(format!("清空回收站失败: {error}")))?;
    }
    Ok(CleanupOutcome {
        id: target.id.into(),
        name: target.name.into(),
        freed_bytes: bytes,
        removed_files: files,
        errors: Vec::new(),
    })
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}
