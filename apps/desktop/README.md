# Dewpond Desktop (`@dewpond/desktop`)

Optional signed offline **Tauri v2** desktop wrapper for environments where InfoSec teams require a signed native binary instead of a browser tab.

## Security Posture

- **Zero external network access**: Enforces a strict Tauri CSP (`connect-src 'self' blob:`, `object-src 'none'`, `base-uri 'none'`).
- **Least-privilege capabilities**: `src-tauri/capabilities/default.json` grants only `core:default` (no shell execution, no arbitrary HTTP client, no background telemetry).
- **Offline assets**: Bundles `apps/web/dist` (including self-hosted DuckDB-WASM 1.32.0 binaries and extensions).

## Prerequisites

1. Rust toolchain (`rustup`, `rustc >= 1.77`, `cargo`) + OS WebView dependencies (WebKitGTK on Linux, WebView2 on Windows, Xcode CLI tools on macOS).
2. Tauri CLI (`pnpm add -D -w @tauri-apps/cli` or `cargo install tauri-cli --version "^2"`).

## Build & Run

```bash
# Development (starts Vite dev server + Tauri window at /app/)
pnpm --filter @dewpond/desktop dev

# Production bundle (builds @dewpond/web + signed/packaged native installers)
pnpm --filter @dewpond/desktop build
```

## Code Signing

- **macOS**: Set `APPLE_SIGNING_IDENTITY`, `APPLE_ID` / `APPLE_TEAM_ID`, and `APPLE_PASSWORD` (app-specific password) or `APPLE_API_ISSUER` + `APPLE_API_KEY` for notarization before running `tauri build`.
- **Windows**: Set `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_THUMBPRINT` (or configure `bundle.windows.certificateThumbprint` + `timestampUrl`) for Authenticode signing.
- **Tauri Updater Signing** (optional): Set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if distributing signed updates.
