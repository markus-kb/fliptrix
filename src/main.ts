import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isScreensaverWindow } from "./screensaver";

window.addEventListener("DOMContentLoaded", async () => {
  const appRoot = document.querySelector<HTMLDivElement>("#app");

  if (!appRoot) {
    throw new Error("Missing #app root element.");
  }

  // Detect whether this window is a screensaver overlay or the main
  // settings window. Screensaver windows are created by Rust with
  // labels like "screensaver-0"; the main window is labeled "main".
  //
  // The Tauri API may not be available during Vite-only dev or tests,
  // so we fall back to the settings shell when the label can't be read.
  let windowLabel = "main";
  try {
    const currentWindow = getCurrentWebviewWindow();
    windowLabel = currentWindow.label;
  } catch {
    // Tauri API unavailable (plain browser, Vitest) — default to main shell.
  }

  if (isScreensaverWindow(windowLabel)) {
    // Lazy-import the overlay module so the settings shell doesn't pull in
    // Tauri IPC code that would fail in non-Tauri environments.
    const { initScreensaverOverlay } = await import("./screensaver-overlay");
    initScreensaverOverlay(appRoot);
  } else {
    // Lazy-import the settings UI so Tauri IPC calls are deferred until
    // the main window is ready.
    const { initSettingsUi } = await import("./settings-ui");
    await initSettingsUi(appRoot);
  }
});
