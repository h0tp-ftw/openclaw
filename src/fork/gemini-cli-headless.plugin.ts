import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi, ProviderPlugin, ProviderAuthContext, ProviderAuthResult } from "../plugins/types.js";
import { detectBinary } from "../commands/onboard-helpers.js";
import { resolveUserPath } from "../utils.js";

const GEMINI_SETTINGS_PATH = path.join(resolveUserPath("~/.gemini"), "settings.json");

const HEADLESS_SETTINGS = {
  security: { auth: { selectedType: "oauth-personal" } },
  coreClient: { disableTelemetry: true },
  models: { gemini3: true },
};

async function ensureGeminiSettings(): Promise<void> {
  const dir = path.dirname(GEMINI_SETTINGS_PATH);
  await fs.mkdir(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(GEMINI_SETTINGS_PATH, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid — start fresh.
  }

  const merged = { ...existing, ...HEADLESS_SETTINGS };
  await fs.writeFile(GEMINI_SETTINGS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

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

const DEFAULT_GEMINI_BACKEND = {
  command: "gemini",
  args: ["--output-format", "stream-json", "--yolo"],
  streamingArgs: ["--output-format", "stream-json", "--yolo"],
  resumeArgs: ["--output-format", "stream-json", "--yolo", "--resume", "{sessionId}"],
  env: {
    GEMINI_TELEMETRY_ENABLED: "false",
    GEMINI_TELEMETRY_LOG_PROMPTS: "false",
  },
  output: "jsonl",
  input: "arg",
  promptArg: "-p",
  modelArg: "-m",
  modelAliases: GEMINI_MODEL_ALIASES,
  sessionMode: "existing",
  sessionIdFields: ["session_id"],
  systemPromptEnvVar: "GEMINI_SYSTEM_MD",
  serialize: true,
} as const;

export const geminiCliHeadlessPlugin: ProviderPlugin = {
  id: "gemini-cli-headless",
  label: "Gemini CLI (Headless)",
  cliBackend: DEFAULT_GEMINI_BACKEND as any,
  auth: [
    {
      id: "oauth",
      label: "Google OAuth (Headless)",
      kind: "custom",
      run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
        // --- 1. Detect gemini binary ---
        const hasGemini = await detectBinary("gemini");
        if (!hasGemini) {
          throw new Error("The `gemini` CLI binary was not found on your PATH. Install it with: npm install -g @anthropic-ai/gemini-cli");
        }

        // --- 2. Write ~/.gemini/settings.json ---
        await ensureGeminiSettings();
        await ctx.prompter.note(`Configured ${GEMINI_SETTINGS_PATH} for headless OAuth.`, "Gemini CLI (Headless)");

        // --- 3. Trigger OAuth via gemini -p "Hi" ---
        await ctx.prompter.note("Running `gemini -p \"Hi\"` to trigger Google OAuth. Check your browser.", "Gemini CLI (Headless)");

        const { spawn } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const child = spawn("gemini", ["-p", "Hi"], { 
            stdio: "inherit",
            shell: process.platform === "win32"
          });
          child.on("error", reject);
          child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Gemini CLI exited with code ${code}`));
          });
        });

        const model = "gemini-cli-headless/gemini-2.5-pro";
        return {
          profiles: [
            {
              profileId: "gemini-cli-headless:oauth",
              credential: {
                type: "oauth",
                provider: "gemini-cli-headless",
              } as any
            }
          ],
          defaultModel: model
        };
      }
    }
  ]
};

export default function(api: OpenClawPluginApi) {
  api.registerProvider(geminiCliHeadlessPlugin);
}
