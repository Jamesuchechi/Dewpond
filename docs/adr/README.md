# Architecture Decision Records (Index)

All v1 architectural decisions and falsification evidence are summarized in [`ARCHITECTURE.md §15`](../../ARCHITECTURE.md#15-architecture-decision-records-summary) and [`docs/spikes/00-falsification-report.md`](../spikes/00-falsification-report.md).

| ADR | Decision | Status | Source |
|---|---|---|---|
| ADR-001 | Recipe of typed steps is source of truth; SQL is derived | Accepted | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| ADR-002 | Sample-5k strict text scoring + single-pass `all_varchar` + `try_cast` | Accepted | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
| ADR-003 | Single-threaded `eh`/`mvp` DuckDB-WASM only (no COI/pthreads for v1) | Accepted | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
| ADR-004 | Serialized DuckDB worker + one `fflate`/PII compute worker (`blob:`-wrapped) | Accepted | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
| ADR-005 | `blob:`-worker CSP + self-hosted SHA-256 bundles + 60s DevTools audit | Accepted | [`audit.md`](../audit.md) |
| ADR-006 | TanStack Virtual DOM grid over cached 500-row Arrow pages | Accepted | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| ADR-007 | Views by default; checkpoint tables on cost/depth/pressure | Accepted | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| ADR-008 | Share-safe `#r=` URL fragment Recipes; `rawSql` requires review; `sqlkit` allowlist | Accepted | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| ADR-009 | Streaming `fflate` + chunked XML XLSX reader (warn > 25 MB, cap 50 MB) | Accepted | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
| ADR-010 | Pin `@duckdb/duckdb-wasm@1.32.0`; `:memory:` DB + IndexedDB + Arrow IPC OPFS snapshots | Accepted | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
| ADR-011 | Cell/row editing (`setCell`/`insertRows`) deferred to Post-v1 | Deferred | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
| ADR-012 | `.duckdb` `ATTACH`/export & SQLite deferred to Post-v1 | Deferred | [`00-falsification-report.md`](../spikes/00-falsification-report.md) |
