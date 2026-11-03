//! Deterministic in-memory adapters for framework tests.
//!
//! The testkit implements every `devops-core` capability trait and records the
//! calls it receives. It has no Windows dependency, so the application layer can
//! be tested on any CI host.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use devops_core::{
    BatteryInfo, Cleanup, CleanupCategory, CleanupOutcome, CleanupReport, CleanupScan,
    CleanupTarget, Diagnostics, DiskHealth, DnsLookupResult, Elevation, GpuInfo, InstalledApp,
    LogBatch, LogCenter, LogEntry, LogExport, LogField, LogLevel, LogQuery, LogSource,
    LogSourceKind, NetworkInterface, NetworkProbe, OpsError, OpsResult, PortCheckResult,
    ProcessControl, ProcessInfo, QuickAction, QuickActionResult, ScheduledTask, ServiceAction,
    ServiceControl, ServiceInfo, ServiceStatus, SoftwareInventory, SoftwareKind, SoftwareScope,
    StartupItem, StartupLocation, StartupManager, StartupScope, SystemDiagnostics, SystemProbe,
    SystemSnapshot,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

pub fn sample_snapshot() -> SystemSnapshot {
    SystemSnapshot {
        hostname: "OPS-MOCK".into(),
        os_name: "Windows 11 Pro".into(),
        os_version: "24H2".into(),
        kernel_version: "10.0.26100".into(),
        arch: "x86_64".into(),
        uptime_secs: 9_000,
        boot_time: 1_700_000_000,
        cpu_brand: "Test CPU".into(),
        physical_cores: 4,
        logical_cores: 8,
        cpu_usage: 12.5,
        per_core_usage: vec![10.0, 20.0, 5.0, 15.0],
        memory_total: 16 * 1024 * 1024 * 1024,
        memory_used: 8 * 1024 * 1024 * 1024,
        swap_total: 2 * 1024 * 1024 * 1024,
        swap_used: 512 * 1024 * 1024,
        disks: vec![devops_core::DiskInfo {
            name: "System".into(),
            mount_point: "C:\\".into(),
            file_system: "NTFS".into(),
            total: 512 * 1024 * 1024 * 1024,
            available: 256 * 1024 * 1024 * 1024,
            removable: false,
        }],
        is_elevated: false,
    }
}

pub fn sample_processes() -> Vec<ProcessInfo> {
    vec![
        ProcessInfo {
            pid: 4242,
            name: "mock-worker.exe".into(),
            exe: Some("C:\\Mock\\mock-worker.exe".into()),
            command: "mock-worker.exe --serve".into(),
            cpu_usage: 2.5,
            memory: 128 * 1024 * 1024,
            virtual_memory: 256 * 1024 * 1024,
            status: "运行中".into(),
            user: Some("tester".into()),
            start_time: 1_700_000_100,
        },
        ProcessInfo {
            pid: 9999,
            name: "opsdeck.exe".into(),
            exe: Some("C:\\Mock\\opsdeck.exe".into()),
            command: "opsdeck.exe".into(),
            cpu_usage: 0.4,
            memory: 64 * 1024 * 1024,
            virtual_memory: 96 * 1024 * 1024,
            status: "运行中".into(),
            user: Some("tester".into()),
            start_time: 1_700_000_200,
        },
    ]
}

pub fn sample_services() -> Vec<ServiceInfo> {
    vec![
        ServiceInfo {
            name: "MockSvc".into(),
            display_name: "Mock Service".into(),
            status: ServiceStatus::Running,
            start_type: "auto".into(),
            process_id: 4242,
            can_stop: true,
        },
        ServiceInfo {
            name: "MockStopped".into(),
            display_name: "Mock Stopped Service".into(),
            status: ServiceStatus::Stopped,
            start_type: "manual".into(),
            process_id: 0,
            can_stop: true,
        },
    ]
}

