import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const APP_ID = "com.fliptrix.desktop";

const DRIVER_PORT = Number(process.env.FLIPTRIX_E2E_DRIVER_PORT ?? "4444");
const DRIVER_PATH = process.env.FLIPTRIX_E2E_DRIVER_PATH ?? "/";
const LINUX_NATIVE_DRIVER_CANDIDATES = [
  "/usr/bin/WebKitWebDriver",
  "/usr/libexec/webkit2gtk-4.1/WebKitWebDriver",
];

export async function waitFor(check, { timeoutMs = 15_000, intervalMs = 250, errorMessage }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) {
      return;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
  }

  const message = typeof errorMessage === "function" ? errorMessage() : errorMessage;
  throw new Error(message ?? `Condition timed out after ${timeoutMs}ms`);
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseDriverArgs(rawArgs) {
  return rawArgs
    .split(" ")
    .map((arg) => arg.trim())
    .filter(Boolean);
}

export function hasLinuxDisplay(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

export function resolveNativeDriverFromArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--native-driver") {
      return args[index + 1] ?? null;
    }
    if (arg.startsWith("--native-driver=")) {
      return arg.slice("--native-driver=".length) || null;
    }
  }
  return null;
}

async function resolveLinuxNativeDriverPath() {
  for (const candidate of LINUX_NATIVE_DRIVER_CANDIDATES) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function computeTauriDriverArgs({
  platform = process.platform,
  rawArgs = process.env.FLIPTRIX_E2E_DRIVER_ARGS ?? "",
  env = process.env,
  linuxNativeDriverPath,
} = {}) {
  const extraArgs = parseDriverArgs(rawArgs);

  if (platform !== "linux") {
    return extraArgs;
  }

  if (!hasLinuxDisplay(env)) {
    throw new Error(
      "Linux E2E requires a graphical display. Set DISPLAY/WAYLAND_DISPLAY or run under xvfb (e.g. `xvfb-run -a corepack pnpm e2e:generic`).",
    );
  }

  const explicitNativeDriver = resolveNativeDriverFromArgs(extraArgs);
  if (explicitNativeDriver) {
    return extraArgs;
  }

  const detectedDriver = linuxNativeDriverPath ?? (await resolveLinuxNativeDriverPath());
  if (!detectedDriver) {
    throw new Error(
      "Unable to locate Linux native WebDriver. Install package `webkit2gtk-driver` and ensure `/usr/bin/WebKitWebDriver` exists, or set FLIPTRIX_E2E_DRIVER_ARGS='--native-driver /path/to/WebKitWebDriver'.",
    );
  }

  return [...extraArgs, "--native-driver", detectedDriver];
}

export async function resolveApplicationPath() {
  const override = process.env.FLIPTRIX_E2E_APP;
  if (override && override.trim()) {
    const absolute = resolve(override.trim());
    if (!(await exists(absolute))) {
      throw new Error(`FLIPTRIX_E2E_APP does not exist: ${absolute}`);
    }
    return absolute;
  }

  const executable = process.platform === "win32" ? "fliptrix.exe" : "fliptrix";
  const candidates = [
    resolve("src-tauri", "target", "debug", executable),
    resolve("src-tauri", "target", "release", executable),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No Tauri app binary found. Set FLIPTRIX_E2E_APP or build first (tried: ${candidates.join(
      ", ",
    )}).`,
  );
}

export async function createIsolatedDirs(prefix) {
  const rootDir = await mkdtemp(join(tmpdir(), `fliptrix-e2e-${prefix}-`));
  const appDataDir = join(rootDir, "app-data");
  const autostartDir = join(rootDir, "autostart");

  await mkdir(appDataDir, { recursive: true });
  await mkdir(autostartDir, { recursive: true });

  return {
    rootDir,
    appDataDir,
    autostartDir,
    async cleanup() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export function resolveDriverStatusPath(driverPath) {
  const normalizedPath = (driverPath?.trim() || "/").startsWith("/")
    ? driverPath?.trim() || "/"
    : `/${driverPath?.trim() || ""}`;
  const basePath = normalizedPath.endsWith("/") ? normalizedPath.slice(0, -1) : normalizedPath;
  return `${basePath}/status`;
}

async function isDriverReady() {
  try {
    const response = await fetch(
      `http://127.0.0.1:${DRIVER_PORT}${resolveDriverStatusPath(DRIVER_PATH)}`,
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function startTauriDriver(envOverrides = {}) {
  const driverCommand = process.env.FLIPTRIX_TAURI_DRIVER ?? "tauri-driver";
  const mergedEnv = {
    ...process.env,
    ...envOverrides,
  };
  const extraArgs = await computeTauriDriverArgs({
    rawArgs: mergedEnv.FLIPTRIX_E2E_DRIVER_ARGS ?? "",
    env: mergedEnv,
  });

  const logs = [];
  let startupError = null;
  let exited = false;
  const child = spawn(driverCommand, extraArgs, {
    env: mergedEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    logs.push(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    logs.push(String(chunk));
  });
  child.once("error", (error) => {
    startupError = error;
  });
  child.once("exit", () => {
    exited = true;
  });

  await waitFor(
    async () => {
      if (startupError) {
        throw new Error(`Failed to start tauri-driver (${driverCommand}): ${startupError.message}`);
      }
      if (exited) {
        throw new Error(
          `tauri-driver exited before becoming ready. Command: ${driverCommand} ${extraArgs.join(" ")}\n${logs.join("")}`,
        );
      }
      return isDriverReady();
    },
    {
      timeoutMs: 20_000,
      errorMessage: `tauri-driver did not become ready. Command: ${driverCommand} ${extraArgs.join(
        " ",
      )}\n${logs.join("")}`,
    },
  );

  return {
    child,
    port: DRIVER_PORT,
    path: DRIVER_PATH,
    logs,
    async stop() {
      if (child.killed) {
        return;
      }

      child.kill();
      await new Promise((resolveStop) => {
        child.once("exit", () => resolveStop());
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
          resolveStop();
        }, 5_000);
      });
    },
  };
}
