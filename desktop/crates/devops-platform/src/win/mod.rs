pub mod cleanup;
pub mod diagnostics;
pub mod elevation;
pub mod icons;
pub mod logs;
pub mod network;
pub mod process;
pub mod registry;
pub mod service;
pub mod software;
pub mod startup;
pub mod system;

pub struct WindowsPlatform {
    pub system: system::SystemProbeImpl,
    pub processes: process::ProcessControlImpl,
    pub services: service::ServiceControlImpl,
    pub network: network::NetworkProbeImpl,
    pub elevation: elevation::ElevationImpl,
    pub logs: logs::LogCenterImpl,
    pub cleanup: cleanup::CleanupImpl,
    pub startup: startup::StartupManagerImpl,
    pub software: software::SoftwareInventoryImpl,
    pub diagnostics: diagnostics::DiagnosticsImpl,
}

impl WindowsPlatform {
    pub fn new() -> Self {
        Self {
            system: system::SystemProbeImpl::new(),
            processes: process::ProcessControlImpl::new(),
            services: service::ServiceControlImpl,
            network: network::NetworkProbeImpl,
            elevation: elevation::ElevationImpl,
            logs: logs::LogCenterImpl,
            cleanup: cleanup::CleanupImpl,
            startup: startup::StartupManagerImpl,
            software: software::SoftwareInventoryImpl,
            diagnostics: diagnostics::DiagnosticsImpl,
        }
    }
}
