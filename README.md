> [!CAUTION]  
>
> This is in beta phase. Do not use it productively. If you want to try it out, we are happy to receive feedback for further improvements.

# Protocol Adapter for MCP
This is a protocol adapter for the MCP protocol to expose CAP services for agent consumption. For more information, check the offical [documentation](https://pages.github.tools.sap/cap/docs/guides/protocols/mcp).

## Trying out the sample
You find a sample in this repository in `tests/bookshop`. You can start it via:

```bash
npm run watch:sample
```

In a new terminal, you can then start the MCP inspector to explore the provided MCP servers:
```bash
npm run inspect
```

## Generated Tools
See the [documentation](https://pages.github.tools.sap/cap/docs/guides/protocols/mcp) for more tools. Here are only the ones listed not yet put to CAPire.

### `call_action`
This tool is used to invoke unbound actions and functions defined in the service. It is only generated if the service exposes at least one unbound action or function.

- `action`: The name of the action or function to call. An enum is provided listing all available actions/functions.
- `parameters`: An object containing the parameters for the action/function. Use `describe` to discover available parameters.

## Demo
The demo video starts with local usage with Opencode, then proceeds to do the same with Joule.
It is to large for GH, so:
- find a demo online [here](https://sap-my.sharepoint.com/:v:/p/simon_engel01/IQDO5Pdt5ULdR4h5L09E35FsAaYgdyvbxnLw2qyHPbvLZYk?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=3Yb76d)
- download the video directly [here](https://sap-my.sharepoint.com/personal/simon_engel01_sap_com/_layouts/15/download.aspx?UniqueId=6df7e4ce%2D42e5%2D47dd%2D8879%2D2f4f44df916c)


## License

This package is provided under the terms of the [SAP Developer License Agreement](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt).
