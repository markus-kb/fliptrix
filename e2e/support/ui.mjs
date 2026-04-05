import { waitFor } from "./runtime.mjs";

export async function setFieldValue(browser, selector, value) {
  const field = await browser.$(selector);
  await field.waitForDisplayed({ timeout: 15_000 });
  await field.clearValue();
  await field.setValue(String(value));
}

export async function clickButton(browser, selector) {
  const button = await browser.$(selector);
  await button.waitForEnabled({ timeout: 15_000 });
  await button.click();
}

export async function waitForElementText(browser, selector, expectedSubstring, timeoutMs = 15_000) {
  const element = await browser.$(selector);
  await waitFor(
    async () => {
      const text = await element.getText();
      return text.includes(expectedSubstring);
    },
    {
      timeoutMs,
      errorMessage: `Timed out waiting for '${expectedSubstring}' in ${selector}`,
    },
  );
}

export async function waitForWindowCount(browser, expected, timeoutMs = 15_000) {
  await waitFor(
    async () => {
      const handles = await browser.getWindowHandles();
      return handles.length === expected;
    },
    {
      timeoutMs,
      errorMessage: `Timed out waiting for ${expected} window(s)`,
    },
  );
}

export async function findWindowHandleWithSelector(browser, selector, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const handles = await browser.getWindowHandles();

    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        const element = await browser.$(selector);
        if (await element.isExisting()) {
          return handle;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("no such window") || error.message.includes("invalid session id"))
        ) {
          continue;
        }
        throw error;
      }
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }

  throw new Error(`Could not find a window containing selector ${selector}`);
}

export async function waitForNoWindowWithSelector(browser, selector, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const handles = await browser.getWindowHandles();
    let found = false;

    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        const element = await browser.$(selector);
        if (await element.isExisting()) {
          found = true;
          break;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("no such window") || error.message.includes("invalid session id"))
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!found) {
      return;
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }

  throw new Error(`Selector ${selector} still found in at least one window`);
}

export async function moveMouseBeyondDeadZone(browser) {
  await browser.performActions([
    {
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, x: 20, y: 20, origin: "viewport" },
        { type: "pause", duration: 50 },
        { type: "pointerMove", duration: 0, x: 220, y: 220, origin: "viewport" },
      ],
    },
  ]);
  try {
    await browser.releaseActions();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("no such window") || error.message.includes("invalid session id"))
    ) {
      return;
    }
    throw error;
  }
}
