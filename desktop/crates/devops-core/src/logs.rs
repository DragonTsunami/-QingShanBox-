//! Log center domain types.
//!
//! The desktop client starts with Windows Event Log channels. The shape is kept
//! independent from Win32 so the same query/export contract can later be backed
//! by application log files or a server-side collector.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSourceKind {
    EventLog,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSource {
    pub id: String,
    pub name: String,
    pub kind: LogSourceKind,
    pub description: String,
    pub available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Critical,
    Error,
    Warning,
    Information,
    Verbose,
    Unknown,
}

impl LogLevel {
    /// Map a Windows event level (EVENTLOG_*_TYPE) to the domain enum.
    pub fn from_win32(level: u8) -> Self {
        match level {
            1 => Self::Critical,
            2 => Self::Error,
            3 => Self::Warning,
            4 => Self::Information,
            5 => Self::Verbose,
            _ => Self::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Critical => "critical",
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Information => "information",
            Self::Verbose => "verbose",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: LogLevel,
    pub channel: String,
    pub provider: String,
    pub event_id: u32,
    pub message: String,
    pub computer: String,
    pub user: Option<String>,
    pub fields: Vec<LogField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    pub source: String,
    pub level: Option<LogLevel>,
    pub keyword: String,
    pub limit: usize,
    /// Time window in days. The adapter applies it before parsing, so the
    /// returned batch represents "the last N days" rather than a raw tail.
    #[serde(default = "default_days")]
    pub days: u32,
}

fn default_days() -> u32 {
    3
}

impl Default for LogQuery {
    fn default() -> Self {
        Self {
            source: "application".into(),
            level: None,
            keyword: String::new(),
            limit: 2000,
            days: default_days(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBatch {
    pub source: String,
    pub entries: Vec<LogEntry>,
    /// Number of raw records parsed before filtering.
    pub scanned: usize,
    /// Number of records matching the level/keyword filters.
    pub total: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogExport {
    pub path: String,
    pub count: usize,
}
