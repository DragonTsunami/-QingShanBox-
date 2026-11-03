//! Contract tests for the JSON shape shared with the React client. A field
//! rename here is a breaking IPC change, so it must fail loudly in CI.

use devops_core::*;

fn snapshot() -> SystemSnapshot {
    SystemSnapshot {
        hostname: "CONTRACT-HOST".into(),
        os_name: "Windows 11 Pro".into(),
        os_version: "24H2".into(),
        kernel_version: "10.0.26100".into(),
        arch: "x86_64".into(),
        uptime_secs: 42,
        boot_time: 1_700_000_000,
        cpu_brand: "Contract CPU".into(),
        physical_cores: 2,
        logical_cores: 4,
        cpu_usage: 12.5,
        per_core_usage: vec![10.0, 20.0],
        memory_total: 8_589_934_592,
        memory_used: 4_294_967_296,
        swap_total: 0,
        swap_used: 0,
        disks: vec![DiskInfo {
            name: "System".into(),
            mount_point: "C:\\".into(),
            file_system: "NTFS".into(),
            total: 512_000_000_000,
            available: 256_000_000_000,
            removable: false,
        }],
        is_elevated: false,
    }
}

#[test]
fn snapshot_serializes_with_camel_case_keys() {
    let value = serde_json::to_value(snapshot()).expect("serialize snapshot");

    for key in [
        "hostname",
        "osName",
        "kernelVersion",
        "uptimeSecs",
        "bootTime",
        "cpuBrand",
        "physicalCores",
        "logicalCores",
        "cpuUsage",
        "perCoreUsage",
        "memoryTotal",
        "memoryUsed",
        "swapTotal",
        "swapUsed",
        "isElevated",
    ] {
        assert!(value.get(key).is_some(), "missing key {key}: {value}");
    }

    assert!(value.get("cpu_usage").is_none());
    assert_eq!(value["disks"][0]["mountPoint"], "C:\\");
    assert_eq!(value["arch"], "x86_64");
}

#[test]
fn process_round_trips_through_camel_case_json() {
    let json = r#"{
        "pid": 1234,
        "name": "worker.exe",
        "exe": "C:\\worker.exe",
        "command": "worker.exe --run",
        "cpuUsage": 3.5,
        "memory": 1048576,
        "virtualMemory": 2097152,
        "status": "运行中",
        "user": null,
        "startTime": 1700000000
    }"#;

    let process: ProcessInfo = serde_json::from_str(json).expect("deserialize process");
    assert_eq!(process.pid, 1234);
    assert_eq!(process.cpu_usage, 3.5);
    assert!(process.user.is_none());

    let value = serde_json::to_value(&process).expect("serialize process");
    assert_eq!(value["cpuUsage"], 3.5);
    assert_eq!(value["virtualMemory"], 2097152);
    assert!(value.get("cpu_usage").is_none());
}

#[test]
fn service_enums_match_frontend_strings() {
    assert_eq!(
        serde_json::to_value(ServiceStatus::Running).unwrap(),
        "running"
    );
    assert_eq!(
        serde_json::to_value(ServiceStatus::StartPending).unwrap(),
        "startpending"
    );
    assert_eq!(
        serde_json::to_value(ServiceStatus::Unknown).unwrap(),
        "unknown"
    );
    assert_eq!(
        serde_json::to_value(ServiceAction::Restart).unwrap(),
        "restart"
    );

    let action: ServiceAction = serde_json::from_str("\"stop\"").expect("action");
    assert_eq!(action, ServiceAction::Stop);
}

#[test]
fn error_codes_are_stable_and_documented() {
    let cases = [
        (OpsError::Platform("x".into()), "platform"),
        (OpsError::NotFound("x".into()), "not_found"),
        (OpsError::PermissionDenied, "permission_denied"),
        (OpsError::InvalidInput("x".into()), "invalid_input"),
    ];

    for (error, code) in cases {
        assert_eq!(error.code(), code);
        assert!(!error.to_string().is_empty());
    }
}

#[test]
fn app_info_serializes_with_camel_case_keys() {
    let value = serde_json::to_value(AppInfo {
        name: "青衫工具箱".into(),
        version: "0.2.0".into(),
        core_version: "0.2.0".into(),
        build_profile: "debug".into(),
        platform: "windows-x86_64".into(),
        is_elevated: true,
    })
    .expect("serialize app info");

    assert_eq!(value["coreVersion"], "0.2.0");
    assert_eq!(value["buildProfile"], "debug");
    assert_eq!(value["isElevated"], true);
    assert!(value.get("core_version").is_none());
}
