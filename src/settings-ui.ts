/**
 * Settings window UI — renders and manages the full user-facing settings panel.
 *
 * This module is loaded by `main.ts` when the window label is "main".
 * It replaces the Phase 1–6 placeholder shell with a real form that:
 *   - Reads current settings from the Rust backend on load
 *   - Renders grouped form sections for each settings category
 *   - Validates and saves on submit, showing inline success/error feedback
 *   - Manages the autostart toggle independently
 *   - Provides a "Refresh Posts" button to trigger an X API fetch
 *
 * The module has no external DOM dependencies — it writes to a passed root
 * element, making it straightforward to test with a JSDOM environment.
 */

import { invoke } from "@tauri-apps/api/core";
import { logDebug, logError, logInfo, logWarn, setFrontendDebugLogging } from "./logger";
import {
  type AppSettings,
  activateScreensaver,
  cloneDefaultSettings,
  getAutostartEnabled,
  getSettings,
  openLogsDirectory,
  saveSettings,
  setAutostartEnabled,
  withScreensaverMode,
} from "./settings";

interface CachedPostSummary {
  author_username?: string;
  created_at?: string;
}

interface CachedPostsEnvelope {
  fetched_at?: string;
  posts: CachedPostSummary[];
}

const cacheOverviewRequestByRoot = new WeakMap<HTMLElement, number>();

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Initialise the settings UI inside `root`.
 *
 * Fetches current settings from the backend, renders the form, and wires up
 * all event listeners. Async because the initial settings load is a Tauri IPC
 * call.
 */
