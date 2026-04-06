import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const APP_ID = "com.fliptrix.desktop";

const LINUX_NATIVE_DRIVER_CANDIDATES = [
  "/usr/bin/WebKitWebDriver",
  "/usr/libexec/webkit2gtk-4.1/WebKitWebDriver",
];

function resolveDriverPort(env = process.env) {
  return Number(env.FLIPTRIX_E2E_DRIVER_PORT ?? "4444");
}

function resolveDriverPath(env = process.env) {
  return env.FLIPTRIX_E2E_DRIVER_PATH ?? "/";
}

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

export function resolveDriverPortFromArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      const next = args[index + 1];
      return next ? Number(next) : null;
    }
    if (arg.startsWith("--port=")) {
      const value = arg.slice("--port=".length);
      return value ? Number(value) : null;
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
  const explicitDriverPort = resolveDriverPortFromArgs(extraArgs);
  if (!explicitDriverPort) {
    extraArgs.push("--port", String(resolveDriverPort(env)));
  }

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

export async function getAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to resolve ephemeral port")));
        return;
      }

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

export function resolveDriverStatusPath(driverPath) {
  const normalizedPath = (driverPath?.trim() || "/").startsWith("/")
    ? driverPath?.trim() || "/"
    : `/${driverPath?.trim() || ""}`;
  const basePath = normalizedPath.endsWith("/") ? normalizedPath.slice(0, -1) : normalizedPath;
  return `${basePath}/status`;
}

async function isDriverReady(env) {
  const port = resolveDriverPort(env);
  const path = resolveDriverPath(env);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${resolveDriverStatusPath(path)}`);
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

  async function stopChild() {
    if (child.killed || exited) {
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
  }

  try {
    await waitFor(
      async () => {
        if (startupError) {
          throw new Error(
            `Failed to start tauri-driver (${driverCommand}): ${startupError.message}`,
          );
        }
        if (exited) {
          throw new Error(
            `tauri-driver exited before becoming ready. Command: ${driverCommand} ${extraArgs.join(" ")}\n${logs.join("")}`,
          );
        }
        return isDriverReady(mergedEnv);
      },
      {
        timeoutMs: 20_000,
        errorMessage: `tauri-driver did not become ready. Command: ${driverCommand} ${extraArgs.join(
          " ",
        )}\n${logs.join("")}`,
      },
    );
  } catch (error) {
    await stopChild();
    throw error;
  }

  return {
    child,
    port: resolveDriverPort(mergedEnv),
    path: resolveDriverPath(mergedEnv),
    logs,
    async stop() {
      await stopChild();
    },
  };
}
