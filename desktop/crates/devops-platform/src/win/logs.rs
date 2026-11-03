//! Windows Event Log adapter.
//!
//! `wevtutil qe ... /f:xml` is used instead of the Evt* API: the XML rendering
//! is stable across Windows versions, keeps the adapter small, and lets us apply
//! keyword/level filters with the same code path on every channel. Security.evtx
//! needs an elevated process; the error is surfaced verbatim so the UI can point
//! the user at the standard-user hint.

use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use devops_core::{
    LogBatch, LogCenter, LogEntry, LogExport, LogField, LogLevel, LogQuery, LogSource,
    LogSourceKind, OpsError, OpsResult,
};
use quick_xml::events::Event;
use quick_xml::Reader;

const MAX_LIMIT: usize = 2000;
const MAX_KEYWORD: usize = 128;
const MAX_DAYS: u32 = 30;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct LogCenterImpl;

impl LogCenter for LogCenterImpl {
    fn sources(&self) -> OpsResult<Vec<LogSource>> {
        Ok(vec![
            LogSource {
                id: "application".into(),
                name: "应用程序".into(),
                kind: LogSourceKind::EventLog,
                description: "Windows Application 通道，含应用崩溃与安装事件".into(),
                available: true,
            },
            LogSource {
                id: "system".into(),
                name: "系统".into(),
                kind: LogSourceKind::EventLog,
                description: "Windows System 通道，含驱动、服务与内核事件".into(),
                available: true,
            },
            LogSource {
                id: "security".into(),
                name: "安全".into(),
                kind: LogSourceKind::EventLog,
                description: "Windows Security 通道，读取需要管理员权限".into(),
                available: true,
            },
        ])
    }

    fn query(&self, query: &LogQuery) -> OpsResult<LogBatch> {
        let channel = channel_for(&query.source)?;
        let limit = query.limit.clamp(1, MAX_LIMIT);
        let days = query.days.clamp(1, MAX_DAYS);
        if query.keyword.chars().count() > MAX_KEYWORD {
            return Err(OpsError::InvalidInput("关键字不能超过 128 个字符".into()));
        }

        // Filter by age in the event query itself. This keeps the batch a
        // meaningful "last N days" view instead of a raw record count.
        let age_filter = age_filter(days);

        let mut command = Command::new("wevtutil.exe");
        command.args([
            "qe",
            channel,
            &format!("/q:{age_filter}"),
            &format!("/c:{limit}"),
            "/rd:true",
            "/f:xml",
        ]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let output = command
            .output()
            .map_err(|error| OpsError::Platform(format!("无法启动 wevtutil.exe: {error}")))?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            let hint = if query.source == "security" {
                "（安全日志需要以管理员身份运行）"
            } else {
                ""
            };
            return Err(OpsError::Platform(format!(
                "读取{channel}日志失败{hint}: {}",
                detail.trim()
            )));
        }

        let xml = decode_output(&output.stdout);
        let parsed = parse_events(&xml);
        let scanned = parsed.len();
        let keyword = query.keyword.trim().to_lowercase();

        let matched: Vec<LogEntry> = parsed
            .into_iter()
            .filter(|entry| {
                query
                    .level
                    .map(|level| entry.level == level)
                    .unwrap_or(true)
                    && (keyword.is_empty() || entry_matches(entry, &keyword))
            })
            .collect();

        let total = matched.len();
        let entries: Vec<LogEntry> = matched.into_iter().take(limit).collect();

        Ok(LogBatch {
            source: query.source.clone(),
            entries,
            scanned,
            total,
            truncated: total > limit,
        })
    }

    fn clear(&self, source: &str) -> OpsResult<()> {
        let channel = channel_for(source)?;
        let mut command = Command::new("wevtutil.exe");
        command.args(["cl", channel]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let output = command
            .output()
            .map_err(|error| OpsError::Platform(format!("无法启动 wevtutil.exe: {error}")))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(OpsError::Platform(format!(
                "清空{channel}日志失败（需要管理员权限）: {}",
                detail.trim()
            )));
        }
        Ok(())
    }

