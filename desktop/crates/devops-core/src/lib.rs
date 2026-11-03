//! Domain layer shared by the 青衫工具箱 desktop client and (later) the web
//! backend. Nothing in this crate may depend on Tauri, sysinfo or Windows APIs.

pub mod cleanup;
pub mod diagnostics;
pub mod error;
pub mod logs;
pub mod models;
pub mod software;
pub mod startup;
pub mod traits;

pub use cleanup::*;
pub use diagnostics::*;
pub use error::{OpsError, OpsResult};
pub use logs::*;
pub use models::*;
pub use software::*;
pub use startup::*;
pub use traits::*;

/// Crate version, surfaced to the UI through the Tauri command layer.
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
