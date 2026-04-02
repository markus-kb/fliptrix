//! Data types for X post storage, fetch configuration, and caching.
//!
//! These types are shared across the API client, cache layer, and Tauri
//! commands. All types derive `Serialize`/`Deserialize` so they round-trip
//! cleanly through both per-mode cache files and the Tauri IPC bridge.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// X Post
// ---------------------------------------------------------------------------

/// A single X/Twitter post, normalized from the API v2 response.
///
/// Fields map to X API v2 tweet objects with `tweet.fields=id,text,created_at,
/// author_id,note_tweet` plus user expansion for `username`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Post {
    /// X tweet ID (numeric string).
    pub id: String,
    /// Full post text. For long posts (>280 chars) this is the `note_tweet.text`
    /// field when available, falling back to the regular `text` field.
    pub text: String,
    /// The `@username` of the post author (without the leading `@`).
    pub author_username: String,
    /// The numeric user ID of the post author.
    pub author_id: String,
    /// When the post was created.
    pub created_at: DateTime<Utc>,
}

impl Post {
    /// Returns `text` truncated to `max_chars` characters, appending "..." if
    /// truncation occurred. Returns the full text if it fits within the limit.
    ///
    /// Used by FlipFlap and Matrix renderers (Phase 5/6) to fit posts to
    /// the configured display width.
    #[allow(dead_code)]
    pub fn truncated_text(&self, max_chars: usize) -> String {
        if self.text.chars().count() <= max_chars {
            self.text.clone()
        } else {
            // Truncate to max_chars - 3 to leave room for the ellipsis.
            let end = max_chars.saturating_sub(3);
            let truncated: String = self.text.chars().take(end).collect();
            format!("{truncated}...")
        }
    }
}

// ---------------------------------------------------------------------------
// Fetch configuration
// ---------------------------------------------------------------------------

/// Per-mode configuration for which X data to fetch.
///
/// Each screensaver mode (FlipFlap, Matrix) has its own `ModeDataConfig` so
/// the user can show different accounts/queries on each mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModeDataConfig {
    /// X usernames to fetch timelines from (without leading `@`).
    pub accounts: Vec<String>,
    /// Optional search query for the recent search endpoint. When set, results
    /// from this query are merged with timeline posts.
    #[serde(default)]
    pub search_query: Option<String>,
    /// How far back to fetch posts, in hours (default: 24).
    #[serde(default = "default_time_window_hours")]
    pub time_window_hours: u64,
    /// Maximum characters per post for display. Posts longer than this are
    /// truncated with "..." (default: 280).
    #[serde(default = "default_truncation_length")]
    pub truncation_length: usize,
}

fn default_time_window_hours() -> u64 {
    24
}

fn default_truncation_length() -> usize {
    280
}

impl Default for ModeDataConfig {
    fn default() -> Self {
        Self {
            accounts: Vec::new(),
            search_query: None,
            time_window_hours: default_time_window_hours(),
            truncation_length: default_truncation_length(),
        }
    }
}

/// Top-level fetch configuration covering both screensaver modes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct FetchConfig {
    pub flipflap: ModeDataConfig,
    pub matrix: ModeDataConfig,
}

// ---------------------------------------------------------------------------
// Post cache envelope
// ---------------------------------------------------------------------------

/// Wraps a list of posts with metadata for staleness checking.
///
/// Serialized as a per-mode cache file in the app data directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PostCache {
    /// When this cache was last successfully populated from the API.
    pub fetched_at: DateTime<Utc>,
    /// The posts, newest first.
    pub posts: Vec<Post>,
}

impl PostCache {
    /// Returns `true` if the cache is older than `max_age_hours`.
    pub fn is_stale(&self, max_age_hours: u64) -> bool {
        let age = Utc::now() - self.fetched_at;
        // chrono::TimeDelta::num_hours returns total hours (can be negative
        // if fetched_at is in the future due to clock skew — treat as fresh).
        age.num_hours() >= max_age_hours as i64
    }
}

// ---------------------------------------------------------------------------
// X API v2 response types (deserialization only)
// ---------------------------------------------------------------------------
// These types mirror the X API v2 JSON schema. Some fields are not yet read
// by application code but are kept for completeness and future pagination
// support. Suppress dead_code warnings for the entire API response section.