    fn export(&self, entries: &[LogEntry]) -> OpsResult<LogExport> {
        if entries.is_empty() {
            return Err(OpsError::InvalidInput("没有可导出的日志".into()));
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();
        let directory = export_directory();
        std::fs::create_dir_all(&directory)
            .map_err(|error| OpsError::Platform(format!("无法创建导出目录: {error}")))?;
        let path = directory.join(format!("qingshan-logs-{now}.csv"));

        let mut csv = String::from("\u{feff}时间,级别,通道,来源,事件 ID,计算机,消息\r\n");
        for entry in entries {
            csv.push_str(&csv_line(entry));
        }

        std::fs::write(&path, csv)
            .map_err(|error| OpsError::Platform(format!("无法写入导出文件: {error}")))?;

        Ok(LogExport {
            path: path.to_string_lossy().into_owned(),
            count: entries.len(),
        })
    }
}

fn age_filter(days: u32) -> String {
    format!(
        "*[System[TimeCreated[timediff(@SystemTime) <= {}]]]",
        u64::from(days.clamp(1, MAX_DAYS)) * 86_400_000
    )
}

fn channel_for(source: &str) -> OpsResult<&'static str> {
    match source {
        "application" => Ok("Application"),
        "system" => Ok("System"),
        "security" => Ok("Security"),
        _ => Err(OpsError::InvalidInput("未知的日志来源".into())),
    }
}

fn entry_matches(entry: &LogEntry, lowered_keyword: &str) -> bool {
    entry.message.to_lowercase().contains(lowered_keyword)
        || entry.provider.to_lowercase().contains(lowered_keyword)
        || entry.channel.to_lowercase().contains(lowered_keyword)
        || entry.computer.to_lowercase().contains(lowered_keyword)
        || entry.event_id.to_string().contains(lowered_keyword)
        || entry
            .fields
            .iter()
            .any(|field| field.value.to_lowercase().contains(lowered_keyword))
}

