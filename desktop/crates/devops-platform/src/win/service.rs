use std::thread::sleep;
use std::time::{Duration, Instant};

use devops_core::{OpsError, OpsResult, ServiceAction, ServiceControl, ServiceInfo, ServiceStatus};
use windows::core::PCWSTR;
use windows::Win32::Foundation::ERROR_MORE_DATA;
use windows::Win32::System::Services::*;

const ENUM_BUFFER_INITIAL: usize = 64 * 1024;
const STATE_TIMEOUT: Duration = Duration::from_secs(20);
const STATE_POLL: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct ServiceControlImpl;

impl ServiceControl for ServiceControlImpl {
    fn list(&self) -> OpsResult<Vec<ServiceInfo>> {
        unsafe {
            let scm = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_ENUMERATE_SERVICE)
                .map_err(|error| windows_error("打开服务控制管理器", error))?;

            let result = enumerate_services(scm);
            let _ = CloseServiceHandle(scm);
            result
        }
    }

    fn apply(&self, name: &str, action: ServiceAction) -> OpsResult<ServiceInfo> {
        let name = name.trim();
        if name.is_empty() {
            return Err(OpsError::InvalidInput("服务名称不能为空".into()));
        }

        unsafe {
            let scm = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT)
                .map_err(|error| windows_error("打开服务控制管理器", error))?;

            let result = apply_inner(scm, name, action);
            let _ = CloseServiceHandle(scm);
            result
        }
    }
}

unsafe fn apply_inner(scm: SC_HANDLE, name: &str, action: ServiceAction) -> OpsResult<ServiceInfo> {
    let wide = to_wide(name);
    let service_name = PCWSTR(wide.as_ptr());
    let current = query_one(scm, name).map_err(|error| windows_error("查询服务状态", error))?;

    match action {
        ServiceAction::Start if current.status == ServiceStatus::Running => return Ok(current),
        ServiceAction::Stop if current.status == ServiceStatus::Stopped => return Ok(current),
        _ => {}
    }

    match action {
        ServiceAction::Start => start_service(scm, service_name)?,
        ServiceAction::Stop => stop_service(scm, service_name)?,
        ServiceAction::Restart => {
            if current.status != ServiceStatus::Stopped {
                stop_service(scm, service_name)?;
            }
            start_service(scm, service_name)?;
        }
    }

    query_one(scm, name).map_err(|error| windows_error("查询服务状态", error))
}

unsafe fn enumerate_services(scm: SC_HANDLE) -> OpsResult<Vec<ServiceInfo>> {
    let mut buffer = vec![0u8; ENUM_BUFFER_INITIAL];
    let mut resume = 0u32;
    let mut services = Vec::new();

    loop {
        let mut needed = 0u32;
        let mut returned = 0u32;

        let status = EnumServicesStatusExW(
            scm,
            SC_ENUM_PROCESS_INFO,
            SERVICE_WIN32,
            SERVICE_STATE_ALL,
            Some(buffer.as_mut_slice()),
            &mut needed,
            &mut returned,
            Some(&mut resume),
            PCWSTR::null(),
        );

        match status {
            Ok(()) => {}
            Err(error) if (error.code().0 as u32 & 0xFFFF) == ERROR_MORE_DATA.0 => {
                if needed as usize <= buffer.len() {
                    return Err(OpsError::Platform("枚举服务时缓冲区大小异常".into()));
                }
                buffer.resize(needed as usize, 0);
                continue;
            }
            Err(error) => return Err(windows_error("枚举系统服务", error)),
        }

        if returned == 0 {
            break;
        }

        let items = std::slice::from_raw_parts(
            buffer.as_ptr() as *const ENUM_SERVICE_STATUS_PROCESSW,
            returned as usize,
        );

        for item in items {
            let service_name = item.lpServiceName.to_string().unwrap_or_default();
            let display_name = item.lpDisplayName.to_string().unwrap_or_default();
            let process = &item.ServiceStatusProcess;
            let start_type =
                query_start_type(scm, &service_name).unwrap_or_else(|_| "unknown".into());

            services.push(ServiceInfo {
                name: service_name,
                display_name,
                status: map_status(process.dwCurrentState),
                start_type,
                process_id: process.dwProcessId,
                can_stop: process.dwControlsAccepted & SERVICE_ACCEPT_STOP != 0,
            });
        }

        // A large buffer normally returns everything in one call and resets the
        // resume handle to zero; only continue when Windows has more batches.
        if resume == 0 {
            break;
        }
    }

    services.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    Ok(services)
}

unsafe fn query_one(scm: SC_HANDLE, name: &str) -> windows::core::Result<ServiceInfo> {
    let wide = to_wide(name);
    let handle = OpenServiceW(
        scm,
        PCWSTR(wide.as_ptr()),
        SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS,
    )?;

    let mut status = SERVICE_STATUS_PROCESS::default();
    let mut needed = 0u32;
    let status_buffer = std::slice::from_raw_parts_mut(
        &mut status as *mut _ as *mut u8,
        std::mem::size_of::<SERVICE_STATUS_PROCESS>(),
    );
    QueryServiceStatusEx(
        handle,
        SC_STATUS_PROCESS_INFO,
        Some(status_buffer),
        &mut needed,
    )?;

    let start_type = query_start_type_handle(handle)?;
    let _ = CloseServiceHandle(handle);

    Ok(ServiceInfo {
        name: name.to_string(),
        display_name: name.to_string(),
        status: map_status(status.dwCurrentState),
        start_type,
        process_id: status.dwProcessId,
        can_stop: status.dwControlsAccepted & SERVICE_ACCEPT_STOP != 0,
    })
}

