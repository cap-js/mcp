# Protocol Adapter for MCP
This is a protocol adapter for the MCP protocol to expose CAP services for agent consumption. For more information, check the official [documentation](https://pages.github.tools.sap/cap/docs/guides/protocols/mcp).

## Feature Flags

All configuration lives under `cds.mcp` in your `package.json`:

```json
{
  "cds": {
    "mcp": {
      "per_action_tool": false,
      "format_json": false,
      "json_response": false
    }
  }
}
```

| Flag | Default | Description |
|---|---|---|
| `per_action_tool` | `false` | Expose each action/function as its own dedicated tool instead of the generic `call_action` tool. |
| `format_json` | `false` | Return query results as JSON instead of the default [TOON](https://www.npmjs.com/package/@toon-format/toon) format. |
| `json_response` | `false` | Use plain JSON responses instead of SSE streaming for the MCP transport. |

For all other configuration options, refer to the official [documentation](https://pages.github.tools.sap/cap/docs/guides/protocols/mcp).

## Demo
The demo video starts with local usage with Opencode, then proceeds to do the same with Joule.
It is to large for GH, so:
- find a demo online [here](https://sap-my.sharepoint.com/:v:/p/simon_engel01/IQDO5Pdt5ULdR4h5L09E35FsAaYgdyvbxnLw2qyHPbvLZYk?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=3Yb76d)
- download the video directly [here](https://sap-my.sharepoint.com/personal/simon_engel01_sap_com/_layouts/15/download.aspx?UniqueId=6df7e4ce%2D42e5%2D47dd%2D8879%2D2f4f44df916c)


## License

This package is provided under the terms of the [SAP Developer License Agreement](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt).
