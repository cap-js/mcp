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

| Flag              | Default | Description                                                                                                                                                            |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `per_action_tool` | `false` | Expose each action/function as its own dedicated tool instead of the generic `call` tool.                                                                       |
| `toon_format`     | `true`  | Return query results in [TOON](https://www.npmjs.com/package/@toon-format/toon) format. Set to `false` to use JSON instead.                                            |
| `prefix`          | `false` | Prefix tool names with the slugified service name to avoid collisions when a MCP client connects to multiple MCP servers (e.g. `catalog_query`, `admin_describe`).     |
| `format`          | `"cqn"` | Experimental: Change the `query` input format. `"cqn"` (default) uses structured CQN input. `"cql"` switches the `query` tool to accept a plain SQL `SELECT` statement |

For all other configuration options, refer to the official [documentation](https://cap.cloud.sap/docs/guides/protocols/mcp).

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
