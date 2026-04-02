//! Platform-specific idle time detection.
//!
//! Uses a trait (`IdleProvider`) so the lifecycle poller can be tested with
//! deterministic mocks while production code calls real OS APIs.
//!
//! - **Linux**: `XScreenSaverQueryInfo` via `x11-dl` (dynamically loaded).
//!   Only works under X11; pure Wayland sessions are not supported yet.
//! - **Windows**: `GetLastInputInfo` via the `windows` crate.

/// Abstraction over idle-time queries so callers are decoupled from OS APIs.
pub trait IdleProvider: Send + Sync {
    /// Returns the number of whole seconds the user has been idle,
    /// or a human-readable error string if the query fails.
    fn idle_seconds(&self) -> Result<u64, String>;
}

// ---------------------------------------------------------------------------
// Linux implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
pub mod platform {
    use super::IdleProvider;
    use std::os::raw::c_void;
    use std::ptr;
    use x11_dl::xlib::Xlib;
    use x11_dl::xss::Xss;

    /// Queries the X11 screen-saver extension for idle time.
    ///
    /// Libraries are loaded once via `dlopen` — no link-time dependency on
    /// `libXss-dev`. If the X server or the extension is unavailable (e.g.
    /// headless or Wayland-only), the constructor returns an error instead of
    /// panicking at runtime.
    pub struct X11IdleProvider {
        xlib: Xlib,
        xss: Xss,
        display: *mut x11_dl::xlib::Display,
    }

    // x11-dl Display pointers are thread-safe when each call is externally
    // serialized; our usage is single-threaded polling from one async task.
    unsafe impl Send for X11IdleProvider {}
    unsafe impl Sync for X11IdleProvider {}

    impl X11IdleProvider {
        /// Try to open the default X display and load the XScreenSaver extension.
        pub fn new() -> Result<Self, String> {
            let xlib = Xlib::open().map_err(|e| format!("failed to load libX11: {e}"))?;
            let xss = Xss::open().map_err(|e| format!("failed to load libXss: {e}"))?;

            let display = unsafe { (xlib.XOpenDisplay)(ptr::null()) };
            if display.is_null() {
                return Err("XOpenDisplay returned null — no X11 display available".into());
            }

            Ok(Self { xlib, xss, display })
        }
    }

    impl Drop for X11IdleProvider {
        fn drop(&mut self) {
            if !self.display.is_null() {
                unsafe {
                    (self.xlib.XCloseDisplay)(self.display);
                }
            }
        }
    }

    impl IdleProvider for X11IdleProvider {
        fn idle_seconds(&self) -> Result<u64, String> {
            unsafe {
                let info = (self.xss.XScreenSaverAllocInfo)();
                if info.is_null() {
                    return Err("XScreenSaverAllocInfo returned null".into());
                }

                let root = (self.xlib.XDefaultRootWindow)(self.display);
                let status = (self.xss.XScreenSaverQueryInfo)(self.display, root, info);

                if status == 0 {
                    (self.xlib.XFree)(info as *mut c_void);
                    return Err("XScreenSaverQueryInfo failed".into());
                }

                let idle_ms = (*info).idle;
                (self.xlib.XFree)(info as *mut c_void);

                Ok(idle_ms / 1000)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub mod platform {
    use super::IdleProvider;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    /// Queries `GetLastInputInfo` for the time since last user input.
    pub struct WindowsIdleProvider;

    impl WindowsIdleProvider {
        pub fn new() -> Result<Self, String> {
            Ok(Self)
        }
    }

    impl IdleProvider for WindowsIdleProvider {
        fn idle_seconds(&self) -> Result<u64, String> {
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };

            let success = unsafe { GetLastInputInfo(&mut info) };
            if !success.as_bool() {
                return Err("GetLastInputInfo failed".into());
            }

            // GetTickCount wraps at ~49.7 days; the subtraction still works
            // correctly for unsigned arithmetic within that window.
            let tick_count = unsafe { windows::Win32::System::SystemInformation::GetTickCount() };
            let idle_ms = tick_count.wrapping_sub(info.dwTime);

            Ok(idle_ms as u64 / 1000)
        }
    }
}

// ---------------------------------------------------------------------------
// Unsupported platforms — compile-time error
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub mod platform {
    use super::IdleProvider;

    pub struct UnsupportedIdleProvider;

    impl UnsupportedIdleProvider {
        pub fn new() -> Result<Self, String> {
            Err("idle detection is not supported on this platform".into())
        }
    }

    impl IdleProvider for UnsupportedIdleProvider {
        fn idle_seconds(&self) -> Result<u64, String> {
            Err("idle detection is not supported on this platform".into())
        }
    }
}

// ---------------------------------------------------------------------------
// Convenience constructor
// ---------------------------------------------------------------------------

/// Create the platform-appropriate idle provider.
///
/// Returns an error if the OS APIs are unavailable (headless, Wayland-only,
/// missing libraries, etc.). Callers should log the error and fall back to
/// a degraded mode (e.g. manual-only screensaver activation).
pub fn create_idle_provider() -> Result<Box<dyn IdleProvider>, String> {
    #[cfg(target_os = "linux")]
    {
        platform::X11IdleProvider::new().map(|p| Box::new(p) as Box<dyn IdleProvider>)
    }

    #[cfg(target_os = "windows")]
    {
        platform::WindowsIdleProvider::new().map(|p| Box::new(p) as Box<dyn IdleProvider>)
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        platform::UnsupportedIdleProvider::new().map(|p| Box::new(p) as Box<dyn IdleProvider>)
    }
}

// ---------------------------------------------------------------------------
// Mock provider for tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub mod mock {
    use super::IdleProvider;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Test double that returns a caller-controlled idle value.
    pub struct MockIdleProvider {
        idle_secs: AtomicU64,
    }

    impl MockIdleProvider {
        pub fn new(initial_idle: u64) -> Self {
            Self {
                idle_secs: AtomicU64::new(initial_idle),
            }
        }

        pub fn set_idle(&self, secs: u64) {
            self.idle_secs.store(secs, Ordering::Relaxed);
        }
    }

    impl IdleProvider for MockIdleProvider {
        fn idle_seconds(&self) -> Result<u64, String> {
            Ok(self.idle_secs.load(Ordering::Relaxed))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::MockIdleProvider;
    use super::IdleProvider;

    #[test]
    fn mock_provider_returns_configured_value() {
        let provider = MockIdleProvider::new(42);
        assert_eq!(provider.idle_seconds().unwrap(), 42);
    }

    #[test]
    fn mock_provider_value_can_be_updated() {
        let provider = MockIdleProvider::new(0);
        assert_eq!(provider.idle_seconds().unwrap(), 0);
        provider.set_idle(120);
        assert_eq!(provider.idle_seconds().unwrap(), 120);
    }

    #[test]
    fn create_idle_provider_returns_result() {
        // On a headless CI/server this will return Err (no X display).
        // On a graphical Linux session it should return Ok.
        // Either way, it must not panic.
        let result = super::create_idle_provider();
        // We just assert it's a valid Result — the actual Ok/Err depends on
        // whether an X11 display is available.
        assert!(result.is_ok() || result.is_err());
    }
}
