use std::path::Path;
use std::process::Command;

use devops_core::{
    AppInfo, CleanupReport, CleanupScan, DnsLookupResult, InstalledApp, LogBatch, LogEntry,
    LogExport, LogQuery, LogSource, NetworkInterface, PortCheckResult, ProcessInfo,
    QuickActionResult, ScheduledTask, ServiceAction, ServiceInfo, StartupItem, SystemDiagnostics,
    SystemSnapshot,
};
use devops_plugins::{PluginCatalog, PluginMarketEntry};
use tauri::{AppHandle, State};

use crate::state::AppState;

fn to_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub fn system_snapshot(state: State<'_, AppState>) -> Result<SystemSnapshot, String> {
    state.service.snapshot().map_err(to_message)
}

#[tauri::command]
pub fn process_list(state: State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> {
    state.service.list_processes().map_err(to_message)
}

#[tauri::command]
pub fn process_kill(
    state: State<'_, AppState>,
    pid: u32,
    force: Option<bool>,
) -> Result<(), String> {
    state
        .service
        .kill_process(pid, force.unwrap_or(false))
        .map_err(to_message)
}

#[tauri::command]
pub async fn service_list(state: State<'_, AppState>) -> Result<Vec<ServiceInfo>, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.list_services())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn service_action(
    state: State<'_, AppState>,
    name: String,
    action: ServiceAction,
) -> Result<ServiceInfo, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.apply_service(&name, action))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn network_interfaces(
    state: State<'_, AppState>,
) -> Result<Vec<NetworkInterface>, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.interfaces())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn network_check_port(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<PortCheckResult, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.check_port(&host, port, timeout_ms.unwrap_or(1500))
    })
    .await
    .map_err(to_message)?
    .map_err(to_message)
}

