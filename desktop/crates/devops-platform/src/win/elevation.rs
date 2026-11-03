use std::os::windows::ffi::OsStrExt;

use devops_core::{Elevation, OpsError, OpsResult};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

pub struct ElevationImpl;

pub fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }

        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        let _ = CloseHandle(token);

        result.is_ok() && elevation.TokenIsElevated != 0
    }
}

impl Elevation for ElevationImpl {
    fn is_elevated(&self) -> bool {
        is_elevated()
    }

    fn relaunch_elevated(&self) -> OpsResult<()> {
        if is_elevated() {
            return Err(OpsError::InvalidInput(
                "青衫工具箱已以管理员身份运行".into(),
            ));
        }

        let exe = std::env::current_exe()?;
        let operation: Vec<u16> = "runas\0".encode_utf16().collect();
        let file: Vec<u16> = exe
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let result = unsafe {
            ShellExecuteW(
                HWND::default(),
                PCWSTR(operation.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };

        // ShellExecuteW returns a value <= 32 on failure.
        if result.0 as isize <= 32 {
            return Err(OpsError::Platform(
                "无法发起 UAC 提权，请手动以管理员身份运行".into(),
            ));
        }

        Ok(())
    }
}
