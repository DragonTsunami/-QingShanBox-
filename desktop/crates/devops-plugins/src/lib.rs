//! Declarative plugin registry for the desktop overview.
//!
//! DeepSeek Harness plugins run inside Cordis (Node/Electron), which cannot be
//! embedded in a Tauri process. This crate borrows the useful part of that
//! model — a manifest, enable/disable lifecycle, and UI contributions — while
//! keeping the host in control: plugins declare data, they never execute code.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Bump when a breaking manifest change is made.
pub const PLUGIN_API_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_WIDGETS: usize = 4;

const BUILTINS: &[(&str, &str)] = &[
    (
        "qingshan.health-check",
        include_str!("../builtin/health-check.json"),
    ),
    (
        "qingshan.release-links",
        include_str!("../builtin/release-links.json"),
    ),
];

/// Official optional bundles. They are listed in the market but only written
/// into the plugin directory when the user installs them.
const OPTIONAL: &[(&str, &str)] = &[
    (
        "qingshan.disk-cleanup",
        include_str!("../optional/disk-cleanup.json"),
    ),
    (
        "qingshan.event-log",
        include_str!("../optional/event-log.json"),
    ),
];

const MAX_PLUGIN_FILES: usize = 256;
const MAX_PLUGIN_BYTES: u64 = 10 * 1024 * 1024;

const PLUGIN_README: &str = r#"# 青衫工具箱插件目录

每个插件一个文件夹：`<插件 id>/plugin.json`。插件只声明概览卡片，不执行第三方代码。

最小示例：

```json
{
  "id": "com.example.hello",
  "name": "示例插件",
  "version": "0.1.0",
  "description": "在概览上放一条说明。",
  "author": "Your Team",
  "icon": "note",
  "enabledByDefault": true,
  "contributes": {
    "overview": [
      {
        "id": "hello",
        "title": "Hello",
        "kind": "note",
        "body": "把 plugin.json 放进本目录即可。"
      }
    ]
  }
}
```

