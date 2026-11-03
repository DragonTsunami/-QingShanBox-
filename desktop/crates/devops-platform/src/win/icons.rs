//! Extracts the shell icon of an installed application and returns it as a PNG
//! data URL. Icons are rendered at 64×64 so the 32 CSS-px tile stays sharp on
//! scaled displays.

use std::ffi::c_void;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;

use base64::Engine;
use image::{ImageFormat, RgbaImage};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, GetIconInfo, LoadImageW, PrivateExtractIconsW, DI_NORMAL, HICON,
    ICONINFO, IMAGE_ICON, LR_LOADFROMFILE,
};

/// Render at 64 px so the 32 CSS-px tile remains sharp at 150–200% scaling.
const SIZE: i32 = 64;

pub fn icon_data_url(display_icon: &str) -> Option<String> {
    let (path, index) = parse_display_icon(display_icon)?;
    let icon = load_icon(&path, index)?;
    let png = render_png(icon);
    unsafe {
        let _ = DestroyIcon(icon);
    }
    let bytes = png?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Resolve a registry DisplayIcon value to the underlying executable/icon path.
pub(crate) fn display_icon_path(display_icon: &str) -> Option<PathBuf> {
    parse_display_icon(display_icon).map(|(path, _)| path)
}

fn parse_display_icon(value: &str) -> Option<(PathBuf, i32)> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    let (path, tail) = if let Some(rest) = value.strip_prefix('"') {
        let end = rest.find('"')?;
        (&rest[..end], &rest[end + 1..])
    } else if let Some(position) = value.rfind(',') {
        if value[position + 1..].trim().parse::<i32>().is_ok() {
            (&value[..position], &value[position..])
        } else {
            (value, "")
        }
    } else {
        (value, "")
    };

    let index = tail
        .trim()
        .trim_start_matches(',')
        .trim()
        .parse::<i32>()
        .unwrap_or(0)
        .max(0);
    let path = Path::new(path.trim());
    if !path.is_file() {
        return None;
    }
    Some((path.to_path_buf(), index))
}

fn load_icon(path: &Path, index: i32) -> Option<HICON> {
    let text = path.as_os_str().to_string_lossy();
    let mut wide = [0u16; 260];
    let mut length = 0usize;
    for unit in text.encode_utf16() {
        if length + 1 >= wide.len() {
            break;
        }
        wide[length] = unit;
        length += 1;
    }
    if length == 0 || length + 1 >= wide.len() {
        return None;
    }

    // PrivateExtractIconsW can render any requested size; ExtractIconExW only
    // returns the system large icon (32 px at 100% DPI), which looked blurry
    // on scaled displays.
    let mut high_res = HICON::default();
    let count = unsafe {
        PrivateExtractIconsW(
            &wide,
            index,
            SIZE,
            SIZE,
            Some(std::slice::from_mut(&mut high_res)),
            None,
            0,
        )
    };
    if count > 0 && !high_res.0.is_null() {
        return Some(high_res);
    }

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ico"))
    {
        let handle = unsafe {
            LoadImageW(
                None,
                PCWSTR(wide.as_ptr()),
                IMAGE_ICON,
                SIZE,
                SIZE,
                LR_LOADFROMFILE,
            )
        }
        .ok()?;
        return Some(HICON(handle.0));
    }

    let mut large = HICON::default();
    let count = unsafe { ExtractIconExW(PCWSTR(wide.as_ptr()), index, Some(&mut large), None, 1) };
    if count == 0 || large.0.is_null() {
        None
    } else {
        Some(large)
    }
}

fn render_png(icon: HICON) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut info).ok()? };

    let screen = unsafe { GetDC(None) };
    let memory = unsafe { CreateCompatibleDC(screen) };
    if memory.0.is_null() {
        unsafe {
            let _ = ReleaseDC(None, screen);
        }
        return None;
    }

    let result = render_in_dc(icon, memory, &info);

    unsafe {
        if !info.hbmColor.is_invalid() {
            let _ = DeleteObject(info.hbmColor);
        }
        if !info.hbmMask.is_invalid() {
            let _ = DeleteObject(info.hbmMask);
        }
        let _ = DeleteDC(memory);
        let _ = ReleaseDC(None, screen);
    }
    result
}

fn render_in_dc(icon: HICON, memory: HDC, info: &ICONINFO) -> Option<Vec<u8>> {
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: SIZE,
            biHeight: -SIZE,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = null_mut();
    let dib = unsafe { CreateDIBSection(memory, &bmi, DIB_RGB_COLORS, &mut bits, None, 0) }.ok()?;
    if bits.is_null() {
        return None;
    }

    let old = unsafe { SelectObject(memory, dib) };
    let drawn = unsafe { DrawIconEx(memory, 0, 0, icon, SIZE, SIZE, 0, None, DI_NORMAL) };
    if drawn.is_err() {
        unsafe {
            let _ = SelectObject(memory, old);
            let _ = DeleteObject(dib);
        }
        return None;
    }

    let pixels =
        unsafe { std::slice::from_raw_parts(bits as *const u8, (SIZE * SIZE * 4) as usize) };

    let mut mask_bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: SIZE,
            biHeight: -SIZE,
            biPlanes: 1,
            biBitCount: 1,
            ..Default::default()
        },
        ..Default::default()
    };
    let stride = (((SIZE + 31) / 32) * 4) as usize;
    let mut mask = vec![0u8; stride * SIZE as usize];
    let mask_lines = unsafe {
        GetDIBits(
            memory,
            info.hbmMask,
            0,
            SIZE as u32,
            Some(mask.as_mut_ptr() as *mut c_void),
            &mut mask_bmi,
            DIB_RGB_COLORS,
        )
    };

    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for (index, pixel) in pixels.chunks_exact(4).enumerate() {
        let x = index as i32 % SIZE;
        let y = index as i32 / SIZE;
        let masked = mask_lines > 0
            && (mask[y as usize * stride + (x / 8) as usize] >> (7 - (x % 8))) & 1 == 1;
        let alpha = if masked {
            0
        } else if pixel[3] == 0 {
            255
        } else {
            pixel[3]
        };
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], alpha]);
    }

    unsafe {
        let _ = SelectObject(memory, old);
        let _ = DeleteObject(dib);
    }

    let image = RgbaImage::from_raw(SIZE as u32, SIZE as u32, rgba)?;
    let mut cursor = Cursor::new(Vec::new());
    image.write_to(&mut cursor, ImageFormat::Png).ok()?;
    Some(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_png_data_url() {
        let url = icon_data_url(r"C:\Windows\System32\notepad.exe");
        let url = url.expect("notepad icon should be readable");
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(url.len() > 200);
    }
}