#[tauri::command]
pub async fn network_resolve(
    state: State<'_, AppState>,
    host: String,
) -> Result<DnsLookupResult, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.resolve(&host))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn log_sources(state: State<'_, AppState>) -> Result<Vec<LogSource>, String> {
    let logs = state.logs.clone();
    tauri::async_runtime::spawn_blocking(move || logs.sources())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn logs_query(state: State<'_, AppState>, query: LogQuery) -> Result<LogBatch, String> {
    let logs = state.logs.clone();
    tauri::async_runtime::spawn_blocking(move || logs.query(query))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn logs_export(
    state: State<'_, AppState>,
    entries: Vec<LogEntry>,
) -> Result<LogExport, String> {
    let logs = state.logs.clone();
    tauri::async_runtime::spawn_blocking(move || logs.export(&entries))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn logs_clear(state: State<'_, AppState>, source: String) -> Result<(), String> {
    let logs = state.logs.clone();
    tauri::async_runtime::spawn_blocking(move || logs.clear(&source))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn cleanup_scan(state: State<'_, AppState>) -> Result<CleanupScan, String> {
    let cleanup = state.cleanup.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup.scan())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn cleanup_run(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<CleanupReport, String> {
    let cleanup = state.cleanup.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup.clean(ids))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn startup_items(state: State<'_, AppState>) -> Result<Vec<StartupItem>, String> {
    let maintenance = state.maintenance.clone();
    tauri::async_runtime::spawn_blocking(move || maintenance.startup_items())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn startup_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Vec<StartupItem>, String> {
    let maintenance = state.maintenance.clone();
    tauri::async_runtime::spawn_blocking(move || maintenance.set_startup_enabled(&id, enabled))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn scheduled_tasks(state: State<'_, AppState>) -> Result<Vec<ScheduledTask>, String> {
    let maintenance = state.maintenance.clone();
    tauri::async_runtime::spawn_blocking(move || maintenance.scheduled_tasks())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn task_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Vec<ScheduledTask>, String> {
    let maintenance = state.maintenance.clone();
    tauri::async_runtime::spawn_blocking(move || maintenance.set_task_enabled(&id, enabled))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn software_list(state: State<'_, AppState>) -> Result<Vec<InstalledApp>, String> {
    let maintenance = state.maintenance.clone();
    tauri::async_runtime::spawn_blocking(move || maintenance.software())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn software_uninstall(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let maintenance = state.maintenance.clone();
    tauri::async_runtime::spawn_blocking(move || maintenance.uninstall_software(&id))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn diagnostics_read(state: State<'_, AppState>) -> Result<SystemDiagnostics, String> {
    let diagnostics = state.diagnostics.clone();
    tauri::async_runtime::spawn_blocking(move || diagnostics.read())
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub fn diagnostics_actions(state: State<'_, AppState>) -> Vec<devops_core::QuickAction> {
    state.diagnostics.quick_actions()
}

#[tauri::command]
pub async fn diagnostics_run_action(
    state: State<'_, AppState>,
    id: String,
) -> Result<QuickActionResult, String> {
    let diagnostics = state.diagnostics.clone();
    tauri::async_runtime::spawn_blocking(move || diagnostics.run_quick_action(&id))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub async fn diagnostics_export(
    state: State<'_, AppState>,
    markdown: String,
) -> Result<String, String> {
    let diagnostics = state.diagnostics.clone();
    tauri::async_runtime::spawn_blocking(move || {
        diagnostics
            .export_report(&markdown)
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(to_message)?
    .map_err(to_message)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<devops_app::update::UpdateCheck, String> {
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || devops_app::update::check_for_update(&current))
        .await
        .map_err(to_message)?
        .map_err(to_message)
}

#[tauri::command]
pub fn open_apps_features() -> Result<(), String> {
    let mut command = Command::new("control.exe");
    command.arg("appwiz.cpl");
    command.spawn().map(|_| ()).map_err(to_message)
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        name: "青衫工作台".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        core_version: devops_core::CORE_VERSION.into(),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .into(),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        is_elevated: state.service.is_elevated(),
    }
}

#[tauri::command]
pub fn is_elevated(state: State<'_, AppState>) -> bool {
    state.service.is_elevated()
}

#[tauri::command]
pub fn plugin_catalog(state: State<'_, AppState>) -> Result<PluginCatalog, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .catalog()
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_rescan(state: State<'_, AppState>) -> Result<PluginCatalog, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .catalog()
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<PluginCatalog, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .set_enabled(&id, enabled)
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_market(state: State<'_, AppState>) -> Result<Vec<PluginMarketEntry>, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .market()
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_install(state: State<'_, AppState>, id: String) -> Result<PluginCatalog, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .install(&id)
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_install_from_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<PluginCatalog, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .install_from_path(&path)
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_remove(state: State<'_, AppState>, id: String) -> Result<PluginCatalog, String> {
    state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .remove(&id)
        .map_err(to_message)
}

#[tauri::command]
pub fn plugin_open_directory(state: State<'_, AppState>) -> Result<String, String> {
    let directory = state
        .plugins
        .lock()
        .map_err(|_| "插件状态锁不可用".to_string())?
        .directory()
        .to_path_buf();
    open_path(&directory)?;
    Ok(directory.display().to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if url.len() > 2048
        || !(url.starts_with("https://") || url.starts_with("http://"))
        || url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("只允许打开 http(s) 链接".into());
    }
    open_target(url)?;
    Ok(())
}

fn open_path(path: &Path) -> Result<(), String> {
    open_target(path.as_os_str().to_string_lossy().as_ref())
}

fn open_target(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut command = Command::new("explorer.exe");
    #[cfg(not(windows))]
    let mut command = Command::new("xdg-open");

    command.arg(target).spawn().map(|_| ()).map_err(to_message)
}

#[tauri::command]
pub fn set_window_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    window
        .set_theme(Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }))
        .map_err(to_message)
}

#[tauri::command]
pub fn relaunch_as_admin(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.service.relaunch_elevated().map_err(to_message)?;
    app.exit(0);
    Ok(())
}
