> **Important**
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

