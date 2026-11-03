//! Local system-health diagnostics for the personal desktop edition.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub name: String,
    pub charge_percent: Option<u8>,
    pub status: String,
    pub estimated_minutes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskHealth {
    pub name: String,
    pub media_type: String,
    pub health: String,
    pub operational_status: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub driver_version: String,
    pub memory_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnostics {
    pub collected_at: String,
    pub battery: Option<BatteryInfo>,
    pub disks: Vec<DiskHealth>,
    pub gpus: Vec<GpuInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAction {
    pub id: String,
    pub name: String,
    pub description: String,
    pub requires_admin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickActionResult {
    pub action: String,
    pub message: String,
}
