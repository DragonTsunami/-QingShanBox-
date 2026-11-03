//! Framework tests for the application service layer. These run without a
//! webview or Windows host by injecting `devops-testkit` adapters.

use devops_app::OpsService;
use devops_core::{OpsError, ServiceAction, ServiceStatus};
use devops_testkit::{
    MockAdapters, MockElevation, MockNetwork, MockProcesses, MockServices, MockSystem,
};

fn setup() -> (OpsService, MockAdapters) {
    let mocks = MockAdapters::new();
    let service = OpsService::new(
        mocks.system.clone(),
        mocks.processes.clone(),
        mocks.services.clone(),
        mocks.network.clone(),
        mocks.elevation.clone(),
    );
    (service, mocks)
}

#[test]
fn snapshot_and_processes_pass_through() {
    let (service, _) = setup();

    let snapshot = service.snapshot().expect("snapshot");
    assert_eq!(snapshot.hostname, "OPS-MOCK");
    assert_eq!(snapshot.logical_cores, 8);

    let processes = service.list_processes().expect("processes");
    assert_eq!(processes.len(), 2);
    assert!(processes.iter().any(|process| process.pid == 4242));
}

#[test]
fn kill_forwards_force_flag() {
    let (service, mocks) = setup();

    service.kill_process(4242, true).expect("kill");

    assert_eq!(mocks.processes.killed_calls(), vec![(4242, true)]);
}

#[test]
fn kill_rejects_the_running_desktop_process() {
    let (service, mocks) = setup();

    let error = service
        .kill_process(std::process::id(), false)
        .expect_err("self-kill must be rejected");

    assert!(matches!(error, OpsError::InvalidInput(_)));
    assert!(mocks.processes.killed_calls().is_empty());
}

#[test]
fn kill_propagates_not_found() {
    let (service, mocks) = setup();

    let error = service
        .kill_process(123_456, false)
        .expect_err("unknown pid");

    assert!(matches!(error, OpsError::NotFound(_)));
    assert_eq!(mocks.processes.killed_calls(), vec![(123_456, false)]);
}

#[test]
fn service_action_updates_state_and_records_call() {
    let (service, mocks) = setup();

    let updated = service
        .apply_service("MockSvc", ServiceAction::Restart)
        .expect("restart");

    assert_eq!(updated.status, ServiceStatus::Running);
    assert_eq!(
        mocks.services.action_calls(),
        vec![("MockSvc".to_string(), ServiceAction::Restart)]
    );
}

#[test]
fn blank_or_unknown_service_is_rejected() {
    let (service, mocks) = setup();

    let blank = service
        .apply_service("   ", ServiceAction::Start)
        .expect_err("blank name");
    assert!(matches!(blank, OpsError::InvalidInput(_)));

    let missing = service
        .apply_service("NoSuchService", ServiceAction::Stop)
        .expect_err("unknown service");
    assert!(matches!(missing, OpsError::NotFound(_)));

    assert_eq!(mocks.services.action_calls().len(), 1);
}

#[test]
fn network_calls_forward_trimmed_arguments() {
    let (service, mocks) = setup();

    let probe = service
        .check_port("  127.0.0.1  ", 443, 1_500)
        .expect("port check");
    assert!(probe.open);
    assert_eq!(
        mocks.network.port_calls(),
        vec![("127.0.0.1".to_string(), 443, 1_500)]
    );

    let dns = service.resolve("  example.com ").expect("dns");
    assert_eq!(dns.addresses, vec!["127.0.0.1".to_string()]);
    assert_eq!(mocks.network.dns_calls(), vec!["example.com".to_string()]);
}

#[test]
fn invalid_network_inputs_are_rejected_before_the_adapter() {
    let (service, mocks) = setup();

    assert!(matches!(
        service.check_port("", 443, 500),
        Err(OpsError::InvalidInput(_))
    ));
    assert!(matches!(
        service.check_port("127.0.0.1", 0, 500),
        Err(OpsError::InvalidInput(_))
    ));
    assert!(matches!(
        service.resolve(" "),
        Err(OpsError::InvalidInput(_))
    ));
    assert!(mocks.network.port_calls().is_empty());
    assert!(mocks.network.dns_calls().is_empty());
}

#[test]
fn elevation_state_and_relaunch_are_exposed() {
    let (service, mocks) = setup();
    assert!(!service.is_elevated());

    service.relaunch_elevated().expect("relaunch");
    assert!(mocks.elevation.relaunched());
}

#[test]
fn elevated_relaunch_is_an_invalid_operation() {
    let mocks = MockAdapters {
        elevation: std::sync::Arc::new(MockElevation::new(true)),
        ..MockAdapters::new()
    };
    let service = OpsService::new(
        mocks.system.clone(),
        mocks.processes.clone(),
        mocks.services.clone(),
        mocks.network.clone(),
        mocks.elevation.clone(),
    );

    assert!(service.is_elevated());
    assert!(matches!(
        service.relaunch_elevated(),
        Err(OpsError::InvalidInput(_))
    ));
}

#[test]
fn adapter_errors_keep_their_machine_readable_code() {
    let failing_system = std::sync::Arc::new(MockSystem::failing());
    let service = OpsService::new(
        failing_system,
        std::sync::Arc::new(MockProcesses::new()),
        std::sync::Arc::new(MockServices::new()),
        std::sync::Arc::new(MockNetwork::new()),
        std::sync::Arc::new(MockElevation::default()),
    );

    let error = service.snapshot().expect_err("failure must propagate");
    assert_eq!(error.code(), "platform");
    assert!(error.to_string().contains("mock snapshot failure"));
}
