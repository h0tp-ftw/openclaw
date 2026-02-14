import { resolveCliBackendConfig } from "../agents/cli-backends.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { loadOpenClawPlugins } from "../plugins/loader.js";
import { normalizeProviderId } from "../agents/model-selection.js";

async function verify() {
  console.log("Verifying restructuring...");

  const cfg = {}; // Empty config
  const workspaceDir = resolveDefaultAgentWorkspaceDir();

  console.log("Loading plugins...");
  const registry = loadOpenClawPlugins({ config: cfg as any, workspaceDir });
  
  const geminiPlugin = registry.providers.find(p => normalizeProviderId(p.provider.id) === "gemini-cli-headless");
  if (geminiPlugin) {
    console.log("✅ Plugin 'gemini-cli-headless' found in registry.");
  } else {
    console.error("❌ Plugin 'gemini-cli-headless' NOT found in registry.");
    process.exit(1);
  }

  console.log("Resolving CLI backend config...");
  const backend = resolveCliBackendConfig("gemini-cli-headless", cfg as any);
  if (backend && backend.config.command === "gemini") {
    console.log("✅ CLI backend 'gemini-cli-headless' resolved correctly.");
    console.log("Backend config:", JSON.stringify(backend.config, null, 2));
  } else {
    console.error("❌ CLI backend 'gemini-cli-headless' failed to resolve.");
    process.exit(1);
  }

  console.log("Verification successful!");
}

verify().catch(err => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
