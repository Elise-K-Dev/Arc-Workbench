use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCheckResult {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchSummary {
    pub files: Vec<String>,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileSnapshot {
    pub relative_path: String,
    pub pre_content: String,
    pub pre_sha256: String,
    pub post_sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchRollbackStatus {
    Available,
    RolledBack,
    Invalidated,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRollbackRecord {
    pub id: String,
    pub created_at: String,
    pub workspace_root: String,
    pub patch_summary: PatchSummary,
    pub files: Vec<PatchFileSnapshot>,
    pub status: PatchRollbackStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyResult {
    pub ok: bool,
    pub message: String,
    pub snapshot: Option<PatchRollbackRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRollbackResult {
    pub ok: bool,
    pub message: String,
    pub record: Option<PatchRollbackRecord>,
}
