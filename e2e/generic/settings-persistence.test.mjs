import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";
import { clickButton, setFieldValue, waitForElementText } from "../support/ui.mjs";

let harness;

before(async () => {
  harness = await createHarness({ suiteName: "generic-settings" });
});

after(async () => {
  await harness?.dispose();
});

test("persists saved settings across app sessions", async () => {
  const firstSession = await harness.openSession();
  try {
    await setFieldValue(firstSession, '[name="idle_timeout_secs"]', "321");
    await clickButton(firstSession, 'button[type="submit"]');
    await waitForElementText(firstSession, "#settings-save-feedback", "Settings saved.");
  } finally {
    await harness.closeSession(firstSession);
  }

  const secondSession = await harness.openSession();
  try {
    const field = await secondSession.$('[name="idle_timeout_secs"]');
    await field.waitForDisplayed({ timeout: 15_000 });
    const value = await field.getValue();
    assert.equal(value, "321");
  } finally {
    await harness.closeSession(secondSession);
  }
});

test("displays build hash in settings header", async () => {
  const browser = await harness.openSession();
  try {
    const hashEl = await browser.$("#build-hash");
    await hashEl.waitForDisplayed({ timeout: 15_000 });
    const text = await hashEl.getText();
    assert.ok(
      /^[0-9a-f]{7,}$/.test(text) || text === "dev",
      `build hash must be a hex short hash or "dev", got: "${text}"`,
    );
  } finally {
    await harness.closeSession(browser);
  }
});
