//! Application service layer.
//!
//! The Tauri command module is intentionally thin: it only adapts IPC arguments
//! and schedules blocking work. All orchestration and cross-cutting guards live
//! here, which keeps the same behavior testable without a webview or a Windows
//! host. The service depends exclusively on `devops-core` traits.

use std::sync::Arc;

use devops_core::{
    Cleanup, CleanupReport, CleanupScan, Diagnostics, DnsLookupResult, Elevation, InstalledApp,
    LogBatch, LogCenter, LogEntry, LogExport, LogQuery, LogSource, NetworkInterface, NetworkProbe,
    OpsError, OpsResult, PortCheckResult, ProcessControl, ProcessInfo, QuickAction,
    QuickActionResult, ScheduledTask, ServiceAction, ServiceControl, ServiceInfo,
    SoftwareInventory, StartupItem, StartupManager, SystemDiagnostics, SystemProbe, SystemSnapshot,
};

pub mod update;

/// Disk cleanup use cases; deletion is strictly id-based and never path-based.
#[derive(Clone)]
pub struct CleanupService {
    cleanup: Arc<dyn Cleanup>,
}

impl CleanupService {
    pub fn new(cleanup: Arc<dyn Cleanup>) -> Self {
        Self { cleanup }
    }

    pub fn scan(&self) -> OpsResult<CleanupScan> {
        self.cleanup.scan()
    }

    pub fn clean(&self, ids: Vec<String>) -> OpsResult<CleanupReport> {
        let mut unique = Vec::new();
        for id in ids {
            let id = id.trim().to_string();
            if !id.is_empty() && !unique.contains(&id) {
                unique.push(id);
            }
        }
        if unique.is_empty() {
            return Err(OpsError::InvalidInput("请选择要清理的项目".into()));
        }
        if unique.len() > 16 {
            return Err(OpsError::InvalidInput("单次最多清理 16 个项目".into()));
        }
        self.cleanup.clean(&unique)
    }
}

/// Startup entries, scheduled tasks and installed software.
#[derive(Clone)]
pub struct MaintenanceService {
    startup: Arc<dyn StartupManager>,
    software: Arc<dyn SoftwareInventory>,
}

impl MaintenanceService {
    pub fn new(startup: Arc<dyn StartupManager>, software: Arc<dyn SoftwareInventory>) -> Self {
        Self { startup, software }
    }

    pub fn startup_items(&self) -> OpsResult<Vec<StartupItem>> {
        self.startup.startup_items()
    }

    pub fn set_startup_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<StartupItem>> {
        if id.trim().is_empty() {
            return Err(OpsError::InvalidInput("启动项标识不能为空".into()));
        }
        self.startup.set_startup_enabled(id.trim(), enabled)
    }

    pub fn scheduled_tasks(&self) -> OpsResult<Vec<ScheduledTask>> {
        self.startup.scheduled_tasks()
    }

    pub fn set_task_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<ScheduledTask>> {
        if id.trim().is_empty() {
            return Err(OpsError::InvalidInput("计划任务标识不能为空".into()));
        }
        self.startup.set_task_enabled(id.trim(), enabled)
    }

    pub fn software(&self) -> OpsResult<Vec<InstalledApp>> {
        self.software.list()
    }

    pub fn uninstall_software(&self, id: &str) -> OpsResult<()> {
        let id = id.trim();
        if id.is_empty() {
            return Err(OpsError::InvalidInput("软件标识不能为空".into()));
        }
        self.software.uninstall(id)
    }
}

/// Log center use cases: list channels, run a bounded query, export a snapshot.
#[derive(Clone)]
pub struct LogService {
    logs: Arc<dyn LogCenter>,
}

impl LogService {
    pub fn new(logs: Arc<dyn LogCenter>) -> Self {
        Self { logs }
    }

    pub fn sources(&self) -> OpsResult<Vec<LogSource>> {
        self.logs.sources()
    }