/// Top-level response from X API v2 tweet endpoints.
///
/// Used for both `/2/users/{id}/tweets` (timeline) and
/// `/2/tweets/search/recent` (search). The `includes` field carries
/// expanded user objects when `expansions=author_id` is requested.
#[derive(Debug, Deserialize)]
pub struct XApiTweetResponse {
    #[serde(default)]
    pub data: Option<Vec<XApiTweet>>,
    #[serde(default)]
    pub includes: Option<XApiIncludes>,
    #[serde(default)]
    #[allow(dead_code)]
    pub meta: Option<XApiMeta>,
    /// Present when the API returns an error instead of data.
    #[serde(default)]
    #[allow(dead_code)]
    pub errors: Option<Vec<XApiError>>,
}

/// A tweet object from the X API v2 response.
#[derive(Debug, Deserialize)]
pub struct XApiTweet {
    pub id: String,
    pub text: String,
    pub author_id: Option<String>,
    pub created_at: Option<String>,
    /// For posts >280 chars, the full text lives here.
    pub note_tweet: Option<XApiNoteTweet>,
}

/// The `note_tweet` expansion for long-form posts.
#[derive(Debug, Deserialize)]
pub struct XApiNoteTweet {
    pub text: String,
}

/// The `includes` section of an X API v2 response.
#[derive(Debug, Deserialize)]
pub struct XApiIncludes {
    #[serde(default)]
    pub users: Option<Vec<XApiUser>>,
}

/// A user object from the X API v2 `includes.users` expansion.
#[derive(Debug, Deserialize)]
pub struct XApiUser {
    pub id: String,
    pub username: String,
}

/// Pagination and result count metadata.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct XApiMeta {
    pub newest_id: Option<String>,
    pub oldest_id: Option<String>,
    pub next_token: Option<String>,
    pub result_count: Option<u32>,
}

/// An error object from the X API v2 response.
#[derive(Debug, Deserialize)]
pub struct XApiError {
    pub message: String,
    #[serde(default)]
    pub title: Option<String>,
}

/// Response from `/2/users/by/username/{username}`.
#[derive(Debug, Deserialize)]
pub struct XApiUserLookupResponse {
    pub data: Option<XApiUserData>,
    #[allow(dead_code)]
    pub errors: Option<Vec<XApiError>>,
}

/// The `data` field of a user lookup response.
#[derive(Debug, Deserialize)]
pub struct XApiUserData {
    pub id: String,
    #[allow(dead_code)]
    pub username: String,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_post_truncated_text_short() {
        let post = Post {
            id: "1".into(),
            text: "Hello".into(),
            author_username: "user".into(),
            author_id: "100".into(),
            created_at: Utc::now(),
        };
        assert_eq!(post.truncated_text(280), "Hello");
    }

    #[test]
    fn test_post_truncated_text_exact_limit() {
        let text = "a".repeat(280);
        let post = Post {
            id: "1".into(),
            text: text.clone(),
            author_username: "user".into(),
            author_id: "100".into(),
            created_at: Utc::now(),
        };
        assert_eq!(post.truncated_text(280), text);
    }

