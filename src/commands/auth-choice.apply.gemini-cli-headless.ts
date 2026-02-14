import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceGeminiCliHeadless(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  return await applyAuthChoicePluginProvider(params, {
    authChoice: "gemini-cli-headless",
    pluginId: "google-gemini-cli-auth",
    providerId: "gemini-cli-headless",
    methodId: "oauth",
    label: "Gemini CLI (Headless)",
  });
}
