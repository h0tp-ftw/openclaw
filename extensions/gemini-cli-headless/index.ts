/**
 * gemini-cli-headless — OpenClaw provider extension
 *
 * Registers the `gemini-cli-headless` provider which spawns the local
 * Gemini CLI binary as a headless subprocess, streaming responses
 * via JSON-lines.
 *
 * This extension is entirely self-contained: all backend configuration,
 * model aliases, auth flow, and settings management live here.
 */

import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "openclaw/plugin-sdk";
import { ensureGeminiSettings, GEMINI_SETTINGS_PATH } from "./settings-manager.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_ID = "gemini-cli-headless";
const PROVIDER_LABEL = "Gemini CLI (Headless)";

// ---------------------------------------------------------------------------
// Model aliases — map user-friendly names to actual Gemini model IDs
// ---------------------------------------------------------------------------

const GEMINI_MODEL_ALIASES: Record<string, string> = {
  // Gemini 3 Preview
  "pro-3": "gemini-3-pro-preview",
  "flash-3": "gemini-3-flash-preview",
  "gemini-3-pro": "gemini-3-pro-preview",
  "gemini-3-flash": "gemini-3-flash-preview",

  // Gemini 2.5
  pro: "gemini-2.5-pro",
  "2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-pro": "gemini-2.5-pro",

  flash: "gemini-2.5-flash",
  "2.5-flash": "gemini-2.5-flash",
  "gemini-2.5-flash": "gemini-2.5-flash",

  lite: "gemini-2.5-flash-lite",
  "flash-lite": "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-2.5-flash-lite",

  // Auto Selectors
  "auto-3": "auto-gemini-3",
  "auto-gemini-3": "auto-gemini-3",
  "auto-2.5": "auto-gemini-2.5",
  "auto-gemini-2.5": "auto-gemini-2.5",
};

// ---------------------------------------------------------------------------
// CLI Backend config — describes how to spawn and interact with `gemini`
// ---------------------------------------------------------------------------

const GEMINI_CLI_BACKEND = {
  command: "gemini",
  args: ["--output-format", "json", "--yolo"],
  streamingArgs: ["--output-format", "stream-json", "--yolo"],
  resumeArgs: ["--output-format", "json", "--yolo", "--resume", "{sessionId}"],
  env: {
    GEMINI_TELEMETRY_ENABLED: "false",
    GEMINI_TELEMETRY_LOG_PROMPTS: "false",
    COLUMNS: "10000",
    LINES: "10000",
    TERM: "dumb",
  },
  output: "json",
  input: "arg",
  promptArg: "-p",
  modelArg: "-m",
  modelAliases: GEMINI_MODEL_ALIASES,
  sessionMode: "existing",
  sessionIdFields: ["session_id"],
  systemPromptEnvVar: "GEMINI_SYSTEM_MD",
  serialize: true,
} as const;

// ---------------------------------------------------------------------------
// Binary detection helper
// ---------------------------------------------------------------------------

async function detectBinary(name: string): Promise<boolean> {
  const { exec } = await import("node:child_process");
  const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
  return new Promise((resolve) => {
    exec(cmd, (error) => resolve(!error));
  });
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const geminiCliHeadlessPlugin = {
  id: "gemini-cli-headless",
  name: "Gemini CLI Headless",
  description: "Headless provider using the local Gemini CLI binary with OAuth",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      aliases: ["gemini-headless", "google-gemini-cli", "gemini-cli"],
      cliBackend: GEMINI_CLI_BACKEND as any,
      models: {
        baseUrl: "cli://headless",
        models: [
          {
            id: "gemini-3-pro-preview",
            name: "Gemini 3 Pro",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1048576,
            maxTokens: 8192,
          },
          {
            id: "gemini-3-flash-preview",
            name: "Gemini 3 Flash",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1048576,
            maxTokens: 8192,
          },
          {
            id: "gemini-2.5-pro",
            name: "Gemini 2.5 Pro",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          },
          {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
      auth: [
        {
          id: "oauth",
          label: "Google OAuth (Headless)",
          hint: "Uses local Gemini CLI binary with OAuth — no API key needed",
          kind: "custom" as const,

          async run(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
            // 1. Detect gemini binary
            let hasGemini = await detectBinary("gemini");
            if (!hasGemini) {
              const confirm = await ctx.prompter.confirm({
                message:
                  "The `gemini` CLI binary was not found on your PATH. Would you like to install it now?\n" +
                  "(Runs: npm install -g @google/gemini-cli)",
                initialValue: true,
              });

              if (confirm) {
                await ctx.prompter.note(
                  "Installing @google/gemini-cli globally...",
                  "Gemini CLI (Headless)",
                );
                const { exec } = await import("node:child_process");
                await new Promise<void>((resolve, reject) => {
                  exec("npm install -g @google/gemini-cli", (error) => {
                    if (error) {
                      reject(new Error(`Installation failed: ${error.message}`));
                    } else {
                      resolve();
                    }
                  });
                });
                hasGemini = await detectBinary("gemini");
              }

              if (!hasGemini) {
                throw new Error(
                  "The `gemini` CLI binary is still missing.\n" +
                    "Please install it manually: npm install -g @google/gemini-cli",
                );
              }
            }

            // 2. Configure ~/.gemini/settings.json for headless OAuth
            await ensureGeminiSettings();
            await ctx.prompter.note(
              `Configured ${GEMINI_SETTINGS_PATH} for headless OAuth.`,
              "Gemini CLI (Headless)",
            );

            // 3. Trigger OAuth via `gemini -p "Hi"` (opens browser)
            await ctx.prompter.note(
              'Running `gemini -p "Hi"` to trigger Google OAuth. Check your browser.',
              "Gemini CLI (Headless)",
            );

            const { spawn } = await import("node:child_process");
            await new Promise<void>((resolve, reject) => {
              const child = spawn("gemini", ["-p", "Hi"], {
                stdio: "inherit",
                shell: process.platform === "win32",
              });
              child.on("error", reject);
              child.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Gemini CLI exited with code ${code}`));
              });
            });

            const model = `${PROVIDER_ID}/gemini-3-pro-preview`;
            return {
              profiles: [
                {
                  profileId: `${PROVIDER_ID}:oauth`,
                  credential: {
                    type: "oauth",
                    provider: PROVIDER_ID,
                  } as any,
                },
              ],
              defaultModel: model,
            };
          },
        },
      ],
    });
  },
};

export default geminiCliHeadlessPlugin;
