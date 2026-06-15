# Protocol Adapter for MCP
This is a protocol adapter for the MCP protocol to expose CAP services for agent consumption. For more information, check the official [documentation](https://pages.github.tools.sap/cap/docs/guides/protocols/mcp).

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

| Flag | Default | Description |
|---|---|---|
| `per_action_tool` | `false` | Expose each action/function as its own dedicated tool instead of the generic `call_action` tool. |
| `toon_format` | `true` | Return query results in [TOON](https://www.npmjs.com/package/@toon-format/toon) format. Set to `false` to use JSON instead. |
| `format` | `"cqn"` | Query format mode. `"cqn"` uses CQN objects; `"sql"` accepts SQL strings and returns CDS definitions. See below. |

## SQL Format Mode

Set `format: "sql"` to switch the `query` and `describe` tools to SQL/CDS mode:

```json
{
  "cds": {
    "mcp": {
      "format": "sql"
    }
  }
}
```

**Benefits:**
- **Lower token consumption** — SQL is more compact than CQN JSON objects, reducing input/output tokens per tool call
- **Easier for LLMs** — LLMs are pretrained on SQL and generate it more reliably than CQN's custom JSON structure

**Behavior changes:**

| Tool | `"cqn"` (default) | `"sql"` |
|---|---|---|
| `describe` | Returns JSON with element types, keys, associations | Returns **CDS source** (CDL) via `cds.compile.to.cdl` |
| `query` | Accepts CQN object (`entity`, `where`, `select`, …) | Accepts a **SQL SELECT string**, parsed via `cds.parse.cql` |

The `query` tool in SQL mode only allows SELECT statements. The response includes a `count` field reflecting the **total** matching rows (via `$count`), independent of any LIMIT clause — useful for pagination awareness.

For all other configuration options, refer to the official [documentation](https://pages.github.tools.sap/cap/docs/guides/protocols/mcp).

## Custom Server Instructions

You can customize the MCP server instructions sent to agents during initialization using the `@mcp.instructions` annotation:

```cds
annotate MyService with @mcp.instructions: 'Use describe to explore the product catalog. Use query to search products by name or category.';
```

If not set, a default instruction is used. The annotation also supports i18n references (`{i18n>key}`).

## Demo
The demo video starts with local usage with Opencode, then proceeds to do the same with Joule.
It is to large for GH, so:
- find a demo online [here](https://sap-my.sharepoint.com/:v:/p/simon_engel01/IQDO5Pdt5ULdR4h5L09E35FsAaYgdyvbxnLw2qyHPbvLZYk?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=3Yb76d)
- download the video directly [here](https://sap-my.sharepoint.com/personal/simon_engel01_sap_com/_layouts/15/download.aspx?UniqueId=6df7e4ce%2D42e5%2D47dd%2D8879%2D2f4f44df916c)


## License

This package is provided under the terms of the [SAP Developer License Agreement](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt).
