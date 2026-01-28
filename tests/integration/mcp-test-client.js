const MCP_PROTOCOL_VERSION = "2025-11-25";

async function parseResponseStream(data) {
  const str = typeof data === "string" ? data : await new Response(data).text();
  return JSON.parse(
    str
      .split("\n")
      .find((l) => l.startsWith("data: "))
      .slice(6),
  );
}

module.exports =
  (test) =>
  (endpoint = "/mcp/catalog", auth = null) => {
    let sessionId = null;
    let requestId = 0;

    const getHeaders = () => {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
      };
      if (auth) {
        headers["Authorization"] =
          `Basic ${Buffer.from(auth).toString("base64")}`;
      }
      if (sessionId) {
        headers["Mcp-Session-Id"] = sessionId;
      }
      return headers;
    };

    const sendRequest = async (method, params = {}) => {
      try {
        const response = await test.POST(
          endpoint,
          {
            jsonrpc: "2.0",
            id: ++requestId,
            method,
            params,
          },
          { headers: getHeaders() },
        );

        const newSessionId = response.headers?.["mcp-session-id"];
        if (newSessionId) {
          sessionId = newSessionId;
        }

        return parseResponseStream(response.data);
      } catch (err) {
        // Handle HTTP errors (401, 403) from authorization failures
        if (err.response?.data) {
          return err.response.data;
        }
        throw err;
      }
    };

    let initError = null;

    const initialize = async () => {
      const initResponse = await sendRequest("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      });

      // If initialization failed (authorization error), don't send notification
      if (initResponse.error) {
        initError = initResponse;
        return initResponse;
      }

      await test.POST(
        endpoint,
        {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        },
        { headers: getHeaders() },
      );

      return initResponse;
    };

    const mcp = async (method, params = {}) => {
      if (!sessionId && !initError) await initialize();
      // If initialization failed, return the error for any subsequent request
      if (initError) return initError;
      return sendRequest(method, params);
    };

    const callTool = async (name, args = {}) => {
      const res = await mcp("tools/call", { name, arguments: args });
      // Handle JSON-RPC error (e.g., authorization failure during initialization)
      if (res.error) {
        return {
          ...res,
          content: null,
          error: res.error.message,
        };
      }
      return {
        ...res,
        content: res.result.isError
          ? null
          : JSON.parse(res.result.content[0].text),
        error: res.result.isError ? res.result.content[0].text : null,
      };
    };

    return { mcp, callTool, initialize };
  };