pub fn sample_interfaces() -> Vec<NetworkInterface> {
    vec![NetworkInterface {
        name: "Ethernet".into(),
        mac: "00-11-22-33-44-55".into(),
        ipv4: vec!["192.0.2.10".into()],
        ipv6: vec!["2001:db8::10".into()],
        is_loopback: false,
        is_up: true,
        total_received: 1024,
        total_transmitted: 512,
    }]
}

pub fn sample_port_result() -> PortCheckResult {
    PortCheckResult {
        host: "127.0.0.1".into(),
        port: 443,
        open: true,
        latency_ms: 12,
        error: None,
    }
}

pub fn sample_dns_result() -> DnsLookupResult {
    DnsLookupResult {
        host: "example.com".into(),
        addresses: vec!["127.0.0.1".into()],
        latency_ms: 4,
        error: None,
    }
}

pub fn sample_logs() -> Vec<LogEntry> {
    vec![
        LogEntry {
            id: "Application-1000-20261030010203".into(),
            timestamp: "2026-10-30T01:02:03.0000000Z".into(),
            level: LogLevel::Error,
            channel: "Application".into(),
            provider: "Application Error".into(),
            event_id: 1000,
            message: "demo.exe 崩溃，异常代码 0xc0000005".into(),
            computer: "OPS-MOCK".into(),
            user: Some("S-1-5-18".into()),
            fields: vec![LogField {
                name: "异常代码".into(),
                value: "0xc0000005".into(),
            }],
        },
        LogEntry {
            id: "System-7036-20261030010100".into(),
            timestamp: "2026-10-30T01:01:00.0000000Z".into(),
            level: LogLevel::Information,
            channel: "System".into(),
            provider: "Service Control Manager".into(),
            event_id: 7036,
            message: "Windows Update 服务进入运行状态".into(),
            computer: "OPS-MOCK".into(),
            user: None,
            fields: Vec::new(),
        },
        LogEntry {
            id: "Application-1001-20261030010000".into(),
            timestamp: "2026-10-30T01:00:00.0000000Z".into(),
            level: LogLevel::Warning,
            channel: "Application".into(),
            provider: "Windows Error Reporting".into(),
            event_id: 1001,
            message: "Windows 错误报告队列已满".into(),
            computer: "OPS-MOCK".into(),
            user: None,
            fields: Vec::new(),
        },
    ]
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

pub struct MockSystem {
    pub snapshot: SystemSnapshot,
    pub fail: bool,
}

impl MockSystem {
    pub fn new() -> Self {
        Self {
            snapshot: sample_snapshot(),
            fail: false,
        }
    }

    pub fn failing() -> Self {
        Self {
            snapshot: sample_snapshot(),
            fail: true,
        }
    }
}

impl Default for MockSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemProbe for MockSystem {
    fn snapshot(&self) -> OpsResult<SystemSnapshot> {
        if self.fail {
            return Err(OpsError::Platform("mock snapshot failure".into()));
        }
        Ok(self.snapshot.clone())
    }
}

pub struct MockProcesses {
    processes: Mutex<Vec<ProcessInfo>>,
    killed: Mutex<Vec<(u32, bool)>>,
    pub fail_list: bool,
}

impl MockProcesses {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(sample_processes()),
            killed: Mutex::new(Vec::new()),
            fail_list: false,
        }
    }

    pub fn with_processes(processes: Vec<ProcessInfo>) -> Self {
        Self {
            processes: Mutex::new(processes),
            killed: Mutex::new(Vec::new()),
            fail_list: false,
        }
    }

    pub fn killed_calls(&self) -> Vec<(u32, bool)> {
        self.killed.lock().expect("mock lock").clone()
    }
}

impl Default for MockProcesses {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessControl for MockProcesses {
    fn list(&self) -> OpsResult<Vec<ProcessInfo>> {
        if self.fail_list {
            return Err(OpsError::Platform("mock process list failure".into()));
        }
        Ok(self.processes.lock().expect("mock lock").clone())
    }

