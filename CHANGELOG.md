# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](https://keepachangelog.com/).
- This project adheres to [Semantic Versioning](https://semver.org/).

## Version 0.0.16 - 2026-06-03

### Added
- Add `offset` parameter to the `query` tool for stable pagination (CQN `limit.offset`)

## Version 0.0.15 - 2026-05-18

### Fixed
- Remove strict UUID input validation to allow HANA UUIDs 

## Version 0.0.14 - 2026-05-13

### Fixed
- MCP endpoints take extended cds model into consideration not only base model

## Version 0.0.13 - 2026-05-12

### Fixed
- Actions with `many` parameters now properly work
- Custom types in actions work properly

## Version 0.0.12 - 2026-05-05

### Added
- Support for CDS 8

### Fixed
- Doc comments available in production builds

## Version 0.0.11 - 2026-04-22

### Added

### Changed
- Adjust MCP server card generation to allow URI reference
- Rely on runtime behaviour for `@cds.query.limit`

### Removed
- Custom MCP default limit of 20

### Fixed
- Query limits output in `describe` tool
- `@assert.range` in `describe` output for tool schemas correctly supports all cases now

## Version 0.0.10 - 2026-03-30

### Added
- Portable standard functions in expressions for strings, numbers, date/time
- Arithmetic operators (`+`, `-`, `*`, `/`) and computed columns via `{ xpr: [...], as: "alias" }`
- `is null` / `is not null`, `not in`, `not like`, `exists` / `not exists` keywords in where clauses
- Infix filters on ref segments for filtered association navigation (e.g., `books[stock > 100]`)
- `having` clause for filtering grouped results
- `search` clause for full-text search across multiple fields
- Support in per-action tool schemas and describe output: `enum`, `@assert.range`, `@assert.format`, `@mandatory`

### Fixed
- Resolve description for tool schemas and describe output consistently

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