    pub fn query(&self, mut query: LogQuery) -> OpsResult<LogBatch> {
        query.source = query.source.trim().to_string();
        if query.source.is_empty() {
            return Err(OpsError::InvalidInput("日志来源不能为空".into()));
        }
        if !(1..=2000).contains(&query.limit) {
            return Err(OpsError::InvalidInput(
                "单次查询数量需在 1 到 2000 之间".into(),
            ));
        }
        if !(1..=30).contains(&query.days) {
            return Err(OpsError::InvalidInput(
                "日志时间范围需在 1 到 30 天之间".into(),
            ));
        }
        if query.keyword.chars().count() > 128 {
            return Err(OpsError::InvalidInput("关键字不能超过 128 个字符".into()));
        }
        self.logs.query(&query)
    }

    pub fn clear(&self, source: &str) -> OpsResult<()> {
        let source = source.trim();
        if source.is_empty() {
            return Err(OpsError::InvalidInput("日志来源不能为空".into()));
        }
        self.logs.clear(source)
    }

    pub fn export(&self, entries: &[LogEntry]) -> OpsResult<LogExport> {
        if entries.is_empty() {
            return Err(OpsError::InvalidInput("没有可导出的日志".into()));
        }
        if entries.len() > 10_000 {
            return Err(OpsError::InvalidInput("单次最多导出 10000 条日志".into()));
        }
        self.logs.export(entries)
    }
}

/// System diagnostics and allow-listed quick repairs.
#[derive(Clone)]
pub struct DiagnosticsService {
    diagnostics: Arc<dyn Diagnostics>,
    report_dir: std::path::PathBuf,
}

impl DiagnosticsService {
    pub fn new(diagnostics: Arc<dyn Diagnostics>, report_dir: std::path::PathBuf) -> Self {
        Self {
            diagnostics,
            report_dir,
        }
    }

    pub fn read(&self) -> OpsResult<SystemDiagnostics> {
        self.diagnostics.read()
    }

    pub fn quick_actions(&self) -> Vec<QuickAction> {
        self.diagnostics.quick_actions()
    }

    pub fn run_quick_action(&self, id: &str) -> OpsResult<QuickActionResult> {
        let id = id.trim();
        if id.is_empty() {
            return Err(OpsError::InvalidInput("修复动作标识不能为空".into()));
        }
        self.diagnostics.run_quick_action(id)
    }

    pub fn export_report(&self, markdown: &str) -> OpsResult<std::path::PathBuf> {
        let body = markdown.trim();
        if body.is_empty() {
            return Err(OpsError::InvalidInput("诊断报告内容为空".into()));
        }
        if body.len() > 2 * 1024 * 1024 {
            return Err(OpsError::InvalidInput("诊断报告过大".into()));
        }
        std::fs::create_dir_all(&self.report_dir)
            .map_err(|error| OpsError::Platform(format!("无法创建报告目录: {error}")))?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        let path = self
            .report_dir
            .join(format!("qingshan-diagnostics-{stamp}.md"));
        std::fs::write(&path, format!("{body}\n"))
            .map_err(|error| OpsError::Platform(format!("无法写入诊断报告: {error}")))?;
        Ok(path)
    }
}

/// Composed use cases for the desktop client.
#[derive(Clone)]
pub struct OpsService {
    system: Arc<dyn SystemProbe>,
    processes: Arc<dyn ProcessControl>,
    services: Arc<dyn ServiceControl>,
    network: Arc<dyn NetworkProbe>,
    elevation: Arc<dyn Elevation>,
}

impl OpsService {
    pub fn new(
        system: Arc<dyn SystemProbe>,
        processes: Arc<dyn ProcessControl>,
        services: Arc<dyn ServiceControl>,
        network: Arc<dyn NetworkProbe>,
        elevation: Arc<dyn Elevation>,
    ) -> Self {
        Self {
            system,
            processes,
            services,
            network,
            elevation,
        }
    }

    pub fn snapshot(&self) -> OpsResult<SystemSnapshot> {
        self.system.snapshot()
    }

    pub fn list_processes(&self) -> OpsResult<Vec<ProcessInfo>> {
        self.processes.list()
    }

    /// Terminate a process, refusing to target the running 青衫工具箱 instance.
    /// The guard lives at the application boundary so every caller inherits it,
    /// including future web/CLI front ends built on this service.
    pub fn kill_process(&self, pid: u32, force: bool) -> OpsResult<()> {
        if pid == std::process::id() {
            return Err(OpsError::InvalidInput("不能终止青衫工具箱自身进程".into()));
        }
        self.processes.kill(pid, force)
    }

