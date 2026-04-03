// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "./settings";

const {
  invokeMock,
  getSettingsMock,
  getAutostartEnabledMock,
  saveSettingsMock,
  setAutostartEnabledMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getSettingsMock: vi.fn<() => Promise<AppSettings>>(),
  getAutostartEnabledMock: vi.fn<() => Promise<boolean>>(),
  saveSettingsMock: vi.fn<(settings: AppSettings) => Promise<void>>(),
  setAutostartEnabledMock: vi.fn<(enabled: boolean, exePath: string) => Promise<void>>(),
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
    saveSettings: saveSettingsMock,
    setAutostartEnabled: setAutostartEnabledMock,
  };
});

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

    getSettingsMock.mockResolvedValue(cloneDefaultSettings());
    getAutostartEnabledMock.mockResolvedValue(false);
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
});
