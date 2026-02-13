import { type OpenClawConfig, loadConfig } from "../config/config.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import { ensureOpenClawModelsJson } from "./models-config.js";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

type DiscoveredModel = {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

type PiSdkModule = typeof import("./pi-model-discovery.js");

let modelCatalogPromise: Promise<ModelCatalogEntry[]> | null = null;
let hasLoggedModelCatalogError = false;
const defaultImportPiSdk = () => import("./pi-model-discovery.js");
let importPiSdk = defaultImportPiSdk;

export function resetModelCatalogCacheForTest() {
  modelCatalogPromise = null;
  hasLoggedModelCatalogError = false;
  importPiSdk = defaultImportPiSdk;
}

// Test-only escape hatch: allow mocking the dynamic import to simulate transient failures.
export function __setModelCatalogImportForTest(loader?: () => Promise<PiSdkModule>) {
  importPiSdk = loader ?? defaultImportPiSdk;
}

export async function loadModelCatalog(params?: {
  config?: OpenClawConfig;
  useCache?: boolean;
}): Promise<ModelCatalogEntry[]> {
  if (params?.useCache === false) {
    modelCatalogPromise = null;
  }
  if (modelCatalogPromise) {
    return modelCatalogPromise;
  }

  modelCatalogPromise = (async () => {
    const models: ModelCatalogEntry[] = [];
    const sortModels = (entries: ModelCatalogEntry[]) =>
      entries.sort((a, b) => {
        const p = a.provider.localeCompare(b.provider);
        if (p !== 0) {
          return p;
        }
        return a.name.localeCompare(b.name);
      });

    let cfg = params?.config;
    if (!cfg) {
      try {
        cfg = (await import("../config/config.js")).loadConfig();
      } catch {
        // Fallback or ignore
      }
    }

    try {
      if (cfg) {
        await ensureOpenClawModelsJson(cfg);
      }

      // IMPORTANT: keep the dynamic import *inside* the try/catch.
      const piSdk = await importPiSdk();
      const agentDir = resolveOpenClawAgentDir();
      const { join } = await import("node:path");

      let registryItems: Array<DiscoveredModel> = [];
      try {
        const authStorage = new piSdk.AuthStorage(join(agentDir, "auth.json"));
        const registry = new piSdk.ModelRegistry(authStorage, join(agentDir, "models.json")) as
          | {
              getAll: () => Array<DiscoveredModel>;
            }
          | Array<DiscoveredModel>;
        registryItems = Array.isArray(registry) ? registry : registry.getAll();
      } catch (e) {
        // Ignore registry load errors, proceed with empty or partial
      }

      for (const entry of registryItems) {
        const id = String(entry?.id ?? "").trim();
        if (!id) {
          continue;
        }
        const provider = String(entry?.provider ?? "").trim();
        if (!provider) {
          continue;
        }
        const name = String(entry?.name ?? id).trim() || id;
        const contextWindow =
          typeof entry?.contextWindow === "number" && entry.contextWindow > 0
            ? entry.contextWindow
            : undefined;
        const reasoning = typeof entry?.reasoning === "boolean" ? entry.reasoning : undefined;
        const input = Array.isArray(entry?.input) ? entry.input : undefined;
        models.push({ id, name, provider, contextWindow, reasoning, input });
      }

      if (models.length === 0) {
        modelCatalogPromise = null;
      }

      // Explicitly add Gemini CLI models requested by user
      const geminiModels: ModelCatalogEntry[] = [
        {
          id: "gemini-3-pro-preview",
          name: "Gemini 3 Pro",
          provider: "headless-gemini-cli",
          contextWindow: 2097152,
          input: ["text", "image"],
        },
        {
          id: "gemini-3-flash-preview",
          name: "Gemini 3 Flash",
          provider: "headless-gemini-cli",
          contextWindow: 1048576,
          input: ["text", "image"],
        },
        {
          id: "gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
          provider: "headless-gemini-cli",
          contextWindow: 2097152,
          input: ["text", "image"],
        },
        {
          id: "gemini-2.5-flash",
          name: "Gemini 2.5 Flash",
          provider: "headless-gemini-cli",
          contextWindow: 1048576,
          input: ["text", "image"],
        },
        {
          id: "gemini-2.5-flash-lite",
          name: "Gemini 2.5 Flash Lite",
          provider: "headless-gemini-cli",
          contextWindow: 1048576,
          input: ["text", "image"],
        },
        {
          id: "auto-gemini-3",
          name: "Auto Gemini 3",
          provider: "headless-gemini-cli",
          contextWindow: 2097152,
          input: ["text", "image"],
        },
        {
          id: "auto-gemini-2.5",
          name: "Auto Gemini 2.5",
          provider: "headless-gemini-cli",
          contextWindow: 2097152,
          input: ["text", "image"],
        },
      ];

      for (const gm of geminiModels) {
        if (!models.some((m) => m.provider === gm.provider && m.id === gm.id)) {
          models.push(gm);
        }
      }

      if (cfg?.agents?.defaults?.cliMode) {
        const { isCliProvider } = await import("./model-selection.js");
        const filtered = models.filter((m) => isCliProvider(m.provider, cfg));
        return sortModels(filtered);
      }

      return sortModels(models);
    } catch (error) {
      if (!hasLoggedModelCatalogError) {
        hasLoggedModelCatalogError = true;
        console.warn(`[model-catalog] Failed to load model catalog: ${String(error)}`);
      }
      modelCatalogPromise = null;

      // Attempt to filter even on failure if we have models
      if (cfg?.agents?.defaults?.cliMode && models.length > 0) {
        try {
          const { isCliProvider } = await import("./model-selection.js");
          const filtered = models.filter((m) => isCliProvider(m.provider, cfg));
          return sortModels(filtered);
        } catch {
          // ignore import error
        }
      }

      if (models.length > 0) {
        return sortModels(models);
      }
      return [];
    }
  })();

  return modelCatalogPromise;
}

/**
 * Check if a model supports image input based on its catalog entry.
 */
export function modelSupportsVision(entry: ModelCatalogEntry | undefined): boolean {
  return entry?.input?.includes("image") ?? false;
}

/**
 * Find a model in the catalog by provider and model ID.
 */
export function findModelInCatalog(
  catalog: ModelCatalogEntry[],
  provider: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  const normalizedProvider = provider.toLowerCase().trim();
  const normalizedModelId = modelId.toLowerCase().trim();
  return catalog.find(
    (entry) =>
      entry.provider.toLowerCase() === normalizedProvider &&
      entry.id.toLowerCase() === normalizedModelId,
  );
}
