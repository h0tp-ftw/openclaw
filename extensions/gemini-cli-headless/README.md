# Gemini CLI Headless (OpenClaw plugin)

Headless provider plugin that uses the local **Gemini CLI** binary with OAuth.
Unlike `google-gemini-cli` (which uses the API directly), this extension spawns
the `gemini` binary as a subprocess and streams responses via JSON-lines.

## Enable

Bundled plugins are disabled by default. Enable this one:

```bash
openclaw plugins enable gemini-cli-headless
```

Restart the Gateway after enabling.

## Authenticate

```bash
openclaw models auth login --provider gemini-cli-headless --set-default
```

This will:
1. Verify the `gemini` binary is on your PATH
2. Configure `~/.gemini/settings.json` for headless OAuth
3. Trigger the Google OAuth flow in your browser

## Requirements

Install the Gemini CLI first:

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
