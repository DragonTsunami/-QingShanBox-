use thiserror::Error;

/// Unified error type for every platform operation. Commands convert this into
/// a user-facing string at the Tauri boundary.
#[derive(Debug, Error)]
pub enum OpsError {
    #[error("平台操作失败: {0}")]
    Platform(String),

    #[error("未找到目标: {0}")]
    NotFound(String),

    #[error("权限不足，请以管理员身份重新启动青衫工具箱")]
    PermissionDenied,

    #[error("参数无效: {0}")]
    InvalidInput(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type OpsResult<T> = Result<T, OpsError>;

impl OpsError {
    /// Stable machine-readable code so the UI can branch without string
    /// matching on localized messages.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Platform(_) => "platform",
            Self::NotFound(_) => "not_found",
            Self::PermissionDenied => "permission_denied",
            Self::InvalidInput(_) => "invalid_input",
            Self::Io(_) => "io",
        }
    }
}
