import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createHarness } from "../support/harness.mjs";

let harness;

before(async () => {
  harness = await createHarness({ suiteName: "generic-renderer-layout" });
});

after(async () => {
  await harness?.dispose();
});

test("defaults renderer tab to FlipFlap and allows switching to Matrix", async () => {
  const browser = await harness.openSession();

  try {
    const flipTab = await browser.$("#renderer-tab-flipflap");
    const matrixTab = await browser.$("#renderer-tab-matrix");
    const flipPanel = await browser.$("#renderer-tab-panel-flipflap");
    const matrixPanel = await browser.$("#renderer-tab-panel-matrix");

    await flipTab.waitForDisplayed({ timeout: 15_000 });

    assert.equal(await flipTab.getAttribute("aria-selected"), "true");
    assert.equal(await matrixTab.getAttribute("aria-selected"), "false");
    assert.equal(await flipPanel.isDisplayed(), true);
    assert.equal(await matrixPanel.isDisplayed(), false);

    await matrixTab.click();

    assert.equal(await flipTab.getAttribute("aria-selected"), "false");
    assert.equal(await matrixTab.getAttribute("aria-selected"), "true");
    assert.equal(await flipPanel.isDisplayed(), false);
    assert.equal(await matrixPanel.isDisplayed(), true);
  } finally {
    await harness.closeSession(browser);
  }
});

test("aligns field-row columns on the same vertical baseline", async () => {
  const browser = await harness.openSession();

  try {
    const misalignedRows = await browser.execute(() => {
      const visibleRows = Array.from(document.querySelectorAll(".field-row")).filter((row) => {
        const style = window.getComputedStyle(row);
        return style.display !== "none" && style.visibility !== "hidden";
      });

      const rowsWithDelta = visibleRows
        .map((row, index) => {
          const fields = Array.from(row.querySelectorAll(":scope > .field"));
          if (fields.length < 2) {
            return null;
          }

          const leftTop = fields[0].getBoundingClientRect().top;
          const rightTop = fields[1].getBoundingClientRect().top;
          const delta = Math.abs(leftTop - rightTop);

          return {
            index,
            delta,
            labels: fields.map(
              (field) => field.querySelector(".field-label")?.textContent?.trim() ?? "",
            ),
          };
        })
        .filter((row) => row && row.delta > 1);

      return rowsWithDelta;
    });

    assert.equal(
      misalignedRows.length,
      0,
      `Expected all visible field rows to be top-aligned, got mismatches: ${JSON.stringify(misalignedRows)}`,
    );
  } finally {
    await harness.closeSession(browser);
  }
});