    fn kill(&self, pid: u32, force: bool) -> OpsResult<()> {
        self.killed.lock().expect("mock lock").push((pid, force));
        let mut processes = self.processes.lock().expect("mock lock");
        let Some(index) = processes.iter().position(|process| process.pid == pid) else {
            return Err(OpsError::NotFound(format!("PID {pid}")));
        };
        processes.remove(index);
        Ok(())
    }
}

pub struct MockServices {
    services: Mutex<Vec<ServiceInfo>>,
    actions: Mutex<Vec<(String, ServiceAction)>>,
    pub fail: bool,
}

impl MockServices {
    pub fn new() -> Self {
        Self {
            services: Mutex::new(sample_services()),
            actions: Mutex::new(Vec::new()),
            fail: false,
        }
    }

    pub fn action_calls(&self) -> Vec<(String, ServiceAction)> {
        self.actions.lock().expect("mock lock").clone()
    }
}

impl Default for MockServices {
    fn default() -> Self {
        Self::new()
    }
}

impl ServiceControl for MockServices {
    fn list(&self) -> OpsResult<Vec<ServiceInfo>> {
        if self.fail {
            return Err(OpsError::Platform("mock service list failure".into()));
        }
        Ok(self.services.lock().expect("mock lock").clone())
    }

    fn apply(&self, name: &str, action: ServiceAction) -> OpsResult<ServiceInfo> {
        self.actions
            .lock()
            .expect("mock lock")
            .push((name.to_string(), action));

        let mut services = self.services.lock().expect("mock lock");
        let Some(service) = services.iter_mut().find(|service| service.name == name) else {
            return Err(OpsError::NotFound(format!("service {name}")));
        };
        service.status = match action {
            ServiceAction::Stop => ServiceStatus::Stopped,
            ServiceAction::Start | ServiceAction::Restart => ServiceStatus::Running,
        };
        Ok(service.clone())
    }
}

pub struct MockNetwork {
    interfaces: Vec<NetworkInterface>,
    port_result: PortCheckResult,
    dns_result: DnsLookupResult,
    port_calls: Mutex<Vec<(String, u16, u64)>>,
    dns_calls: Mutex<Vec<String>>,
    pub fail: bool,
}

impl MockNetwork {
    pub fn new() -> Self {
        Self {
            interfaces: sample_interfaces(),
            port_result: sample_port_result(),
            dns_result: sample_dns_result(),
            port_calls: Mutex::new(Vec::new()),
            dns_calls: Mutex::new(Vec::new()),
            fail: false,
        }
    }

    pub fn port_calls(&self) -> Vec<(String, u16, u64)> {
        self.port_calls.lock().expect("mock lock").clone()
    }

    pub fn dns_calls(&self) -> Vec<String> {
        self.dns_calls.lock().expect("mock lock").clone()
    }
}

impl Default for MockNetwork {
    fn default() -> Self {
        Self::new()
    }
}

impl NetworkProbe for MockNetwork {
    fn interfaces(&self) -> OpsResult<Vec<NetworkInterface>> {
        if self.fail {
            return Err(OpsError::Platform("mock interface failure".into()));
        }
        Ok(self.interfaces.clone())
    }

    fn check_port(&self, host: &str, port: u16, timeout_ms: u64) -> OpsResult<PortCheckResult> {
        self.port_calls
            .lock()
            .expect("mock lock")
            .push((host.to_string(), port, timeout_ms));
        Ok(self.port_result.clone())
    }

    fn resolve(&self, host: &str) -> OpsResult<DnsLookupResult> {
        self.dns_calls
            .lock()
            .expect("mock lock")
            .push(host.to_string());
        Ok(self.dns_result.clone())
    }
}

pub struct MockLogs {
    entries: Vec<LogEntry>,
    queries: Mutex<Vec<LogQuery>>,
    exports: Mutex<Vec<usize>>,
    clears: Mutex<Vec<String>>,
    pub fail: bool,
}

impl MockLogs {
    pub fn new() -> Self {
        Self {
            entries: sample_logs(),
            queries: Mutex::new(Vec::new()),
            exports: Mutex::new(Vec::new()),
            clears: Mutex::new(Vec::new()),
            fail: false,
        }
    }

