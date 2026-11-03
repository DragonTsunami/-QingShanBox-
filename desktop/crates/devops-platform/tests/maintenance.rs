use devops_platform::DesktopPlatform;

#[test]
fn cleanup_scan_reports_allow_listed_targets() {
    let platform = DesktopPlatform::new().expect("platform");
    let scan = platform.cleanup.scan().expect("cleanup scan");
    assert!(!scan.targets.is_empty());
    for target in &scan.targets {
        assert!(!target.id.is_empty());
        assert!(!target.name.is_empty());
    }
    assert_eq!(
        scan.total_bytes,
        scan.targets.iter().map(|target| target.bytes).sum::<u64>()
    );
}

#[test]
fn startup_and_software_inventory_are_readable() {
    let platform = DesktopPlatform::new().expect("platform");
    let startup = platform.startup.startup_items().expect("startup items");
    assert!(startup.iter().all(|item| !item.id.is_empty()));
    let apps = platform.software.list().expect("software list");
    assert!(!apps.is_empty());
    assert!(apps.iter().any(|app| !app.name.is_empty()));
}

#[test]
fn scheduled_task_list_returns_known_fields() {
    let platform = DesktopPlatform::new().expect("platform");
    match platform.startup.scheduled_tasks() {
        Ok(tasks) => {
            for task in tasks {
                assert!(!task.id.is_empty());
                assert!(!task.path.is_empty());
            }
        }
        Err(error) => {
            // The task store is ACL-protected in restricted CI/sandbox sessions;
            // the adapter must surface a useful error rather than panic.
            let message = error.to_string();
            assert!(
                message.contains("拒绝访问")
                    || message.contains("path specified")
                    || message.contains("计划任务"),
                "unexpected scheduler error: {message}"
            );
        }
    }
}
