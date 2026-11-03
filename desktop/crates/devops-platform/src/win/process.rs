use std::sync::Mutex;

use devops_core::{OpsError, OpsResult, ProcessControl, ProcessInfo};
use sysinfo::{Pid, ProcessesToUpdate, System, Users};

pub struct ProcessControlImpl {
    system: Mutex<System>,
}

impl ProcessControlImpl {
    pub fn new() -> Self {
        Self {
            system: Mutex::new(System::new_all()),
        }
    }
}

impl ProcessControl for ProcessControlImpl {
    fn list(&self) -> OpsResult<Vec<ProcessInfo>> {
        let mut system = self
            .system
            .lock()
            .map_err(|_| OpsError::Platform("进程采集器状态异常".into()))?;

        system.refresh_processes(ProcessesToUpdate::All, true);
        let users = Users::new_with_refreshed_list();

        let mut processes: Vec<ProcessInfo> = system
            .processes()
            .iter()
            .map(|(pid, process)| {
                let exe = process
                    .exe()
                    .map(|path| path.to_string_lossy().into_owned());
                let command = if process.cmd().is_empty() {
                    exe.clone().unwrap_or_default()
                } else {
                    process
                        .cmd()
                        .iter()
                        .map(|arg| arg.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                let user = process
                    .user_id()
                    .and_then(|uid| users.get_user_by_id(uid))
                    .map(|user| user.name().to_string());

                ProcessInfo {
                    pid: pid.as_u32(),
                    name: process.name().to_string_lossy().into_owned(),
                    exe,
                    command,
                    cpu_usage: (process.cpu_usage() * 10.0).round() / 10.0,
                    memory: process.memory(),
                    virtual_memory: process.virtual_memory(),
                    status: status_label(process.status()),
                    user,
                    start_time: process.start_time(),
                }
            })
            .collect();

        processes.sort_by_key(|process| std::cmp::Reverse(process.memory));
        Ok(processes)
    }

    fn kill(&self, pid: u32, force: bool) -> OpsResult<()> {
        if pid == std::process::id() {
            return Err(OpsError::InvalidInput("不能终止青衫工具箱自身进程".into()));
        }

        let mut system = self
            .system
            .lock()
            .map_err(|_| OpsError::Platform("进程采集器状态异常".into()))?;
        let target = Pid::from_u32(pid);
        system.refresh_processes(ProcessesToUpdate::Some(&[target]), true);

        let process = system
            .process(target)
            .ok_or_else(|| OpsError::NotFound(format!("PID {pid}")))?;

        let terminated = if force {
            process
                .kill_with(sysinfo::Signal::Kill)
                .unwrap_or_else(|| process.kill())
        } else {
            process.kill()
        };

        if terminated {
            Ok(())
        } else {
            Err(OpsError::PermissionDenied)
        }
    }
}

fn status_label(status: sysinfo::ProcessStatus) -> String {
    match status {
        sysinfo::ProcessStatus::Run => "运行中",
        sysinfo::ProcessStatus::Sleep => "休眠",
        sysinfo::ProcessStatus::Idle => "空闲",
        sysinfo::ProcessStatus::Stop => "已暂停",
        sysinfo::ProcessStatus::Zombie => "僵尸",
        sysinfo::ProcessStatus::Dead => "已退出",
        sysinfo::ProcessStatus::Tracing => "被调试",
        sysinfo::ProcessStatus::Wakekill => "唤醒终止",
        sysinfo::ProcessStatus::Waking => "唤醒中",
        sysinfo::ProcessStatus::Parked => "已挂起",
        sysinfo::ProcessStatus::LockBlocked => "锁等待",
        _ => "未知",
    }
    .to_string()
}
