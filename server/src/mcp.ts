import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createTools, type ToolContext } from "./tools.js";

/**
 * Create an in-process MCP server exposed as a Hono sub-app at /mcp.
 * All tools run in the same process, calling domain objects directly.
 */
export function createMcpRoute(ctx: ToolContext) {
  const mcp = new Hono();
  const mcpServer = new McpServer({ name: "minhome", version: "0.1.0" });
  const transport = new StreamableHTTPTransport();
  const tools = createTools();

  // Register all tools on the MCP server
  for (const [name, def] of Object.entries(tools)) {
    const paramShape = "shape" in def.parameters ? (def.parameters as { shape: Record<string, unknown> }).shape : {};
    mcpServer.tool(name, def.description, paramShape, async (params) => {
      try {
        const result = await def.execute(params, ctx);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String((err as Error).message ?? err) }],
          isError: true,
        };
      }
    });
  }

  mcp.all("/mcp", async (c) => {
    if (!mcpServer.isConnected()) {
      await mcpServer.connect(transport);
    }
    return transport.handleRequest(c);
  });

  return mcp;
}
