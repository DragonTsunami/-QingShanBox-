use serde::{Deserialize, Serialize};

/// A known, allow-listed cleanup location. The platform layer only accepts the
/// ids it produced; the UI never sends arbitrary paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupTarget {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: CleanupCategory,
    pub requires_admin: bool,
    pub available: bool,
    pub bytes: u64,
    pub files: u64,
    pub note: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupCategory {
    Temp,
    Browser,
    Windows,
    Recycle,
}

impl CleanupCategory {
    pub fn label(self) -> &'static str {
        match self {
            Self::Temp => "临时文件",
            Self::Browser => "浏览器缓存",
            Self::Windows => "系统缓存",
            Self::Recycle => "回收站",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScan {
    pub targets: Vec<CleanupTarget>,
    pub total_bytes: u64,
    pub total_files: u64,
    pub scanned_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOutcome {
    pub id: String,
    pub name: String,
    pub freed_bytes: u64,
    pub removed_files: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub outcomes: Vec<CleanupOutcome>,
    pub freed_bytes: u64,
    pub removed_files: u64,
    pub errors: Vec<String>,
}
