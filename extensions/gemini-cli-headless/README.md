# Gemini CLI Headless (OpenClaw plugin)

Headless provider plugin that uses the local **Gemini CLI** binary with OAuth.
Unlike `google-gemini-cli` (which uses the API directly), this extension spawns
the `gemini` binary as a subprocess and streams responses via JSON-lines.

## Enable

## Enable
 
This plugin is **enabled by default** in the `h0tp-ftw/openclaw` fork. You do not need to manually enable it.

## MCP Tool Bridge (Experimental)

OpenClaw exposes its powerful coding tools (Web Search, File I/O, Bash) via the Model Context Protocol (MCP).

To use these tools with an MCP-compatible client (like Claude Desktop or Gemini CLI with MCP support):

1.  Point your client to the generated manifest:
    `extensions/gemini-cli-headless/gemini-extension.json`

2.  Or use the launcher script directly:
    `extensions/gemini-cli-headless/start-mcp.cmd`

This bridge allows the headless agent to perform real-world actions like browsing the web and editing files.

## Authenticate

```bash
openclaw models auth login --provider gemini-cli-headless --set-default
```

This will:
1. Verify the `gemini` binary is on your PATH
2. Configure `~/.gemini/settings.json` for headless OAuth
3. Trigger the Google OAuth flow in your browser

## Requirements

1. **OpenClaw Fork Only**: This extension requires the `h0tp-ftw/openclaw` fork (or a core patched with dynamic CLI backend support). Stock OpenClaw does not yet support plugin-provided CLI backends.
2. **Gemini CLI**: Install the official CLI tool:

```bash
npm install -g @google/gemini-cli
```

## Model Aliases

| Alias | Resolves To |
|-------|-------------|
| `pro` | `gemini-2.5-pro` |
| `flash` | `gemini-2.5-flash` |
| `lite` | `gemini-2.5-flash-lite` |
| `pro-3` | `gemini-3-pro-preview` |
| `flash-3` | `gemini-3-flash-preview` |

## How It Works

This provider registers a CLI backend configuration. When selected, OpenClaw:

1. Spawns `gemini --output-format stream-json --yolo -p <prompt>`
2. Streams JSON-line responses back to the user
3. Supports session resumption via `--resume {sessionId}`
4. Disables telemetry via environment variables
