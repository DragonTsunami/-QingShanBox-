use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use devops_core::{
    InstalledApp, OpsError, OpsResult, SoftwareInventory, SoftwareKind, SoftwareScope,
};
use windows::core::PCWSTR;
use windows::Win32::Foundation::GetLastError;
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use super::registry;

const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

#[derive(Default)]
pub struct SoftwareInventoryImpl;

impl SoftwareInventory for SoftwareInventoryImpl {
    fn list(&self) -> OpsResult<Vec<InstalledApp>> {
        let mut apps = Vec::new();
        let mut seen = HashSet::new();
        let last_used = user_assist_last_used();

        for (root, scope) in [
            (HKEY_LOCAL_MACHINE, SoftwareScope::Machine),
            (HKEY_CURRENT_USER, SoftwareScope::User),
        ] {
            for view in [64u32, 32u32] {
                let Ok(parent) = registry::open_view(root, UNINSTALL, view, false) else {
                    continue;
                };
                let keys = match registry::enum_subkeys(parent) {
                    Ok(keys) => keys,
                    Err(_) => {
                        registry::close(parent);
                        continue;
                    }
                };
                for key_name in keys {
                    let path = format!(r"{UNINSTALL}\{key_name}");
                    let Ok(key) = registry::open_view(root, &path, view, false) else {
                        continue;
                    };
                    if let Some(app) = read_app(key, &key_name, scope, view, &last_used) {
                        let identity = format!(
                            "{}|{}|{}",
                            app.name.to_lowercase(),
                            app.version,
                            app.publisher.to_lowercase()
                        );
                        if seen.insert(identity) {
                            apps.push(app);
                        }
                    }
                    registry::close(key);
                }
                registry::close(parent);
            }
        }

        apps.sort_by_key(|app| app.name.to_lowercase());
        Ok(apps)
    }

    fn uninstall(&self, id: &str) -> OpsResult<()> {
        let id = id.trim();
        if id.is_empty() {
            return Err(OpsError::InvalidInput("软件标识不能为空".into()));
        }
        if id.chars().count() > 512 {
            return Err(OpsError::InvalidInput("软件标识过长".into()));
        }

        let apps = self.list()?;
        let app = apps
            .iter()
            .find(|app| app.id == id)
            .ok_or_else(|| OpsError::NotFound("未找到该软件，请刷新后重试".into()))?;
        let command = app.uninstall_string.trim();
        if command.is_empty() {
            return Err(OpsError::InvalidInput(
                "该系统未提供此软件的卸载命令，请使用 Windows「应用和功能」".into(),
            ));
        }
        if command.chars().count() > 4096 {
            return Err(OpsError::InvalidInput("卸载命令过长，已拒绝执行".into()));
        }

        launch_uninstaller(command, app.scope)
    }
}