    #[test]
    fn test_post_truncated_text_over_limit() {
        let text = "a".repeat(300);
        let post = Post {
            id: "1".into(),
            text,
            author_username: "user".into(),
            author_id: "100".into(),
            created_at: Utc::now(),
        };
        let result = post.truncated_text(280);
        assert_eq!(result.chars().count(), 280);
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_post_truncated_text_unicode() {
        // 5 emoji (each 1 char in Rust) + need truncation at 4
        let post = Post {
            id: "1".into(),
            text: "\u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}".into(),
            author_username: "user".into(),
            author_id: "100".into(),
            created_at: Utc::now(),
        };
        let result = post.truncated_text(4);
        // 4 - 3 = 1 char + "..." = 4 chars
        assert_eq!(result, "\u{1F600}...");
    }

    #[test]
    fn test_post_truncated_text_tiny_limit() {
        let post = Post {
            id: "1".into(),
            text: "Hello World".into(),
            author_username: "user".into(),
            author_id: "100".into(),
            created_at: Utc::now(),
        };
        // With limit=3, saturating_sub(3)=0, so we get just "..."
        let result = post.truncated_text(3);
        assert_eq!(result, "...");
    }

    #[test]
    fn test_cache_is_stale_fresh() {
        let cache = PostCache {
            fetched_at: Utc::now(),
            posts: vec![],
        };
        assert!(!cache.is_stale(24));
    }

    #[test]
    fn test_cache_is_stale_old() {
        let cache = PostCache {
            fetched_at: Utc::now() - chrono::TimeDelta::hours(25),
            posts: vec![],
        };
        assert!(cache.is_stale(24));
    }

    #[test]
    fn test_cache_is_stale_exact_boundary() {
        let cache = PostCache {
            fetched_at: Utc::now() - chrono::TimeDelta::hours(24),
            posts: vec![],
        };
        // At exactly 24 hours, num_hours() >= 24 → stale
        assert!(cache.is_stale(24));
    }

    #[test]
    fn test_mode_data_config_defaults() {
        let config = ModeDataConfig::default();
        assert!(config.accounts.is_empty());
        assert!(config.search_query.is_none());
        assert_eq!(config.time_window_hours, 24);
        assert_eq!(config.truncation_length, 280);
    }

    #[test]
    fn test_post_serialization_roundtrip() {
        let post = Post {
            id: "1234567890".into(),
            text: "Test post".into(),
            author_username: "testuser".into(),
            author_id: "999".into(),
            created_at: Utc.with_ymd_and_hms(2026, 3, 31, 12, 0, 0).unwrap(),
        };
        let json = serde_json::to_string(&post).unwrap();
        let deserialized: Post = serde_json::from_str(&json).unwrap();
        assert_eq!(post, deserialized);
    }

    #[test]
    fn test_post_cache_serialization_roundtrip() {
        let cache = PostCache {
            fetched_at: Utc.with_ymd_and_hms(2026, 3, 31, 12, 0, 0).unwrap(),
            posts: vec![Post {
                id: "1".into(),
                text: "Hello".into(),
                author_username: "user".into(),
                author_id: "100".into(),
                created_at: Utc.with_ymd_and_hms(2026, 3, 31, 11, 0, 0).unwrap(),
            }],
        };
        let json = serde_json::to_string(&cache).unwrap();
        let deserialized: PostCache = serde_json::from_str(&json).unwrap();
        assert_eq!(cache, deserialized);
    }

    #[test]
    fn test_mode_data_config_deserialize_with_defaults() {
        // Only supply accounts — everything else should get defaults.
        let json = r#"{"accounts": ["elonmusk"]}"#;
        let config: ModeDataConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.accounts, vec!["elonmusk"]);
        assert!(config.search_query.is_none());
        assert_eq!(config.time_window_hours, 24);
        assert_eq!(config.truncation_length, 280);
    }

    #[test]
    fn test_x_api_tweet_response_deserialize_success() {
        let json = r#"{
            "data": [{
                "id": "123",
                "text": "Hello world",
                "author_id": "456",
                "created_at": "2026-03-31T12:00:00.000Z"
            }],
            "includes": {
                "users": [{"id": "456", "username": "testuser"}]
            },
            "meta": {
                "newest_id": "123",
                "oldest_id": "123",
                "result_count": 1
            }
        }"#;
        let response: XApiTweetResponse = serde_json::from_str(json).unwrap();
        let data = response.data.unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].id, "123");
        assert_eq!(data[0].text, "Hello world");
        let users = response.includes.unwrap().users.unwrap();
        assert_eq!(users[0].username, "testuser");
    }

    #[test]
    fn test_x_api_tweet_response_deserialize_error() {
        let json = r#"{
            "errors": [{
                "message": "Unauthorized",
                "title": "Unauthorized"
            }]
        }"#;
        let response: XApiTweetResponse = serde_json::from_str(json).unwrap();
        assert!(response.data.is_none());
        let errors = response.errors.unwrap();
        assert_eq!(errors[0].message, "Unauthorized");
    }

    #[test]
    fn test_x_api_tweet_with_note_tweet() {
        let json = r#"{
            "id": "789",
            "text": "Short version...",
            "author_id": "100",
            "created_at": "2026-03-31T10:00:00.000Z",
            "note_tweet": {"text": "This is the full long-form text that exceeds 280 characters"}
        }"#;
        let tweet: XApiTweet = serde_json::from_str(json).unwrap();
        assert_eq!(
            tweet.note_tweet.unwrap().text,
            "This is the full long-form text that exceeds 280 characters"
        );
    }

    #[test]
    fn test_x_api_user_lookup_response() {
        let json = r#"{
            "data": {"id": "123456", "username": "fliptrix_user"}
        }"#;
        let response: XApiUserLookupResponse = serde_json::from_str(json).unwrap();
        let data = response.data.unwrap();
        assert_eq!(data.id, "123456");
        assert_eq!(data.username, "fliptrix_user");
    }
}
