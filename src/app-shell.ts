export function createAppShell(): string {
  return `
    <section class="shell">
      <p class="eyebrow">Phase 7</p>
      <h1>fliptrix</h1>
      <p class="lead">Settings UI, autostart, and mode switching.</p>
      <div class="panel">
        <h2>Status</h2>
        <p class="lifecycle-state">Lifecycle: <strong>Monitoring</strong></p>
        <p class="api-status">API key: <strong>Not configured</strong></p>
        <p class="cache-status">Cache: <strong>Empty</strong></p>
      </div>
      <div class="panel">
        <h2>Phase 7 features</h2>
        <ul>
          <li>Settings window with all renderer and general options</li>
          <li>Mode selection: FlipFlap, Matrix, or Both (auto-switch)</li>
          <li>Autostart on login (Linux .desktop / Windows Startup batch)</li>
          <li>X API bearer token management and post refresh</li>
          <li>Settings persisted across restarts via tauri-plugin-store</li>
        </ul>
      </div>
    </section>
  `;
}