export async function initSettingsUi(root: HTMLElement): Promise<void> {
  const [settings, autostartEnabled] = await Promise.all([getSettings(), getAutostartEnabled()]);

  root.innerHTML = buildSettingsHtml(settings, autostartEnabled);

  wireForm(root, settings);
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildSettingsHtml(s: AppSettings, autostartEnabled: boolean): string {
  return `
    <section class="settings-shell">
      <header class="settings-header">
        <p class="eyebrow">Settings</p>
        <h1>fliptrix</h1>
        <p class="lead">Configure your screensaver.</p>
      </header>

      <div id="settings-feedback" class="settings-feedback" aria-live="polite" hidden></div>

      <form id="settings-form" class="settings-form" novalidate>

        <!-- General -->
        <fieldset class="panel">
          <legend>General</legend>

          <label class="field">
            <span class="field-label">Idle timeout (seconds)</span>
            <input type="number" name="idle_timeout_secs" min="10" max="86400"
              value="${s.idle_timeout_secs}" required />
            <span class="field-hint">Default: 300 (5 minutes)</span>
          </label>

          <label class="field">
            <span class="field-label">Mouse dead-zone (pixels)</span>
            <input type="number" name="mouse_dead_zone_px" min="0" max="50" step="0.5"
              value="${s.mouse_dead_zone_px}" required />
            <span class="field-hint">Movement within this radius is ignored. Default: 5</span>
          </label>
        </fieldset>

        <!-- Mode -->
        <fieldset class="panel">
          <legend>Screensaver mode</legend>

          <label class="field">
            <span class="field-label">Mode</span>
            <select name="mode">
              <option value="matrix" ${s.mode === "matrix" ? "selected" : ""}>Matrix (digital rain)</option>
              <option value="flip_flap" ${s.mode === "flip_flap" ? "selected" : ""}>FlipFlap (split-flap board)</option>
              <option value="both" ${s.mode === "both" ? "selected" : ""}>Both (auto-switch)</option>
            </select>
          </label>

          <label class="field" id="mode-switch-interval-field"
            ${s.mode !== "both" ? 'style="display:none"' : ""}>
            <span class="field-label">Switch interval (minutes)</span>
            <input type="number" name="mode_switch_interval_mins" min="1" max="1440"
              value="${s.mode_switch_interval_mins}" />
            <span class="field-hint">How often to alternate between FlipFlap and Matrix. Default: 10</span>
          </label>

          <div class="field field-actions">
            <span class="field-label">Test immediately</span>
            <div class="inline-actions">
              <button type="button" id="test-matrix-btn" class="btn btn-secondary">Test Matrix now</button>
              <button type="button" id="test-flipflap-btn" class="btn btn-secondary">Test FlipFlap now</button>
              <button type="button" id="test-both-btn" class="btn btn-secondary">Test Both now</button>
            </div>
            <span class="field-hint">Applies the current form values with the selected test mode and launches the screensaver immediately.</span>
          </div>
        </fieldset>

        <!-- Renderers -->
        <fieldset class="panel">
          <legend>Renderers</legend>

          <div class="renderer-tabs" role="tablist" aria-label="Renderer settings">
            <button
              type="button"
              id="renderer-tab-flipflap"
              class="renderer-tab renderer-tab--active"
              role="tab"
              aria-selected="true"
              aria-controls="renderer-tab-panel-flipflap"
            >
              FlipFlap
            </button>
            <button
              type="button"
              id="renderer-tab-matrix"
              class="renderer-tab"
              role="tab"
              aria-selected="false"
              aria-controls="renderer-tab-panel-matrix"
            >
              Matrix
            </button>
          </div>

          <div id="renderer-tab-panel-flipflap" class="renderer-tab-panel" role="tabpanel" aria-labelledby="renderer-tab-flipflap">
            <div class="field-row">
              <label class="field">
                <span class="field-label">Rows</span>
                <input type="number" name="flipflap_rows" min="1" max="32"
                  value="${s.flipflap_rows}" />
                <span class="field-hint">Default: 8</span>
              </label>
              <label class="field">
                <span class="field-label">Columns</span>
                <input type="number" name="flipflap_cols" min="1" max="120"
                  value="${s.flipflap_cols}" />
                <span class="field-hint">Default: 40</span>
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span class="field-label">Tick (ms)</span>
                <input type="number" name="flipflap_tick_ms" min="5" max="500"
                  value="${s.flipflap_tick_ms}" />
                <span class="field-hint">Animation speed. Default: 80</span>
              </label>
              <label class="field">
                <span class="field-label">Post rotation (seconds)</span>
                <input type="number" name="flipflap_rotation_secs" min="5" max="300"
                  value="${s.flipflap_rotation_secs}" />
                <span class="field-hint">Default: 20</span>
              </label>
            </div>

            <label class="field">
              <span class="field-label">Sound volume (0 – 1)</span>
              <input type="range" name="flipflap_volume" min="0" max="1" step="0.05"
                value="${s.flipflap_volume}" />
              <output class="range-output" for="flipflap_volume">${s.flipflap_volume.toFixed(2)}</output>
            </label>
          </div>

          <div id="renderer-tab-panel-matrix" class="renderer-tab-panel" role="tabpanel" aria-labelledby="renderer-tab-matrix" hidden>
            <div class="field-row">
              <label class="field">
                <span class="field-label">Font size (px)</span>
                <input type="number" name="matrix_font_size" min="8" max="48"
                  value="${s.matrix_font_size}" />
                <span class="field-hint">Default: 24</span>
              </label>
              <label class="field">
                <span class="field-label">Spawn density (0 – 1)</span>
                <input type="number" name="matrix_spawn_density" min="0" max="1" step="0.01"
                  value="${s.matrix_spawn_density}" />
                <span class="field-hint">Default: 0.5</span>
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span class="field-label">Glow intensity (px blur)</span>
                <input type="number" name="matrix_glow_intensity" min="0" max="30"
                  value="${s.matrix_glow_intensity}" />
                <span class="field-hint">Default: 12</span>
              </label>
              <label class="field">
                <span class="field-label">Tick (ms)</span>
                <input type="number" name="matrix_tick_ms" min="10" max="500"
                  value="${s.matrix_tick_ms}" />
                <span class="field-hint">Animation speed. Default: 40</span>
              </label>
            </div>

            <label class="field">
              <span class="field-label">Post rotation (seconds)</span>
              <input type="number" name="matrix_post_rotation_secs" min="5" max="300"
                value="${s.matrix_post_rotation_secs}" />
              <span class="field-hint">Default: 15</span>
            </label>
          </div>
        </fieldset>

        <!-- X Data -->
        <fieldset class="panel">
          <legend>X data</legend>
          <p class="field-hint">
            Set your X API bearer token and configure separate post sources for
            FlipFlap and Matrix. Each mode caches its own posts independently.
          </p>

          <label class="field">
            <span class="field-label">Bearer token</span>
            <input type="password" id="bearer-token-input" name="bearer_token"
              placeholder="Enter your X API bearer token" autocomplete="off" />
            <span class="field-hint" id="api-key-status">Status: checking…</span>
          </label>

          <button type="button" id="save-api-key-btn" class="btn btn-secondary">
            Save token
          </button>
          <button type="button" id="refresh-posts-btn" class="btn btn-secondary">
            Refresh posts now
          </button>
          <span id="refresh-status" class="field-hint"></span>

          <div id="cache-overview" class="cache-overview" aria-live="polite">
            <p id="cache-overview-summary" class="field-hint">Total cached posts: loading…</p>

            <div class="cache-overview-columns">
              <section class="cache-overview-mode">
                <p id="cache-meta-flipflap" class="field-hint">FlipFlap cache: loading…</p>
                <ul id="cache-list-flipflap" class="cache-overview-list">
                  <li class="cache-overview-item cache-overview-item--empty">Loading…</li>
                </ul>
              </section>

              <section class="cache-overview-mode">
                <p id="cache-meta-matrix" class="field-hint">Matrix cache: loading…</p>
                <ul id="cache-list-matrix" class="cache-overview-list">
                  <li class="cache-overview-item cache-overview-item--empty">Loading…</li>
                </ul>
              </section>
            </div>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">FlipFlap accounts</span>
              <textarea name="flipflap_accounts" rows="4"
                placeholder="alice&#10;bob">${formatAccountsField(s.flipflap_accounts)}</textarea>
              <span class="field-hint">One username per line. Leading @ is optional.</span>
            </label>

            <label class="field">
              <span class="field-label">Matrix accounts</span>
              <textarea name="matrix_accounts" rows="4"
                placeholder="carol&#10;dave">${formatAccountsField(s.matrix_accounts)}</textarea>
              <span class="field-hint">One username per line. Leading @ is optional.</span>
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">FlipFlap search query</span>
              <input type="text" name="flipflap_search_query"
                value="${s.flipflap_search_query}" placeholder="from:alice has:media" />
            </label>

            <label class="field">
              <span class="field-label">Matrix search query</span>
              <input type="text" name="matrix_search_query"
                value="${s.matrix_search_query}" placeholder="(matrix OR cyberpunk) lang:en" />
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">FlipFlap time window (hours)</span>
              <input type="number" name="flipflap_time_window_hours" min="1" max="720"
                value="${s.flipflap_time_window_hours}" />
            </label>

            <label class="field">
              <span class="field-label">Matrix time window (hours)</span>
              <input type="number" name="matrix_time_window_hours" min="1" max="720"
                value="${s.matrix_time_window_hours}" />
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">FlipFlap truncation (chars)</span>
              <input type="number" name="flipflap_truncation_chars" min="1" max="2000"
                value="${s.flipflap_truncation_chars}" />
            </label>

            <label class="field">
              <span class="field-label">Matrix truncation (chars)</span>
              <input type="number" name="matrix_truncation_chars" min="1" max="2000"
                value="${s.matrix_truncation_chars}" />
            </label>
          </div>
        </fieldset>

        <!-- Autostart -->
        <fieldset class="panel">
          <legend>Autostart</legend>
          <label class="field field-checkbox">
            <input type="checkbox" name="autostart" id="autostart-checkbox"
              ${autostartEnabled ? "checked" : ""} />
            <span class="field-label">Start fliptrix when I log in</span>
          </label>
          <span class="field-hint">
            Writes a <code>.desktop</code> file (Linux) or Startup batch script
            (Windows) to your user profile. No admin rights required.
          </span>
        </fieldset>

        <!-- Diagnostics -->
        <fieldset class="panel">
          <legend>Diagnostics</legend>

          <label class="field field-checkbox">
            <input type="checkbox" name="debug_logging_enabled" id="debug-logging-checkbox"
              ${s.debug_logging_enabled ? "checked" : ""} />
            <span class="field-label">Enable debug logs</span>
          </label>

          <span class="field-hint">
            Keeps production logging at info level by default and includes debug entries when enabled.
          </span>

          <div class="field field-actions">
            <span class="field-label">Logs folder</span>
            <div class="inline-actions">
              <button type="button" id="open-logs-btn" class="btn btn-secondary">Open logs folder</button>
            </div>
            <span class="field-hint">
              Opens the app log directory in your system file explorer.
            </span>
          </div>
        </fieldset>

        <div class="settings-actions-wrap">
          <div class="settings-actions">
            <button type="submit" class="btn btn-primary">Save settings</button>
            <button type="button" id="reset-btn" class="btn btn-ghost">Reset to defaults</button>
          </div>
          <div id="settings-save-feedback" class="settings-feedback settings-feedback--inline" aria-live="polite" hidden></div>
        </div>
      </form>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Form wiring
// ---------------------------------------------------------------------------

function wireForm(root: HTMLElement, initialSettings: AppSettings): void {
  const form = root.querySelector<HTMLFormElement>("#settings-form");
  const previewFeedback = root.querySelector<HTMLElement>("#settings-feedback");
  if (!form || !previewFeedback) return;

  const saveFeedback =
    root.querySelector<HTMLElement>("#settings-save-feedback") ?? previewFeedback;

  setFrontendDebugLogging(initialSettings.debug_logging_enabled);

  // Show/hide mode-switch-interval based on selected mode.
  const modeSelect = form.querySelector<HTMLSelectElement>('[name="mode"]');
  modeSelect?.addEventListener("change", () => syncModeSwitchVisibility(form));

  // Renderer tabs.
  wireRendererTabs(root);

  // Live-update the volume range output label.
  const volumeRange = form.querySelector<HTMLInputElement>('[name="flipflap_volume"]');
  const volumeOutput = form.querySelector<HTMLOutputElement>(".range-output");
  volumeRange?.addEventListener("input", () => {
    if (volumeOutput) {
      volumeOutput.textContent = Number(volumeRange.value).toFixed(2);
    }
  });

  // Autostart toggle.
  wireAutostartToggle(form);

  // API key save button.
  wireApiKeySave(root, form);

  // Refresh posts button.
  wireRefreshPosts(root);

  // Open logs folder.
  wireOpenLogsButton(root, previewFeedback);

  // Manual mode test buttons.
  wirePreviewButtons(root, form, previewFeedback, saveFeedback, initialSettings);

  // Load API key status on startup.
  loadApiKeyStatus(root);
  void loadCacheOverview(root);

  // Reset to defaults.
  const resetBtn = root.querySelector<HTMLButtonElement>("#reset-btn");
  resetBtn?.addEventListener("click", () => {
    const defaults = cloneDefaultSettings();
    populateForm(form, defaults);
    setFrontendDebugLogging(defaults.debug_logging_enabled);
    logInfo("Settings form reset to defaults");
    previewFeedback.hidden = true;
    showFeedback(saveFeedback, "info", "Defaults loaded — click Save to apply.");
  });

  // Main form submit.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = readFormValues(form, initialSettings);
    try {
      await saveSettings(settings);
      previewFeedback.hidden = true;
      setFrontendDebugLogging(settings.debug_logging_enabled);
      logInfo("Settings saved", {
        mode: settings.mode,
        debugLoggingEnabled: settings.debug_logging_enabled,
      });
      showFeedback(saveFeedback, "success", "Settings saved.");
    } catch (err) {
      previewFeedback.hidden = true;
      logError("Failed to save settings", err);
      showFeedback(
        saveFeedback,
        "error",
        `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read all form inputs into an AppSettings object. */
export function parseAccountsField(value: string): string[] {
  const uniqueAccounts = new Set<string>();

  for (const line of value.split(/\r?\n/)) {
    const normalized = line.trim().replace(/^@+/, "");
    if (normalized) {
      uniqueAccounts.add(normalized);
    }
  }

  return [...uniqueAccounts];
}

export function formatAccountsField(accounts: string[]): string {
  return accounts.join("\n");
}

function readFormValues(form: HTMLFormElement, fallback: AppSettings): AppSettings {
  const d = new FormData(form);

  function num(name: string, fb: number): number {
    const v = Number(d.get(name));
    return Number.isFinite(v) ? v : fb;
  }

  function str(name: string, fb: string): string {
    const value = d.get(name);
    return typeof value === "string" ? value : fb;
  }

  function bool(name: string, fb: boolean): boolean {
    const value = d.get(name);
    if (value === null) {
      return false;
    }

    if (typeof value === "string") {
      return value === "on";
    }

    return fb;
  }

  return {
    idle_timeout_secs: num("idle_timeout_secs", fallback.idle_timeout_secs),
    mouse_dead_zone_px: num("mouse_dead_zone_px", fallback.mouse_dead_zone_px),
    debug_logging_enabled: bool("debug_logging_enabled", fallback.debug_logging_enabled),
    mode: (d.get("mode") as AppSettings["mode"]) ?? fallback.mode,
    mode_switch_interval_mins: num("mode_switch_interval_mins", fallback.mode_switch_interval_mins),
    flipflap_rows: num("flipflap_rows", fallback.flipflap_rows),
    flipflap_cols: num("flipflap_cols", fallback.flipflap_cols),
    flipflap_tick_ms: num("flipflap_tick_ms", fallback.flipflap_tick_ms),
    flipflap_rotation_secs: num("flipflap_rotation_secs", fallback.flipflap_rotation_secs),
    flipflap_volume: num("flipflap_volume", fallback.flipflap_volume),
    flipflap_accounts: parseAccountsField(
      str("flipflap_accounts", formatAccountsField(fallback.flipflap_accounts)),
    ),
    flipflap_search_query: str("flipflap_search_query", fallback.flipflap_search_query),
    flipflap_time_window_hours: num(
      "flipflap_time_window_hours",
      fallback.flipflap_time_window_hours,
    ),
    flipflap_truncation_chars: num("flipflap_truncation_chars", fallback.flipflap_truncation_chars),
    matrix_font_size: num("matrix_font_size", fallback.matrix_font_size),
    matrix_spawn_density: num("matrix_spawn_density", fallback.matrix_spawn_density),
    matrix_glow_intensity: num("matrix_glow_intensity", fallback.matrix_glow_intensity),
    matrix_tick_ms: num("matrix_tick_ms", fallback.matrix_tick_ms),
    matrix_background_layers: fallback.matrix_background_layers,
    matrix_post_rotation_secs: num("matrix_post_rotation_secs", fallback.matrix_post_rotation_secs),
    matrix_accounts: parseAccountsField(
      str("matrix_accounts", formatAccountsField(fallback.matrix_accounts)),
    ),
    matrix_search_query: str("matrix_search_query", fallback.matrix_search_query),
    matrix_time_window_hours: num("matrix_time_window_hours", fallback.matrix_time_window_hours),
    matrix_truncation_chars: num("matrix_truncation_chars", fallback.matrix_truncation_chars),
  };
}

/** Populate all form inputs from an AppSettings object. */
function populateForm(form: HTMLFormElement, s: AppSettings): void {
  const fields: Record<string, string | number> = {
    idle_timeout_secs: s.idle_timeout_secs,
    mouse_dead_zone_px: s.mouse_dead_zone_px,
    mode: s.mode,
    mode_switch_interval_mins: s.mode_switch_interval_mins,
    flipflap_rows: s.flipflap_rows,
    flipflap_cols: s.flipflap_cols,
    flipflap_tick_ms: s.flipflap_tick_ms,
    flipflap_rotation_secs: s.flipflap_rotation_secs,
    flipflap_volume: s.flipflap_volume,
    flipflap_search_query: s.flipflap_search_query,
    flipflap_time_window_hours: s.flipflap_time_window_hours,
    flipflap_truncation_chars: s.flipflap_truncation_chars,
    matrix_font_size: s.matrix_font_size,
    matrix_spawn_density: s.matrix_spawn_density,
    matrix_glow_intensity: s.matrix_glow_intensity,
    matrix_tick_ms: s.matrix_tick_ms,
    matrix_background_layers: s.matrix_background_layers,
    matrix_post_rotation_secs: s.matrix_post_rotation_secs,
    matrix_search_query: s.matrix_search_query,
    matrix_time_window_hours: s.matrix_time_window_hours,
    matrix_truncation_chars: s.matrix_truncation_chars,
  };

  for (const [name, value] of Object.entries(fields)) {
    const el = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
    if (el) el.value = String(value);
  }

  const flipflapAccounts = form.querySelector<HTMLTextAreaElement>('[name="flipflap_accounts"]');
  if (flipflapAccounts) {
    flipflapAccounts.value = formatAccountsField(s.flipflap_accounts);
  }

  const matrixAccounts = form.querySelector<HTMLTextAreaElement>('[name="matrix_accounts"]');
  if (matrixAccounts) {
    matrixAccounts.value = formatAccountsField(s.matrix_accounts);
  }

  const debugLoggingCheckbox = form.querySelector<HTMLInputElement>("#debug-logging-checkbox");
  if (debugLoggingCheckbox) {
    debugLoggingCheckbox.checked = s.debug_logging_enabled;
  }

  // Update the volume output label.
  const volumeOutput = form.querySelector<HTMLOutputElement>(".range-output");
  if (volumeOutput) {
    volumeOutput.textContent = Number(s.flipflap_volume).toFixed(2);
  }

  syncModeSwitchVisibility(form);
}

function syncModeSwitchVisibility(form: HTMLFormElement): void {
  const modeSelect = form.querySelector<HTMLSelectElement>('[name="mode"]');
  const switchIntervalField = form.querySelector<HTMLElement>("#mode-switch-interval-field");
  if (!modeSelect || !switchIntervalField) {
    return;
  }

  switchIntervalField.style.display = modeSelect.value === "both" ? "" : "none";
}

function wireRendererTabs(root: HTMLElement): void {
  const flipTab = root.querySelector<HTMLButtonElement>("#renderer-tab-flipflap");
  const matrixTab = root.querySelector<HTMLButtonElement>("#renderer-tab-matrix");
  const flipPanel = root.querySelector<HTMLElement>("#renderer-tab-panel-flipflap");
  const matrixPanel = root.querySelector<HTMLElement>("#renderer-tab-panel-matrix");

  if (!flipTab || !matrixTab || !flipPanel || !matrixPanel) {
    return;
  }

  const activate = (mode: "flipflap" | "matrix") => {
    const flipActive = mode === "flipflap";

    flipTab.setAttribute("aria-selected", flipActive ? "true" : "false");
    matrixTab.setAttribute("aria-selected", flipActive ? "false" : "true");

    flipTab.classList.toggle("renderer-tab--active", flipActive);
    matrixTab.classList.toggle("renderer-tab--active", !flipActive);

    flipPanel.hidden = !flipActive;
    matrixPanel.hidden = flipActive;
  };

  flipTab.addEventListener("click", () => activate("flipflap"));
  matrixTab.addEventListener("click", () => activate("matrix"));
}

function showFeedback(el: HTMLElement, type: "success" | "error" | "info", message: string): void {
  el.className = `settings-feedback settings-feedback--${type}`;
  el.textContent = message;
  el.hidden = false;

  // Auto-hide after 4 seconds for success/info messages.
  if (type !== "error") {
    setTimeout(() => {
      el.hidden = true;
    }, 4000);
  }
}

function wireAutostartToggle(form: HTMLFormElement): void {
  const checkbox = form.querySelector<HTMLInputElement>("#autostart-checkbox");
  if (!checkbox) return;

  checkbox.addEventListener("change", async () => {
    try {
      // On Linux the binary path comes from the running process.
      // `process.execPath` is not available in browser contexts, so we pass
      // an empty string when disabling and rely on Tauri's own path resolution
      // when enabling. A production build should use tauri's `currentExe`
      // command or the stored install path.
      const exePath = checkbox.checked ? ((await getExePath()) ?? "") : "";
      await setAutostartEnabled(checkbox.checked, exePath);
      logInfo("Autostart setting changed", { enabled: checkbox.checked });
    } catch (err) {
      logError("Autostart toggle failed", err, { intendedEnabled: checkbox.checked });
      // Revert the checkbox on failure.
      checkbox.checked = !checkbox.checked;
    }
  });
}

/** Attempt to get the current executable path via Tauri. Returns null in non-Tauri contexts. */
async function getExePath(): Promise<string | null> {
  try {
    return await invoke<string>("plugin:path|resolve_path", {
      path: "",
      directory: "Executable",
    });
  } catch {
    // Fallback: use process.argv[0] when available (Electron-style) or empty.
    return null;
  }
}

function wireApiKeySave(root: HTMLElement, form: HTMLFormElement): void {
  const saveBtn = root.querySelector<HTMLButtonElement>("#save-api-key-btn");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    const input = form.querySelector<HTMLInputElement>("#bearer-token-input");
    const token = input?.value ?? "";
    try {
      await invoke("set_api_key", { bearerToken: token });
      logInfo("Bearer token saved", { configured: token.trim().length > 0 });
      loadApiKeyStatus(root);
    } catch (err) {
      logError("Failed to save bearer token", err);
    }
  });
}

