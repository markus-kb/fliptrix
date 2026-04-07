/**
 * Screensaver overlay — sets up the fullscreen black overlay, hides the
 * cursor via CSS, and listens for user input to trigger deactivation.
 *
 * This module is loaded only when the window is a screensaver overlay
 * (label starts with `screensaver-`). It depends on Tauri's IPC bridge
 * being available at runtime.
 *
 * Phase 7: the active renderer is selected from the persisted mode setting.
 * - `matrix`   → MatrixRenderer (default)
 * - `flip_flap` → FlipFlapRenderer
 * - `both`     → starts with Matrix, rotates to FlipFlap after
 *                `mode_switch_interval_mins` minutes, and keeps alternating
 */

import { invoke } from "@tauri-apps/api/core";
import { resolveFlipFlapBackgroundImageUrl } from "./flipflap-backgrounds";
import { FlipFlapRenderer } from "./flipflap-renderer";
import { logError, logWarn, setFrontendDebugLogging } from "./logger";
import { MatrixRenderer } from "./matrix-renderer";
import { MouseTracker } from "./screensaver";
import {
  type AppSettings,
  cloneDefaultSettings,
  DEFAULT_SETTINGS,
  type ScreensaverMode,
} from "./settings";

/** Shape of a cached post from the Rust backend. */
interface CachedPost {
  text: string;
  author_name?: string;
  author_username?: string;
}

type RendererPost = { text: string; author?: string };
type ActiveRenderer = FlipFlapRenderer | MatrixRenderer;

let activeRenderer: ActiveRenderer | null = null;
let activeResizeObserver: ResizeObserver | null = null;
let swapTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize the screensaver overlay in the given DOM root element.
 *
 * Sets up:
 * 1. A fullscreen canvas for the active renderer
 * 2. Post data loading from the Rust cache
 * 3. A `keydown` listener that deactivates on any keystroke
 * 4. A `mousemove` listener that tracks origin and deactivates when
 *    movement exceeds the configured dead-zone
 */
