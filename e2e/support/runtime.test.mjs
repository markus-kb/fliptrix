import assert from "node:assert/strict";
import test from "node:test";

import {
  computeTauriDriverArgs,
  hasLinuxDisplay,
  resolveDriverStatusPath,
  resolveDriverPortFromArgs,
  resolveNativeDriverFromArgs,
} from "./runtime.mjs";

test("hasLinuxDisplay returns true when DISPLAY exists", () => {
  assert.equal(hasLinuxDisplay({ DISPLAY: ":99" }), true);
  assert.equal(hasLinuxDisplay({ WAYLAND_DISPLAY: "wayland-1" }), true);
  assert.equal(hasLinuxDisplay({}), false);
});

test("resolveNativeDriverFromArgs reads both arg styles", () => {
  assert.equal(
    resolveNativeDriverFromArgs(["--native-driver", "/usr/bin/WebKitWebDriver"]),
    "/usr/bin/WebKitWebDriver",
  );
  assert.equal(
    resolveNativeDriverFromArgs(["--native-driver=/custom/WebKitWebDriver"]),
    "/custom/WebKitWebDriver",
  );
  assert.equal(resolveNativeDriverFromArgs(["--port", "4444"]), null);
});

test("resolveDriverPortFromArgs reads both arg styles", () => {
  assert.equal(resolveDriverPortFromArgs(["--port", "4444"]), 4444);
  assert.equal(resolveDriverPortFromArgs(["--port=5555"]), 5555);
  assert.equal(resolveDriverPortFromArgs(["--native-driver", "/usr/bin/WebKitWebDriver"]), null);
});

test("computeTauriDriverArgs keeps non-linux args unchanged", async () => {
  const args = await computeTauriDriverArgs({
    platform: "win32",
    rawArgs: "--port 4444",
    env: {},
  });

  assert.deepEqual(args, ["--port", "4444"]);
});

test("computeTauriDriverArgs fails fast on linux without display", async () => {
  await assert.rejects(
    () =>
      computeTauriDriverArgs({
        platform: "linux",
        rawArgs: "",
        env: {},
        linuxNativeDriverPath: "/usr/bin/WebKitWebDriver",
      }),
    /requires a graphical display/i,
  );
});

test("computeTauriDriverArgs appends auto-detected native driver on linux", async () => {
  const args = await computeTauriDriverArgs({
    platform: "linux",
    rawArgs: "--port 4444",
    env: { DISPLAY: ":99" },
    linuxNativeDriverPath: "/usr/bin/WebKitWebDriver",
  });

  assert.deepEqual(args, ["--port", "4444", "--native-driver", "/usr/bin/WebKitWebDriver"]);
});

test("computeTauriDriverArgs appends env-derived port when missing on linux", async () => {
  const args = await computeTauriDriverArgs({
    platform: "linux",
    rawArgs: "",
    env: { DISPLAY: ":99", FLIPTRIX_E2E_DRIVER_PORT: "5566" },
    linuxNativeDriverPath: "/usr/bin/WebKitWebDriver",
  });

  assert.deepEqual(args, ["--port", "5566", "--native-driver", "/usr/bin/WebKitWebDriver"]);
});

test("computeTauriDriverArgs preserves explicit native driver setting", async () => {
  const args = await computeTauriDriverArgs({
    platform: "linux",
    rawArgs: "--native-driver /custom/WebKitWebDriver",
    env: { DISPLAY: ":99" },
    linuxNativeDriverPath: "/usr/bin/WebKitWebDriver",
  });

  assert.deepEqual(args, ["--native-driver", "/custom/WebKitWebDriver", "--port", "4444"]);
});

test("resolveDriverStatusPath appends status when path has no trailing slash", () => {
  assert.equal(resolveDriverStatusPath("/wd/hub"), "/wd/hub/status");
});

test("resolveDriverStatusPath appends status when path has trailing slash", () => {
  assert.equal(resolveDriverStatusPath("/wd/hub/"), "/wd/hub/status");
});

test("resolveDriverStatusPath handles root path", () => {
  assert.equal(resolveDriverStatusPath("/"), "/status");
});