function wireRefreshPosts(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>("#refresh-posts-btn");
  const status = root.querySelector<HTMLElement>("#refresh-status");
  if (!btn || !status) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Fetching…";
    try {
      // Refresh both modes so both caches are populated.
      await invoke("fetch_posts", { mode: "matrix" });
      await invoke("fetch_posts", { mode: "flipflap" });
      await loadCacheOverview(root);
      logInfo("Post refresh completed for both modes");
      status.textContent = "Posts refreshed.";
    } catch (err) {
      logError("Post refresh failed", err);
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      btn.disabled = false;
    }
  });
}

function wireOpenLogsButton(root: HTMLElement, feedback: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>("#open-logs-btn");
  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const path = await openLogsDirectory();
      logInfo("Opened logs directory", { path });
      showFeedback(feedback, "info", `Opened logs folder: ${path}`);
    } catch (err) {
      logError("Failed to open logs directory", err);
      showFeedback(
        feedback,
        "error",
        `Failed to open logs folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      button.disabled = false;
    }
  });
}

function wirePreviewButtons(
  root: HTMLElement,
  form: HTMLFormElement,
  previewFeedback: HTMLElement,
  saveFeedback: HTMLElement,
  fallback: AppSettings,
): void {
  const previewButtons: Array<[string, AppSettings["mode"], string]> = [
    ["#test-matrix-btn", "matrix", "Testing Matrix mode now."],
    ["#test-flipflap-btn", "flip_flap", "Testing FlipFlap mode now."],
    ["#test-both-btn", "both", "Testing Both mode now."],
  ];

  for (const [selector, mode, successMessage] of previewButtons) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (!button) continue;

    button.addEventListener("click", async () => {
      const allButtons = root.querySelectorAll<HTMLButtonElement>(
        "#test-matrix-btn, #test-flipflap-btn, #test-both-btn",
      );

      for (const control of allButtons) {
        control.disabled = true;
      }

      try {
        const settings = withScreensaverMode(readFormValues(form, fallback), mode);
        await saveSettings(settings);
        populateForm(form, settings);
        setFrontendDebugLogging(settings.debug_logging_enabled);
        await activateScreensaver();
        saveFeedback.hidden = true;
        logInfo("Started mode preview", { mode });
        showFeedback(previewFeedback, "info", successMessage);
      } catch (err) {
        saveFeedback.hidden = true;
        logError("Failed to start mode preview", err, { mode });
        showFeedback(
          previewFeedback,
          "error",
          `Failed to start test: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        for (const control of allButtons) {
          control.disabled = false;
        }
      }
    });
  }
}