    pub fn query_calls(&self) -> Vec<LogQuery> {
        self.queries.lock().expect("mock lock").clone()
    }

    pub fn export_calls(&self) -> Vec<usize> {
        self.exports.lock().expect("mock lock").clone()
    }

    pub fn clear_calls(&self) -> Vec<String> {
        self.clears.lock().expect("mock lock").clone()
    }
}

impl Default for MockLogs {
    fn default() -> Self {
        Self::new()
    }
}

impl LogCenter for MockLogs {
    fn sources(&self) -> OpsResult<Vec<LogSource>> {
        Ok(vec![
            LogSource {
                id: "application".into(),
                name: "应用程序".into(),
                kind: LogSourceKind::EventLog,
                description: "mock application log".into(),
                available: true,
            },
            LogSource {
                id: "system".into(),
                name: "系统".into(),
                kind: LogSourceKind::EventLog,
                description: "mock system log".into(),
                available: true,
            },
        ])
    }

    fn query(&self, query: &LogQuery) -> OpsResult<LogBatch> {
        if self.fail {
            return Err(OpsError::Platform("mock log query failure".into()));
        }
        self.queries.lock().expect("mock lock").push(query.clone());
        let keyword = query.keyword.trim().to_lowercase();
        let matched: Vec<LogEntry> = self
            .entries
            .iter()
            .filter(|entry| {
                query
                    .level
                    .map(|level| entry.level == level)
                    .unwrap_or(true)
                    && (keyword.is_empty() || entry.message.to_lowercase().contains(&keyword))
            })
            .cloned()
            .collect();
        let total = matched.len();
        let entries = matched.into_iter().take(query.limit).collect();
        Ok(LogBatch {
            source: query.source.clone(),
            entries,
            scanned: self.entries.len(),
            total,
            truncated: total > query.limit,
        })
    }

    fn export(&self, entries: &[LogEntry]) -> OpsResult<LogExport> {
        self.exports.lock().expect("mock lock").push(entries.len());
        Ok(LogExport {
            path: "C:\\Mock\\logs.csv".into(),
            count: entries.len(),
        })
    }

    fn clear(&self, source: &str) -> OpsResult<()> {
        self.clears
            .lock()
            .expect("mock lock")
            .push(source.to_string());
        Ok(())
    }
}

#[derive(Default)]
pub struct MockElevation {
    elevated: AtomicBool,
    relaunched: AtomicBool,
}

impl MockElevation {
    pub fn new(elevated: bool) -> Self {
        Self {
            elevated: AtomicBool::new(elevated),
            relaunched: AtomicBool::new(false),
        }
    }

    pub fn relaunched(&self) -> bool {
        self.relaunched.load(Ordering::SeqCst)
    }
}

impl Elevation for MockElevation {
    fn is_elevated(&self) -> bool {
        self.elevated.load(Ordering::SeqCst)
    }

    fn relaunch_elevated(&self) -> OpsResult<()> {
        if self.is_elevated() {
            return Err(OpsError::InvalidInput(
                "青衫工具箱已以管理员身份运行".into(),
            ));
        }
        self.relaunched.store(true, Ordering::SeqCst);
        Ok(())
    }
}

/// Deterministic cleanup adapter. It never touches the filesystem.
pub struct MockCleanup {
    pub calls: Mutex<Vec<Vec<String>>>,
    pub fail: AtomicBool,
    target: CleanupTarget,
}

impl MockCleanup {
    pub fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            fail: AtomicBool::new(false),
            target: CleanupTarget {
                id: "mock.temp".into(),
                name: "测试临时文件".into(),
                path: "%TEMP%".into(),
                category: CleanupCategory::Temp,
                requires_admin: false,
                available: true,
                bytes: 1024,
                files: 4,
                note: "mock".into(),
            },
        }
    }
}

