use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SoftwareScope {
    User,
    Machine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SoftwareKind {
    Application,
    Driver,
    Runtime,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub kind: SoftwareKind,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub install_date: String,
    pub install_location: String,
    pub uninstall_string: String,
    pub scope: SoftwareScope,
    pub registry_view: String,
    /// PNG data URL extracted from DisplayIcon, when one is available.
    pub icon: Option<String>,
    /// Last observed launch/access time, as a Unix timestamp in seconds.
    pub last_used: Option<u64>,
}
