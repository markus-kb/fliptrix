import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";
import { APP_ID, waitFor } from "../support/runtime.mjs";

let harness;

before(async () => {
  if (process.platform !== "linux") {
    return;
  }
  harness = await createHarness({ suiteName: "linux-autostart" });
});

after(async () => {
  await harness?.dispose();
});

test("toggles Linux autostart desktop entry in isolated directory", {
  skip: process.platform !== "linux",
}, async () => {
  const browser = await harness.openSession();
  const autostartPath = join(harness.dirs.autostartDir, `${APP_ID}.desktop`);

  try {
    const checkbox = await browser.$("#autostart-checkbox");
    await checkbox.waitForDisplayed({ timeout: 15_000 });

    await checkbox.click();
    await waitFor(() => existsSync(autostartPath), {
      timeoutMs: 15_000,
      errorMessage: "Autostart desktop entry was not created",
    });

    const content = await readFile(autostartPath, "utf8");
    assert.match(content, /\[Desktop Entry\]/);
    assert.match(content, /^Exec=/m);

    await checkbox.click();
    await waitFor(() => !existsSync(autostartPath), {
      timeoutMs: 15_000,
      errorMessage: "Autostart desktop entry was not removed",
    });
  } finally {
    await harness.closeSession(browser);
  }
});
