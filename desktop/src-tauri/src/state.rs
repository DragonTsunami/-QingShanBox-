use std::path::PathBuf;
use std::sync::Mutex;

use devops_app::{CleanupService, DiagnosticsService, LogService, MaintenanceService, OpsService};
use devops_core::OpsResult;
use devops_platform::DesktopPlatform;
use devops_plugins::PluginStore;

/// Shared state injected into every Tauri command. Commands only adapt IPC
/// arguments; orchestration lives in `devops_app::{OpsService, LogService}`.
pub struct AppState {
    pub service: OpsService,
    pub logs: LogService,
    pub cleanup: CleanupService,
    pub maintenance: MaintenanceService,
    pub diagnostics: DiagnosticsService,
    pub plugins: Mutex<PluginStore>,
}

impl AppState {
    pub fn new(plugin_directory: PathBuf, report_directory: PathBuf) -> OpsResult<Self> {
        let platform = DesktopPlatform::new()?;
        Ok(Self {
            service: OpsService::new(
                platform.system,
                platform.processes,
                platform.services,
                platform.network,
                platform.elevation,
            ),
            logs: LogService::new(platform.logs),
            cleanup: CleanupService::new(platform.cleanup),
            maintenance: MaintenanceService::new(platform.startup, platform.software),
            diagnostics: DiagnosticsService::new(platform.diagnostics, report_directory),
            plugins: Mutex::new(PluginStore::new(plugin_directory)),
        })
    }
}
