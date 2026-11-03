use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use devops_plugins::PluginStore;

const EXTERNAL_MANIFEST: &str = r#"{
  "id": "com.example.hello",
  "name": "示例插件",
  "version": "0.1.0",
  "description": "一条来自外部的概览说明。",
  "author": "Example Team",
  "icon": "note",
  "enabledByDefault": true,
  "contributes": {
    "overview": [
      {
        "id": "hello",
        "title": "Hello Ops",
        "kind": "note",
        "body": "这是外部插件声明的卡片。"
      }
    ]
  }
}"#;

struct TempRoot(PathBuf);

impl TempRoot {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "qingshan-plugins-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_manifest(root: &Path, folder: &str, contents: &str) {
    let directory = root.join(folder);
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("plugin.json"), contents).unwrap();
}

#[test]
fn seeds_builtin_plugins_and_readme() {
    let root = TempRoot::new("seed");
    let store = PluginStore::new(&root.0);
    let catalog = store.catalog().unwrap();

    assert!(catalog.warnings.is_empty(), "{:?}", catalog.warnings);
    assert_eq!(catalog.plugins.len(), 2);
    assert!(root.0.join("README.md").exists());
    assert!(root.0.join("qingshan.health-check/plugin.json").exists());

    let health = catalog
        .plugins
        .iter()
        .find(|plugin| plugin.id == "qingshan.health-check")
        .unwrap();
    assert!(health.builtin);
    assert!(health.enabled);
    assert_eq!(health.widgets.len(), 1);

    let links = catalog
        .plugins
        .iter()
        .find(|plugin| plugin.id == "qingshan.release-links")
        .unwrap();
    assert!(links.builtin);
    assert!(!links.enabled);
    assert_eq!(links.widgets[0].links.len(), 3);
}

#[test]
fn external_manifest_is_loaded() {
    let root = TempRoot::new("external");
    write_manifest(&root.0, "com.example.hello", EXTERNAL_MANIFEST);

    let catalog = PluginStore::new(&root.0).catalog().unwrap();
    let plugin = catalog
        .plugins
        .iter()
        .find(|plugin| plugin.id == "com.example.hello")
        .expect("external plugin should be loaded");

    assert!(!plugin.builtin);
    assert!(plugin.enabled);
    assert_eq!(plugin.name, "示例插件");
    assert_eq!(plugin.widgets[0].title, "Hello Ops");
    assert!(catalog.warnings.is_empty(), "{:?}", catalog.warnings);
}

#[test]
fn external_manifest_with_bom_is_loaded() {
    let root = TempRoot::new("bom");
    write_manifest(
        &root.0,
        "com.example.bom",
        &format!("\u{feff}{EXTERNAL_MANIFEST}"),
    );

    let catalog = PluginStore::new(&root.0).catalog().unwrap();
    assert!(
        catalog
            .plugins
            .iter()
            .any(|plugin| plugin.id == "com.example.hello"),
        "BOM manifest should load: {:?}",
        catalog.warnings
    );
    assert!(catalog.warnings.is_empty(), "{:?}", catalog.warnings);
}

#[test]
fn enabled_state_persists_across_reloads() {
    let root = TempRoot::new("toggle");
    let store = PluginStore::new(&root.0);
    store.set_enabled("qingshan.release-links", true).unwrap();

    let reloaded = PluginStore::new(&root.0).catalog().unwrap();
    let links = reloaded
        .plugins
        .iter()
        .find(|plugin| plugin.id == "qingshan.release-links")
        .unwrap();
    assert!(links.enabled);
    assert!(root.0.join("state.json").exists());

    store.set_enabled("qingshan.release-links", false).unwrap();
    let reloaded = PluginStore::new(&root.0).catalog().unwrap();
    let links = reloaded
        .plugins
        .iter()
        .find(|plugin| plugin.id == "qingshan.release-links")
        .unwrap();
    assert!(!links.enabled);
}

#[test]
fn unknown_plugin_is_rejected() {
    let root = TempRoot::new("unknown");
    let store = PluginStore::new(&root.0);
    assert!(store.set_enabled("missing.plugin", true).is_err());
}

#[test]
fn invalid_manifest_warns_without_breaking_catalog() {
    let root = TempRoot::new("invalid");
    write_manifest(
        &root.0,
        "bad",
        r#"{
          "id": "../escape",
          "name": "Bad",
          "version": "0.1.0"
        }"#,
    );

    let catalog = PluginStore::new(&root.0).catalog().unwrap();
    assert_eq!(catalog.plugins.len(), 2);
    assert!(catalog
        .warnings
        .iter()
        .any(|warning| warning.contains("plugin.json")));
}

#[test]
fn non_http_link_is_rejected() {
    let root = TempRoot::new("link");
    write_manifest(
        &root.0,
        "com.example.bad-link",
        r#"{
          "id": "com.example.bad-link",
          "name": "Bad link",
          "version": "0.1.0",
          "contributes": {
            "overview": [
              {
                "id": "bad",
                "title": "Bad",
                "kind": "links",
                "links": [{ "label": "Run", "url": "javascript:alert(1)" }]
              }
            ]
          }
        }"#,
    );

    let catalog = PluginStore::new(&root.0).catalog().unwrap();
    assert!(!catalog
        .plugins
        .iter()
        .any(|plugin| plugin.id == "com.example.bad-link"));
    assert!(catalog
        .warnings
        .iter()
        .any(|warning| warning.contains("https://")));
}

#[test]
fn market_install_and_remove_round_trip() {
    let root = TempRoot::new("market");
    let store = PluginStore::new(&root.0);

    let market = store.market().unwrap();
    let optional = market
        .iter()
        .find(|plugin| plugin.id == "qingshan.disk-cleanup")
        .expect("optional plugin should be listed");
    assert!(!optional.installed);
    assert!(optional.official);

    let catalog = store.install("qingshan.disk-cleanup").unwrap();
    assert!(catalog
        .plugins
        .iter()
        .any(|plugin| plugin.id == "qingshan.disk-cleanup"));
    assert!(root.0.join("qingshan.disk-cleanup/plugin.json").exists());

    let catalog = store.remove("qingshan.disk-cleanup").unwrap();
    assert!(!catalog
        .plugins
        .iter()
        .any(|plugin| plugin.id == "qingshan.disk-cleanup"));
    assert!(!root.0.join("qingshan.disk-cleanup").exists());
    assert!(store.remove("qingshan.health-check").is_err());
}

#[test]
fn installs_external_bundle_from_path() {
    let root = TempRoot::new("install-root");
    let source = TempRoot::new("install-source");
    write_manifest(&source.0, "com.example.hello", EXTERNAL_MANIFEST);
    let store = PluginStore::new(&root.0);

    let catalog = store
        .install_from_path(
            source
                .0
                .join("com.example.hello")
                .to_str()
                .expect("utf-8 path"),
        )
        .unwrap();
    assert!(catalog
        .plugins
        .iter()
        .any(|plugin| plugin.id == "com.example.hello"));
    assert!(root.0.join("com.example.hello/plugin.json").exists());
    assert!(root.0.join("com.example.hello/plugin.json").is_file());
}
