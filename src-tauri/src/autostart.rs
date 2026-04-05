//! Autostart registration — writes or removes a system-level autostart entry
//! so fliptrix launches when the user logs in.
//!
//! # Platform strategy
//! - **Linux**: an XDG `.desktop` file at `~/.config/autostart/<id>.desktop`.
//!   This is the standard for all freedesktop-compliant desktop environments
//!   (GNOME, KDE, XFCE, etc.) and requires no elevated privileges.
//! - **Windows**: a shortcut in the user Startup folder
//!   (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`).
//!   Also requires no elevated privileges.
//!
//! # Why not the registry?
//! `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run` also
//! works without admin rights, but the Startup folder is simpler, more
//! visible to users, and easier to undo manually — both approaches were
//! considered; the folder wins on transparency.
//!
//! The module exposes three pure functions that do only file I/O and return
//! structured errors, making them easy to test and mock.

use std::path::{Path, PathBuf};

const E2E_AUTOSTART_DIR_ENV: &str = "FLIPTRIX_E2E_AUTOSTART_DIR";

fn autostart_dir_override() -> Option<PathBuf> {
    match std::env::var(E2E_AUTOSTART_DIR_ENV) {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(PathBuf::from(trimmed))
            }
        }
        Err(_) => None,
    }
}

/// Error returned by autostart operations.
#[derive(Debug, PartialEq)]
pub struct AutostartError(pub String);