    pub fn list_services(&self) -> OpsResult<Vec<ServiceInfo>> {
        self.services.list()
    }

    pub fn apply_service(&self, name: &str, action: ServiceAction) -> OpsResult<ServiceInfo> {
        let name = name.trim();
        if name.is_empty() {
            return Err(OpsError::InvalidInput("服务名称不能为空".into()));
        }
        self.services.apply(name, action)
    }

    pub fn interfaces(&self) -> OpsResult<Vec<NetworkInterface>> {
        self.network.interfaces()
    }

    pub fn check_port(&self, host: &str, port: u16, timeout_ms: u64) -> OpsResult<PortCheckResult> {
        if host.trim().is_empty() {
            return Err(OpsError::InvalidInput("主机地址不能为空".into()));
        }
        if port == 0 {
            return Err(OpsError::InvalidInput("端口必须大于 0".into()));
        }
        self.network.check_port(host.trim(), port, timeout_ms)
    }

    pub fn resolve(&self, host: &str) -> OpsResult<DnsLookupResult> {
        if host.trim().is_empty() {
            return Err(OpsError::InvalidInput("主机地址不能为空".into()));
        }
        self.network.resolve(host.trim())
    }

    pub fn is_elevated(&self) -> bool {
        self.elevation.is_elevated()
    }

    pub fn relaunch_elevated(&self) -> OpsResult<()> {
        self.elevation.relaunch_elevated()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use devops_core::LogLevel;
    use devops_testkit::{MockDiagnostics, MockLogs};

    #[test]
    fn service_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<OpsService>();
        assert_send_sync::<LogService>();
    }

    #[test]
    fn log_query_is_validated_and_forwarded() {
        let logs = Arc::new(MockLogs::new());
        let service = LogService::new(logs.clone());
        let batch = service
            .query(LogQuery {
                source: " application ".into(),
                level: Some(LogLevel::Error),
                keyword: "崩溃".into(),
                limit: 10,
                days: 3,
            })
            .expect("query");
        assert_eq!(batch.entries.len(), 1);
        assert_eq!(batch.entries[0].event_id, 1000);
        assert_eq!(logs.query_calls()[0].source, "application");
    }

    #[test]
    fn log_query_rejects_bad_limit() {
        let service = LogService::new(Arc::new(MockLogs::new()));
        let error = service
            .query(LogQuery {
                limit: 0,
                ..LogQuery::default()
            })
            .unwrap_err();
        assert!(error.to_string().contains("1 到 2000"));
    }

    #[test]
    fn log_clear_is_forwarded_and_validated() {
        let logs = Arc::new(MockLogs::new());
        let service = LogService::new(logs.clone());
        service.clear(" application ").expect("clear");
        assert_eq!(logs.clear_calls(), vec!["application".to_string()]);
        assert!(service.clear("  ").is_err());
    }

    #[test]
    fn log_export_rejects_empty() {
        let service = LogService::new(Arc::new(MockLogs::new()));
        assert!(service.export(&[]).is_err());
    }

    #[test]
    fn diagnostics_export_writes_markdown_and_rejects_empty() {
        let directory = std::env::temp_dir().join(format!(
            "qingshan-diagnostics-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let service = DiagnosticsService::new(Arc::new(MockDiagnostics::new()), directory.clone());
        let path = service
            .export_report("# 诊断报告\n\n- 主机: test")
            .expect("export");
        assert!(path.starts_with(&directory));
        assert_eq!(
            std::fs::read_to_string(&path).expect("report"),
            "# 诊断报告\n\n- 主机: test\n"
        );
        assert!(service.export_report("  ").is_err());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn diagnostics_quick_action_rejects_blank_id() {
        let service =
            DiagnosticsService::new(Arc::new(MockDiagnostics::new()), std::env::temp_dir());
        assert!(service.run_quick_action(" ").is_err());
        assert!(!service.quick_actions().is_empty());
        assert_eq!(service.read().expect("read").gpus.len(), 1);
    }
}
