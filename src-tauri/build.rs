fn main() {
    // Inject the short git commit hash at compile time so the binary
    // carries a verifiable link to its source. Falls back to "dev" when
    // not building from a git checkout (e.g., tarball or CI checkout
    // without .git).
    let hash = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".into());

    println!("cargo:rustc-env=FLIPTRIX_GIT_HASH={hash}");

    // Rerun when HEAD changes so the hash stays current.
    println!("cargo:rerun-if-changed=.git/HEAD");

    tauri_build::build()
}
