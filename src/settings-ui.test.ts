// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "./settings";

const {
  invokeMock,
  getSettingsMock,
  getAutostartEnabledMock,
  openLogsDirectoryMock,
  saveSettingsMock,
  setAutostartEnabledMock,
  logDebugMock,
  logErrorMock,
  logInfoMock,
  logWarnMock,
  setFrontendDebugLoggingMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getSettingsMock: vi.fn<() => Promise<AppSettings>>(),
  getAutostartEnabledMock: vi.fn<() => Promise<boolean>>(),
  openLogsDirectoryMock: vi.fn<() => Promise<string>>(),
  saveSettingsMock: vi.fn<(settings: AppSettings) => Promise<void>>(),
  setAutostartEnabledMock: vi.fn<(enabled: boolean, exePath: string) => Promise<void>>(),
  logDebugMock: vi.fn(),
  logErrorMock: vi.fn(),
  logInfoMock: vi.fn(),
  logWarnMock: vi.fn(),
  setFrontendDebugLoggingMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("./settings", async () => {
  const actual = await vi.importActual<typeof import("./settings")>("./settings");
  return {
    ...actual,
    getSettings: getSettingsMock,
    getAutostartEnabled: getAutostartEnabledMock,
    openLogsDirectory: openLogsDirectoryMock,
    saveSettings: saveSettingsMock,
    setAutostartEnabled: setAutostartEnabledMock,
  };
});

vi.mock("./logger", () => ({
  logDebug: logDebugMock,
  logError: logErrorMock,
  logInfo: logInfoMock,
  logWarn: logWarnMock,
  setFrontendDebugLogging: setFrontendDebugLoggingMock,
}));

import { cloneDefaultSettings } from "./settings";
import { formatAccountsField, initSettingsUi, parseAccountsField } from "./settings-ui";

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("parseAccountsField", () => {
  it("trims whitespace, strips leading @, and drops empty lines", () => {
    expect(parseAccountsField("  @alice\n\nbob  \n @carol ")).toEqual(["alice", "bob", "carol"]);
  });
});

describe("formatAccountsField", () => {
  it("joins accounts onto separate lines", () => {
    expect(formatAccountsField(["alice", "bob"])).toBe("alice\nbob");
  });
});

describe("initSettingsUi", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    invokeMock.mockReset();
    getSettingsMock.mockReset();
    getAutostartEnabledMock.mockReset();
    saveSettingsMock.mockReset();
    setAutostartEnabledMock.mockReset();
    openLogsDirectoryMock.mockReset();
    logDebugMock.mockReset();
    logErrorMock.mockReset();
    logInfoMock.mockReset();
    logWarnMock.mockReset();
    setFrontendDebugLoggingMock.mockReset();

    getSettingsMock.mockResolvedValue(cloneDefaultSettings());
    getAutostartEnabledMock.mockResolvedValue(false);
    openLogsDirectoryMock.mockResolvedValue("/tmp/fliptrix/logs");
    saveSettingsMock.mockResolvedValue();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_api_key_status") {
        return false;
      }

      if (command === "get_cached_posts") {
        const mode = (args as { mode?: string } | undefined)?.mode;
        if (mode === "flipflap") {
          return {
            fetched_at: "2026-04-05T09:00:00Z",
            posts: [],
          };
        }

        return {
          fetched_at: "2026-04-05T10:00:00Z",
          posts: [],
        };
      }

      return undefined;
    });
  });

  it("renders cache totals and per-mode post metadata", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_api_key_status") {
        return true;
      }

      if (command === "get_cached_posts") {
        const mode = (args as { mode?: string } | undefined)?.mode;
        if (mode === "flipflap") {
          return {
            fetched_at: "2026-04-05T09:30:00Z",
            posts: [
              {
                id: "flip-1",
                text: "flipflap sample",
                author_username: "alice",
                created_at: "2026-04-05T09:20:00Z",
              },
            ],
          };
        }

        return {
          fetched_at: "2026-04-05T10:45:00Z",
          posts: [
            {
              id: "matrix-1",
              text: "matrix sample one",
              author_username: "bob",
              created_at: "2026-04-05T10:10:00Z",
            },
            {
              id: "matrix-2",
              text: "matrix sample two",
              author_username: "carol",
              created_at: "2026-04-05T10:20:00Z",
            },
          ],
        };
      }

      return undefined;
    });

    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);
    await flushUi();

    const summary = root.querySelector<HTMLElement>("#cache-overview-summary");
    const flipMeta = root.querySelector<HTMLElement>("#cache-meta-flipflap");
    const matrixMeta = root.querySelector<HTMLElement>("#cache-meta-matrix");
    const flipList = root.querySelector<HTMLElement>("#cache-list-flipflap");
    const matrixList = root.querySelector<HTMLElement>("#cache-list-matrix");

    expect(summary?.textContent).toContain("Total cached posts: 3");
    expect(flipMeta?.textContent).toContain("FlipFlap cache: 1 post");
    expect(matrixMeta?.textContent).toContain("Matrix cache: 2 posts");

    expect(flipList?.textContent).toContain("@alice");
    expect(flipList?.textContent).toContain("2026");

    expect(matrixList?.textContent).toContain("@bob");
    expect(matrixList?.textContent).toContain("@carol");
    expect(matrixList?.textContent).toContain("2026");
  });

  it("refresh updates cache summary and post list", async () => {
    let cacheVersion = 0;

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_api_key_status") {
        return true;
      }

      if (command === "fetch_posts") {
        cacheVersion = 1;
        return [];
      }

      if (command === "get_cached_posts") {
        const mode = (args as { mode?: string } | undefined)?.mode;
        if (cacheVersion === 0) {
          return {
            fetched_at: "2026-04-05T09:00:00Z",
            posts: [],
          };
        }

        if (mode === "flipflap") {
          return {
            fetched_at: "2026-04-05T09:30:00Z",
            posts: [
              {
                id: "flip-1",
                text: "flip refreshed",
                author_username: "refreshflip",
                created_at: "2026-04-05T09:20:00Z",
              },
            ],
          };
        }

        return {
          fetched_at: "2026-04-05T10:30:00Z",
          posts: [
            {
              id: "matrix-1",
              text: "matrix refreshed",
              author_username: "refreshmatrix",
              created_at: "2026-04-05T10:20:00Z",
            },
          ],
        };
      }

      return undefined;
    });

    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);
    await flushUi();

    const refreshBtn = root.querySelector<HTMLButtonElement>("#refresh-posts-btn");
    if (!refreshBtn) throw new Error("missing refresh button");

    refreshBtn.click();
    await flushUi();

    const summary = root.querySelector<HTMLElement>("#cache-overview-summary");
    const flipList = root.querySelector<HTMLElement>("#cache-list-flipflap");
    const matrixList = root.querySelector<HTMLElement>("#cache-list-matrix");

    expect(summary?.textContent).toContain("Total cached posts: 2");
    expect(flipList?.textContent).toContain("@refreshflip");
    expect(matrixList?.textContent).toContain("@refreshmatrix");
  });

  it("renders immediate test buttons for each mode", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    expect(root.querySelector("#test-matrix-btn")?.textContent).toContain("Test Matrix now");
    expect(root.querySelector("#test-flipflap-btn")?.textContent).toContain("Test FlipFlap now");
    expect(root.querySelector("#test-both-btn")?.textContent).toContain("Test Both now");
  });

  it("renders diagnostics controls", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    expect(root.querySelector("#debug-logging-checkbox")).not.toBeNull();
    expect(root.querySelector("#open-logs-btn")?.textContent).toContain("Open logs folder");
  });

  it("renders flipflap background controls", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const select = root.querySelector<HTMLSelectElement>('[name="flipflap_background_image"]');
    const animationCheckbox = root.querySelector<HTMLInputElement>(
      '[name="flipflap_background_animation_enabled"]',
    );
    const speedRange = root.querySelector<HTMLInputElement>(
      '[name="flipflap_background_pulse_speed"]',
    );

    if (!select || !animationCheckbox || !speedRange) {
      throw new Error("missing background controls");
    }

    const optionValues = [...select.options].map((option) => option.value);
    expect(optionValues).toContain("");
    expect(optionValues).toContain("airport1.jpg");
    expect(optionValues).toContain("airport2.jpg");
    expect(animationCheckbox.checked).toBe(true);
    expect(speedRange.value).toBe("1");
  });

  it("updates the volume output without changing the pulse output", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const volumeRange = root.querySelector<HTMLInputElement>('[name="flipflap_volume"]');
    const volumeOutput = root.querySelector<HTMLOutputElement>('output[for="flipflap_volume"]');
    const pulseOutput = root.querySelector<HTMLOutputElement>("#flipflap-bg-pulse-speed-output");

    if (!volumeRange || !volumeOutput || !pulseOutput) {
      throw new Error("missing range outputs");
    }

    expect(volumeOutput.textContent).toBe("0.60");
    expect(pulseOutput.textContent).toBe("1.0");

    volumeRange.value = "0.35";
    volumeRange.dispatchEvent(new Event("input", { bubbles: true }));

    expect(volumeOutput.textContent).toBe("0.35");
    expect(pulseOutput.textContent).toBe("1.0");
  });

  it("displays the build hash in the settings header", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_build_info") {
        return "abc1234";
      }
      return undefined;
    });
    getSettingsMock.mockResolvedValue({
      ...cloneDefaultSettings(),
      flipflap_volume: 0.35,
      flipflap_background_pulse_speed: 1.7,
    });

    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const resetBtn = root.querySelector<HTMLButtonElement>("#reset-btn");
    const volumeOutput = root.querySelector<HTMLOutputElement>('output[for="flipflap_volume"]');
    const pulseOutput = root.querySelector<HTMLOutputElement>("#flipflap-bg-pulse-speed-output");

    if (!resetBtn || !volumeOutput || !pulseOutput) {
      throw new Error("missing reset controls");
    }

    expect(volumeOutput.textContent).toBe("0.35");
    expect(pulseOutput.textContent).toBe("1.7");

    resetBtn.click();

    expect(volumeOutput.textContent).toBe("0.60");
    expect(pulseOutput.textContent).toBe("1.0");
  });

  it("defaults renderer tabs to FlipFlap", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const flipTab = root.querySelector<HTMLButtonElement>("#renderer-tab-flipflap");
    const matrixTab = root.querySelector<HTMLButtonElement>("#renderer-tab-matrix");
    const flipPanel = root.querySelector<HTMLElement>("#renderer-tab-panel-flipflap");
    const matrixPanel = root.querySelector<HTMLElement>("#renderer-tab-panel-matrix");
    if (!flipTab || !matrixTab || !flipPanel || !matrixPanel) {
      throw new Error("missing renderer tab controls");
    }

    expect(flipTab.getAttribute("aria-selected")).toBe("true");
    expect(matrixTab.getAttribute("aria-selected")).toBe("false");
    expect(flipPanel.hidden).toBe(false);
    expect(matrixPanel.hidden).toBe(true);
  });

  it("switches renderer tab content to Matrix", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const flipTab = root.querySelector<HTMLButtonElement>("#renderer-tab-flipflap");
    const matrixTab = root.querySelector<HTMLButtonElement>("#renderer-tab-matrix");
    const flipPanel = root.querySelector<HTMLElement>("#renderer-tab-panel-flipflap");
    const matrixPanel = root.querySelector<HTMLElement>("#renderer-tab-panel-matrix");
    if (!flipTab || !matrixTab || !flipPanel || !matrixPanel) {
      throw new Error("missing renderer tab controls");
    }

    matrixTab.click();

    expect(flipTab.getAttribute("aria-selected")).toBe("false");
    expect(matrixTab.getAttribute("aria-selected")).toBe("true");
    expect(flipPanel.hidden).toBe(true);
    expect(matrixPanel.hidden).toBe(false);
  });

  it("renders X data rows as aligned FlipFlap and Matrix columns", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const xDataPanel = Array.from(root.querySelectorAll<HTMLElement>("fieldset.panel")).find(
      (panel) => panel.querySelector("legend")?.textContent?.trim() === "X data",
    );
    if (!xDataPanel) throw new Error("missing x data panel");

    const rows = xDataPanel.querySelectorAll<HTMLElement>(".field-row");
    expect(rows).toHaveLength(4);

    const labelsForRow = (row: Element): string[] =>
      Array.from(
        row.querySelectorAll<HTMLElement>(".field-label"),
        (label) => label.textContent?.trim() ?? "",
      );

    expect(labelsForRow(rows[0])).toEqual(["FlipFlap accounts", "Matrix accounts"]);
    expect(labelsForRow(rows[1])).toEqual(["FlipFlap search query", "Matrix search query"]);
    expect(labelsForRow(rows[2])).toEqual([
      "FlipFlap time window (hours)",
      "Matrix time window (hours)",
    ]);
    expect(labelsForRow(rows[3])).toEqual([
      "FlipFlap truncation (chars)",
      "Matrix truncation (chars)",
    ]);
  });

  it("X data left column is always FlipFlap, right column is always Matrix", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const xDataPanel = Array.from(root.querySelectorAll<HTMLElement>("fieldset.panel")).find(
      (panel) => panel.querySelector("legend")?.textContent?.trim() === "X data",
    );
    if (!xDataPanel) throw new Error("missing x data panel");

    const rows = xDataPanel.querySelectorAll<HTMLElement>(".field-row");
    for (const row of rows) {
      const fields = row.querySelectorAll<HTMLElement>(".field");
      expect(fields).toHaveLength(2);

      const leftLabel =
        fields[0].querySelector<HTMLElement>(".field-label")?.textContent?.trim() ?? "";
      const rightLabel =
        fields[1].querySelector<HTMLElement>(".field-label")?.textContent?.trim() ?? "";

      expect(leftLabel).toContain("FlipFlap");
      expect(rightLabel).toContain("Matrix");
    }
  });

  it("X data two-column fields are never unpaired in a field-row", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const xDataPanel = Array.from(root.querySelectorAll<HTMLElement>("fieldset.panel")).find(
      (panel) => panel.querySelector("legend")?.textContent?.trim() === "X data",
    );
    if (!xDataPanel) throw new Error("missing x data panel");

    const rows = xDataPanel.querySelectorAll<HTMLElement>(".field-row");

    // Every field-row must have exactly 2 children — no unpaired fields
    for (const row of rows) {
      expect(row.querySelectorAll<HTMLElement>(".field")).toHaveLength(2);
    }

    // Total two-column field-labels must be even (8 = 4 rows × 2)
    const twoColumnLabels = xDataPanel.querySelectorAll<HTMLElement>(".field-row .field-label");
    expect(twoColumnLabels.length % 2).toBe(0);
  });

  it("shows save confirmation near action buttons", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const form = root.querySelector<HTMLFormElement>("#settings-form");
    const select = root.querySelector<HTMLSelectElement>('[name="flipflap_background_image"]');
    const animationCheckbox = root.querySelector<HTMLInputElement>(
      '[name="flipflap_background_animation_enabled"]',
    );
    const speedRange = root.querySelector<HTMLInputElement>(
      '[name="flipflap_background_pulse_speed"]',
    );

    if (!form || !select || !animationCheckbox || !speedRange) {
      throw new Error("missing save controls");
    }

    select.value = "airport1.jpg";
    animationCheckbox.checked = false;
    speedRange.value = "1.7";

    const topFeedback = root.querySelector<HTMLElement>("#settings-feedback");
    const saveFeedback = root.querySelector<HTMLElement>("#settings-save-feedback");
    if (!form || !topFeedback || !saveFeedback) throw new Error("missing save form controls");

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        flipflap_background_image: "airport1.jpg",
        flipflap_background_animation_enabled: false,
        flipflap_background_pulse_speed: 1.7,
      }),
    );

    expect(saveSettingsMock).toHaveBeenCalled();
    expect(saveFeedback.hidden).toBe(false);
    expect(saveFeedback.textContent).toContain("Settings saved.");
    expect(topFeedback.hidden).toBe(true);
  });

  it("saves matrix mode and activates the screensaver when testing Matrix", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const modeSelect = root.querySelector<HTMLSelectElement>('select[name="mode"]');
    const button = root.querySelector<HTMLButtonElement>("#test-matrix-btn");
    if (!modeSelect || !button) throw new Error("missing preview controls");

    modeSelect.value = "flip_flap";
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "matrix",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("activate_screensaver");
    expect(modeSelect.value).toBe("matrix");
  });

  it("saves both mode and activates the screensaver when testing Both", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const button = root.querySelector<HTMLButtonElement>("#test-both-btn");
    if (!button) throw new Error("missing both preview button");

    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "both",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("activate_screensaver");
  });

  it("opens logs folder from diagnostics button", async () => {
    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const button = root.querySelector<HTMLButtonElement>("#open-logs-btn");
    if (!button) throw new Error("missing open logs button");

    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(openLogsDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it("displays the build hash in the settings header", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_build_info") {
        return "abc1234";
      }
      return undefined;
    });
    getSettingsMock.mockResolvedValue(cloneDefaultSettings());
    getAutostartEnabledMock.mockResolvedValue(false);

    const root = document.querySelector<HTMLElement>("#root");
    if (!root) throw new Error("missing root");

    await initSettingsUi(root);

    const hashEl = root.querySelector<HTMLElement>("#build-hash");
    expect(hashEl).not.toBeNull();
    expect(hashEl?.textContent).toBe("abc1234");
  });
});
