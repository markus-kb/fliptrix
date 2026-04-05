//! X API v2 client for fetching posts.
//!
//! Handles bearer-token authentication, user timeline retrieval, recent search,
//! and username-to-ID resolution. All HTTP calls go through `reqwest` with
//! rustls-tls (no OpenSSL dependency).
//!
//! The client is designed for batch fetching (daily refresh) rather than
//! real-time streaming. Rate-limit handling is intentionally simple: surface
//! the error and let the caller fall back to cached data.

use chrono::{DateTime, Utc};

use crate::models::{Post, XApiError, XApiIncludes, XApiTweetResponse, XApiUserLookupResponse};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_X_API_BASE: &str = "https://api.x.com/2";

fn x_api_base() -> String {
    match std::env::var("FLIPTRIX_X_API_BASE") {
        Ok(override_base) => {
            let trimmed = override_base.trim().trim_end_matches('/');
            if trimmed.is_empty() {
                DEFAULT_X_API_BASE.to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(_) => DEFAULT_X_API_BASE.to_string(),
    }
}

/// Fields requested on every tweet endpoint call.
const TWEET_FIELDS: &str = "id,text,created_at,author_id,note_tweet";

/// Expansions requested to get author usernames alongside tweets.
const EXPANSIONS: &str = "author_id";

/// User fields requested in the `includes.users` expansion.
const USER_FIELDS: &str = "id,username";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Async X API v2 client. Holds a `reqwest::Client` and the bearer token.
///
/// Constructed once at app startup (or when the user sets/changes the API key)
/// and shared via `AppState`. The bearer token is stored in memory only — the
/// persisted copy lives in `tauri-plugin-store`.
#[derive(Debug, Clone)]
pub struct XApiClient {
    http: reqwest::Client,
    bearer_token: String,
}

impl XApiClient {
    /// Creates a new client with the given bearer token.
    ///
    /// Fails if the token is empty (caller should validate before constructing).
    pub fn new(bearer_token: String) -> Result<Self, String> {
        if bearer_token.trim().is_empty() {
            return Err("bearer token must not be empty".into());
        }

        let http = reqwest::Client::builder()
            .user_agent("fliptrix/0.1.0")
            .build()
            .map_err(|e| format!("failed to build HTTP client: {e}"))?;

        Ok(Self { http, bearer_token })
    }

    // -----------------------------------------------------------------------
    // Username → user ID resolution
    // -----------------------------------------------------------------------

    /// Resolves an `@username` (without the `@`) to a numeric user ID.
    ///
    /// The timeline endpoint requires the numeric ID, not the username.
    pub async fn resolve_user_id(&self, username: &str) -> Result<String, String> {
        let url = format!("{}/users/by/username/{username}", x_api_base());

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.bearer_token)
            .send()
            .await
            .map_err(|e| format!("user lookup request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "user lookup for @{username} failed (HTTP {status}): {body}"
            ));
        }

        let body: XApiUserLookupResponse = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse user lookup response: {e}"))?;

        if let Some(errors) = body.errors {
            return Err(format_api_errors(&errors));
        }

        body.data
            .map(|d| d.id)
            .ok_or_else(|| format!("no user found for @{username}"))
    }

    // -----------------------------------------------------------------------
    // User timeline
    // -----------------------------------------------------------------------

    /// Fetches recent tweets from a user's timeline.
    ///
    /// `user_id` is the numeric user ID (use `resolve_user_id` to convert from
    /// username). `start_time` filters to tweets created after that instant.
    /// Returns up to 100 tweets per call (API maximum).
    pub async fn fetch_user_timeline(
        &self,
        user_id: &str,
        start_time: Option<DateTime<Utc>>,
        max_results: u32,
    ) -> Result<XApiTweetResponse, String> {
        let url = format!("{}/users/{user_id}/tweets", x_api_base());
        let max_results = max_results.clamp(5, 100);

        let mut request = self.http.get(&url).bearer_auth(&self.bearer_token).query(&[
            ("tweet.fields", TWEET_FIELDS),
            ("expansions", EXPANSIONS),
            ("user.fields", USER_FIELDS),
            ("max_results", &max_results.to_string()),
            ("exclude", "retweets"),
        ]);

        if let Some(start) = start_time {
            request = request.query(&[("start_time", &start.to_rfc3339())]);
        }

        let resp = request
            .send()
            .await
            .map_err(|e| format!("timeline request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("timeline fetch failed (HTTP {status}): {body}"));
        }

        resp.json::<XApiTweetResponse>()
            .await
            .map_err(|e| format!("failed to parse timeline response: {e}"))
    }

    // -----------------------------------------------------------------------
    // Recent search
    // -----------------------------------------------------------------------

    /// Searches recent tweets (last 7 days) matching `query`.
    ///
    /// Query syntax supports operators like `from:user has:media -is:retweet`.
    /// Returns up to `max_results` tweets (clamped to 10–100).
    pub async fn search_recent(
        &self,
        query: &str,
        max_results: u32,
    ) -> Result<XApiTweetResponse, String> {
        let url = format!("{}/tweets/search/recent", x_api_base());
        let max_results = max_results.clamp(10, 100);

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.bearer_token)
            .query(&[
                ("query", query),
                ("tweet.fields", TWEET_FIELDS),
                ("expansions", EXPANSIONS),
                ("user.fields", USER_FIELDS),
                ("max_results", &max_results.to_string()),
                ("sort_order", "recency"),
            ])
            .send()
            .await
            .map_err(|e| format!("search request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("search failed (HTTP {status}): {body}"));
        }

        resp.json::<XApiTweetResponse>()
            .await
            .map_err(|e| format!("failed to parse search response: {e}"))
    }

    // -----------------------------------------------------------------------
    // High-level fetch: all posts for a mode config
    // -----------------------------------------------------------------------

    /// Fetches all posts for a given mode configuration.
    ///
    /// 1. Resolves each username to a user ID.
    /// 2. Fetches each user's timeline since `time_window_hours` ago.
    /// 3. If `search_query` is set, also runs a recent search.
    /// 4. Merges, deduplicates by tweet ID, and sorts newest-first.
    ///
    /// Partial failures (one account unreachable) are logged but do not abort
    /// the entire fetch — we return whatever we could get.
    pub async fn fetch_posts_for_config(
        &self,
        config: &crate::models::ModeDataConfig,
    ) -> Result<Vec<Post>, String> {
        let start_time = Utc::now() - chrono::TimeDelta::hours(config.time_window_hours as i64);
        let mut all_posts: Vec<Post> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        // Fetch timelines for each configured account.
        for username in &config.accounts {
            let user_id = match self.resolve_user_id(username).await {
                Ok(id) => id,
                Err(e) => {
                    log::warn!("skipping @{username}: {e}");
                    errors.push(e);
                    continue;
                }
            };

            match self
                .fetch_user_timeline(&user_id, Some(start_time), 100)
                .await
            {
                Ok(response) => {
                    let posts = normalize_response(response);
                    all_posts.extend(posts);
                }
                Err(e) => {
                    log::warn!("timeline fetch for @{username} failed: {e}");
                    errors.push(e);
                }
            }
        }

        // Run search query if configured.
        if let Some(query) = &config.search_query {
            if !query.trim().is_empty() {
                match self.search_recent(query, 100).await {
                    Ok(response) => {
                        let posts = normalize_response(response);
                        all_posts.extend(posts);
                    }
                    Err(e) => {
                        log::warn!("search query failed: {e}");
                        errors.push(e);
                    }
                }
            }
        }

        // If we got nothing at all and there were errors, surface them.
        if all_posts.is_empty() && !errors.is_empty() {
            return Err(format!("all fetch attempts failed: {}", errors.join("; ")));
        }

        // Deduplicate by tweet ID and sort newest-first.
        deduplicate_and_sort(&mut all_posts);

        Ok(all_posts)
    }
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

/// Converts an X API v2 tweet response into a flat `Vec<Post>`.
///
/// Joins tweet data with the user expansion to populate `author_username`.
/// Uses `note_tweet.text` for long-form posts when available.
pub fn normalize_response(response: XApiTweetResponse) -> Vec<Post> {
    let tweets = match response.data {
        Some(tweets) => tweets,
        None => return Vec::new(),
    };

    // Build a user-ID → username lookup from the includes section.
    let user_map = build_user_map(&response.includes);

    tweets
        .into_iter()
        .map(|tweet| {
            let author_id = tweet.author_id.unwrap_or_default();
            let author_username = user_map
                .get(&author_id)
                .cloned()
                .unwrap_or_else(|| "unknown".into());

            // Prefer note_tweet.text for long-form posts.
            let text = tweet.note_tweet.map(|nt| nt.text).unwrap_or(tweet.text);

            let created_at = tweet
                .created_at
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now);

            Post {
                id: tweet.id,
                text,
                author_username,
                author_id,
                created_at,
            }
        })
        .collect()
}

/// Builds a mapping from user ID to username from the API includes section.
fn build_user_map(includes: &Option<XApiIncludes>) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    if let Some(inc) = includes {
        if let Some(users) = &inc.users {
            for user in users {
                map.insert(user.id.clone(), user.username.clone());
            }
        }
    }
    map
}

