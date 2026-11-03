use devops_core::{OpsError, OpsResult};
use serde::Serialize;

const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/DragonTsunami/qingshan-toolbox/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub available: bool,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
}

fn version_parts(value: &str) -> Option<Vec<u64>> {
    let value = value.trim().trim_start_matches(['v', 'V']);
    let core = value.split(['-', '+']).next().unwrap_or(value);
    let mut parts = Vec::new();
    for part in core.split('.') {
        parts.push(part.parse::<u64>().ok()?);
    }
    (!parts.is_empty()).then_some(parts)
}

pub fn is_newer(current: &str, latest: &str) -> bool {
    let Some(current) = version_parts(current) else {
        return false;
    };
    let Some(latest) = version_parts(latest) else {
        return false;
    };
    for index in 0..current.len().max(latest.len()) {
        let left = *current.get(index).unwrap_or(&0);
        let right = *latest.get(index).unwrap_or(&0);
        if right != left {
            return right > left;
        }
    }
    false
}

/// Check the public release feed without adding an HTTP/TLS stack to the app.
/// curl is present on supported Windows 10/11 images and honours enterprise
/// proxy environment variables, which is the same transport model as the rest
/// of the desktop workflow.
pub fn check_for_update(current: &str) -> OpsResult<UpdateCheck> {
    let mut command = std::process::Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    command.args([
        "-fsSL",
        "--max-time",
        "12",
        "-H",
        "User-Agent: qingshan-toolbox",
        "-H",
        "Accept: application/vnd.github+json",
        LATEST_RELEASE_URL,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| OpsError::Platform(format!("无法启动更新检查: {error}")))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(OpsError::Platform(format!(
            "更新检查失败: {}",
            detail.trim().chars().take(180).collect::<String>()
        )));
    }
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| OpsError::Platform(format!("更新响应无法解析: {error}")))?;
    let tag = payload
        .get("tag_name")
        .and_then(serde_json::Value::as_str)
        .map(|value| value.trim().trim_start_matches(['v', 'V']).to_string());
    let Some(latest) = tag else {
        return Err(OpsError::Platform("更新响应缺少版本号".into()));
    };
    Ok(UpdateCheck {
        current_version: current.to_string(),
        available: is_newer(current, &latest),
        latest_version: Some(latest),
        release_url: payload
            .get("html_url")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        published_at: payload
            .get("published_at")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_semantic_versions() {
        assert!(is_newer("1.0.0", "1.0.1"));
        assert!(is_newer("1.0.0", "v1.1.0"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("1.1.0", "1.0.9"));
        assert!(!is_newer("dev", "1.0.1"));
    }
}
