use std::sync::Mutex;
use std::time::Duration;

use devops_core::{DiskInfo, OpsError, OpsResult, SystemProbe, SystemSnapshot};
use sysinfo::{Disks, System};

pub struct SystemProbeImpl {
    system: Mutex<System>,
}

impl SystemProbeImpl {
    pub fn new() -> Self {
        let mut system = System::new_all();
        // CPU usage is computed from the delta between two refreshes.
        system.refresh_cpu_usage();
        std::thread::sleep(Duration::from_millis(250));
        system.refresh_cpu_usage();
        Self {
            system: Mutex::new(system),
        }
    }
}

impl SystemProbe for SystemProbeImpl {
    fn snapshot(&self) -> OpsResult<SystemSnapshot> {
        let mut system = self
            .system
            .lock()
            .map_err(|_| OpsError::Platform("系统信息采集器状态异常".into()))?;

        system.refresh_cpu_usage();
        system.refresh_memory();

        let cpus = system.cpus();
        let cpu_brand = cpus
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .unwrap_or_else(|| "未知处理器".into());
        let per_core_usage: Vec<f32> = cpus.iter().map(|cpu| round1(cpu.cpu_usage())).collect();
        let logical_cores = cpus.len();
        let cpu_usage = round1(system.global_cpu_usage());

        let disks = Disks::new_with_refreshed_list()
            .iter()
            .filter(|disk| disk.total_space() > 0)
            .map(|disk| DiskInfo {
                name: disk.name().to_string_lossy().into_owned(),
                mount_point: disk.mount_point().to_string_lossy().into_owned(),
                file_system: disk.file_system().to_string_lossy().into_owned(),
                total: disk.total_space(),
                available: disk.available_space(),
                removable: disk.is_removable(),
            })
            .collect();

        Ok(SystemSnapshot {
            hostname: System::host_name().unwrap_or_else(|| "未知主机".into()),
            os_name: System::name().unwrap_or_else(|| "Windows".into()),
            os_version: System::os_version().unwrap_or_default(),
            kernel_version: System::kernel_version().unwrap_or_default(),
            arch: std::env::consts::ARCH.to_string(),
            uptime_secs: System::uptime(),
            boot_time: System::boot_time(),
            cpu_brand,
            physical_cores: system.physical_core_count().unwrap_or(logical_cores),
            logical_cores,
            cpu_usage,
            per_core_usage,
            memory_total: system.total_memory(),
            memory_used: system.used_memory(),
            swap_total: system.total_swap(),
            swap_used: system.used_swap(),
            disks,
            is_elevated: super::elevation::is_elevated(),
        })
    }
}

fn round1(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}
