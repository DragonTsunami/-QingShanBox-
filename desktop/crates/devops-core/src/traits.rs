use crate::cleanup::{CleanupReport, CleanupScan};
use crate::diagnostics::{QuickAction, QuickActionResult, SystemDiagnostics};
use crate::error::OpsResult;
use crate::logs::{LogBatch, LogEntry, LogExport, LogQuery, LogSource};
use crate::models::{
    DnsLookupResult, NetworkInterface, PortCheckResult, ProcessInfo, ServiceAction, ServiceInfo,
    SystemSnapshot,
};
use crate::software::InstalledApp;
use crate::startup::{ScheduledTask, StartupItem};

/// Read-only machine telemetry.
pub trait SystemProbe: Send + Sync {
    fn snapshot(&self) -> OpsResult<SystemSnapshot>;
}

/// Process inspection and termination.
pub trait ProcessControl: Send + Sync {
    fn list(&self) -> OpsResult<Vec<ProcessInfo>>;
    fn kill(&self, pid: u32, force: bool) -> OpsResult<()>;
}

/// Windows service inspection and lifecycle control.
pub trait ServiceControl: Send + Sync {
    fn list(&self) -> OpsResult<Vec<ServiceInfo>>;
    fn apply(&self, name: &str, action: ServiceAction) -> OpsResult<ServiceInfo>;
}

/// Network inventory and diagnostics.
pub trait NetworkProbe: Send + Sync {
    fn interfaces(&self) -> OpsResult<Vec<NetworkInterface>>;
    fn check_port(&self, host: &str, port: u16, timeout_ms: u64) -> OpsResult<PortCheckResult>;
    fn resolve(&self, host: &str) -> OpsResult<DnsLookupResult>;
}

/// Windows Event Log / application log inspection and export.
pub trait LogCenter: Send + Sync {
    fn sources(&self) -> OpsResult<Vec<LogSource>>;
    fn query(&self, query: &LogQuery) -> OpsResult<LogBatch>;
    /// Write the selected entries to a local file and return its path.
    fn export(&self, entries: &[LogEntry]) -> OpsResult<LogExport>;
    /// Clear one Windows event channel. This is destructive and normally
    /// requires elevation; the adapter must not accept arbitrary channels.
    fn clear(&self, source: &str) -> OpsResult<()>;
}

/// Elevation state and self-relaunch. Kept separate because it is the only
/// capability that mutates the process environment rather than the machine.
pub trait Elevation: Send + Sync {
    fn is_elevated(&self) -> bool;
    /// Relaunch the current executable with the Windows UAC prompt.
    fn relaunch_elevated(&self) -> OpsResult<()>;
}

/// Allow-listed disk cleanup. `scan` never mutates; `clean` only accepts ids
/// produced by the current scan.
pub trait Cleanup: Send + Sync {
    fn scan(&self) -> OpsResult<CleanupScan>;
    fn clean(&self, ids: &[String]) -> OpsResult<CleanupReport>;
}

/// User startup entries and scheduled tasks.
pub trait StartupManager: Send + Sync {
    fn startup_items(&self) -> OpsResult<Vec<StartupItem>>;
    fn set_startup_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<StartupItem>>;
    fn scheduled_tasks(&self) -> OpsResult<Vec<ScheduledTask>>;
    fn set_task_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<ScheduledTask>>;
}

/// Installed software inventory (registry Uninstall keys).
pub trait SoftwareInventory: Send + Sync {
    fn list(&self) -> OpsResult<Vec<InstalledApp>>;
    /// Launch the application's own uninstaller. Implementations must resolve
    /// `id` against the current inventory; they must not accept a raw command.
    fn uninstall(&self, id: &str) -> OpsResult<()>;
}

/// Read-only local health plus a small allow-list of safe repair actions.
pub trait Diagnostics: Send + Sync {
    fn read(&self) -> OpsResult<SystemDiagnostics>;
    fn quick_actions(&self) -> Vec<QuickAction>;
    fn run_quick_action(&self, id: &str) -> OpsResult<QuickActionResult>;
}