fn export_directory() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join("Downloads"))
        .filter(|directory| directory.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

fn csv_line(entry: &LogEntry) -> String {
    let cells = [
        entry.timestamp.clone(),
        entry.level.as_str().to_string(),
        entry.channel.clone(),
        entry.provider.clone(),
        entry.event_id.to_string(),
        entry.computer.clone(),
        entry.message.replace(['\r', '\n'], " "),
    ];
    let mut line = cells
        .iter()
        .map(|cell| format!("\"{}\"", cell.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(",");
    line.push_str("\r\n");
    line
}

fn decode_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }

    let zeroes = bytes.iter().filter(|byte| **byte == 0).count();
    if bytes.len() > 8 && zeroes > bytes.len() / 4 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }

    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

#[derive(Default)]
struct PartialEvent {
    timestamp: String,
    level: u8,
    provider: String,
    event_id: u32,
    channel: String,
    computer: String,
    user: Option<String>,
    fields: Vec<LogField>,
    text_target: Option<TextTarget>,
    text: String,
}

#[derive(Clone, Copy)]
enum TextTarget {
    EventId,
    Level,
    Channel,
    Computer,
    UserData,
}

fn parse_events(xml: &str) -> Vec<LogEntry> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    reader.config_mut().expand_empty_elements = true;
    let mut current: Option<PartialEvent> = None;
    let mut entries = Vec::new();
    let mut pending_data_name: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                let name = start.name();
                let name = name.as_ref();
                match name {
                    "Event" => current = Some(PartialEvent::default()),
                    "Provider" => {
                        if let Some(event) = current.as_mut() {
                            event.provider = attribute(&start, "Name").unwrap_or_default();
                        }
                    }
                    "TimeCreated" => {
                        if let Some(event) = current.as_mut() {
                            event.timestamp = attribute(&start, "SystemTime").unwrap_or_default();
                        }
                    }
                    "EventID" => {
                        if let Some(event) = current.as_mut() {
                            event.text_target = Some(TextTarget::EventId);
                            event.text.clear();
                        }
                    }
                    "Level" => {
                        if let Some(event) = current.as_mut() {
                            event.text_target = Some(TextTarget::Level);
                            event.text.clear();
                        }
                    }
                    "Channel" => {
                        if let Some(event) = current.as_mut() {
                            event.text_target = Some(TextTarget::Channel);
                            event.text.clear();
                        }
                    }
                    "Computer" => {
                        if let Some(event) = current.as_mut() {
                            event.text_target = Some(TextTarget::Computer);
                            event.text.clear();
                        }
                    }
                    "Security" => {
                        if let Some(event) = current.as_mut() {
                            event.user = attribute(&start, "UserID");
                        }
                    }
                    "Data" => {
                        pending_data_name = attribute(&start, "Name");
                        if let Some(event) = current.as_mut() {
                            event.text_target = Some(TextTarget::UserData);
                            event.text.clear();
                        }
                    }
                    "UserData" => {
                        if let Some(event) = current.as_mut() {
                            event.text_target = Some(TextTarget::UserData);
                            event.text.clear();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(event) = current.as_mut() {
                    if event.text_target.is_some() {
                        let value = text.xml_content(quick_xml::XmlVersion::Explicit1_0);
                        event.text.push_str(&value);
                    }
                }
            }
            Ok(Event::End(end)) => {
                let name = end.name();
                let name = name.as_ref();
                if let Some(event) = current.as_mut() {
                    match name {
                        "EventID" => {
                            event.event_id = event.text.trim().parse().unwrap_or_default();
                            event.text_target = None;
                        }
                        "Level" => {
                            event.level = event.text.trim().parse().unwrap_or_default();
                            event.text_target = None;
                        }
                        "Channel" => {
                            event.channel = event.text.trim().to_string();
                            event.text_target = None;
                        }
                        "Computer" => {
                            event.computer = event.text.trim().to_string();
                            event.text_target = None;
                        }
                        "Data" => {
                            let value = event.text.trim().to_string();
                            if !value.is_empty() {
                                event.fields.push(LogField {
                                    name: pending_data_name.take().unwrap_or_else(|| "数据".into()),
                                    value,
                                });
                            }
                            event.text_target = None;
                        }
                        "UserData" => {
                            let value = event.text.trim().to_string();
                            if !value.is_empty() {
                                event.fields.push(LogField {
                                    name: "用户数据".into(),
                                    value,
                                });
                            }
                            event.text_target = None;
                        }
                        "Event" => {
                            if let Some(partial) = current.take() {
                                entries.push(partial.finish());
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    entries
}

fn attribute(start: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    start
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.as_ref() == key)
        .and_then(|attribute| {
            attribute
                .normalized_value(quick_xml::XmlVersion::Explicit1_0)
                .ok()
        })
        .map(|value| value.into_owned())
}

impl PartialEvent {
    fn finish(self) -> LogEntry {
        let message = if self.fields.is_empty() {
            format!(
                "{} 事件 {}",
                if self.channel.is_empty() {
                    "Windows"
                } else {
                    &self.channel
                },
                self.event_id
            )
        } else {
            self.fields
                .iter()
                .map(|field| field.value.as_str())
                .collect::<Vec<_>>()
                .join(" · ")
        };

        let id = format!(
            "{}-{}-{}",
            self.channel,
            self.event_id,
            self.timestamp.replace([':', '.', ' '], "")
        );
        LogEntry {
            id,
            timestamp: self.timestamp,
            level: LogLevel::from_win32(self.level),
            channel: self.channel,
            provider: self.provider,
            event_id: self.event_id,
            message,
            computer: self.computer,
            user: self.user,
            fields: self.fields,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><System><Provider Name="Application Error"/><EventID>1000</EventID><Level>2</Level><TimeCreated SystemTime="2026-10-30T01:02:03.1234567Z"/><Channel>Application</Channel><Computer>OPS-TEST</Computer><Security UserID="S-1-5-18"/></System><EventData><Data Name="Faulting application">demo.exe</Data><Data Name="Exception code">0xc0000005</Data></EventData></Event>"#;

    #[test]
    fn parses_event_xml() {
        let entries = parse_events(SAMPLE);
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.event_id, 1000);
        assert_eq!(entry.level, LogLevel::Error);
        assert_eq!(entry.provider, "Application Error");
        assert_eq!(entry.channel, "Application");
        assert_eq!(entry.computer, "OPS-TEST");
        assert_eq!(entry.fields.len(), 2);
        assert_eq!(entry.fields[1].value, "0xc0000005");
    }

    #[test]
    fn builds_three_day_xpath() {
        assert_eq!(
            age_filter(3),
            "*[System[TimeCreated[timediff(@SystemTime) <= 259200000]]]"
        );
        assert_eq!(
            age_filter(0),
            "*[System[TimeCreated[timediff(@SystemTime) <= 86400000]]]"
        );
        assert_eq!(
            age_filter(99),
            "*[System[TimeCreated[timediff(@SystemTime) <= 2592000000]]]"
        );
    }

    #[test]
    fn filters_by_keyword_and_level() {
        let entries = parse_events(SAMPLE);
        assert!(entry_matches(&entries[0], "demo.exe"));
        assert!(!entry_matches(&entries[0], "not-found"));
    }

    #[test]
    fn rejects_unknown_source() {
        let error = channel_for("nope").unwrap_err();
        assert!(error.to_string().contains("未知"));
    }
}
