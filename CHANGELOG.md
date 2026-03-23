# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](https://keepachangelog.com/).
- This project adheres to [Semantic Versioning](https://semver.org/).

## Version 0.0.9 - 2026-03-23

### Added
- Support for `{ ref: [...], as: "alias" }` in select clause for explicit path expressions with optional alias
- Support for `{ ref: [...], expand: [...] }` in select clause for expanding to-many associations as nested arrays
- Wildcard expand support (`"*"`) to expand all fields of an association
- Auto-detect JSON vs SSE response format from the client's `Accept` header — no more need to send both `application/json` and `text/event-stream`

### Changed
- Log output now uses multi-line formatting with colored values for better readability
- Moved feature flags from `cds.features` to `cds.mcp` namespace

### Removed
- `per_entity_tool` feature flag and per-entity tool mode
- `json_response` feature flag (replaced by `Accept` header auto-detection)
- Auto-wiring support for Cline MCP client

### Fixed
- `Accept` header handling: clients can now send only `Accept: application/json` or only `Accept: text/event-stream` without getting a 406 error

## Version 0.0.8 - 2026-03-10

### Added
- Everything ;) First changelog entry, will be updated as we go.
