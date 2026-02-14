import fs from "node:fs/promises";
import path from "node:path";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { detectBinary } from "./onboard-helpers.js";
import { applyAuthProfileConfig } from "./onboard-auth.js";

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

export async function applyAuthChoiceGeminiCliHeadless(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "gemini-cli-headless") {
    return null;
  }

  let nextConfig = params.config;

  // --- 1. Detect gemini binary ---
  const hasGemini = await detectBinary("gemini");
  if (!hasGemini) {
    await params.prompter.note(
      [
        "The `gemini` CLI binary was not found on your PATH.",
        "",
        "Install it first:",
        "  npm install -g @anthropic-ai/gemini-cli",
        "",
        "Then re-run: openclaw onboard",
      ].join("\n"),
      "Gemini CLI (Headless)",
    );
    return { config: nextConfig };
  }

  // --- 2. Write ~/.gemini/settings.json ---
  try {
    await ensureGeminiSettings();
    await params.prompter.note(
      `Configured ${GEMINI_SETTINGS_PATH} for headless OAuth.`,
      "Gemini CLI (Headless)",
    );
  } catch (err) {
    await params.prompter.note(
      `Failed to write settings: ${String(err)}`,
      "Gemini CLI (Headless)",
    );
    return { config: nextConfig };
  }

  // --- 3. Trigger OAuth via gemini -p "Hi" ---
  await params.prompter.note(
    [
      "Running `gemini -p \"Hi\"` to trigger Google OAuth.",
      "A browser window will open — sign in with your Google account.",
    ].join("\n"),
    "Gemini CLI (Headless)",
  );

  try {
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("gemini", ["-p", "Hi"], { 
        stdio: "inherit",
        shell: process.platform === "win32" // Need shell on Windows to find .cmd/.ps1
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Gemini CLI exited with code ${code}`));
      });
    });
  } catch (err) {
    await params.prompter.note(
      `OAuth flow failed: ${String(err)}\nYou can retry manually: gemini -p "Hi"`,
      "Gemini CLI (Headless)",
    );
    return { config: nextConfig };
  }

  // --- 4. Wire auth profile ---
  nextConfig = applyAuthProfileConfig(nextConfig, {
    profileId: "gemini-cli-headless:oauth",
    provider: "gemini-cli-headless",
    mode: "oauth",
  });

  // --- 5. Set default model ---
  if (params.setDefaultModel) {
    const model = "gemini-cli-headless/gemini-2.5-pro";
    nextConfig = {
      ...nextConfig,
      agents: {
        ...nextConfig.agents,
        defaults: {
          ...nextConfig.agents?.defaults,
          model: {
            ...(typeof nextConfig.agents?.defaults?.model === "object"
              ? nextConfig.agents.defaults.model
              : undefined),
            primary: model,
          },
        },
      },
    };
    await params.prompter.note(`Default model set to ${model}`, "Model configured");
  }

  await params.prompter.note("Gemini CLI (Headless) is ready!", "Gemini CLI (Headless)");
  return { config: nextConfig };
}
