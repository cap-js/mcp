# CAP MCP Plugin / PoC
- Goal: CAP applications can be consumed by an agent through MCP servers

## Requirements
- declarative approach via `@mcp`/ `@protocol: 'mcp'` annotation
- define the server in a CAP way: just another service which is annotated with `@mcp`
- focus is just on READ operations
- cds compile to mcp -> formats to export the MCP server definition that it can be imported into MCP hub 

## Implementation
- create a read tool for each exposed entity
- (create one query tool + describe model tool)

- existing service (e.g. CatalogService) and register a new path `<service>/mcp` which represents the MCP server
- which lifecyle event? How to do that?
- use MCP middleware package for express (https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/middleware)