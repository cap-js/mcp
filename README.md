# About this project

This is a protocol adapter for the MCP protocol to expose CAP services for agent consumption. For more information, check the official [documentation](https://cap.cloud.sap/docs/guides/protocols/mcp).

## Requirements and Setup

We use the @capire/bookshop as a running sample hereinafter. Clone it and open it in VSCode as follows:

```bash
git clone https://github.com/capire/bookshop
code bookshop
```

## Feature Flags

All configuration lives under `cds.mcp` in your `package.json`:

```json
{
  "cds": {
    "mcp": {
      "per_action_tool": false,
      "toon_format": true
    }
  }
}
```

| Flag              | Default | Description                                                                                                                                                        |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `per_action_tool` | `false` | Expose each action/function as its own dedicated tool instead of the generic `call_action` tool.                                                                   |
| `toon_format`     | `true`  | Return query results in [TOON](https://www.npmjs.com/package/@toon-format/toon) format. Set to `false` to use JSON instead.                                        |
| `prefix`          | `false` | Prefix tool names with the slugified service name to avoid collisions when a MCP client connects to multiple MCP servers (e.g. `catalog_query`, `admin_describe`). |
| `format`          | `"sql"` | Query format mode. `"cqn"` uses CQN objects; `"sql"` accepts SQL strings and returns CDS definitions. See below.                                                   |

For all other configuration options, refer to the official [documentation](https://cap.cloud.sap/docs/guides/protocols/mcp).

## SQL Format Mode

Set `format: "cqn"` to switch the `query` and `describe` tools to CQN mode to disable SQL format:

```json
{
  "cds": {
    "mcp": {
      "format": "cqn"
    }
  }
}
```

**Benefits:**

- **Lower token consumption** — SQL is more compact than CQN JSON objects, reducing input/output tokens per tool call
- **Easier for LLMs** — LLMs are pretrained on SQL and generate it more reliably than CQN's custom JSON structure

**Behavior changes:**

| Tool       | `"cqn"`                                             | `"sql"` (default)                                           |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `describe` | Returns JSON with element types, keys, associations | Returns **CDS source** (CDL) via `cds.compile.to.cdl`       |
| `query`    | Accepts CQN object (`entity`, `where`, `select`, …) | Accepts a **SQL SELECT string**, parsed via `cds.parse.cql` |

The `query` tool in SQL mode only allows SELECT statements. The response includes a `count` field reflecting the **total** matching rows (via `$count`), independent of any LIMIT clause — useful for pagination awareness.

## Custom Server Instructions

You can customize the MCP server instructions sent to agents during initialization using the `@mcp.instructions` annotation:

```cds
annotate MyService with @mcp.instructions: 'Use describe to explore the product catalog. Use query to search products by name or category.';
```

If not set, a default instruction is used. The annotation also supports i18n references (`{i18n>key}`).

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/mcp/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure

If you find any bug that may be a security problem, please follow the instructions found [in our security policy](https://github.com/cap-js/mcp/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/cap-js/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2026 SAP SE or an SAP affiliate company and cap-js/mcp contributors. Please see our [LICENSE](./LICENSES/Apache-2.0.txt) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/mcp).