unsafe fn query_start_type(scm: SC_HANDLE, name: &str) -> windows::core::Result<String> {
    let wide = to_wide(name);
    let handle = OpenServiceW(scm, PCWSTR(wide.as_ptr()), SERVICE_QUERY_CONFIG)?;
    let result = query_start_type_handle(handle);
    let _ = CloseServiceHandle(handle);
    result
}

unsafe fn query_start_type_handle(handle: SC_HANDLE) -> windows::core::Result<String> {
    let mut needed = 0u32;
    let _ = QueryServiceConfigW(handle, None, 0, &mut needed);
    if needed == 0 {
        return Ok("unknown".into());
    }

    let config_size = std::mem::size_of::<QUERY_SERVICE_CONFIGW>();
    let count = (needed as usize).div_ceil(config_size).max(1);
    let mut config = vec![QUERY_SERVICE_CONFIGW::default(); count];
    QueryServiceConfigW(
        handle,
        Some(config.as_mut_ptr()),
        (config.len() * config_size) as u32,
        &mut needed,
    )?;

    let start_type = match config[0].dwStartType {
        SERVICE_AUTO_START => "auto",
        SERVICE_DEMAND_START => "manual",
        SERVICE_DISABLED => "disabled",
        SERVICE_BOOT_START => "boot",
        SERVICE_SYSTEM_START => "system",
        _ => "unknown",
    };
    Ok(start_type.to_string())
}

unsafe fn start_service(scm: SC_HANDLE, name: PCWSTR) -> OpsResult<()> {
    let handle = OpenServiceW(scm, name, SERVICE_START | SERVICE_QUERY_STATUS)
        .map_err(|error| windows_error("打开服务", error))?;

    let result = StartServiceW(handle, None).map_err(|error| windows_error("启动服务", error));
    if let Err(error) = result {
        let _ = CloseServiceHandle(handle);
        return Err(error);
    }

    let outcome = wait_for_state(handle, SERVICE_RUNNING);
    let _ = CloseServiceHandle(handle);
    outcome
}

unsafe fn stop_service(scm: SC_HANDLE, name: PCWSTR) -> OpsResult<()> {
    let handle = OpenServiceW(scm, name, SERVICE_STOP | SERVICE_QUERY_STATUS)
        .map_err(|error| windows_error("打开服务", error))?;

    let mut status = SERVICE_STATUS::default();
    let result = ControlService(handle, SERVICE_CONTROL_STOP, &mut status)
        .map_err(|error| windows_error("停止服务", error));
    if let Err(error) = result {
        let _ = CloseServiceHandle(handle);
        return Err(error);
    }

    let outcome = wait_for_state(handle, SERVICE_STOPPED);
    let _ = CloseServiceHandle(handle);
    outcome
}

unsafe fn wait_for_state(
    handle: SC_HANDLE,
    desired: SERVICE_STATUS_CURRENT_STATE,
) -> OpsResult<()> {
    let deadline = Instant::now() + STATE_TIMEOUT;
    loop {
        let mut status = SERVICE_STATUS::default();
        QueryServiceStatus(handle, &mut status)
            .map_err(|error| windows_error("查询服务状态", error))?;

        if status.dwCurrentState == desired {
            return Ok(());
        }
        if status.dwCurrentState == SERVICE_STOPPED && desired == SERVICE_RUNNING {
            let code = status.dwWin32ExitCode;
            return Err(OpsError::Platform(format!(
                "服务启动失败，Win32 退出码 {code}（可能缺少依赖或权限）"
            )));
        }
        if status.dwCurrentState == SERVICE_STOPPED && desired == SERVICE_STOPPED {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(OpsError::Platform(
                "等待服务状态变化超时，请稍后在服务管理器中确认".into(),
            ));
        }
        sleep(STATE_POLL);
    }
}

fn map_status(status: SERVICE_STATUS_CURRENT_STATE) -> ServiceStatus {
    match status {
        SERVICE_RUNNING => ServiceStatus::Running,
        SERVICE_STOPPED => ServiceStatus::Stopped,
        SERVICE_START_PENDING => ServiceStatus::StartPending,
        SERVICE_STOP_PENDING => ServiceStatus::StopPending,
        SERVICE_PAUSED => ServiceStatus::Paused,
        SERVICE_PAUSE_PENDING => ServiceStatus::PausePending,
        SERVICE_CONTINUE_PENDING => ServiceStatus::ContinuePending,
        _ => ServiceStatus::Unknown,
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn windows_error(context: &str, error: windows::core::Error) -> OpsError {
    let code = error.code().0;
    if code == 0x8007_0005u32 as i32 {
        OpsError::PermissionDenied
    } else {
        OpsError::Platform(format!("{context}: {error}"))
    }
}
