import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const APP_ID = "com.fliptrix.desktop";

const DRIVER_PORT = Number(process.env.FLIPTRIX_E2E_DRIVER_PORT ?? "4444");
const DRIVER_PATH = process.env.FLIPTRIX_E2E_DRIVER_PATH ?? "/";

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

async function isDriverReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}${DRIVER_PATH}status`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function startTauriDriver(envOverrides = {}) {
  const driverCommand = process.env.FLIPTRIX_TAURI_DRIVER ?? "tauri-driver";
  const extraArgs = (process.env.FLIPTRIX_E2E_DRIVER_ARGS ?? "")
    .split(" ")
    .map((arg) => arg.trim())
    .filter(Boolean);

  const logs = [];
  let startupError = null;
  let exited = false;
  const child = spawn(driverCommand, extraArgs, {
    env: {
      ...process.env,
      ...envOverrides,
    },
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
