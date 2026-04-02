import { describe, expect, it } from "vitest";

import { createAppShell } from "./app-shell";

describe("createAppShell", () => {
  it("renders the Phase 7 status shell for fliptrix", () => {
    const shell = createAppShell();

    expect(shell).toContain("fliptrix");
    expect(shell).toContain("Phase 7");
    expect(shell).toContain("Settings UI");
  });

  it("lists Phase 7 features", () => {
    const shell = createAppShell();

    expect(shell).toContain("Settings window");
    expect(shell).toContain("Mode selection");
    expect(shell).toContain("Autostart");
    expect(shell).toContain("tauri-plugin-store");
  });

  it("includes autostart and mode switching milestones", () => {
    const shell = createAppShell();

    expect(shell).toContain("FlipFlap");
    expect(shell).toContain("Matrix");
    expect(shell).toContain("X API");
  });

  it("shows lifecycle and data status indicators", () => {
    const shell = createAppShell();

    expect(shell).toContain("lifecycle-state");
    expect(shell).toContain("Monitoring");
    expect(shell).toContain("api-status");
    expect(shell).toContain("API key");
    expect(shell).toContain("cache-status");
  });
});