impl Cleanup for MockCleanup {
    fn scan(&self) -> OpsResult<CleanupScan> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(OpsError::Platform("mock cleanup failure".into()));
        }
        let target = self.target.clone();
        Ok(CleanupScan {
            total_bytes: target.bytes,
            total_files: target.files,
            scanned_at: 0,
            targets: vec![target],
        })
    }

    fn clean(&self, ids: &[String]) -> OpsResult<CleanupReport> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(OpsError::Platform("mock cleanup failure".into()));
        }
        self.calls.lock().unwrap().push(ids.to_vec());
        let outcomes = ids
            .iter()
            .map(|id| CleanupOutcome {
                id: id.clone(),
                name: "测试临时文件".into(),
                freed_bytes: 1024,
                removed_files: 4,
                errors: Vec::new(),
            })
            .collect();
        Ok(CleanupReport {
            outcomes,
            freed_bytes: 1024 * ids.len() as u64,
            removed_files: 4 * ids.len() as u64,
            errors: Vec::new(),
        })
    }
}

impl Default for MockCleanup {
    fn default() -> Self {
        Self::new()
    }
}

/// Deterministic startup/task adapter.
pub struct MockStartup {
    pub items: Mutex<Vec<StartupItem>>,
    pub tasks: Mutex<Vec<ScheduledTask>>,
    pub task_failure: AtomicBool,
}

impl MockStartup {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(vec![StartupItem {
                id: "startup:user:mock".into(),
                name: "Mock Startup".into(),
                command: "mock.exe".into(),
                location: StartupLocation::RegistryRun,
                scope: StartupScope::User,
                enabled: true,
                editable: true,
            }]),
            tasks: Mutex::new(vec![ScheduledTask {
                id: "task:mock".into(),
                name: "Mock Task".into(),
                path: "\\".into(),
                state: "Ready".into(),
                description: "mock".into(),
                author: "testkit".into(),
                enabled: true,
            }]),
            task_failure: AtomicBool::new(false),
        }
    }
}

impl StartupManager for MockStartup {
    fn startup_items(&self) -> OpsResult<Vec<StartupItem>> {
        Ok(self.items.lock().unwrap().clone())
    }

    fn set_startup_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<StartupItem>> {
        let mut items = self.items.lock().unwrap();
        let item = items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| OpsError::NotFound(id.into()))?;
        item.enabled = enabled;
        Ok(items.clone())
    }

    fn scheduled_tasks(&self) -> OpsResult<Vec<ScheduledTask>> {
        if self.task_failure.load(Ordering::SeqCst) {
            return Err(OpsError::Platform("mock task failure".into()));
        }
        Ok(self.tasks.lock().unwrap().clone())
    }

    fn set_task_enabled(&self, id: &str, enabled: bool) -> OpsResult<Vec<ScheduledTask>> {
        let mut tasks = self.tasks.lock().unwrap();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| OpsError::NotFound(id.into()))?;
        task.enabled = enabled;
        task.state = if enabled { "Ready" } else { "Disabled" }.into();
        Ok(tasks.clone())
    }
}

impl Default for MockStartup {
    fn default() -> Self {
        Self::new()
    }
}

/// Read-only software inventory fixture.
pub struct MockSoftware {
    apps: Vec<InstalledApp>,
}

impl MockSoftware {
    pub fn new() -> Self {
        Self {
            apps: vec![InstalledApp {
                id: "app:mock".into(),
                kind: SoftwareKind::Application,
                name: "Mock App".into(),
                version: "1.0.0".into(),
                publisher: "Testkit".into(),
                install_date: "20260101".into(),
                install_location: r"C:\Program Files\Mock".into(),
                uninstall_string: String::new(),
                scope: SoftwareScope::Machine,
                registry_view: "64".into(),
                icon: None,
                last_used: None,
            }],
        }
    }
}