async function loadApiKeyStatus(root: HTMLElement): Promise<void> {
  const hint = root.querySelector<HTMLElement>("#api-key-status");
  if (!hint) return;
  try {
    const hasKey = await invoke<boolean>("get_api_key_status");
    hint.textContent = hasKey ? "Status: token saved ✓" : "Status: not configured";
    logDebug("API key status loaded", { configured: hasKey });
  } catch {
    hint.textContent = "Status: unavailable";
    logWarn("API key status unavailable");
  }
}

async function loadCacheOverview(root: HTMLElement): Promise<void> {
  const summary = root.querySelector<HTMLElement>("#cache-overview-summary");
  const flipMeta = root.querySelector<HTMLElement>("#cache-meta-flipflap");
  const matrixMeta = root.querySelector<HTMLElement>("#cache-meta-matrix");
  const flipList = root.querySelector<HTMLUListElement>("#cache-list-flipflap");
  const matrixList = root.querySelector<HTMLUListElement>("#cache-list-matrix");

  if (!summary || !flipMeta || !matrixMeta || !flipList || !matrixList) {
    return;
  }

  const requestId = (cacheOverviewRequestByRoot.get(root) ?? 0) + 1;
  cacheOverviewRequestByRoot.set(root, requestId);

  try {
    const [flipCache, matrixCache] = await Promise.all([
      invoke<CachedPostsEnvelope>("get_cached_posts", { mode: "flipflap" }),
      invoke<CachedPostsEnvelope>("get_cached_posts", { mode: "matrix" }),
    ]);

    const flipCount = flipCache.posts.length;
    const matrixCount = matrixCache.posts.length;
    const totalCount = flipCount + matrixCount;

    if (cacheOverviewRequestByRoot.get(root) !== requestId) {
      return;
    }

    summary.textContent = `Total cached posts: ${totalCount} (FlipFlap: ${flipCount}, Matrix: ${matrixCount})`;
    flipMeta.textContent = `FlipFlap cache: ${formatPostCount(flipCount)} (last fetch: ${formatDateTimeForUi(flipCache.fetched_at)})`;
    matrixMeta.textContent = `Matrix cache: ${formatPostCount(matrixCount)} (last fetch: ${formatDateTimeForUi(matrixCache.fetched_at)})`;

    renderCacheList(flipList, flipCache.posts);
    renderCacheList(matrixList, matrixCache.posts);
  } catch (err) {
    if (cacheOverviewRequestByRoot.get(root) !== requestId) {
      return;
    }

    summary.textContent = "Total cached posts: unavailable";
    flipMeta.textContent = "FlipFlap cache: unavailable";
    matrixMeta.textContent = "Matrix cache: unavailable";
    renderUnavailableList(flipList);
    renderUnavailableList(matrixList);
    logWarn(`Failed to load cache overview: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function formatPostCount(count: number): string {
  return `${count} ${count === 1 ? "post" : "posts"}`;
}

function formatDateTimeForUi(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return "unknown";
  }

  return timestamp.toLocaleString();
}

function renderCacheList(target: HTMLUListElement, posts: CachedPostSummary[]): void {
  target.replaceChildren();

  if (posts.length === 0) {
    const empty = document.createElement("li");
    empty.className = "cache-overview-item cache-overview-item--empty";
    empty.textContent = "No posts cached.";
    target.append(empty);
    return;
  }

  for (const post of posts) {
    const handle = post.author_username?.trim() ? `@${post.author_username}` : "@unknown";
    const sentAt = formatDateTimeForUi(post.created_at);

    const item = document.createElement("li");
    item.className = "cache-overview-item";
    item.textContent = `${handle} - ${sentAt}`;
    target.append(item);
  }
}

function renderUnavailableList(target: HTMLUListElement): void {
  target.replaceChildren();
  const item = document.createElement("li");
  item.className = "cache-overview-item cache-overview-item--empty";
  item.textContent = "Cache unavailable.";
  target.append(item);
}