impl std::fmt::Display for AutostartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<std::io::Error> for AutostartError {
    fn from(e: std::io::Error) -> Self {
        AutostartError(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Returns the path where the autostart entry would be written on this
/// platform, without creating it.
///
/// Useful for the settings UI to display the path to the user.
pub fn autostart_path(app_id: &str) -> Result<PathBuf, AutostartError> {
    #[cfg(target_os = "linux")]
    {
        linux_autostart_path(app_id)
    }
    #[cfg(target_os = "windows")]
    {
        windows_autostart_path(app_id)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = app_id;
        Err(AutostartError(
            "autostart is not supported on this platform".into(),
        ))
    }
}

/// Writes an autostart entry that launches `exe_path` at login.
///
/// Creates parent directories as needed. Overwrites any existing entry.
pub fn enable_autostart(app_id: &str, exe_path: &Path) -> Result<(), AutostartError> {
    #[cfg(target_os = "linux")]
    {
        linux_enable_autostart(app_id, exe_path)
    }
    #[cfg(target_os = "windows")]
    {
        windows_enable_autostart(app_id, exe_path)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = (app_id, exe_path);
        Err(AutostartError(
            "autostart is not supported on this platform".into(),
        ))
    }
}

/// Removes the autostart entry, if present.
///
/// Returns `Ok(())` even when no entry existed (idempotent).
pub fn disable_autostart(app_id: &str) -> Result<(), AutostartError> {
    #[cfg(target_os = "linux")]
    {
        linux_disable_autostart(app_id)
    }
    #[cfg(target_os = "windows")]
    {
        windows_disable_autostart(app_id)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = app_id;
        Err(AutostartError(
            "autostart is not supported on this platform".into(),
        ))
    }
}

/// Returns `true` if an autostart entry currently exists.
pub fn is_autostart_enabled(app_id: &str) -> bool {
    match autostart_path(app_id) {
        Ok(path) => path.exists(),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Linux implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn linux_autostart_dir() -> Result<PathBuf, AutostartError> {
    if let Some(override_dir) = autostart_dir_override() {
        return Ok(override_dir);
    }

    // Prefer XDG_CONFIG_HOME if set; fall back to $HOME/.config.
    // Using only env vars avoids the dirs/dirs-next dependency while
    // remaining fully correct per the XDG Base Directory specification.
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return Ok(PathBuf::from(xdg).join("autostart"));
        }
    }
    let home = std::env::var("HOME")
        .map_err(|_| AutostartError("HOME environment variable not set".into()))?;
    Ok(PathBuf::from(home).join(".config").join("autostart"))
}

#[cfg(target_os = "linux")]
fn linux_autostart_path(app_id: &str) -> Result<PathBuf, AutostartError> {
    Ok(linux_autostart_dir()?.join(format!("{app_id}.desktop")))
}

#[cfg(target_os = "linux")]
fn linux_enable_autostart(app_id: &str, exe_path: &Path) -> Result<(), AutostartError> {
    let dir = linux_autostart_dir()?;
    std::fs::create_dir_all(&dir)?;

    let desktop_entry = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=fliptrix\n\
         Comment=Screensaver idle monitor\n\
         Exec={exe}\n\
         Hidden=false\n\
         NoDisplay=false\n\
         X-GNOME-Autostart-enabled=true\n",
        exe = exe_path.display()
    );

    let path = linux_autostart_path(app_id)?;
    std::fs::write(&path, desktop_entry)?;
    log::info!("autostart enabled: {}", path.display());
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_disable_autostart(app_id: &str) -> Result<(), AutostartError> {
    let path = linux_autostart_path(app_id)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
        log::info!("autostart disabled: {}", path.display());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn windows_startup_dir() -> Result<PathBuf, AutostartError> {
    if let Some(override_dir) = autostart_dir_override() {
        return Ok(override_dir);
    }

    // APPDATA is always set on Windows for interactive users.
    let appdata = std::env::var("APPDATA")
        .map_err(|_| AutostartError("APPDATA environment variable not set".into()))?;
    Ok(PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup"))
}

#[cfg(target_os = "windows")]
fn windows_autostart_path(app_id: &str) -> Result<PathBuf, AutostartError> {
    Ok(windows_startup_dir()?.join(format!("{app_id}.bat")))
}

#[cfg(target_os = "windows")]
fn windows_enable_autostart(app_id: &str, exe_path: &Path) -> Result<(), AutostartError> {
    let dir = windows_startup_dir()?;
    std::fs::create_dir_all(&dir)?;

    // A minimal batch file that launches the exe silently and exits.
    // Using a .bat file rather than a .lnk avoids the need for the
    // Windows Shell COM API, which would add substantial complexity.
    let batch = format!("@echo off\nstart \"\" \"{}\"\n", exe_path.display());

    let path = windows_autostart_path(app_id)?;
    std::fs::write(&path, batch)?;
    log::info!("autostart enabled: {}", path.display());
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_disable_autostart(app_id: &str) -> Result<(), AutostartError> {
    let path = windows_autostart_path(app_id)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
        log::info!("autostart disabled: {}", path.display());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    use std::path::Path;
    use std::sync::Mutex;

    // Serialize all tests that mutate XDG_CONFIG_HOME to avoid races between
    // parallel test threads on this process-global environment variable.
    static XDG_LOCK: Mutex<()> = Mutex::new(());

    fn set_env_var(key: &str, value: &std::path::Path) {
        unsafe {
            std::env::set_var(key, value);
        }
    }

    fn remove_env_var(key: &str) {
        unsafe {
            std::env::remove_var(key);
        }
    }

    // Helper: a fake executable path for tests.
    #[cfg(target_os = "linux")]
    fn fake_exe() -> PathBuf {
        PathBuf::from("/usr/local/bin/fliptrix")
    }

    #[test]
    fn test_autostart_path_contains_app_id() {
        let path = autostart_path("com.fliptrix.desktop").unwrap();
        assert!(
            path.to_string_lossy().contains("fliptrix"),
            "path should contain app_id component"
        );
    }

    #[test]
    fn test_autostart_path_uses_override_directory() {
        let _guard = XDG_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().unwrap();
        set_env_var(E2E_AUTOSTART_DIR_ENV, tmp.path());

        let path = autostart_path("test.fliptrix.override").unwrap();
        assert!(path.starts_with(tmp.path()));

        remove_env_var(E2E_AUTOSTART_DIR_ENV);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_linux_autostart_path_ends_with_desktop() {
        let path = linux_autostart_path("com.fliptrix.desktop").unwrap();
        assert!(path.to_string_lossy().ends_with(".desktop"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_linux_enable_and_disable_autostart() {
        use tempfile::TempDir;

        let _guard = XDG_LOCK.lock().unwrap();
        let tmp = TempDir::new().unwrap();
        // Override XDG_CONFIG_HOME to a temp directory so we don't pollute
        // the real user config.
        set_env_var("XDG_CONFIG_HOME", tmp.path());

        let app_id = "test.fliptrix.autostart";
        enable_autostart(app_id, &fake_exe()).unwrap();

        // File should exist and contain the exe path.
        let path = autostart_path(app_id).unwrap();
        assert!(path.exists(), "desktop file should exist after enable");
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("/usr/local/bin/fliptrix"));
        assert!(content.contains("[Desktop Entry]"));

        // is_autostart_enabled should return true.
        assert!(is_autostart_enabled(app_id));

        // Disable should remove the file.
        disable_autostart(app_id).unwrap();
        assert!(
            !path.exists(),
            "desktop file should be removed after disable"
        );
        assert!(!is_autostart_enabled(app_id));

        // Disable again is idempotent.
        disable_autostart(app_id).unwrap();

        remove_env_var("XDG_CONFIG_HOME");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_linux_desktop_file_format() {
        use tempfile::TempDir;

        let _guard = XDG_LOCK.lock().unwrap();
        let tmp = TempDir::new().unwrap();
        set_env_var("XDG_CONFIG_HOME", tmp.path());

        let app_id = "test.fliptrix.format";
        enable_autostart(app_id, Path::new("/opt/fliptrix/fliptrix")).unwrap();

        let path = autostart_path(app_id).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();

        assert!(content.contains("Type=Application"));
        assert!(content.contains("Name=fliptrix"));
        assert!(content.contains("X-GNOME-Autostart-enabled=true"));
        assert!(content.contains("Exec=/opt/fliptrix/fliptrix"));

        remove_env_var("XDG_CONFIG_HOME");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_is_autostart_disabled_when_no_file() {
        use tempfile::TempDir;

        let _guard = XDG_LOCK.lock().unwrap();
        let tmp = TempDir::new().unwrap();
        set_env_var("XDG_CONFIG_HOME", tmp.path());

        assert!(!is_autostart_enabled("test.fliptrix.absent"));

        remove_env_var("XDG_CONFIG_HOME");
    }
}
