//! Integration tests that exercise the real Windows adapters. They are read-only
//! (no services are started/stopped and no processes are killed).

use devops_core::{LogQuery, ServiceStatus};
use devops_platform::DesktopPlatform;

fn platform() -> DesktopPlatform {
    DesktopPlatform::new().expect("platform adapters should initialize")
}

#[test]
fn snapshot_reports_local_machine() {
    let snapshot = platform().system.snapshot().expect("snapshot");
    assert!(!snapshot.hostname.trim().is_empty());
    assert!(snapshot.memory_total > 0);
    assert!(snapshot.logical_cores > 0);
    assert!(!snapshot.cpu_brand.trim().is_empty());
    assert!(!snapshot.disks.is_empty());
    assert_eq!(snapshot.arch, std::env::consts::ARCH);
}

#[test]
fn process_list_contains_current_process() {
    let processes = platform().processes.list().expect("process list");
    assert!(processes.len() > 10);
    let current = std::process::id();
    assert!(
        processes.iter().any(|process| process.pid == current),
        "current process {current} should be visible"
    );
}

#[test]
fn process_cannot_kill_itself() {
    let platform = platform();
    let error = platform
        .processes
        .kill(std::process::id(), false)
        .expect_err("killing 青衫工具箱 itself must be rejected");
    assert!(matches!(error, devops_core::OpsError::InvalidInput(_)));
}

#[test]
fn service_list_reports_windows_services() {
    let services = platform().services.list().expect("service list");
    assert!(services.len() > 10, "expected a populated service list");
    assert!(services
        .iter()
        .any(|service| service.status == ServiceStatus::Running));
    assert!(services
        .iter()
        .all(|service| !service.name.trim().is_empty()));
}

#[test]
fn network_interfaces_are_reported() {
    let interfaces = platform().network.interfaces().expect("interfaces");
    assert!(!interfaces.is_empty());
    assert!(interfaces
        .iter()
        .any(|interface| !interface.ipv4.is_empty() || !interface.ipv6.is_empty()));
}

#[test]
fn dns_resolves_localhost() {
    let result = platform().network.resolve("localhost").expect("resolve");
    assert!(
        result.error.is_none(),
        "localhost should resolve: {result:?}"
    );
    assert!(result
        .addresses
        .iter()
        .any(|address| address == "127.0.0.1" || address == "::1"));
}

#[test]
fn closed_port_is_reported_as_closed() {
    let result = platform()
        .network
        .check_port("127.0.0.1", 1, 500)
        .expect("port check");
    assert!(!result.open);
    assert!(result.error.is_some());
}

#[test]
fn event_log_query_reads_application_channel() {
    let batch = platform()
        .logs
        .query(&LogQuery {
            source: "application".into(),
            level: None,
            keyword: String::new(),
            limit: 5,
            days: 3,
        })
        .expect("application event log query");
    assert!(
        !batch.entries.is_empty(),
        "expected recent application events"
    );
    assert!(batch.scanned >= batch.entries.len());
    assert_eq!(batch.source, "application");
    assert!(batch.entries.iter().all(|entry| !entry.channel.is_empty()));
}
