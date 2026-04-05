import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";
import { clickButton, setFieldValue, waitForElementText } from "../support/ui.mjs";

let harness;

before(async () => {
  harness = await createHarness({
    suiteName: "generic-refresh",
    withFixtureServer: true,
  });
});

after(async () => {
  await harness?.dispose();
});

test("refreshes posts and writes per-mode cache files", async () => {
  const browser = await harness.openSession();
  try {
    await setFieldValue(browser, '[name="matrix_search_query"]', "matrix-e2e-query");
    await setFieldValue(browser, '[name="flipflap_search_query"]', "flipflap-e2e-query");

    await setFieldValue(browser, "#bearer-token-input", "e2e-token");
    await clickButton(browser, "#save-api-key-btn");
    await waitForElementText(browser, "#api-key-status", "token saved");

    await clickButton(browser, 'button[type="submit"]');
    await waitForElementText(browser, "#settings-feedback", "Settings saved.");

    await clickButton(browser, "#refresh-posts-btn");
    await waitForElementText(browser, "#refresh-status", "Posts refreshed.", 25_000);
  } finally {
    await harness.closeSession(browser);
  }

  const matrixCachePath = join(harness.dirs.appDataDir, "posts_matrix.json");
  const flipflapCachePath = join(harness.dirs.appDataDir, "posts_flipflap.json");

  const [matrixRaw, flipflapRaw] = await Promise.all([
    readFile(matrixCachePath, "utf8"),
    readFile(flipflapCachePath, "utf8"),
  ]);

  const matrixCache = JSON.parse(matrixRaw);
  const flipflapCache = JSON.parse(flipflapRaw);

  assert.ok(Array.isArray(matrixCache.posts));
  assert.ok(Array.isArray(flipflapCache.posts));
  assert.ok(matrixCache.posts.length > 0);
  assert.ok(flipflapCache.posts.length > 0);

  assert.match(matrixCache.posts[0].text, /matrix-e2e-query/i);
  assert.match(flipflapCache.posts[0].text, /flipflap-e2e-query/i);
});
