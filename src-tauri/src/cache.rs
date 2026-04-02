//! File-backed per-mode post caches in the app data directory.
//!
//! The cache serves two purposes:
//! 1. Avoid redundant API calls — daily refresh is sufficient for a screensaver.
//! 2. Provide fallback data when the X API is unreachable (network down, rate
//!    limited, invalid token, etc.).
//!
//! Each mode stores its own `PostCache` struct (timestamp + posts array) as
//! pretty-printed JSON for easy debugging. Keeping the files separate avoids
//! cross-mode overwrites and preserves the PRD requirement that FlipFlap and
//! Matrix never share post sources.

use std::path::{Path, PathBuf};

use crate::models::PostCache;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default staleness threshold in hours. A cache older than this triggers a
/// re-fetch on the next `fetch_posts` call.
pub const DEFAULT_STALENESS_HOURS: u64 = 24;

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Returns the full path to the cache file for a specific mode inside the
/// given app data directory.
///
/// Does not create the directory — the caller (Tauri setup) ensures it exists.
pub fn cache_path(app_data_dir: &Path, mode: &str) -> PathBuf {
    app_data_dir.join(format!("posts_{mode}.json"))
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/// Reads the post cache from disk.
///
/// Returns `None` if the file does not exist or cannot be parsed (corrupt file
/// is treated the same as missing — we'll just re-fetch).
pub fn read_cache(app_data_dir: &Path, mode: &str) -> Option<PostCache> {
    let path = cache_path(app_data_dir, mode);

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("failed to read cache file {}: {e}", path.display());
            }
            return None;
        }
    };

    match serde_json::from_str::<PostCache>(&content) {
        Ok(cache) => Some(cache),
        Err(e) => {
            log::warn!("cache file is corrupt, will re-fetch: {e}");
            None
        }
    }
}

/// Writes the post cache to disk, creating the parent directory if needed.
///
/// Uses pretty-printed JSON so the file is human-readable for debugging.
/// Writes to a temp file first, then renames for atomicity.
pub fn write_cache(app_data_dir: &Path, mode: &str, cache: &PostCache) -> Result<(), String> {
    let path = cache_path(app_data_dir, mode);

    // Ensure the directory exists.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create cache directory: {e}"))?;
    }

    let json = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("failed to serialize cache: {e}"))?;

    // Atomic write: write to a temp file in the same directory, then rename.
    // This prevents a crash mid-write from corrupting the cache.
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json.as_bytes())
        .map_err(|e| format!("failed to write temp cache file: {e}"))?;

    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("failed to rename temp cache to final path: {e}"))?;

    log::info!(
        "cache written: {} posts, fetched_at={}",
        cache.posts.len(),
        cache.fetched_at
    );

    Ok(())
}

/// Returns `true` if the cache file exists and is still fresh (not stale).
///
/// Convenience for deciding whether to skip a fetch on startup.
pub fn is_cache_fresh(app_data_dir: &Path, mode: &str, max_age_hours: u64) -> bool {
    match read_cache(app_data_dir, mode) {
        Some(cache) => !cache.is_stale(max_age_hours),
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Post;
    use chrono::{TimeZone, Utc};
    use std::fs;

    /// Creates a test cache with known data.
    fn sample_cache() -> PostCache {
        PostCache {
            fetched_at: Utc.with_ymd_and_hms(2026, 3, 31, 12, 0, 0).unwrap(),
            posts: vec![
                Post {
                    id: "1".into(),
                    text: "First post".into(),
                    author_username: "alice".into(),
                    author_id: "100".into(),
                    created_at: Utc.with_ymd_and_hms(2026, 3, 31, 11, 0, 0).unwrap(),
                },
                Post {
                    id: "2".into(),
                    text: "Second post".into(),
                    author_username: "bob".into(),
                    author_id: "200".into(),
                    created_at: Utc.with_ymd_and_hms(2026, 3, 31, 10, 0, 0).unwrap(),
                },
            ],
        }
    }

    #[test]
    fn test_cache_path() {
        let matrix_path = cache_path(Path::new("/app/data"), "matrix");
        let flipflap_path = cache_path(Path::new("/app/data"), "flipflap");
        assert_eq!(matrix_path, PathBuf::from("/app/data/posts_matrix.json"));
        assert_eq!(
            flipflap_path,
            PathBuf::from("/app/data/posts_flipflap.json")
        );
    }

    #[test]
    fn test_write_and_read_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = sample_cache();

        write_cache(dir.path(), "matrix", &cache).unwrap();
        let read_back = read_cache(dir.path(), "matrix").unwrap();
        assert_eq!(read_back, cache);
    }

    #[test]
    fn test_read_cache_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_cache(dir.path(), "matrix").is_none());
    }

    #[test]
    fn test_read_cache_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = cache_path(dir.path(), "matrix");
        fs::write(&path, "not valid json {{{").unwrap();
        assert!(read_cache(dir.path(), "matrix").is_none());
    }

    #[test]
    fn test_write_cache_creates_directory() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("nested").join("deep");
        let cache = sample_cache();

        write_cache(&nested, "matrix", &cache).unwrap();
        assert!(cache_path(&nested, "matrix").exists());
    }

    #[test]
    fn test_is_cache_fresh_no_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_cache_fresh(dir.path(), "matrix", 24));
    }

    #[test]
    fn test_is_cache_fresh_with_fresh_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PostCache {
            fetched_at: Utc::now(),
            posts: vec![],
        };
        write_cache(dir.path(), "matrix", &cache).unwrap();
        assert!(is_cache_fresh(dir.path(), "matrix", 24));
    }

    #[test]
    fn test_is_cache_fresh_with_stale_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PostCache {
            fetched_at: Utc::now() - chrono::TimeDelta::hours(25),
            posts: vec![],
        };
        write_cache(dir.path(), "matrix", &cache).unwrap();
        assert!(!is_cache_fresh(dir.path(), "matrix", 24));
    }

    #[test]
    fn test_write_cache_atomicity() {
        // Write cache, then write again — the second write should not leave
        // a .tmp file lying around.
        let dir = tempfile::tempdir().unwrap();
        let cache = sample_cache();

        write_cache(dir.path(), "matrix", &cache).unwrap();
        write_cache(dir.path(), "matrix", &cache).unwrap();

        let tmp_path = cache_path(dir.path(), "matrix").with_extension("json.tmp");
        assert!(!tmp_path.exists());
    }

    #[test]
    fn test_cache_file_is_pretty_printed() {
        let dir = tempfile::tempdir().unwrap();
        let cache = sample_cache();
        write_cache(dir.path(), "matrix", &cache).unwrap();

        let content = fs::read_to_string(cache_path(dir.path(), "matrix")).unwrap();
        // Pretty-printed JSON has newlines and indentation.
        assert!(content.contains('\n'));
        assert!(content.contains("  "));
    }

    #[test]
    fn test_modes_use_separate_cache_files() {
        let dir = tempfile::tempdir().unwrap();
        let matrix_cache = sample_cache();
        let mut flipflap_cache = sample_cache();
        flipflap_cache.posts[0].id = "flipflap-1".into();

        write_cache(dir.path(), "matrix", &matrix_cache).unwrap();
        write_cache(dir.path(), "flipflap", &flipflap_cache).unwrap();

        let matrix = read_cache(dir.path(), "matrix").unwrap();
        let flipflap = read_cache(dir.path(), "flipflap").unwrap();

        assert_eq!(matrix.posts[0].id, "1");
        assert_eq!(flipflap.posts[0].id, "flipflap-1");
    }
}
