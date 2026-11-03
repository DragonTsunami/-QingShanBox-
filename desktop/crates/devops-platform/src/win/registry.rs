use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use devops_core::{OpsError, OpsResult};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, WIN32_ERROR,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, RegQueryValueExW,
    RegSetValueExW, HKEY, KEY_READ, KEY_WRITE, REG_BINARY, REG_EXPAND_SZ, REG_OPTION_NON_VOLATILE,
    REG_SZ, REG_VALUE_TYPE,
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn status_error(action: &str, status: WIN32_ERROR) -> OpsError {
    OpsError::Platform(format!("{action}失败（Win32 错误 {}）", status.0))
}

pub fn open(root: HKEY, path: &str, write: bool) -> OpsResult<HKEY> {
    open_view(root, path, 0, write)
}

pub fn open_view(root: HKEY, path: &str, view: u32, write: bool) -> OpsResult<HKEY> {
    let path = wide(path);
    let mut key = HKEY::default();
    let mut access = if write {
        KEY_READ | KEY_WRITE
    } else {
        KEY_READ
    };
    if view == 32 {
        access |= windows::Win32::System::Registry::KEY_WOW64_32KEY;
    } else if view == 64 {
        access |= windows::Win32::System::Registry::KEY_WOW64_64KEY;
    }
    let status = unsafe { RegOpenKeyExW(root, PCWSTR(path.as_ptr()), 0, access, &mut key) };
    if status != ERROR_SUCCESS {
        return Err(status_error("打开注册表项", status));
    }
    Ok(key)
}

pub fn close(key: HKEY) {
    unsafe {
        let _ = RegCloseKey(key);
    }
}

pub fn create_key(root: HKEY, path: &str) -> OpsResult<HKEY> {
    let path = wide(path);
    let mut key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            root,
            PCWSTR(path.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_READ | KEY_WRITE,
            None,
            &mut key,
            None,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(status_error("创建注册表项", status));
    }
    Ok(key)
}

pub fn read_string(key: HKEY, name: &str) -> OpsResult<Option<String>> {
    let name = wide(name);
    let mut kind = REG_VALUE_TYPE::default();
    let mut size = 0u32;
    let status = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            None,
            Some(&mut size),
        )
    };
    if status == ERROR_FILE_NOT_FOUND || status == ERROR_SUCCESS && size == 0 {
        return Ok(None);
    }
    if status != ERROR_SUCCESS {
        return Err(status_error("读取注册表值", status));
    }
    let mut data = vec![0u8; size as usize];
    let status = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(data.as_mut_ptr()),
            Some(&mut size),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(status_error("读取注册表值", status));
    }
    data.truncate(size as usize);
    if kind == REG_SZ || kind == REG_EXPAND_SZ {
        Ok(Some(decode_utf16(&data)))
    } else {
        Ok(None)
    }
}

pub fn read_binary(key: HKEY, name: &str) -> OpsResult<Option<Vec<u8>>> {
    let name = wide(name);
    let mut kind = REG_VALUE_TYPE::default();
    let mut size = 0u32;
    let status = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            None,
            Some(&mut size),
        )
    };
    if status == ERROR_FILE_NOT_FOUND || status == ERROR_SUCCESS && size == 0 {
        return Ok(None);
    }
    if status != ERROR_SUCCESS {
        return Err(status_error("读取注册表值", status));
    }
    let mut data = vec![0u8; size as usize];
    let status = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(data.as_mut_ptr()),
            Some(&mut size),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(status_error("读取注册表值", status));
    }
    data.truncate(size as usize);
    Ok(Some(data))
}

pub fn write_binary(key: HKEY, name: &str, value: &[u8]) -> OpsResult<()> {
    let name = wide(name);
    let status = unsafe { RegSetValueExW(key, PCWSTR(name.as_ptr()), 0, REG_BINARY, Some(value)) };
    if status != ERROR_SUCCESS {
        return Err(status_error("写入注册表值", status));
    }
    Ok(())
}

pub fn enum_values(key: HKEY) -> OpsResult<Vec<(String, String)>> {
    let mut index = 0u32;
    let mut values = Vec::new();
    loop {
        let mut name = vec![0u16; 512];
        let mut name_len = name.len() as u32;
        let mut kind_raw = 0u32;
        let mut data = vec![0u8; 8192];
        let mut data_len = data.len() as u32;
        let status = unsafe {
            RegEnumValueW(
                key,
                index,
                windows::core::PWSTR(name.as_mut_ptr()),
                &mut name_len,
                None,
                Some(&mut kind_raw),
                Some(data.as_mut_ptr()),
                Some(&mut data_len),
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_MORE_DATA {
            // A single value larger than the buffer is not a startup command we
            // can use; skip it and keep enumerating.
            index += 1;
            continue;
        }
        if status != ERROR_SUCCESS {
            return Err(status_error("枚举注册表值", status));
        }
        name.truncate(name_len as usize);
        data.truncate(data_len as usize);
        if kind_raw == REG_SZ.0 {
            values.push((decode_wide(&name), decode_utf16(&data)));
        }
        index += 1;
    }
    Ok(values)
}

pub fn enum_binary_values(key: HKEY) -> OpsResult<Vec<(String, Vec<u8>)>> {
    let mut index = 0u32;
    let mut values = Vec::new();
    loop {
        let mut name = vec![0u16; 512];
        let mut name_len = name.len() as u32;
        let mut kind_raw = 0u32;
        let mut data = vec![0u8; 8192];
        let mut data_len = data.len() as u32;
        let status = unsafe {
            RegEnumValueW(
                key,
                index,
                windows::core::PWSTR(name.as_mut_ptr()),
                &mut name_len,
                None,
                Some(&mut kind_raw),
                Some(data.as_mut_ptr()),
                Some(&mut data_len),
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_MORE_DATA {
            index += 1;
            continue;
        }
        if status != ERROR_SUCCESS {
            return Err(status_error("枚举注册表值", status));
        }
        name.truncate(name_len as usize);
        data.truncate(data_len as usize);
        if kind_raw == REG_BINARY.0 {
            values.push((decode_wide(&name), data));
        }
        index += 1;
    }
    Ok(values)
}

pub fn enum_subkeys(key: HKEY) -> OpsResult<Vec<String>> {
    let mut index = 0u32;
    let mut names = Vec::new();
    loop {
        let mut name = vec![0u16; 512];
        let mut name_len = name.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                key,
                index,
                windows::core::PWSTR(name.as_mut_ptr()),
                &mut name_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_MORE_DATA {
            index += 1;
            continue;
        }
        if status != ERROR_SUCCESS {
            return Err(status_error("枚举注册表子项", status));
        }
        name.truncate(name_len as usize);
        names.push(decode_wide(&name));
        index += 1;
    }
    Ok(names)
}

fn decode_wide(units: &[u16]) -> String {
    let units: Vec<u16> = units
        .iter()
        .copied()
        .take_while(|unit| *unit != 0)
        .collect();
    OsString::from_wide(&units).to_string_lossy().into_owned()
}

fn decode_utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
    OsString::from_wide(&units).to_string_lossy().into_owned()
}

const ERROR_FILE_NOT_FOUND: WIN32_ERROR = WIN32_ERROR(2u32);
