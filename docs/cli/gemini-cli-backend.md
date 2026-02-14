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
| `gemini-2.5-pro`            | `gemini-2.5-pro`         |
| `gemini-2.5-flash`          | `gemini-2.5-flash`       |
| `gemini-3-pro-preview`          | `gemini-3-pro-preview`   |
| `gemini-3-flash-preview`        | `gemini-3-flash-preview` |
| `gemini-2.5-flash-lite`        | `gemini-2.5-flash-lite`         |
| `auto-gemini-2.5`      | Auto-selects best available Gemini 2.5 model       |
| `auto-gemini-3`   | Auto-selects best available Gemini 3 model |

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

## Advanced Usage

### Session Resumption

OpenClaw supports persistent conversations via the Gemini CLI's `--resume` capability. 

- **How it works**: When a session starts, OpenClaw captures the `session_id` from the CLI's `init` event. Subsequent turns in the same OpenClaw session automatically append `--resume <session_id>` to the CLI command.
- **Benefits**: This preserves conversation state (context) across multiple CLI spawns without needing to re-send the entire history as text, saving tokens and improving speed.
- **Manual Control**: Running `/new` in the chat will clear the stored CLI session ID and start a fresh context.

### Streaming Architecture

The `gemini-cli-headless` backend leverages a custom NDJSON parser to handle real-time feedback:

1.  **Reasoning Tokens**: "Thinking" tokens are captured from `thinking` events and streamed to the UI via `onReasoningStream`.
2.  **Assistant Response**: Message deltas are streamed via `onPartialReply`.
3.  **Tool Orchestration**: `tool_use` and `tool_result` events are bridged to OpenClaw's internal event bus, allowing for observability of the CLI's native tool usage.

### Image Support

Multi-modal inputs are supported via temporary file injection:
- Images sent to OpenClaw are written to a secure temporary directory (`/tmp/openclaw-cli-images-*`).
- The file paths are passed to the CLI using the `-i` (or configured `imageArg`) flag.
- Files are automatically cleaned up after the CLI process terminates.

## Compliance & Terms of Service

Unlike alternative methods that involve scraping or unauthorized session token extraction, the **Gemini CLI Headless** backend is a **100% legal and first-class method** for interacting with Gemini.

> [!IMPORTANT]
> **ToS Friendly Architecture**
> This fork uses the official `gemini` CLI binary as its underlying engine. This means:
> 1. **Authorized Auth**: You use standard, Google-approved OAuth flows (`gemini login`).
> 2. **Official API Usage**: Commands are translated into official API calls by the binary itself.
> 3. **No Key Stealing**: There is no need for illegal session hijacking or "stealing" of OAuth cookies.
> 4. **Standard Quotas**: You benefit from the generous quotas (context windows, requests/day) provided to the Gemini CLI.

This approach ensures your usage remains compliant with Google's Terms of Service while providing a seamless, headless automation experience.

## Other CLI Backends
... [rest of file] ...
