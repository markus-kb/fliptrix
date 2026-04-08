import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";
import { clickButton, setFieldValue, waitForElementText } from "../support/ui.mjs";

let harness;

before(async () => {
  harness = await createHarness({ suiteName: "generic-auto-refresh" });
});

after(async () => {
  await harness?.dispose();
});

test("auto-refresh dropdown defaults to disabled (0) and persists a selected interval", async () => {
  const firstSession = await harness.openSession();
  try {
    const select = await firstSession.$('[name="auto_refresh_hours"]');
    await select.waitForDisplayed({ timeout: 15_000 });
    const initialValue = await select.getValue();
    assert.equal(initialValue, "0", "auto_refresh_hours should default to 0 (disabled)");

    await select.selectByVisibleText("Every 4 hours");
    await clickButton(firstSession, 'button[type="submit"]');
    await waitForElementText(firstSession, "#settings-save-feedback", "Settings saved.");
  } finally {
    await harness.closeSession(firstSession);
  }

  const secondSession = await harness.openSession();
  try {
    const select = await secondSession.$('[name="auto_refresh_hours"]');
    await select.waitForDisplayed({ timeout: 15_000 });
    const value = await select.getValue();
    assert.equal(value, "4", "auto_refresh_hours should persist as 4");
  } finally {
    await harness.closeSession(secondSession);
  }
});

test("fetch-on-startup checkbox defaults to unchecked and persists checked state", async () => {
  const firstSession = await harness.openSession();
  try {
    const checkbox = await firstSession.$('[name="fetch_on_startup"]');
    await checkbox.waitForDisplayed({ timeout: 15_000 });
    const initiallyChecked = await checkbox.isSelected();
    assert.equal(initiallyChecked, false, "fetch_on_startup should default to unchecked");

    await checkbox.click();
    assert.equal(await checkbox.isSelected(), true, "clicking checkbox should check it");

    await clickButton(firstSession, 'button[type="submit"]');
    await waitForElementText(firstSession, "#settings-save-feedback", "Settings saved.");
  } finally {
    await harness.closeSession(firstSession);
  }

  const secondSession = await harness.openSession();
  try {
    const checkbox = await secondSession.$('[name="fetch_on_startup"]');
    await checkbox.waitForDisplayed({ timeout: 15_000 });
    const isChecked = await checkbox.isSelected();
    assert.equal(isChecked, true, "fetch_on_startup should persist as checked");
  } finally {
    await harness.closeSession(secondSession);
  }
});
