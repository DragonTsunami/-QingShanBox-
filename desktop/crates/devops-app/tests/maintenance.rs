use devops_app::{CleanupService, MaintenanceService};
use devops_testkit::MockAdapters;

#[test]
fn cleanup_scan_and_clean_are_forwarded() {
    let adapters = MockAdapters::new();
    let service = CleanupService::new(adapters.cleanup.clone());

    let scan = service.scan().expect("scan");
    assert_eq!(scan.targets.len(), 1);
    assert_eq!(scan.total_bytes, 1024);

    let report = service.clean(vec!["mock.temp".into()]).expect("clean");
    assert_eq!(report.freed_bytes, 1024);
    assert_eq!(report.outcomes[0].id, "mock.temp");
    assert_eq!(
        adapters.cleanup.calls.lock().unwrap().as_slice(),
        &[vec!["mock.temp".to_string()]]
    );
}

#[test]
fn startup_and_task_toggles_round_trip() {
    let adapters = MockAdapters::new();
    let service = MaintenanceService::new(adapters.startup.clone(), adapters.software.clone());

    let items = service.startup_items().expect("startup items");
    assert!(items[0].enabled);
    let items = service
        .set_startup_enabled(&items[0].id, false)
        .expect("disable startup");
    assert!(!items[0].enabled);

    let tasks = service.scheduled_tasks().expect("tasks");
    let tasks = service
        .set_task_enabled(&tasks[0].id, false)
        .expect("disable task");
    assert!(!tasks[0].enabled);
    assert_eq!(tasks[0].state, "Disabled");
}

#[test]
fn software_inventory_is_read_only() {
    let adapters = MockAdapters::new();
    let service = MaintenanceService::new(adapters.startup.clone(), adapters.software.clone());
    let apps = service.software().expect("software");
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].name, "Mock App");
}
