import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceGoogleHeadlessGeminiCli(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  return await applyAuthChoicePluginProvider(params, {
    authChoice: "google-headless-gemini-cli",
    pluginId: "google-headless-gemini-cli-auth",
    providerId: "google-headless-gemini-cli",
    methodId: "oauth",
    label: "Headless Gemini CLI",
  });
}