impl SoftwareInventory for MockSoftware {
    fn list(&self) -> OpsResult<Vec<InstalledApp>> {
        Ok(self.apps.clone())
    }

    fn uninstall(&self, id: &str) -> OpsResult<()> {
        if self.apps.iter().any(|app| app.id == id) {
            Ok(())
        } else {
            Err(OpsError::NotFound(id.into()))
        }
    }
}

impl Default for MockSoftware {
    fn default() -> Self {
        Self::new()
    }
}

/// Deterministic diagnostics fixture.
pub struct MockDiagnostics {
    pub calls: Mutex<Vec<String>>,
    pub fail: bool,
}

impl MockDiagnostics {
    pub fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            fail: false,
        }
    }
}

impl Diagnostics for MockDiagnostics {
    fn read(&self) -> OpsResult<SystemDiagnostics> {
        if self.fail {
            return Err(OpsError::Platform("mock diagnostics failure".into()));
        }
        self.calls.lock().unwrap().push("read".into());
        Ok(SystemDiagnostics {
            collected_at: "2026-01-01 00:00:00".into(),
            battery: Some(BatteryInfo {
                name: "Mock Battery".into(),
                charge_percent: Some(72),
                status: "已接通电源".into(),
                estimated_minutes: Some(180),
            }),
            disks: vec![DiskHealth {
                name: "Mock NVMe".into(),
                media_type: "SSD".into(),
                health: "Healthy".into(),
                operational_status: "OK".into(),
                size_bytes: 512 * 1024 * 1024 * 1024,
            }],
            gpus: vec![GpuInfo {
                name: "Mock GPU".into(),
                driver_version: "1.2.3".into(),
                memory_bytes: 8 * 1024 * 1024 * 1024,
            }],
        })
    }

    fn quick_actions(&self) -> Vec<QuickAction> {
        vec![QuickAction {
            id: "flush-dns".into(),
            name: "刷新 DNS 缓存".into(),
            description: "mock".into(),
            requires_admin: false,
        }]
    }

    fn run_quick_action(&self, id: &str) -> OpsResult<QuickActionResult> {
        self.calls.lock().unwrap().push(id.into());
        if self.fail {
            return Err(OpsError::Platform("mock action failure".into()));
        }
        if id == "flush-dns" {
            Ok(QuickActionResult {
                action: id.into(),
                message: "DNS 缓存已刷新".into(),
            })
        } else {
            Err(OpsError::InvalidInput(id.into()))
        }
    }
}

impl Default for MockDiagnostics {
    fn default() -> Self {
        Self::new()
    }
}

/// Bundle of mock adapters for tests that want the full capability set.
pub struct MockAdapters {
    pub system: Arc<MockSystem>,
    pub processes: Arc<MockProcesses>,
    pub services: Arc<MockServices>,
    pub network: Arc<MockNetwork>,
    pub elevation: Arc<MockElevation>,
    pub logs: Arc<MockLogs>,
    pub cleanup: Arc<MockCleanup>,
    pub startup: Arc<MockStartup>,
    pub software: Arc<MockSoftware>,
    pub diagnostics: Arc<MockDiagnostics>,
}

impl MockAdapters {
    pub fn new() -> Self {
        Self {
            system: Arc::new(MockSystem::new()),
            processes: Arc::new(MockProcesses::new()),
            services: Arc::new(MockServices::new()),
            network: Arc::new(MockNetwork::new()),
            elevation: Arc::new(MockElevation::new(false)),
            logs: Arc::new(MockLogs::new()),
            cleanup: Arc::new(MockCleanup::new()),
            startup: Arc::new(MockStartup::new()),
            software: Arc::new(MockSoftware::new()),
            diagnostics: Arc::new(MockDiagnostics::new()),
        }
    }
}

impl Default for MockAdapters {
    fn default() -> Self {
        Self::new()
    }
}
