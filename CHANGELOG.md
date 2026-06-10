# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](https://keepachangelog.com/).
- This project adheres to [Semantic Versioning](https://semver.org/).

## Version 1.0.1 - 2026-06-10

### Added
- Support `@mcp.instructions` annotation to customize MCP server instructions per service
- `offset` parameter to the `query` tool for stable pagination (CQN `limit.offset`)
- Support for CDS 8
- Portable standard functions in expressions for strings, numbers, date/time
- Arithmetic operators (`+`, `-`, `*`, `/`) and computed columns via `{ xpr: [...], as: "alias" }`
- `is null` / `is not null`, `not in`, `not like`, `exists` / `not exists` keywords in where clauses
- Infix filters on ref segments for filtered association navigation (e.g., `books[stock > 100]`)
- `having` clause for filtering grouped results
- `search` clause for full-text search across multiple fields
- Support in per-action tool schemas and describe output: `enum`, `@assert.range`, `@assert.format`, `@mandatory`
- Support for `{ ref: [...], as: "alias" }` in select clause for explicit path expressions with optional alias
- Support for `{ ref: [...], expand: [...] }` in select clause for expanding to-many associations as nested arrays
- Wildcard expand support (`"*"`) to expand all fields of an association
- Auto-detect JSON vs SSE response format from the client's `Accept` header

### Changed
- Adjust MCP server card generation to allow URI reference
- Rely on runtime behaviour for `@cds.query.limit`
- Log output now uses multi-line formatting with colored values for better readability
- Moved feature flags from `cds.features` to `cds.mcp` namespace
