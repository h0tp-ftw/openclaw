import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceGoogleGeminiCli(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "google-gemini-cli") {
    return null;
  }

  const mode = await params.prompter.select({
    message: "Choose Gemini CLI mode:",
    options: [
      {
        value: "headless",
        label: "Headless (Binary)",
        hint: "Uses local `gemini` binary (requires `npm install -g @google/gemini-cli`)",
      },
      {
        value: "api",
        label: "API (Node.js)",
        hint: "Uses standard Google API via Node.js (OAuth)",
      },
    ],
  });

  if (mode === "headless") {
    return await applyAuthChoicePluginProvider(params, {
      authChoice: "google-gemini-cli",
      pluginId: "gemini-cli-headless",
      providerId: "gemini-cli-headless", // Maps to extension's provider ID
      methodId: "oauth",
      label: "Gemini CLI (Headless)",
    });
  }

  return await applyAuthChoicePluginProvider(params, {
    authChoice: "google-gemini-cli",
    pluginId: "google-gemini-cli-auth",
    providerId: "google-gemini-cli",
    methodId: "oauth",
    label: "Gemini CLI (API)",
  });
}
