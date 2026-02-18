
import { createOpenClawTools } from "../../src/agents/openclaw-tools.js";
import { createExecTool, createProcessTool } from "../../src/agents/bash-tools.js";
import type { AnyAgentTool } from "../../src/agents/tools/common.js";
import readline from "node:readline";

// Minimal MCP implementation
type McpRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
};

type McpResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
};

// Basic JSON-RPC 2.0 Loop
async function main() {
  const commonTools = createOpenClawTools({
    workspaceDir: process.cwd(),
    sandboxed: false,
    allowHostBrowserControl: true, // Enable browser automation
    config: {
      tools: {
        web: { search: { enabled: true, provider: "brave" } },
        browser: { enabled: true, headless: false }, // Default to visible browser for user to see actions
      },
    } as any,
  });

  const execTool = createExecTool({
      host: "node", // Allow running on the host node process
      allowBackground: true,
      cwd: process.cwd()
  });

  const processTool = createProcessTool(); // No args needed for default behavior

  const tools = [...commonTools, execTool, processTool];

  const toolMap = new Map<string, AnyAgentTool>();
  for (const tool of tools) {
    if (tool.name) {
      toolMap.set(tool.name, tool);
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    try {
      const request = JSON.parse(trimmed) as McpRequest;
      // Handle batch or single
      if (Array.isArray(request)) {
          // MCP doesn't usually use batch, but good practice
          for (const req of request) {
              const response = await handleRequest(req, toolMap);
              if (response) console.log(JSON.stringify(response));
          }
      } else {
          const response = await handleRequest(request, toolMap);
          if (response) console.log(JSON.stringify(response));
      }
    } catch (err) {
      console.error("Failed to parse/process JSON-RPC:", err);
    }
  });
  
  // Log ready state to stderr so it doesn't pollute stdout (MCP channel)
  console.error(`[OpenClaw MCP] Server ready with ${toolMap.size} tools.`);
}

async function handleRequest(req: McpRequest, tools: Map<string, AnyAgentTool>): Promise<McpResponse | null> {
  if (!req.jsonrpc || req.jsonrpc !== "2.0") return null;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: req.id!,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: "openclaw-mcp-server",
              version: "1.0.0",
            },
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: req.id!,
          result: {
            tools: Array.from(tools.values()).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.parameters,
            })),
          },
        };

      case "tools/call":
        const params = req.params as { name: string; arguments: Record<string, any> };
        const tool = tools.get(params.name);
        if (!tool) {
          throw { code: -32601, message: `Tool not found: ${params.name}` };
        }

        console.error(`[OpenClaw MCP] Executing ${params.name}...`);
        const result = await tool.execute(String(req.id), params.arguments || {});

        return {
          jsonrpc: "2.0",
          id: req.id!,
          result: {
            content: result.content,
            isError: false,
          },
        };
      
      case "notifications/initialized":
        return null;

      case "ping":
        return { jsonrpc: "2.0", id: req.id!, result: {} };

      default:
        // Ignore unknown notifications, error on unknown methods with ID
        if (req.id !== undefined) {
             throw { code: -32601, message: `Method not found: ${req.method}` };
        }
        return null;
    }
  } catch (err: any) {
    const code = typeof err.code === 'number' ? err.code : -32000;
    return {
      jsonrpc: "2.0",
      id: req.id!,
      error: {
        code,
        message: err.message || "Internal error",
        data: err.data,
      },
    };
  }
}

main().catch(err => {
    console.error("Fatal MCP Server Error:", err);
    process.exit(1);
});
