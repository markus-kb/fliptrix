import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";
import { waitFor } from "../support/runtime.mjs";
import {
  clickButton,
  findWindowHandleWithSelector,
  setFieldValue,
  waitForElementText,
  waitForNoWindowWithSelector,
} from "../support/ui.mjs";

let harness;

before(async () => {
  harness = await createHarness({
    suiteName: "generic-rendered-post-visibility",
    withFixtureServer: true,
  });
});

after(async () => {
  await harness?.dispose();
});

async function configureAndRefresh(
  browser,
  { flipflapQuery, matrixQuery, matrixRotationSecs = "1" },
) {
  await clickButton(browser, "#renderer-tab-matrix");

  await setFieldValue(browser, '[name="mouse_dead_zone_px"]', "9999");
  await setFieldValue(browser, '[name="flipflap_search_query"]', flipflapQuery);
  await setFieldValue(browser, '[name="matrix_search_query"]', matrixQuery);
  await setFieldValue(browser, '[name="matrix_post_rotation_secs"]', matrixRotationSecs);

  await setFieldValue(browser, "#bearer-token-input", "e2e-token");
  await clickButton(browser, "#save-api-key-btn");
  await waitForElementText(browser, "#api-key-status", "token saved");

  await clickButton(browser, 'button[type="submit"]');
  await waitForElementText(browser, "#settings-save-feedback", "Settings saved.");

  await clickButton(browser, "#refresh-posts-btn");
  await waitForElementText(browser, "#refresh-status", "Posts refreshed.", 25_000);
  await waitForElementText(browser, "#cache-list-flipflap", "@fixture", 15_000);
  await waitForElementText(browser, "#cache-list-matrix", "@fixture", 15_000);
}

async function waitForRenderedPostsAttribute(browser, expectedSubstring, timeoutMs = 20_000) {
  let lastSeen = "";

  await waitFor(
    async () => {
      const state = await browser.execute(() => {
        const canvas = document.querySelector("#screensaver-canvas");
        const probe = document.querySelector("#screensaver-rendered-posts");
        return {
          attr: canvas?.getAttribute("data-rendered-posts") ?? "",
          sync: canvas?.getAttribute("data-rendered-posts-sync") ?? "",
          probe: probe?.textContent ?? "",
        };
      });
      const attr = String(state?.attr ?? "");
      const sync = String(state?.sync ?? "");
      const probe = String(state?.probe ?? "");
      lastSeen = `sync='${sync}' attr='${attr}' probe='${probe}'`;
      return attr.includes(expectedSubstring) || probe.includes(expectedSubstring);
    },
    {
      timeoutMs,
      errorMessage: () =>
        `Timed out waiting for rendered post marker containing '${expectedSubstring}'. Last seen='${lastSeen}'`,
    },
  );
}

test("flipflap preview exposes rendered X post content", async () => {
  const browser = await harness.openSession();

  try {
    await configureAndRefresh(browser, {
      flipflapQuery: "ffv2e",
      matrixQuery: "matrix-unused",
    });

    await clickButton(browser, "#test-flipflap-btn");

    const screensaverHandle = await findWindowHandleWithSelector(
      browser,
      "#screensaver-canvas",
      20_000,
    );

    await browser.switchToWindow(screensaverHandle);
    await waitForRenderedPostsAttribute(browser, "ffv2e");

    const renderedPosts = await browser.execute(() => {
      const canvas = document.querySelector("#screensaver-canvas");
      return canvas?.getAttribute("data-rendered-posts") ?? "";
    });
    assert.match(String(renderedPosts), /ffv2e/i);

    await browser.keys("Escape");
    await waitForNoWindowWithSelector(browser, "#screensaver-canvas", 20_000);
  } finally {
    await harness.closeSession(browser);
  }
});

test("matrix preview exposes rendered X post packet content", async () => {
  const browser = await harness.openSession();

  try {
    await configureAndRefresh(browser, {
      flipflapQuery: "flipflap-unused",
      matrixQuery: "mxv2e",
      matrixRotationSecs: "1",
    });

    await clickButton(browser, "#test-matrix-btn");

    const screensaverHandle = await findWindowHandleWithSelector(
      browser,
      "#screensaver-canvas",
      20_000,
    );

    await browser.switchToWindow(screensaverHandle);

    const canvasClass = await browser.execute(() => {
      const canvas = document.querySelector("#screensaver-canvas");
      return canvas?.className ?? "";
    });
    assert.match(String(canvasClass), /matrix-canvas/);

    await waitForRenderedPostsAttribute(browser, "MXV2E", 25_000);

    const renderedPosts = await browser.execute(() => {
      const canvas = document.querySelector("#screensaver-canvas");
      return canvas?.getAttribute("data-rendered-posts") ?? "";
    });
    assert.match(String(renderedPosts), /MXV2E/);

    await browser.keys("Escape");
    await waitForNoWindowWithSelector(browser, "#screensaver-canvas", 20_000);
  } finally {
    await harness.closeSession(browser);
  }
});