fn launch_uninstaller(command: &str, scope: SoftwareScope) -> OpsResult<()> {
    // The command comes from the application's own Uninstall registry value.
    // Machine-wide uninstallers normally need elevation, so let UAC prompt for
    // them; per-user uninstallers run in the current token.
    let verb = match scope {
        SoftwareScope::Machine => "runas",
        SoftwareScope::User => "open",
    };
    let file = wide("cmd.exe");
    let verb = wide(verb);
    let parameters = wide(&format!("/C {command}"));

    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR(parameters.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        let code = unsafe { GetLastError() };
        if code.0 == 1223 {
            return Err(OpsError::PermissionDenied);
        }
        return Err(OpsError::Platform(format!(
            "无法启动卸载程序（Windows 错误 {}）",
            code.0
        )));
    }
    Ok(())
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn read_app(
    key: windows::Win32::System::Registry::HKEY,
    key_name: &str,
    scope: SoftwareScope,
    view: u32,
    last_used: &HashMap<String, u64>,
) -> Option<InstalledApp> {
    let name = registry::read_string(key, "DisplayName")
        .ok()
        .flatten()?
        .trim()
        .to_string();
    if name.is_empty() {
        return None;
    }
    if registry::read_string(key, "SystemComponent")
        .ok()
        .flatten()
        .as_deref()
        == Some("1")
    {
        return None;
    }
    if registry::read_string(key, "ParentKeyName")
        .ok()
        .flatten()
        .is_some()
    {
        return None;
    }

    let text = |name: &str| {
        registry::read_string(key, name)
            .ok()
            .flatten()
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    let scope_label = match scope {
        SoftwareScope::Machine => "machine",
        SoftwareScope::User => "user",
    };

    let display_icon = text("DisplayIcon");
    let install_location = text("InstallLocation");
    let uninstall_string = text("UninstallString");
    let kind = effective_kind(&name, &uninstall_string);
    Some(InstalledApp {
        id: format!("{scope_label}:{view}:{key_name}"),
        kind,
        name,
        version: text("DisplayVersion"),
        publisher: text("Publisher"),
        install_date: text("InstallDate"),
        install_location: install_location.clone(),
        uninstall_string,
        scope,
        registry_view: format!("{view}-bit"),
        icon: crate::win::icons::icon_data_url(&display_icon),
        last_used: last_used_for(&display_icon, &install_location, last_used),
    })
}

/// Entries without an uninstall command are separated from the three main
/// categories: they cannot be managed from here and should not be mixed with
/// applications, drivers, or runtimes.
fn effective_kind(name: &str, uninstall_string: &str) -> SoftwareKind {
    if uninstall_string.trim().is_empty() {
        SoftwareKind::Other
    } else {
        classify_kind(name, uninstall_string)
    }
}

/// Drivers rarely expose a stable registry marker. Prefer explicit driver
/// installers and the driver-related product names that Windows registers.
fn classify_kind(name: &str, uninstall_string: &str) -> SoftwareKind {
    let name = name.to_lowercase();
    let uninstall = uninstall_string.to_lowercase();
    if uninstall.contains("pnputil") || uninstall.contains("infdefaultinstall") {
        return SoftwareKind::Driver;
    }
    const DRIVER_MARKERS: [&str; 12] = [
        "driver",
        "graphics",
        "chipset",
        "display adapter",
        "adrenalin",
        "realtek",
        "radeon",
        "nvidia graphics",
        "nvidia display",
        "intel(r) graphics",
        "intel® graphics",
        "bluetooth driver",
    ];
    if DRIVER_MARKERS.iter().any(|marker| name.contains(marker)) {
        return SoftwareKind::Driver;
    }
    const RUNTIME_MARKERS: [&str; 11] = [
        ".net",
        "dotnet",
        "asp.net",
        "runtime",
        "redistributable",
        "visual c++",
        "vc++",
        "webview2",
        "java",
        "jre",
        "jdk",
    ];
    if RUNTIME_MARKERS.iter().any(|marker| name.contains(marker)) {
        SoftwareKind::Runtime
    } else {
        SoftwareKind::Application
    }
}

/// Best-effort last-use timestamp. Windows does not expose a reliable
/// per-application launch time to standard users; UserAssist covers launches
/// performed through Explorer, and the executable access time is a fallback.
fn last_used_for(
    display_icon: &str,
    install_location: &str,
    last_used: &HashMap<String, u64>,
) -> Option<u64> {
    let icon_path = crate::win::icons::display_icon_path(display_icon);
    if let Some(path) = icon_path.as_deref() {
        let lower = path.to_string_lossy().to_lowercase();
        if let Some(value) = last_used.get(&lower) {
            return Some(*value);
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            if let Some(value) = last_used.get(&name.to_lowercase()) {
                return Some(*value);
            }
        }
    }

    if !install_location.trim().is_empty() {
        let base = install_location
            .trim()
            .trim_end_matches(['\\', '/'])
            .to_lowercase();
        let prefix = format!("{base}\\");
        let matched = last_used
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix) && key.ends_with(".exe"))
            .map(|(_, value)| *value)
            .max();
        if matched.is_some() {
            return matched;
        }
    }

    let path = icon_path?;
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.accessed().ok())
        .and_then(unix_seconds)
        .filter(|seconds| *seconds > 946684800)
}