/// Deduplicates posts by tweet ID and sorts newest-first.
fn deduplicate_and_sort(posts: &mut Vec<Post>) {
    // Stable sort by created_at descending, then dedup by ID.
    posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let mut seen = std::collections::HashSet::new();
    posts.retain(|p| seen.insert(p.id.clone()));
}

/// Formats a list of X API errors into a single human-readable string.
fn format_api_errors(errors: &[XApiError]) -> String {
    errors
        .iter()
        .map(|e| {
            if let Some(title) = &e.title {
                format!("{title}: {}", e.message)
            } else {
                e.message.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;
    use std::sync::Mutex;

    static X_API_BASE_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn test_normalize_response_basic() {
        let response = XApiTweetResponse {
            data: Some(vec![XApiTweet {
                id: "100".into(),
                text: "Hello world".into(),
                author_id: Some("1".into()),
                created_at: Some("2026-03-31T12:00:00Z".into()),
                note_tweet: None,
            }]),
            includes: Some(XApiIncludes {
                users: Some(vec![XApiUser {
                    id: "1".into(),
                    username: "testuser".into(),
                }]),
            }),
            meta: None,
            errors: None,
        };

        let posts = normalize_response(response);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "100");
        assert_eq!(posts[0].text, "Hello world");
        assert_eq!(posts[0].author_username, "testuser");
        assert_eq!(posts[0].author_id, "1");
    }

    #[test]
    fn test_normalize_response_note_tweet_preferred() {
        let response = XApiTweetResponse {
            data: Some(vec![XApiTweet {
                id: "200".into(),
                text: "Short version".into(),
                author_id: Some("2".into()),
                created_at: Some("2026-03-31T12:00:00Z".into()),
                note_tweet: Some(XApiNoteTweet {
                    text: "This is the full long-form text".into(),
                }),
            }]),
            includes: Some(XApiIncludes {
                users: Some(vec![XApiUser {
                    id: "2".into(),
                    username: "longposter".into(),
                }]),
            }),
            meta: None,
            errors: None,
        };

        let posts = normalize_response(response);
        assert_eq!(posts[0].text, "This is the full long-form text");
    }

    #[test]
    fn test_normalize_response_missing_user_expansion() {
        let response = XApiTweetResponse {
            data: Some(vec![XApiTweet {
                id: "300".into(),
                text: "No user info".into(),
                author_id: Some("99".into()),
                created_at: Some("2026-03-31T12:00:00Z".into()),
                note_tweet: None,
            }]),
            includes: None,
            meta: None,
            errors: None,
        };

        let posts = normalize_response(response);
        assert_eq!(posts[0].author_username, "unknown");
    }

    #[test]
    fn test_normalize_response_empty_data() {
        let response = XApiTweetResponse {
            data: None,
            includes: None,
            meta: None,
            errors: None,
        };

        let posts = normalize_response(response);
        assert!(posts.is_empty());
    }

    #[test]
    fn test_deduplicate_and_sort() {
        use chrono::TimeZone;

        let mut posts = vec![
            Post {
                id: "1".into(),
                text: "First".into(),
                author_username: "a".into(),
                author_id: "10".into(),
                created_at: Utc.with_ymd_and_hms(2026, 3, 31, 10, 0, 0).unwrap(),
            },
            Post {
                id: "2".into(),
                text: "Second".into(),
                author_username: "b".into(),
                author_id: "20".into(),
                created_at: Utc.with_ymd_and_hms(2026, 3, 31, 12, 0, 0).unwrap(),
            },
            Post {
                id: "1".into(),
                text: "Duplicate of first".into(),
                author_username: "a".into(),
                author_id: "10".into(),
                created_at: Utc.with_ymd_and_hms(2026, 3, 31, 10, 0, 0).unwrap(),
            },
        ];

        deduplicate_and_sort(&mut posts);

        assert_eq!(posts.len(), 2);
        // Newest first
        assert_eq!(posts[0].id, "2");
        assert_eq!(posts[1].id, "1");
    }

    #[test]
    fn test_format_api_errors_single() {
        let errors = vec![XApiError {
            message: "Not Found".into(),
            title: Some("NotFoundError".into()),
        }];
        assert_eq!(format_api_errors(&errors), "NotFoundError: Not Found");
    }

    #[test]
    fn test_format_api_errors_multiple() {
        let errors = vec![
            XApiError {
                message: "Rate limit exceeded".into(),
                title: None,
            },
            XApiError {
                message: "Service unavailable".into(),
                title: Some("ServerError".into()),
            },
        ];
        let result = format_api_errors(&errors);
        assert_eq!(
            result,
            "Rate limit exceeded; ServerError: Service unavailable"
        );
    }

    #[test]
    fn test_build_user_map_empty() {
        let map = build_user_map(&None);
        assert!(map.is_empty());
    }

    #[test]
    fn test_build_user_map_populated() {
        let includes = Some(XApiIncludes {
            users: Some(vec![
                XApiUser {
                    id: "1".into(),
                    username: "alice".into(),
                },
                XApiUser {
                    id: "2".into(),
                    username: "bob".into(),
                },
            ]),
        });
        let map = build_user_map(&includes);
        assert_eq!(map.get("1").unwrap(), "alice");
        assert_eq!(map.get("2").unwrap(), "bob");
    }

    #[test]
    fn test_client_rejects_empty_token() {
        let result = XApiClient::new(String::new());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_client_rejects_whitespace_token() {
        let result = XApiClient::new("   ".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_client_accepts_valid_token() {
        let result = XApiClient::new("valid_bearer_token_123".into());
        assert!(result.is_ok());
    }

    #[test]
    fn test_x_api_base_defaults_to_x_api() {
        let _guard = X_API_BASE_LOCK.lock().unwrap();
        unsafe {
            std::env::remove_var("FLIPTRIX_X_API_BASE");
        }
        assert_eq!(x_api_base(), "https://api.x.com/2");
    }

    #[test]
    fn test_x_api_base_uses_env_override_without_trailing_slash() {
        let _guard = X_API_BASE_LOCK.lock().unwrap();
        unsafe {
            std::env::set_var("FLIPTRIX_X_API_BASE", "http://127.0.0.1:19001/2/");
        }
        assert_eq!(x_api_base(), "http://127.0.0.1:19001/2");
        unsafe {
            std::env::remove_var("FLIPTRIX_X_API_BASE");
        }
    }
}
