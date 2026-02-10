---
summary: "Using the Gemini CLI binary as a headless execution backend in OpenClaw"
read_when:
  - You want to route OpenClaw through the Gemini CLI binary instead of the embedded API
  - You want to understand how CLI backends (gemini-cli, claude-cli, codex-cli) work
title: "Gemini CLI Backend"
---

# Gemini CLI Backend

OpenClaw can use the **Gemini CLI binary** as a headless execution backend, spawning `gemini` as a child process for each agent turn instead of calling the Google API directly. This gives you the Gemini CLI's own tool ecosystem, authentication, and execution environment.

## Prerequisites

1. **Gemini CLI installed** — the `gemini` command must be on your `$PATH`.  
   Install it via: `npm install -g @anthropic-ai/gemini-cli` (or your preferred method).
2. **Gemini CLI authenticated** — run `gemini` once interactively to complete the OAuth flow, or set the `GOOGLE_API_KEY` / `GEMINI_API_KEY` environment variable.

## Quick Start

```bash
# Set Gemini CLI as the default model backend
openclaw models set gemini-cli/gemini-2.5-pro

# Restart the gateway to pick up the change
openclaw gateway restart
```

That's it. All agent interactions will now be routed through the `gemini` binary in headless mode.

## Available Models

Use `gemini-cli/<model-id>` format. Built-in aliases are also supported:

| Alias            | Resolves To              |
| ---------------- | ------------------------ |
| `pro`            | `gemini-2.5-pro`         |
| `flash`          | `gemini-2.5-flash`       |
| `pro-3`          | `gemini-3-pro-preview`   |
| `flash-3`        | `gemini-3-flash-preview` |
| `2.5-pro`        | `gemini-2.5-pro`         |
| `2.5-flash`      | `gemini-2.5-flash`       |
| `gemini-3-pro`   | `gemini-3-pro-preview`   |
| `gemini-3-flash` | `gemini-3-flash-preview` |

Examples:

```bash
openclaw models set gemini-cli/gemini-2.5-pro
openclaw models set gemini-cli/gemini-3-flash-preview
```

## How It Works

### Architecture

When the provider is `gemini-cli`, OpenClaw:

1. **Routes via `isCliProvider()`** — recognizes `gemini-cli` as a CLI backend (alongside `claude-cli` and `codex-cli`).
2. **Resolves backend config** — `resolveCliBackendConfig()` in `cli-backends.ts` merges the built-in defaults with any user overrides from `agents.defaults.cliBackends`.
3. **Spawns the CLI** — `runCliAgent()` in `cli-runner.ts` builds the command, injects the system prompt, and executes the `gemini` binary.

### Headless Mode

The backend automatically runs in headless mode using these flags:

```
gemini --output-format stream-json --yolo -m <model> -p "<prompt>"
```

| Flag                          | Purpose                                 |
| ----------------------------- | --------------------------------------- |
| `-p "<prompt>"`               | Run in non-interactive mode with prompt |
| `--output-format stream-json` | Streaming JSON output (ndjson)          |
| `--yolo`                      | Auto-approve all tool calls (headless)  |
| `-m <model>`                  | Model selection                         |

For streaming responses, `--output-format stream-json` is used instead.

### System Prompt Injection

The system prompt is written to a temporary file and injected via the `GEMINI_SYSTEM_MD` environment variable, which the Gemini CLI reads automatically.

### MCP Tools Bridge

OpenClaw exposes its own tools to the Gemini CLI session via an auto-generated `gemini-extension.json` manifest that connects to the OpenClaw MCP server (`mcp-server.ts`). This gives the Gemini CLI access to OpenClaw's coding tools while excluding tools the CLI already provides natively (file I/O, shell, web search, etc.).

## Other CLI Backends

OpenClaw supports three CLI backends using the same architecture:

| Provider     | Command  | Status       |
| ------------ | -------- | ------------ |
| `gemini-cli` | `gemini` | ✅ Supported |
| `claude-cli` | `claude` | ✅ Supported |
| `codex-cli`  | `codex`  | ✅ Supported |

Switch between them with:

```bash
openclaw models set gemini-cli/gemini-2.5-pro
openclaw models set claude-cli/claude-sonnet-4-5-20250514
openclaw models set codex-cli/codex-mini-latest
```

## Custom Backend Overrides

You can override the default `gemini-cli` backend config via `openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "gemini-cli": {
          "command": "/custom/path/to/gemini",
          "args": ["--output-format", "stream-json", "--yolo"],
          "modelArg": "-m"
        }
      }
    }
  }
}
```

Overrides are merged with the built-in defaults, so you only need to specify the fields you want to change.

## Key Source Files

| File                               | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `src/agents/model-selection.ts`    | `isCliProvider()` — routes `gemini-cli` to the CLI runner       |
| `src/agents/cli-backends.ts`       | `DEFAULT_GEMINI_BACKEND` config and `resolveCliBackendConfig()` |
| `src/agents/cli-runner.ts`         | `runCliAgent()` — spawns and manages the CLI process            |
| `src/agents/cli-runner/helpers.ts` | System prompt injection, argument building, JSON parsing        |
| `src/agents/mcp-server.ts`         | MCP tools bridge for Gemini CLI extensions                      |

## Troubleshooting

**"gemini: command not found"** — Ensure the Gemini CLI is installed and on your `$PATH`.

**Authentication errors** — Run `gemini` interactively once to complete OAuth, or set `GOOGLE_API_KEY`.

**Model not routing through CLI** — Run `openclaw models status` and verify the provider shows as `gemini-cli`. If it shows `google` or `google-gemini-cli`, you're using the embedded API instead.

**Checking logs** — Use `openclaw logs --follow` to see CLI invocations and output in real time.