export function initScreensaverOverlay(root: HTMLElement): void {
  root.innerHTML = `
    <div class="screensaver-overlay">
      <canvas id="screensaver-canvas"></canvas>
      <output id="screensaver-rendered-posts" class="screensaver-rendered-posts" aria-live="polite"></output>
    </div>
  `;

  // Apply cursor-hide and full-bleed styles.
  document.documentElement.style.cursor = "none";
  document.body.style.cursor = "none";
  document.body.style.overflow = "hidden";
  document.body.style.margin = "0";
  document.body.style.background = "#000";

  const canvas = root.querySelector<HTMLCanvasElement>("#screensaver-canvas");
  if (canvas) {
    let deadZonePx = DEFAULT_SETTINGS.mouse_dead_zone_px;

    void (async () => {
      const settings = await loadSettings();
      deadZonePx = settings.mouse_dead_zone_px;
      await startRenderer(canvas, settings);
    })();

    const mouseTracker = new MouseTracker();
    let deactivating = false;

    async function deactivate(): Promise<void> {
      if (deactivating) return;
      deactivating = true;
      stopActiveRenderer();

      try {
        await invoke("deactivate_screensaver");
      } catch (err) {
        logError("Failed to deactivate screensaver", err);
      }
    }

    document.addEventListener("keydown", () => {
      void deactivate();
    });

    document.addEventListener("mousemove", (event: MouseEvent) => {
      if (deactivating) return;

      if (!mouseTracker.hasOrigin()) {
        mouseTracker.recordOrigin(event.clientX, event.clientY);
        return;
      }

      if (mouseTracker.exceedsDeadZone(event.clientX, event.clientY, deadZonePx)) {
        void deactivate();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Renderer lifecycle
// ---------------------------------------------------------------------------

/**
 * Load settings + posts and start the appropriate renderer.
 * Falls back to Matrix with demo posts on any error.
 */
async function startRenderer(canvas: HTMLCanvasElement, settings: AppSettings): Promise<void> {
  const demoContent: RendererPost[] = [
    { text: "FLIPTRIX" },
    { text: "NO POSTS CACHED" },
    { text: "CONFIGURE API KEY" },
  ];

  if (settings.mode === "flip_flap") {
    const posts = await loadCachedPosts("flipflap", settings.flipflap_truncation_chars);
    await startFlipFlapRenderer(canvas, settings, posts.length > 0 ? posts : demoContent);
  } else if (settings.mode === "both") {
    const [matrixPosts, flipflapPosts] = await Promise.all([
      loadCachedPosts("matrix", settings.matrix_truncation_chars),
      loadCachedPosts("flipflap", settings.flipflap_truncation_chars),
    ]);
    await startBothModeRenderer(
      canvas,
      settings,
      matrixPosts.length > 0 ? matrixPosts : demoContent,
      flipflapPosts.length > 0 ? flipflapPosts : demoContent,
    );
  } else {
    const posts = await loadCachedPosts("matrix", settings.matrix_truncation_chars);
    await startMatrixRenderer(canvas, settings, posts.length > 0 ? posts : demoContent);
  }
}

/**
 * Start the Matrix rain renderer.
 */
async function startMatrixRenderer(
  canvas: HTMLCanvasElement,
  settings: AppSettings,
  posts: RendererPost[],
): Promise<void> {
  stopActiveRenderer();
  canvas.className = "matrix-canvas";

  let renderer: MatrixRenderer;
  try {
    renderer = new MatrixRenderer(canvas, {
      fontSize: settings.matrix_font_size,
      spawnDensity: settings.matrix_spawn_density,
      glowIntensity: settings.matrix_glow_intensity,
      tickIntervalMs: settings.matrix_tick_ms,
      backgroundLayerCount: settings.matrix_background_layers,
      postRotationSec: settings.matrix_post_rotation_secs,
      onActivePacketTextChange: (text) => {
        writeRenderedPostsProbe(canvas, text);
      },
    });
  } catch (err) {
    writeRenderedPostsProbe(canvas, "MATRIX RENDERER INIT FAILED");
    logError("Failed to initialize Matrix renderer", err);
    return;
  }

  wireResizeObserver(canvas, () => renderer.resizeCanvas());
  writeRenderedPostsProbe(canvas, buildInitialMatrixProbe(posts));
  renderer.setPostContent(posts);
  renderer.start();
  activeRenderer = renderer;
}

/**
 * Start the FlipFlap split-flap renderer.
 */
async function startFlipFlapRenderer(
  canvas: HTMLCanvasElement,
  settings: AppSettings,
  posts: RendererPost[],
): Promise<void> {
  stopActiveRenderer();
  canvas.className = "flipflap-canvas";

  const renderer = new FlipFlapRenderer(canvas, {
    rows: settings.flipflap_rows,
    cols: settings.flipflap_cols,
    tickIntervalMs: settings.flipflap_tick_ms,
    postRotationSec: settings.flipflap_rotation_secs,
    backgroundImageUrl: resolveFlipFlapBackgroundImageUrl(settings.flipflap_background_image),
    backgroundAnimationEnabled: settings.flipflap_background_animation_enabled,
    backgroundPulseSpeed: settings.flipflap_background_pulse_speed,
    audio: {
      masterVolume: settings.flipflap_volume,
      pitchCenter: 1800,
      pitchVariation: 200,
      volumeVariation: 0.1,
      durationMs: 15,
    },
    onVisibleLinesChange: (lines) => {
      writeRenderedPostsProbe(canvas, lines.join("\n"));
    },
  });

  wireResizeObserver(canvas, () => renderer.resizeCanvas());
  renderer.setPostContent(posts);
  renderer.start();
  activeRenderer = renderer;
}

/**
 * "Both" mode: start with Matrix, swap to FlipFlap after the configured
 * interval, then keep alternating.
 *
 * Each swap destroys the old renderer and creates a new one so canvas state
 * doesn't bleed between modes.
 */
async function startBothModeRenderer(
  canvas: HTMLCanvasElement,
  settings: AppSettings,
  matrixPosts: RendererPost[],
  flipflapPosts: RendererPost[],
): Promise<void> {
  let currentMode: Exclude<ScreensaverMode, "both"> = "matrix";

  clearSwapTimer();
  await startMatrixRenderer(canvas, settings, matrixPosts);

  const intervalMs = settings.mode_switch_interval_mins * 60 * 1000;

  function scheduleSwap(): void {
    swapTimerId = setTimeout(async () => {
      currentMode = currentMode === "matrix" ? "flip_flap" : "matrix";

      if (currentMode === "flip_flap") {
        await startFlipFlapRenderer(canvas, settings, flipflapPosts);
      } else {
        await startMatrixRenderer(canvas, settings, matrixPosts);
      }

      scheduleSwap();
    }, intervalMs);
  }

  scheduleSwap();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wireResizeObserver(canvas: HTMLCanvasElement, onResize: () => void): void {
  activeResizeObserver?.disconnect();
  activeResizeObserver = new ResizeObserver(() => onResize());
  activeResizeObserver.observe(canvas.parentElement ?? document.body);
}

function clearSwapTimer(): void {
  if (swapTimerId !== null) {
    clearTimeout(swapTimerId);
    swapTimerId = null;
  }
}

function stopActiveRenderer(): void {
  clearSwapTimer();
  activeResizeObserver?.disconnect();
  activeResizeObserver = null;
  activeRenderer?.stop();
  activeRenderer = null;
}

function writeRenderedPostsProbe(canvas: HTMLCanvasElement, renderedText: string): void {
  const normalized = renderedText.trim();
  canvas.setAttribute("data-rendered-posts-sync", "1");
  canvas.setAttribute("data-rendered-posts", normalized);

  const probe = document.querySelector<HTMLOutputElement>("#screensaver-rendered-posts");
  if (probe) {
    probe.textContent = normalized;
  }
}

function buildInitialMatrixProbe(posts: RendererPost[]): string {
  if (posts.length === 0) {
    return "";
  }

  const first = posts[0];
  const author =
    first.author && first.author.trim().length > 0
      ? `${first.author.startsWith("@") ? first.author : `@${first.author}`}: `
      : "";

  return `${author}${first.text}`.toUpperCase();
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const settings = await invoke<AppSettings>("get_settings");
    setFrontendDebugLogging(settings.debug_logging_enabled);
    return settings;
  } catch (err) {
    logWarn("Failed to load settings in screensaver overlay, using defaults");
    setFrontendDebugLogging(false);
    logError("Screensaver overlay settings load failed", err);
    return cloneDefaultSettings();
  }
}

/**
 * Load cached posts from the Rust backend via Tauri IPC.
 *
 * Falls back gracefully to an empty array if the cache is empty or
 * the IPC call fails (e.g. during development without a running backend).
 */
async function loadCachedPosts(
  mode: "flipflap" | "matrix",
  truncationChars: number,
): Promise<RendererPost[]> {
  try {
    const cached = await invoke<{ posts: CachedPost[] }>("get_cached_posts", {
      mode,
      truncationChars,
    });
    return cached.posts.map((post) => ({
      text: post.text,
      author: post.author_username ? `@${post.author_username}` : post.author_name,
    }));
  } catch (err) {
    logError("Failed to load cached posts", err, { mode });
    return [];
  }
}