fn user_assist_last_used() -> HashMap<String, u64> {
    const KEYS: [&str; 2] = [
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist\{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}\Count",
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist\{F4E57C4B-2036-45F0-A9AB-443BCFE33D9F}\Count",
    ];

    let mut result: HashMap<String, u64> = HashMap::new();
    for path in KEYS {
        let Ok(key) = registry::open(HKEY_CURRENT_USER, path, false) else {
            continue;
        };
        let values = registry::enum_binary_values(key).unwrap_or_default();
        registry::close(key);

        for (encoded_name, data) in values {
            let decoded = rot13(&encoded_name);
            let Some(path) = decoded
                .split_once("}\\")
                .map(|(_, value)| value)
                .or_else(|| {
                    if decoded.starts_with('{') {
                        None
                    } else {
                        Some(decoded.as_str())
                    }
                })
            else {
                continue;
            };
            let lower = path.to_lowercase();
            if !lower.ends_with(".exe") {
                continue;
            }
            let Some(seconds) = filetime_at(&data, 60) else {
                continue;
            };
            let Some(name) = Path::new(&lower)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
            else {
                continue;
            };

            for key in [lower, name] {
                result
                    .entry(key)
                    .and_modify(|current| *current = (*current).max(seconds))
                    .or_insert(seconds);
            }
        }
    }
    result
}

fn filetime_at(data: &[u8], offset: usize) -> Option<u64> {
    let bytes = data.get(offset..offset + 8)?;
    let filetime = u64::from_le_bytes(bytes.try_into().ok()?);
    if filetime < 116_444_736_000_000_000 {
        return None;
    }
    Some(filetime / 10_000_000 - 11_644_473_600)
}

fn unix_seconds(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_secs())
}

fn rot13(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            'A'..='Z' => char::from(b'A' + (character as u8 - b'A' + 13) % 26),
            'a'..='z' => char::from(b'a' + (character as u8 - b'a' + 13) % 26),
            _ => character,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{classify_kind, effective_kind};
    use devops_core::SoftwareKind;

    #[test]
    fn uninstall_path_is_stable() {
        assert!(super::UNINSTALL.contains("Uninstall"));
    }

    #[test]
    fn driver_products_are_separated_from_applications() {
        assert_eq!(
            classify_kind("Intel(R) Graphics Software & Drivers", ""),
            SoftwareKind::Driver
        );
        assert_eq!(
            classify_kind("AMD Chipset Software", ""),
            SoftwareKind::Driver
        );
        assert_eq!(
            classify_kind("Google Chrome", ""),
            SoftwareKind::Application
        );
        assert_eq!(
            classify_kind("Intel Computing Improvement Program", ""),
            SoftwareKind::Application
        );
        assert_eq!(
            classify_kind("Microsoft .NET Runtime - 10.0.7 (x64)", ""),
            SoftwareKind::Runtime
        );
        assert_eq!(
            classify_kind(
                "Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211",
                ""
            ),
            SoftwareKind::Runtime
        );
        assert_eq!(
            classify_kind("Microsoft Edge WebView2 Runtime", ""),
            SoftwareKind::Runtime
        );
        assert_eq!(
            effective_kind("Microsoft .NET Runtime - 10.0.7 (x64)", ""),
            SoftwareKind::Other
        );
        assert_eq!(
            effective_kind(
                "Microsoft .NET Runtime - 10.0.7 (x64)",
                "C:\\Program Files\\dotnet\\uninstall.exe"
            ),
            SoftwareKind::Runtime
        );
        assert_eq!(
            effective_kind("Intel(R) Graphics Software & Drivers", ""),
            SoftwareKind::Other
        );
    }
}
