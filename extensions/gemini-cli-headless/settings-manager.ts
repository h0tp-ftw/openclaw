/**
 * Manages ~/.gemini/settings.json for headless OAuth mode.
 *
 * Ensures the settings file exists and contains the required configuration
 * for headless authentication (personal OAuth, telemetry disabled, Gemini 3 enabled).
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const GEMINI_DIR = path.join(os.homedir(), ".gemini");
export const GEMINI_SETTINGS_PATH = path.join(GEMINI_DIR, "settings.json");

/**
 * Settings required for headless operation.
 * - `security.auth.selectedType`: use personal OAuth flow
 * - `coreClient.disableTelemetry`: no telemetry in headless mode
 * - `models.gemini3`: enable Gemini 3 model family
 */
const HEADLESS_SETTINGS = {
  security: { auth: { selectedType: "oauth-personal" } },
  coreClient: { disableTelemetry: true },
  models: { gemini3: true },
} as const;

/**
 * Read, merge, and write ~/.gemini/settings.json with headless-required settings.
 * Creates the directory and file if they don't exist.
 * Preserves any existing settings that don't conflict.
 */
export async function ensureGeminiSettings(): Promise<void> {
  await fs.mkdir(GEMINI_DIR, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(GEMINI_SETTINGS_PATH, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid — start fresh.
  }

  // Deep merge to preserve existing user settings while enforcing our requirements
  const merged = JSON.parse(JSON.stringify(existing));

  // Security
  if (!merged.security) merged.security = {};
  if (!merged.security.auth) merged.security.auth = {};
  merged.security.auth.selectedType = HEADLESS_SETTINGS.security.auth.selectedType;

  // Telemetry
  if (!merged.coreClient) merged.coreClient = {};
  merged.coreClient.disableTelemetry = HEADLESS_SETTINGS.coreClient.disableTelemetry;

  // Models (Enable Gemini 3 Preview)
  if (!merged.models) merged.models = {};
  merged.models.gemini3 = HEADLESS_SETTINGS.models.gemini3;

  await fs.writeFile(GEMINI_SETTINGS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}
