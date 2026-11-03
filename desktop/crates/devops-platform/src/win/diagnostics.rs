use std::process::Command;

use devops_core::{
    BatteryInfo, Diagnostics, DiskHealth, GpuInfo, OpsError, OpsResult, QuickAction,
    QuickActionResult, SystemDiagnostics,
};
use serde_json::Value;

const POWERSHELL_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$battery = @(Get-CimInstance Win32_Battery | Select-Object Name, EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime)
$disks = @(Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus, OperationalStatus, Size)
if ($disks.Count -eq 0) {
  $disks = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
    [pscustomobject]@{
      FriendlyName = $_.Model
      MediaType = $_.InterfaceType
      HealthStatus = $_.Status
      OperationalStatus = $_.Status
      Size = $_.Size
    }
  })
}
$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM)
[pscustomobject]@{
  collectedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  battery = $battery
  disks = $disks
  gpus = $gpus
} | ConvertTo-Json -Depth 4 -Compress
"#;

pub struct DiagnosticsImpl;

impl DiagnosticsImpl {
    fn collect(&self) -> OpsResult<SystemDiagnostics> {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            POWERSHELL_SCRIPT,
        ]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let output = command
            .output()
            .map_err(|error| OpsError::Platform(format!("无法启动系统诊断: {error}")))?;
        if !output.status.success() {
            return Err(OpsError::Platform(format!(
                "系统诊断命令失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let value: Value = serde_json::from_str(text.trim())
            .map_err(|error| OpsError::Platform(format!("无法解析系统诊断结果: {error}")))?;

        let battery = value
            .get("battery")
            .and_then(as_first)
            .map(|item| BatteryInfo {
                name: string_field(item, "Name").unwrap_or_else(|| "电池".into()),
                charge_percent: number_field(item, "EstimatedChargeRemaining")
                    .map(|value| value.min(100) as u8),
                status: battery_status(number_field(item, "BatteryStatus")),
                estimated_minutes: number_field(item, "EstimatedRunTime")
                    .filter(|value| *value > 0 && *value < 100_000)
                    .map(|value| value as u32),
            });

        let disks = value
            .get("disks")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .map(|item| DiskHealth {
                        name: string_field(item, "FriendlyName").unwrap_or_else(|| "磁盘".into()),
                        media_type: string_field(item, "MediaType").unwrap_or_else(|| "—".into()),
                        health: string_field(item, "HealthStatus").unwrap_or_else(|| "未知".into()),
                        operational_status: string_field(item, "OperationalStatus")
                            .unwrap_or_else(|| "—".into()),
                        size_bytes: number_field(item, "Size").unwrap_or(0),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let gpus = value
            .get("gpus")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .map(|item| GpuInfo {
                        name: string_field(item, "Name").unwrap_or_else(|| "显卡".into()),
                        driver_version: string_field(item, "DriverVersion")
                            .unwrap_or_else(|| "—".into()),
                        memory_bytes: number_field(item, "AdapterRAM").unwrap_or(0),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(SystemDiagnostics {
            collected_at: string_field(&value, "collectedAt").unwrap_or_else(|| "—".into()),
            battery,
            disks,
            gpus,
        })
    }

    fn run_action(&self, id: &str) -> OpsResult<QuickActionResult> {
        match id {
            "flush-dns" => {
                let output = Command::new("ipconfig.exe")
                    .arg("/flushdns")
                    .output()
                    .map_err(|error| OpsError::Platform(format!("无法执行 DNS 刷新: {error}")))?;
                if !output.status.success() {
                    return Err(OpsError::Platform("Windows 未完成 DNS 缓存刷新".into()));
                }
                Ok(QuickActionResult {
                    action: id.into(),
                    message: "DNS 缓存已刷新".into(),
                })
            }
            "open-network-settings" => {
                Command::new("cmd.exe")
                    .args(["/C", "start", "", "ms-settings:network"])
                    .spawn()
                    .map_err(|error| OpsError::Platform(format!("无法打开网络设置: {error}")))?;
                Ok(QuickActionResult {
                    action: id.into(),
                    message: "已打开 Windows 网络设置".into(),
                })
            }
            other => Err(OpsError::InvalidInput(format!("未知的修复动作: {other}"))),
        }
    }
}

impl Diagnostics for DiagnosticsImpl {
    fn read(&self) -> OpsResult<SystemDiagnostics> {
        self.collect()
    }

    fn quick_actions(&self) -> Vec<QuickAction> {
        vec![
            QuickAction {
                id: "flush-dns".into(),
                name: "刷新 DNS 缓存".into(),
                description: "解决域名解析异常、网页打不开但能上 QQ 等常见问题".into(),
                requires_admin: false,
            },
            QuickAction {
                id: "open-network-settings".into(),
                name: "打开网络设置".into(),
                description: "查看适配器、代理、VPN 和 DNS 配置".into(),
                requires_admin: false,
            },
        ]
    }

    fn run_quick_action(&self, id: &str) -> OpsResult<QuickActionResult> {
        self.run_action(id)
    }
}

fn as_first(value: &Value) -> Option<&Value> {
    match value {
        Value::Array(items) => items.first(),
        Value::Object(_) => Some(value),
        _ => None,
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    let text = value.get(key)?.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn number_field(value: &Value, key: &str) -> Option<u64> {
    let number = value.get(key)?;
    if let Some(value) = number.as_u64() {
        return Some(value);
    }
    if let Some(value) = number.as_f64() {
        return (value >= 0.0).then_some(value as u64);
    }
    number.as_str()?.parse().ok()
}

fn battery_status(code: Option<u64>) -> String {
    match code {
        Some(1) => "放电中".into(),
        Some(2) => "已接通电源".into(),
        Some(3) => "充电中".into(),
        Some(4) => "电量偏低".into(),
        Some(5) => "电量临界".into(),
        Some(6) | Some(7) | Some(8) | Some(9) => "充电中".into(),
        Some(_) => "未知".into(),
        None => "—".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{as_first, number_field, string_field};
    use serde_json::json;

    #[test]
    fn cim_shape_is_tolerated() {
        let value = json!([{"Name": "BAT0", "EstimatedChargeRemaining": 80}]);
        let first = as_first(&value).expect("first");
        assert_eq!(string_field(first, "Name").as_deref(), Some("BAT0"));
        assert_eq!(number_field(first, "EstimatedChargeRemaining"), Some(80));
    }

    #[test]
    fn empty_string_is_ignored() {
        let value = json!({ "Name": "  " });
        assert_eq!(string_field(&value, "Name"), None);
    }
}
