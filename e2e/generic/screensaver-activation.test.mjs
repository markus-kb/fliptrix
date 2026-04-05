import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";
import {
  clickButton,
  findWindowHandleWithSelector,
  moveMouseBeyondDeadZone,
  pressEscape,
  waitForNoWindowWithSelector,
} from "../support/ui.mjs";

let harness;

before(async () => {
  harness = await createHarness({ suiteName: "generic-screensaver" });
});

after(async () => {
  await harness?.dispose();
});

test("preview test opens screensaver and keyboard input deactivates it", async () => {
  const browser = await harness.openSession();
  try {
    await clickButton(browser, "#test-matrix-btn");

    const screensaverHandle = await findWindowHandleWithSelector(
      browser,
      "#screensaver-canvas",
      20_000,
    );
    await browser.switchToWindow(screensaverHandle);
    await pressEscape(browser);

    await waitForNoWindowWithSelector(browser, "#screensaver-canvas", 20_000);
  } finally {
    await harness.closeSession(browser);
  }
});

test("mouse movement beyond dead-zone deactivates the screensaver", async () => {
  const browser = await harness.openSession();
  try {
    await clickButton(browser, "#test-matrix-btn");

    const screensaverHandle = await findWindowHandleWithSelector(
      browser,
      "#screensaver-canvas",
      20_000,
    );
    await browser.switchToWindow(screensaverHandle);

    await moveMouseBeyondDeadZone(browser);
    await waitForNoWindowWithSelector(browser, "#screensaver-canvas", 20_000);
  } finally {
    await harness.closeSession(browser);
  }
});
