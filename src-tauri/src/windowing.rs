//! Screensaver window management — creates and destroys fullscreen overlay
//! windows on each connected monitor.
//!
//! The architecture separates pure data types (`MonitorInfo`, label generation)
//! from Tauri-dependent window creation so that label logic and monitor
//! mapping remain unit-testable on headless servers.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

// ---------------------------------------------------------------------------
// Pure data types — testable without a running Tauri app
// ---------------------------------------------------------------------------

/// Serializable snapshot of a single monitor's geometry.
///
/// Returned by the `get_monitors` Tauri command so the frontend can reason
/// about display layout without calling platform APIs.
#[derive(Debug, Clone, Serialize)]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

/// Generates a deterministic Tauri window label for a screensaver overlay.
///
/// Labels must be unique across all windows in the app. We use the format
/// `screensaver-{index}` where index is the monitor's position in the
/// enumerated list. This is simple, stable, and avoids characters that
/// could cause issues in Tauri's label validation.
pub fn screensaver_label(monitor_index: usize) -> String {
    format!("screensaver-{monitor_index}")
}

// ---------------------------------------------------------------------------
// Tauri-dependent window management
// ---------------------------------------------------------------------------

/// Creates one borderless, always-on-top, fullscreen screensaver window per
/// monitor. Returns the labels of all successfully created windows.
///
/// Each window:
/// - Loads the same frontend URL (`index.html`) so the screensaver renderer
///   JS can initialize.
/// - Is positioned to cover the exact monitor area using physical coords.
/// - Has decorations disabled, is always-on-top, hidden from taskbar.
/// - Is focused and has cursor hidden.
///
/// Windows that fail to create are logged and skipped — partial coverage is
/// better than crashing the whole screensaver activation.
pub fn create_screensaver_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    // We need an existing window to call `available_monitors()`.
    // Use the main settings window which should always exist.
    let main_window = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            log::error!("cannot enumerate monitors: main window not found");
            return Vec::new();
        }
    };

    let monitors = match main_window.available_monitors() {
        Ok(m) => m,
        Err(e) => {
            log::error!("failed to enumerate monitors: {e}");
            return Vec::new();
        }
    };

    if monitors.is_empty() {
        log::warn!("no monitors detected — cannot create screensaver windows");
        return Vec::new();
    }

    log::info!(
        "creating screensaver windows on {} monitor(s)",
        monitors.len()
    );

    let mut created_labels = Vec::new();

    for (i, monitor) in monitors.iter().enumerate() {
        let label = screensaver_label(i);
        let pos = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor();

        // Convert physical pixels to logical pixels for Tauri's builder API,
        // which expects logical coordinates.
        let logical_x = pos.x as f64 / scale;
        let logical_y = pos.y as f64 / scale;
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;

        log::info!(
            "  monitor {i}: {:?} pos=({},{}) size={}x{} scale={scale:.2} → logical ({logical_x},{logical_y}) {logical_w}x{logical_h}",
            monitor.name(),
            pos.x,
            pos.y,
            size.width,
            size.height,
        );

        let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("fliptrix screensaver")
            .position(logical_x, logical_y)
            .inner_size(logical_w, logical_h)
            .decorations(false)
            .always_on_top(true)
            .resizable(false)
            .skip_taskbar(true)
            .focused(i == 0) // Focus only the first window
            .visible(true);

        match builder.build() {
            Ok(window) => {
                // Hide cursor on this window.
                if let Err(e) = window.set_cursor_visible(false) {
                    log::warn!("failed to hide cursor on {label}: {e}");
                }
                // Enter fullscreen after creation for reliable coverage.
                if let Err(e) = window.set_fullscreen(true) {
                    log::warn!("failed to set fullscreen on {label}: {e}");
                }
                created_labels.push(label);
            }
            Err(e) => {
                log::error!("failed to create screensaver window {label}: {e}");
            }
        }
    }

    log::info!(
        "created {}/{} screensaver windows",
        created_labels.len(),
        monitors.len()
    );
    created_labels
}

/// Destroys all screensaver overlay windows.
///
/// Uses `destroy()` rather than `close()` to skip the `CloseRequested` event
/// dance — screensaver windows should vanish instantly on user input.
/// Returns the count of windows that were successfully destroyed.
pub fn destroy_screensaver_windows<R: Runtime>(app: &AppHandle<R>) -> usize {
    let all_windows = app.webview_windows();
    let mut destroyed = 0;

    for (label, window) in &all_windows {
        if label.starts_with("screensaver-") {
            // Restore cursor before destroying, so the cursor reappears.
            let _ = window.set_cursor_visible(true);

            if let Err(e) = window.destroy() {
                log::error!("failed to destroy {label}: {e}");
            } else {
                destroyed += 1;
            }
        }
    }

    if destroyed > 0 {
        log::info!("destroyed {destroyed} screensaver window(s)");
    }

    destroyed
}

/// Collects monitor information without creating windows.
///
/// Used by the `get_monitors` Tauri command to expose display layout to the
/// frontend for settings UI or debug display.
pub fn enumerate_monitors<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<MonitorInfo>, String> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let monitors = main_window
        .available_monitors()
        .map_err(|e| format!("failed to enumerate monitors: {e}"))?;

    Ok(monitors
        .iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned(),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Tests — pure logic only (label generation, data types)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screensaver_label_format() {
        assert_eq!(screensaver_label(0), "screensaver-0");
        assert_eq!(screensaver_label(1), "screensaver-1");
        assert_eq!(screensaver_label(42), "screensaver-42");
    }

    #[test]
    fn screensaver_labels_are_unique_for_different_indices() {
        let labels: Vec<_> = (0..10).map(screensaver_label).collect();
        let unique: std::collections::HashSet<_> = labels.iter().collect();
        assert_eq!(labels.len(), unique.len());
    }

    #[test]
    fn monitor_info_serializes_to_json() {
        let info = MonitorInfo {
            name: Some("HDMI-1".into()),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"name\":\"HDMI-1\""));
        assert!(json.contains("\"width\":1920"));
        assert!(json.contains("\"height\":1080"));
        assert!(json.contains("\"scale_factor\":1.0"));
    }

    #[test]
    fn monitor_info_with_no_name_serializes() {
        let info = MonitorInfo {
            name: None,
            x: 1920,
            y: 0,
            width: 2560,
            height: 1440,
            scale_factor: 1.5,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"name\":null"));
        assert!(json.contains("\"x\":1920"));
    }
}
