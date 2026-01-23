> [!CAUTION]  
>
> This is a PoC implementation. Do not use it productively.

## Protocol Adapter for MCP

```cds
@protocol: 'mcp'
service CatalogService {
  entity Books as projection on my.Books;
}
```

Currently, only READ tools are created. Incoming tool calls are translated to CQN queries. For every service annotated with `@protocol: 'mcp'` or `@mcp`, a new MCP Server is created for that service that is served on `/<service-name>/mcp`.

## Demo
The demo video starts with local usage with Opencode integration ootb, then proceeds to do the same with Joule.
It is to large for GH, so:
- find a demo [here](https://sap-my.sharepoint.com/:v:/p/simon_engel01/IQDO5Pdt5ULdR4h5L09E35FsAaYgdyvbxnLw2qyHPbvLZYk?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=3Yb76d)
- download the video directly [here](https://sap-my.sharepoint.com/personal/simon_engel01_sap_com/_layouts/15/download.aspx?UniqueId=6df7e4ce%2D42e5%2D47dd%2D8879%2D2f4f44df916c)