支持的 `kind`：`note`、`checklist`、`links`、`health`。
链接必须是 `https://` 或 `http://`，单个插件最多 4 个卡片。
修改后回到「插件管理」点「重新扫描」。
"#;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("插件目录读写失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("插件清单 JSON 无效: {0}")]
    Json(#[from] serde_json::Error),
    #[error("插件不存在: {0}")]
    NotFound(String),
    #[error("插件校验失败: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributions {
    #[serde(default)]
    pub overview: Vec<OverviewWidget>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidgetKind {
    #[default]
    Note,
    Checklist,
    Links,
    Health,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginLink {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRule {
    #[serde(default = "default_memory_max_percent")]
    pub memory_max_percent: u8,
    #[serde(default = "default_system_disk_max_percent")]
    pub system_disk_max_percent: u8,
    #[serde(default)]
    pub require_elevation: bool,
}

fn default_memory_max_percent() -> u8 {
    85
}

fn default_system_disk_max_percent() -> u8 {
    90
}

impl Default for HealthRule {
    fn default() -> Self {
        Self {
            memory_max_percent: default_memory_max_percent(),
            system_disk_max_percent: default_system_disk_max_percent(),
            require_elevation: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewWidget {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub kind: WidgetKind,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub items: Vec<String>,
    #[serde(default)]
    pub links: Vec<PluginLink>,
    #[serde(default)]
    pub health: Option<HealthRule>,
}

impl OverviewWidget {
    fn validate(&self) -> Result<(), String> {
        validate_id("卡片 id", &self.id)?;
        validate_text("卡片标题", &self.title, 80, false)?;
        validate_text("卡片正文", &self.body, 600, true)?;

        if self.items.len() > 8 {
            return Err("卡片清单最多 8 项".into());
        }
        for item in &self.items {
            validate_text("清单项", item, 120, false)?;
        }

        if self.links.len() > 6 {
            return Err("卡片链接最多 6 个".into());
        }
        for link in &self.links {
            validate_text("链接标题", &link.label, 60, false)?;
            validate_url(&link.url)?;
        }

        match self.kind {
            WidgetKind::Links if self.links.is_empty() => {
                return Err("链接卡片至少需要一个链接".into());
            }
            WidgetKind::Health => {
                let health = self
                    .health
                    .as_ref()
                    .ok_or_else(|| "巡检卡片缺少 health 配置".to_string())?;
                if !(1..=100).contains(&health.memory_max_percent) {
                    return Err("health.memoryMaxPercent 必须在 1..=100".into());
                }
                if !(1..=100).contains(&health.system_disk_max_percent) {
                    return Err("health.systemDiskMaxPercent 必须在 1..=100".into());
                }
            }
            _ => {}
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub enabled_by_default: bool,
    #[serde(default)]
    pub contributes: Contributions,
}

impl PluginManifest {
    pub fn validate(&self) -> Result<(), String> {
        validate_id("插件 id", &self.id)?;
        validate_text("插件名称", &self.name, 80, false)?;
        validate_text("插件版本", &self.version, 32, false)?;
        validate_text("插件说明", &self.description, 280, true)?;
        validate_text("插件作者", &self.author, 80, true)?;

        if !self
            .version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
        {
            return Err("插件版本只能包含字母、数字、点、连字符和加号".into());
        }

        if let Some(icon) = &self.icon {
            validate_text("插件图标", icon, 32, true)?;
        }
        if let Some(homepage) = &self.homepage {
            validate_url(homepage)?;
        }

        if self.tags.len() > 6 {
            return Err("插件标签最多 6 个".into());
        }
        for tag in &self.tags {
            validate_text("插件标签", tag, 24, false)?;
        }

        if self.contributes.overview.len() > MAX_WIDGETS {
            return Err(format!("单插件最多 {MAX_WIDGETS} 个概览卡片"));
        }

        let mut widget_ids = BTreeSet::new();
        for widget in &self.contributes.overview {
            widget.validate()?;
            if !widget_ids.insert(widget.id.as_str()) {
                return Err(format!("卡片 id 重复: {}", widget.id));
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub builtin: bool,
    pub path: String,
    pub widgets: Vec<OverviewWidget>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalog {
    pub directory: String,
    pub plugins: Vec<PluginView>,
    pub warnings: Vec<String>,
}

/// One entry in the bundled plugin market. The desktop app ships its catalog
/// with the binary, so discovery works offline; installing an entry writes its
/// manifest into the plugin directory.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub homepage: Option<String>,
    pub icon: Option<String>,
    pub tags: Vec<String>,
    pub installed: bool,
    pub official: bool,
}

#[derive(Debug, Clone)]
pub struct PluginStore {
    root: PathBuf,
    state_file: PathBuf,
}

impl PluginStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let state_file = root.join("state.json");
        Self { root, state_file }
    }

    pub fn directory(&self) -> &Path {
        &self.root
    }

    pub fn catalog(&self) -> Result<PluginCatalog, PluginError> {
        self.ensure_layout()?;

        let mut warnings = Vec::new();
        let overrides = self.read_overrides(&mut warnings)?;
        let mut plugins = self.load_plugins(&mut warnings)?;
        for plugin in &mut plugins {
            plugin.enabled = overrides.get(&plugin.id).copied().unwrap_or(plugin.enabled);
        }
        plugins.sort_by(|left, right| {
            right
                .builtin
                .cmp(&left.builtin)
                .then_with(|| left.name.cmp(&right.name))
        });

        Ok(PluginCatalog {
            directory: self.root.display().to_string(),
            plugins,
            warnings,
        })
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<PluginCatalog, PluginError> {
        let catalog = self.catalog()?;
        if !catalog.plugins.iter().any(|plugin| plugin.id == id) {
            return Err(PluginError::NotFound(id.to_string()));
        }

        let mut warnings = Vec::new();
        let mut overrides = self.read_overrides(&mut warnings)?;
        overrides.insert(id.to_string(), enabled);
        self.write_overrides(&overrides)?;
        self.catalog()
    }

    pub fn market(&self) -> Result<Vec<PluginMarketEntry>, PluginError> {
        let catalog = self.catalog()?;
        let mut entries = Vec::new();

        for &(id, json) in BUILTINS.iter().chain(OPTIONAL.iter()) {
            let manifest: PluginManifest = serde_json::from_str(json)?;
            entries.push(PluginMarketEntry {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                author: manifest.author,
                homepage: manifest.homepage,
                icon: manifest.icon,
                tags: manifest.tags,
                installed: catalog.plugins.iter().any(|plugin| plugin.id == id),
                official: true,
            });
        }

        entries.sort_by(|left, right| {
            left.installed
                .cmp(&right.installed)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(entries)
    }

    /// Install a catalog entry. Installed optional bundles are a no-op, and
    /// built-ins are always present, so only unknown ids fail.
    pub fn install(&self, id: &str) -> Result<PluginCatalog, PluginError> {
        if BUILTINS.iter().any(|(builtin_id, _)| *builtin_id == id) {
            return self.catalog();
        }
        let Some((_, json)) = OPTIONAL.iter().find(|(plugin_id, _)| *plugin_id == id) else {
            return Err(PluginError::NotFound(id.to_string()));
        };
        let manifest: PluginManifest = serde_json::from_str(json)?;
        manifest.validate().map_err(PluginError::Invalid)?;

        let directory = self.root.join(&manifest.id);
        if directory.exists() {
            return self.catalog();
        }
        fs::create_dir_all(&directory)?;
        let written = fs::write(directory.join("plugin.json"), json);
        if let Err(error) = written {
            let _ = fs::remove_dir_all(&directory);
            return Err(error.into());
        }
        self.catalog()
    }

    /// Copy a local bundle into the plugin directory. The source must contain a
    /// valid `plugin.json`; the id, not the source folder name, decides the
    /// destination. Partial copies are removed on failure.
    pub fn install_from_path(&self, path: &str) -> Result<PluginCatalog, PluginError> {
        let source = PathBuf::from(path.trim());
        let source = source.canonicalize()?;
        if !source.is_dir() {
            return Err(PluginError::Invalid("插件来源必须是文件夹".into()));
        }
        if source.starts_with(&self.root) {
            return Err(PluginError::Invalid("插件来源不能位于插件目录内".into()));
        }

        let manifest_path = source.join("plugin.json");
        let manifest = read_manifest(&manifest_path)?;
        manifest.validate().map_err(PluginError::Invalid)?;
        if BUILTINS.iter().any(|(id, _)| *id == manifest.id) {
            return Err(PluginError::Invalid("不能覆盖内置插件".into()));
        }

        let destination = self.root.join(&manifest.id);
        if destination.exists() {
            return Err(PluginError::Invalid(format!("插件 {} 已安装", manifest.id)));
        }

        copy_bundle(&source, &destination, &mut CopyBudget::default())?;
        if let Err(error) = self.catalog() {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        self.catalog()
    }

    /// Remove an externally installed plugin. Built-ins are managed by the app
    /// and cannot be removed.
    pub fn remove(&self, id: &str) -> Result<PluginCatalog, PluginError> {
        validate_id("插件 id", id).map_err(PluginError::Invalid)?;
        if BUILTINS.iter().any(|(builtin_id, _)| *builtin_id == id) {
            return Err(PluginError::Invalid("内置插件不能移除".into()));
        }

        let directory = self.root.join(id);
        if !directory.is_dir() {
            return Err(PluginError::NotFound(id.to_string()));
        }
        fs::remove_dir_all(directory)?;

        let mut warnings = Vec::new();
        let mut overrides = self.read_overrides(&mut warnings)?;
        if overrides.remove(id).is_some() {
            self.write_overrides(&overrides)?;
        }
        self.catalog()
    }

    fn ensure_layout(&self) -> Result<(), PluginError> {
        fs::create_dir_all(&self.root)?;
        let readme = self.root.join("README.md");
        if !readme.exists() {
            fs::write(&readme, PLUGIN_README)?;
        }

        for &(id, json) in BUILTINS {
            let directory = self.root.join(id);
            fs::create_dir_all(&directory)?;
            let manifest = directory.join("plugin.json");
            if !manifest.exists() {
                fs::write(&manifest, json)?;
            }
        }
        Ok(())
    }

    fn load_plugins(&self, warnings: &mut Vec<String>) -> Result<Vec<PluginView>, PluginError> {
        let mut plugins = Vec::new();

        // Always load built-ins from their canonical directories first so an
        // external folder cannot shadow a built-in id by accident.
        for &(id, _) in BUILTINS {
            let manifest = self.root.join(id).join("plugin.json");
            if let Some(plugin) = self.load_one(&manifest, warnings) {
                plugins.push(plugin);
            }
        }

        let entries = fs::read_dir(&self.root)?;
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(format!("读取插件目录失败: {error}"));
                    continue;
                }
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    warnings.push(format!("读取 {} 类型失败: {error}", entry.path().display()));
                    continue;
                }
            };
            if !file_type.is_dir() {
                continue;
            }

            let directory_name = entry.file_name().to_string_lossy().to_string();
            if BUILTINS.iter().any(|(id, _)| *id == directory_name) {
                continue;
            }

            let manifest = entry.path().join("plugin.json");
            if !manifest.exists() {
                continue;
            }
            if let Some(plugin) = self.load_one(&manifest, warnings) {
                if plugins.iter().any(|existing| existing.id == plugin.id) {
                    warnings.push(format!(
                        "插件 id 重复，已忽略: {} ({})",
                        plugin.id,
                        manifest.display()
                    ));
                } else {
                    plugins.push(plugin);
                }
            }
        }

        Ok(plugins)
    }

    fn load_one(&self, manifest_path: &Path, warnings: &mut Vec<String>) -> Option<PluginView> {
        let metadata = match fs::metadata(manifest_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!("读取 {} 失败: {error}", manifest_path.display()));
                return None;
            }
        };
        if metadata.len() > MAX_MANIFEST_BYTES {
            warnings.push(format!(
                "插件清单超过 {} KB，已跳过: {}",
                MAX_MANIFEST_BYTES / 1024,
                manifest_path.display()
            ));
            return None;
        }

        let text = match fs::read_to_string(manifest_path) {
            Ok(text) => text,
            Err(error) => {
                warnings.push(format!("读取 {} 失败: {error}", manifest_path.display()));
                return None;
            }
        };
        // Windows 编辑器可能写入 UTF-8 BOM，serde_json 不接受它。
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        let manifest: PluginManifest = match serde_json::from_str(text) {
            Ok(manifest) => manifest,
            Err(error) => {
                warnings.push(format!("{}: {error}", manifest_path.display()));
                return None;
            }
        };
        if let Err(reason) = manifest.validate() {
            warnings.push(format!("{}: {reason}", manifest_path.display()));
            return None;
        }

        let builtin = BUILTINS.iter().any(|(id, _)| *id == manifest.id.as_str());

        Some(PluginView {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            author: manifest.author,
            icon: manifest.icon,
            homepage: manifest.homepage,
            tags: manifest.tags,
            enabled: manifest.enabled_by_default,
            builtin,
            path: manifest_path.display().to_string(),
            widgets: manifest.contributes.overview,
        })
    }

    fn read_overrides(
        &self,
        warnings: &mut Vec<String>,
    ) -> Result<BTreeMap<String, bool>, PluginError> {
        match fs::read_to_string(&self.state_file) {
            Ok(text) => match serde_json::from_str::<PluginState>(&text) {
                Ok(state) => Ok(state.overrides),
                Err(error) => {
                    warnings.push(format!("state.json 解析失败，已忽略: {error}"));
                    Ok(BTreeMap::new())
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn write_overrides(&self, overrides: &BTreeMap<String, bool>) -> Result<(), PluginError> {
        fs::create_dir_all(&self.root)?;
        let state = PluginState {
            overrides: overrides.clone(),
        };
        let data = serde_json::to_string_pretty(&state)?;
        let temporary = self.root.join("state.json.tmp");
        fs::write(&temporary, data)?;
        if self.state_file.exists() {
            fs::remove_file(&self.state_file)?;
        }
        fs::rename(temporary, &self.state_file)?;
        Ok(())
    }
}

#[derive(Default)]
struct CopyBudget {
    files: usize,
    bytes: u64,
}

fn read_manifest(path: &Path) -> Result<PluginManifest, PluginError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(PluginError::Invalid(format!(
            "插件清单超过 {} KB",
            MAX_MANIFEST_BYTES / 1024
        )));
    }
    let text = fs::read_to_string(path)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let manifest: PluginManifest = serde_json::from_str(text)?;
    Ok(manifest)
}

fn copy_bundle(
    source: &Path,
    destination: &Path,
    budget: &mut CopyBudget,
) -> Result<(), PluginError> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_bundle(&entry.path(), &target, budget)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        budget.files += 1;
        if budget.files > MAX_PLUGIN_FILES {
            return Err(PluginError::Invalid(format!(
                "插件文件数不能超过 {MAX_PLUGIN_FILES}"
            )));
        }
        budget.bytes += entry.metadata()?.len();
        if budget.bytes > MAX_PLUGIN_BYTES {
            return Err(PluginError::Invalid(format!(
                "插件总大小不能超过 {} MB",
                MAX_PLUGIN_BYTES / 1024 / 1024
            )));
        }
        fs::copy(entry.path(), target)?;
    }
    Ok(())
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PluginState {
    #[serde(default)]
    overrides: BTreeMap<String, bool>,
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    if !(3..=64).contains(&value.len()) {
        return Err(format!("{label}长度必须在 3..=64"));
    }
    let mut chars = value.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("{label}必须以字母或数字开头"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(format!("{label}只能包含字母、数字、点、下划线和连字符"));
    }
    Ok(())
}

fn validate_text(label: &str, value: &str, max: usize, allow_empty: bool) -> Result<(), String> {
    if !allow_empty && value.trim().is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if value.chars().count() > max {
        return Err(format!("{label}不能超过 {max} 个字符"));
    }
    Ok(())
}

fn validate_url(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.len() > 2048 {
        return Err("URL 不能超过 2048 个字符".into());
    }
    if !(value.starts_with("https://") || value.starts_with("http://")) {
        return Err("URL 必须以 https:// 或 http:// 开头".into());
    }
    if value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("URL 不能包含空白或控制字符".into());
    }
    Ok(())
}
