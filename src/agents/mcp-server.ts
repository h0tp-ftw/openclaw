import { createInterface } from "node:readline";
import { loadConfig } from "../config/io.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

// Basic JSON-RPC 2.0 types
type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: number | string;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string | null;
};

async function main() {
  const config = loadConfig();

  // Accept model context from the calling CLI runner via env vars
  // so tool policy resolution uses the correct provider/model.
  const modelProvider = process.env.OPENCLAW_MCP_MODEL_PROVIDER ?? "google";
  const modelId = process.env.OPENCLAW_MCP_MODEL_ID ?? undefined;

  // Accept agent context from calling CLI runner via env vars
  const sessionKey = process.env.OPENCLAW_SESSION_KEY;
  const agentId = process.env.OPENCLAW_AGENT_ID;
  const agentDir = process.env.OPENCLAW_AGENT_DIR;

  // Initialize tools using env-driven context
  const tools = createOpenClawCodingTools({
    config,
    workspaceDir: process.cwd(),
    modelProvider,
    modelId,
    sessionKey,
    // Agent context
    agentDir,
  });

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const send = (msg: JsonRpcResponse) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const handleRequest = async (line: string) => {
    try {
      if (!line.trim()) return;
      const req: JsonRpcRequest = JSON.parse(line);

      switch (req.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
                resources: {},
              },
              serverInfo: {
                name: "openclaw-mcp",
                version: "1.0.0",
              },
            },
          });
          break;

        case "notifications/initialized":
          // No response needed for notifications
          break;

        case "tools/list": {
          const mcpTools = tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters || { type: "object", properties: {} },
          }));
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              tools: mcpTools,
            },
          });
          break;
        }

        case "tools/call": {
          const params = req.params || {};
          const { name, arguments: args } = params;

          if (!name) {
            send({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32602, message: "Invalid params: 'name' is required" },
            });
            return;
          }

          const tool = toolMap.get(name);
          if (!tool) {
            send({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32601, message: `Tool not found: ${name}` },
            });
            return;
          }

          try {
            const result = await tool.execute(String(req.id), args);
            // MCP expects content array
            const content =
              typeof result === "string"
                ? [{ type: "text", text: result }]
                : [{ type: "text", text: JSON.stringify(result) }];

            send({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                content,
                isError: false,
              },
            });
          } catch (err: any) {
            send({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                content: [{ type: "text", text: `Error: ${err.message}` }],
                isError: true,
              },
            });
          }
          break;
        }

        case "resources/list":
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: { resources: [] },
          });
          break;

        case "ping":
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {},
          });
          break;

        default:
          // Ignore unknown notifications, error on unknown requests
          if (req.id !== undefined && req.id !== null) {
            send({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32601, message: "Method not found" },
            });
          }
      }
    } catch (e) {
      // Log to stderr to avoid corrupting the JSON-RPC stdout channel
      process.stderr.write(`MCP server error: ${e}\n`);
    }
  };

  rl.on("line", handleRequest);
}

main().catch((e) => {
  process.stderr.write(`MCP server fatal: ${e}\n`);
  process.exit(1);
});
