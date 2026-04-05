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
    invokeMock.mockResolvedValue(undefined);
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
    const topFeedback = root.querySelector<HTMLElement>("#settings-feedback");
    const saveFeedback = root.querySelector<HTMLElement>("#settings-save-feedback");
    if (!form || !topFeedback || !saveFeedback) throw new Error("missing save form controls");

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

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
});
