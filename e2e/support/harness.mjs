import { remote } from "webdriverio";

import { startFixtureServer } from "../fixtures/server.mjs";
import {
  APP_ID,
  createIsolatedDirs,
  getAvailablePort,
  resolveApplicationPath,
  startTauriDriver,
} from "./runtime.mjs";

function buildCapabilities(applicationPath) {
  const options = {
    application: applicationPath,
  };

  const appArgsRaw = process.env.FLIPTRIX_E2E_APP_ARGS;
  if (appArgsRaw?.trim()) {
    options.args = appArgsRaw
      .split(" ")
      .map((arg) => arg.trim())
      .filter(Boolean);
  }

  return {
    "tauri:options": options,
  };
}

function parsePortFromDriverArgs(rawArgs) {
  const value = rawArgs ?? "";
  const equalsMatch = value.match(/(?:^|\s)--port=(\d+)(?:\s|$)/);
  if (equalsMatch) {
    return Number(equalsMatch[1]);
  }

  const splitMatch = value.match(/(?:^|\s)--port\s+(\d+)(?:\s|$)/);
  if (splitMatch) {
    return Number(splitMatch[1]);
  }

  return null;
}

export async function createHarness({ suiteName, withFixtureServer = false }) {
  const dirs = await createIsolatedDirs(suiteName);
  let fixture = null;
  let driver = null;

  try {
    fixture = withFixtureServer ? await startFixtureServer() : null;
    const applicationPath = await resolveApplicationPath();
    const existingDriverArgs = process.env.FLIPTRIX_E2E_DRIVER_ARGS ?? "";
    const explicitPort = parsePortFromDriverArgs(existingDriverArgs);
    const driverPort = explicitPort ?? (await getAvailablePort());
    const mergedDriverArgs = explicitPort
      ? existingDriverArgs
      : `${existingDriverArgs} --port ${driverPort}`.trim();

    const env = {
      FLIPTRIX_E2E: "1",
      FLIPTRIX_APP_DATA_DIR: dirs.appDataDir,
      FLIPTRIX_STORE_FILE: `${suiteName}.store.json`,
      FLIPTRIX_E2E_AUTOSTART_DIR: dirs.autostartDir,
      FLIPTRIX_E2E_DRIVER_PORT: String(driverPort),
      FLIPTRIX_E2E_DRIVER_ARGS: mergedDriverArgs,
    };

    if (fixture) {
      env.FLIPTRIX_X_API_BASE = `${fixture.baseUrl}/2`;
    }

    driver = await startTauriDriver(env);

    return {
      appId: APP_ID,
      dirs,
      env,
      fixture,
      applicationPath,
      async openSession() {
        return remote({
          hostname: "127.0.0.1",
          port: driver.port,
          path: driver.path,
          logLevel: "silent",
          capabilities: buildCapabilities(applicationPath),
          connectionRetryCount: 2,
          connectionRetryTimeout: 30_000,
        });
      },
      async closeSession(browser) {
        if (!browser) return;
        try {
          await browser.deleteSession();
        } catch {
          // ignore teardown errors to keep cleanup idempotent
        }
      },
      async dispose() {
        await fixture?.close();
        await driver?.stop();
        await dirs.cleanup();
      },
    };
  } catch (error) {
    await fixture?.close();
    await driver?.stop();
    await dirs.cleanup();
    throw error;
  }
}
