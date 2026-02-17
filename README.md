> [!CAUTION]  
>
> This is in beta phase. Do not use it productively. If you want to try it out, we are happy to receive feedback for further improvements.

# Protocol Adapter for MCP
This is a protocol adapter for the MCP protocol to expose CAP services for agent consumption.

## Trying out the sample
You find a sample in this repository in `tests/bookshop`. You can start it via:

```bash
npm run watch:sample
```

In a new terminal, you can then start the MCP inspector to explore the provided MCP servers:
```bash
npm run inspect
```

## Installation
Currently, the package is only available in the internal registry, hence a `.npmrc` file in your project folder is required that includes:

```
registry=https://int.repositories.cloud.sap/artifactory/api/npm/build-milestones-npm/
```
This line specifies that also packages from the internal nexus can be downloaded.

```bash
npm i @cap-js/mcp
```

## Usage
MCP is just another protocol, simply annotate your existing service as for any other protocol, for example:

```cds
annotate CatalogService with @mcp;
```

You can start an MCP-Inspector to explore and test the created MCP-servers:

```bash
npx @modelcontextprotocol/inspector
```
The inspector should automatically open in your browser. Enter the URL of your service (`http://localhost:4004/mcp/catalog` for the provided sample) and click connect. Go to the `tools` tab and click `List Tools`. To get data, click on the `read_query` tool, select an entity, scroll down and click `Run Tool`. If you connect to a restricted service, make sure to provide the `Authorization` header in the `Authentication` section. For the `AdminService` of the sample, you need to be logged in as admin, the value of the `Authorization` header should be `Basic YWxpY2U6`.

The inspector should automatically open in your browser. Enter the URL of your service (`http://localhost:4004/mcp/catalog` for the provided sample) and click connect. Go to the `tools` tab and click `List Tools`. To get data, click on the `read_query` tool, select an entity, scroll down and click `Run Tool`. If you connect to a restricted service, make sure to provide the `Authorization` header in the `Authentication` section. For the `AdminService` of the sample, you need to be logged in as admin, the value of the `Authorization` header should be `Basic YWxpY2U6`.

## Generated Tools
In general, this adapter only creates tools to read data from the service. Any data manipulation is currently out of scope for this implementation. 

The adapter creates an MCP-server per CAP-service. Each server is by default served under `/mcp/<service>`. Each CAP-application can expose multiple  MCP-servers.

### Default behaviour
By default, the adapter creates the following two tools.

#### `describe_model`
This tool returns information about the entities and their elements exposed by the service. If no parameter is provided, all exposed entities are described (with respect of the authorization). The optional parameter `entity` can be used to describe only a specific entity. An enum is provided to list all available entities.

#### `read_query`
This tool is used to read data from the service. The only mandatory parameter is `entity`, which is an enum listing all entities exposed by the service. This tool takes all provided parameters and translates them to a CQN query, which is eventually executed with the service via `service.run(query)`.

- `filter`: Provides filtering capabilities. Expects a CQN where clause as array of tokens.
- `select`: Provides selection capabilities. Expects an array of strings with the elements to select. Supports path expressions along associations.
- `limit`: Limits the number of returned results. Defaults to 20.
- `orderBy`: Provides ordering capabilities. Expects an array of elements to filter by.
- `sort`: Either `asc` or `desc`. Defaults to `asc`.

### Per entity tool configuration
It is possible to create one `read_<entity>` tool per exposed entity by enabling the feature flag `mcp_per_entity_tool`. These tools behaves exactly like the `read_query` tool, but does not require the `entity` parameter, as it is already bound to a specific entity. The `describe_model` tool is still created without changes.

The Per entity tool configuration is intentionally not the default behaviour, as it may lead to a bloated context for LLMs, depending on the number of entities exposed by the service. This can introduce higher costs, lower performance and quality for LLM especially considering [context rot](https://research.trychroma.com/context-rot).

## Automatic Client configuration
This adapter also provides automatic client-configurations for several local MCP-clients when an application is started locally. This can be used to directly test the provided MCP-servers without going through the deployment process. 

The following clients are supported by default:

- [Opencode](https://opencode.ai/)
- [Cline](https://cline.bot/)
- [Claude Code](https://code.claude.com/docs) (currently only the CLI)

During application startup, the generated MCP-servers and their URL are added to the configuration files of the clients. When the application stops, the added configuration is removed again.


You can provide support for more clients by extending `cds.env.protocols.mcp.clients` and add your custom client to be added automatically on startup as well.

<details><summary>Example code snippet to add a custom client</summary>

```js
cds.env.protocols.mcp.clients ??= {}
cds.env.protocols.mcp.clients.myClient = {
  export(services, url) {
    for (const srv of services) {
      const mcpEndpoint = srv.endpoints.find((ep) => ep.kind === "mcp");
      if (mcpEndpoint) {
        const mcpUrl = url + mcpEndpoint.path;
        console.log(`[myClient] Registering ${srv.name} at ${mcpUrl}`);
      }
    }
  },
  purge(services) {
    for (const srv of services) {
      console.log(`[myClient] Purging ${srv.name}`);
    }
  },
};
```
</details>

## Authorization
As this adapter takes the incoming read request and transforms it to a CQN query, all existing authorization mechanisms in CAP are supported out of the box for the reading of data. Besides that, the adapter also respects the authorization for the `describe_model` tool, meaning that only entities the user is authorized to access are described. This behaviour also prevents bloating the agent's context window with domain information that it cannot access. 

## Limitations
The current implementation only supports reading data. Creating, updating or deleting data is currently out of scope.

## Demo
The demo video starts with local usage with Opencode, then proceeds to do the same with Joule.
It is to large for GH, so:
- find a demo online [here](https://sap-my.sharepoint.com/:v:/p/simon_engel01/IQDO5Pdt5ULdR4h5L09E35FsAaYgdyvbxnLw2qyHPbvLZYk?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=3Yb76d)
- download the video directly [here](https://sap-my.sharepoint.com/personal/simon_engel01_sap_com/_layouts/15/download.aspx?UniqueId=6df7e4ce%2D42e5%2D47dd%2D8879%2D2f4f44df916c)
