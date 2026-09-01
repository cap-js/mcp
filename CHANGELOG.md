# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](https://keepachangelog.com/).
- This project adheres to [Semantic Versioning](https://semver.org/).

## Version 1.4.4 - tbd

### Changed

- Skip `describe` tool when `per_action_tool` is enabled and the service exposes only actions/functions (no entities)

## Version 1.4.3 - 2026-08-14

### Fixed

- Correctly access target name when executing generic read CQL with infix filters

## Version 1.4.2 - 2026-08-13

### Fixed

- Use `format: cql` as default if the `cds.mcp.format` option is not applied
- Entities from MCP-enabled services are not shown on index page
- Entity `@requires` and action `@restrict` annotations are now respected when filtering tool context

### Removed

- Removed the `toon_format` flag, toon is now always the output format

## Version 1.4.1 - 2026-08-07

### Changed

- Clarified server instructions and `query` tool description to emphasize using `describe` before querying
- `query` tool response no longer echoes the executed CQL string

## Version 1.4.0 - 2026-08-03

### Changed

- Migrated from `@modelcontextprotocol/sdk` to the new split packages `@modelcontextprotocol/server` and `@modelcontextprotocol/node` (SDK 2.0.0)
- Default mode for the `query` tool changed to CQL

### Fixed

- Set tool prefix as optional parameter

## Version 1.3.0 - 2026-07-31

### Changed

- Renamed the `call_action` tool to `call`
- `cds.mcp.prefix` now creates a prefix from the full service name
- Experimental SQL input for the `query` tool changed to CQL

## Version 1.2.0 - 2026-07-21

### Added

- Experimental SQL input for the `query` tool

## Version 1.1.1 - 2026-07-08

### Fixed

- Errors with details from actions are now properly returned
- CDS 10 compatibility

## Version 1.1.0 - 2026-06-16

### Added

- Optional `log` option `lib/tools.js` to route tool-execution and registration logs through a custom `cds.log` instance
- Optional tool name prefix (via `cds.mcp.prefix: true`) to avoid possible collisions when clients connect to multiple CAP MCP servers

## Version 1.0.4 - 2026-06-15

### Added

- Allow CDS session variables `$now`, `$user`, `$user.id`, `$user.locale`, `$user.tenant` in where clauses

### Fixed

- Resolving of many action parameters in `describe` output
- Resolving of complex type action parameters in `describe` output

## Version 1.0.3 - 2026-06-11

### Removed

- Hard-coded log level for sql and cds

## Version 1.0.2 - 2026-06-10

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
