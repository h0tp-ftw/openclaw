import type { ImageContent } from "@mariozechner/pi-ai";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { OpenClawConfig } from "../config/config.js";
import type { EmbeddedPiRunResult } from "./pi-embedded-runner.js";
import { resolveHeartbeatPrompt } from "../auto-reply/heartbeat.js";
import { shouldLogVerbose } from "../globals.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveSessionAgentIds } from "./agent-scope.js";
import { makeBootstrapWarn, resolveBootstrapContextForRun } from "./bootstrap-files.js";
import { resolveCliBackendConfig } from "./cli-backends.js";
import {
  buildCliArgs,
  buildSystemPrompt,
  normalizeCliModel,
  parseCliJson,
  parseCliJsonl,
  resolvePromptInput,
  resolveSystemPromptUsage,
  writeCliImages,
  writeSystemPromptFile,
  createGeminiExtension,
} from "./cli-runner/helpers.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { resolveOpenClawDocsPath } from "./docs-path.js";
import { FailoverError, resolveFailoverStatus } from "./failover-error.js";
import { classifyFailoverReason, isFailoverErrorMessage } from "./pi-embedded-helpers.js";
import { redactRunIdentifier, resolveRunWorkspaceDir } from "./workspace-run.js";

const log = createSubsystemLogger("agent/claude-cli");

export async function runCliAgent(params: {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: OpenClawConfig;
  prompt: string;
  provider: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  extraSystemPrompt?: string;
  streamParams?: import("../commands/agent/types.js").AgentStreamParams;
  ownerNumbers?: string[];
  cliSessionId?: string;
  images?: ImageContent[];
  onPartialReply?: (payload: { text?: string; mediaUrls?: string[] }) => void | Promise<void>;
  onReasoningStream?: (payload: { text?: string; mediaUrls?: string[] }) => void | Promise<void>;
  onAgentEvent?: (evt: { stream: string; data: Record<string, unknown> }) => void;
}): Promise<EmbeddedPiRunResult> {
  const started = Date.now();
  const workspaceResolution = resolveRunWorkspaceDir({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    config: params.config,
  });
  const resolvedWorkspace = workspaceResolution.workspaceDir;
  const redactedSessionId = redactRunIdentifier(params.sessionId);
  const redactedSessionKey = redactRunIdentifier(params.sessionKey);
  const redactedWorkspace = redactRunIdentifier(resolvedWorkspace);
  if (workspaceResolution.usedFallback) {
    log.warn(
      `[workspace-fallback] caller=runCliAgent reason=${workspaceResolution.fallbackReason} run=${params.runId} session=${redactedSessionId} sessionKey=${redactedSessionKey} agent=${workspaceResolution.agentId} workspace=${redactedWorkspace}`,
    );
  }
  const workspaceDir = resolvedWorkspace;

  const backendResolved = resolveCliBackendConfig(params.provider, params.config);
  if (!backendResolved) {
    throw new Error(`Unknown CLI backend: ${params.provider}`);
  }
  const backend = backendResolved.config;
  const modelId = (params.model ?? "default").trim() || "default";
  const normalizedModel = normalizeCliModel(modelId, backend);
  const modelDisplay = `${params.provider}/${modelId}`;

  const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.config,
  });

  const tools = createOpenClawCodingTools({
    config: params.config,
    sessionKey: params.sessionKey,
    workspaceDir,
    modelProvider: params.provider,
    modelId: params.model,
    // Provide a minimal sandbox context if available, otherwise undefined
    // For CLI runner, we might need to resolve sandbox if we want sandboxed tools.
    // Assuming local execution for now as per MVP.
    // We don't inject tools via XML anymore for native MCP interaction
    // But we might still want them for reference if we need them, though
    // createGeminiExtension handles the tool definitions internally via MCP server.
  });
  // const toolsXml = formatToolsForGeminiXml(tools);

  const heartbeatPrompt =
    sessionAgentId === defaultAgentId
      ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
      : undefined;
  const docsPath = await resolveOpenClawDocsPath({
    workspaceDir,
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url,
  });

  const usesSystemPromptEnv = Boolean(backend.systemPromptEnvVar);
  const extraSystemPrompt = [
    params.extraSystemPrompt?.trim(),
    // Inject tools XML into system prompt
    // Note: We use the system prompt for tool definitions to keep them persistent.
    // toolsXml, // REMOVED for native MCP
    usesSystemPromptEnv ? undefined : "Tools are disabled in this session. Do not call tools.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const sessionLabel = params.sessionKey ?? params.sessionId;
  const { contextFiles } = await resolveBootstrapContextForRun({
    workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
  });

  // Initial System Prompt Construction
  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    config: params.config,
    defaultThinkLevel: params.thinkLevel,
    extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    heartbeatPrompt,
    docsPath: docsPath ?? undefined,
    tools: [], // We inject tools via extraSystemPrompt string, not this array
    contextFiles,
    modelDisplay,
    agentId: sessionAgentId,
  });

  // The tool loop is now handled by Gemini CLI itself via the MCP extension.
  // We run once and let the CLI handle tool invocations natively.

  let cleanupExtension: (() => Promise<void>) | undefined;
  let cleanupSystemPrompt: (() => Promise<void>) | undefined;
  let cleanupImages: (() => Promise<void>) | undefined;

  try {
    const extensionPayload = await createGeminiExtension();
    cleanupExtension = extensionPayload.cleanup;

    // Handle images
    let imagePaths: string[] | undefined;
    if (params.images && params.images.length > 0) {
      const imagePayload = await writeCliImages(params.images);
      imagePaths = imagePayload.paths;
      cleanupImages = imagePayload.cleanup;
    }

    const { argsPrompt, stdin } = resolvePromptInput({
      backend,
      prompt: params.prompt,
    });

    const isStreaming = !!(params.onPartialReply || params.onReasoningStream || params.onAgentEvent);
    const args = buildCliArgs({
      backend,
      baseArgs: isStreaming && backend.streamingArgs ? backend.streamingArgs : (backend.args ?? []),
      modelId: normalizedModel,
      sessionId: params.cliSessionId ?? params.sessionId,
      systemPrompt: resolveSystemPromptUsage({ backend, isNewSession: true, systemPrompt }),
      imagePaths,
      promptArg: argsPrompt,
      useResume: false,
    });

    // Ensure the MCP extension is loaded
    if (!args.includes("openclaw-tools")) {
      args.unshift("-e", "openclaw-tools");
    }

    // Build env: spread process.env, apply backend overrides, clear sensitive keys, add extensions
    const env = (() => {
      const next: Record<string, string | undefined> = {
        ...process.env,
        ...backend.env,
        GEMINI_EXTENSION_PATH: extensionPayload.path,
        OPENCLAW_MCP_MODEL_PROVIDER: params.provider,
        OPENCLAW_MCP_MODEL_ID: params.model ?? "",
      };
      for (const key of backend.clearEnv ?? []) {
        delete next[key];
      }
      return next;
    })();

    // Inject system prompt via env var if the backend supports it
    if (usesSystemPromptEnv && systemPrompt) {
      const sysPromptResult = await writeSystemPromptFile(systemPrompt);
      env[backend.systemPromptEnvVar!] = sysPromptResult.path;
      cleanupSystemPrompt = sysPromptResult.cleanup;
    }

    // Track accumulated assistant text for delta computation in onAgentEvent
    let accumulatedText = "";

    log.info(
      `cli exec: provider=${params.provider} model=${normalizedModel} promptChars=${params.prompt.length}`,
    );

    const result = await runCommandWithTimeout([backend.command ?? "gemini", ...args], {
      timeoutMs: params.timeoutMs,
      cwd: workspaceDir,
      env,
      input: stdin ?? "",
      onStdout: (data) => {
        const lines = data.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);

            // Gemini stream-json event: assistant message
            if (
              chunk.type === "message" && chunk.role === "model" ||
              chunk.type === "text"
            ) {
              const content = chunk.content ?? chunk.text ?? "";
              if (params.onPartialReply) void params.onPartialReply({ text: content });
              accumulatedText += content;
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "assistant",
                  data: { text: accumulatedText, delta: content },
                });
              }
            }

            // Gemini stream-json event: thinking / reasoning
            else if (chunk.type === "thinking") {
              const content = chunk.content ?? "";
              if (params.onReasoningStream) void params.onReasoningStream({ text: content });
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "reasoning",
                  data: { text: content, delta: content },
                });
              }
            }

            // Gemini stream-json event: tool invocation
            else if (chunk.type === "tool_use") {
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "tool",
                  data: { phase: "start", tool: chunk.tool_name, ...chunk },
                });
              }
            }

            // Gemini stream-json event: tool result
            else if (chunk.type === "tool_result") {
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "tool",
                  data: { phase: "end", tool: chunk.tool_id, status: chunk.status },
                });
              }
            }

            // Gemini stream-json event: error
            else if (chunk.type === "error") {
              if (params.onAgentEvent) {
                params.onAgentEvent({ stream: "error", data: chunk });
              }
            }

            // Gemini stream-json event: generic event passthrough
            else if (chunk.type === "event" && chunk.stream) {
              if (params.onAgentEvent) {
                params.onAgentEvent({ stream: chunk.stream, data: chunk.data ?? chunk });
              }
            }
          } catch {
            // Not JSON — ignore partial lines
          }
        }
      },
    });

    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    if (shouldLogVerbose()) {
      if (stdout) log.debug(`cli stdout:\n${stdout}`);
      if (stderr) log.debug(`cli stderr:\n${stderr}`);
    }

    // --- Error handling with Gemini-specific exit codes ---
    if (result.code !== 0) {
      const errorText = stderr || stdout || "CLI failed.";
      let reason: string | null = null;

      // Map Gemini CLI-specific exit codes
      switch (result.code) {
        case 41: reason = "auth"; break;        // FatalAuthenticationError
        case 53: reason = "rate_limit"; break;  // FatalTurnLimitedError (retryable)
        case 42: // FatalInputError
        case 44: // FatalSandboxError
        case 52: // FatalConfigError
          reason = "unknown";
          break;
        default:
          reason = classifyFailoverReason(errorText) ?? "unknown";
      }

      const status = resolveFailoverStatus(reason as any);
      throw new FailoverError(errorText, {
        reason: reason as any,
        provider: params.provider,
        model: modelId,
        status,
      });
    }

    // --- Parse output ---
    const outputMode = backend.output;
    let text = stdout;
    let usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } | undefined;

    if (outputMode === "json" || outputMode === "jsonl") {
      const parsed = outputMode === "jsonl"
        ? parseCliJsonl(stdout, backend)
        : parseCliJson(stdout, backend);
      if (parsed) {
        text = parsed.text;
        usage = parsed.usage;
      }
    }

    const payloads = text?.trim() ? [{ text: text.trim() }] : undefined;

    return {
      payloads,
      meta: {
        durationMs: Date.now() - started,
        agentMeta: {
          sessionId: params.sessionId,
          provider: params.provider,
          model: modelId,
          usage,
        },
      },
    };
  } catch (err) {
    if (err instanceof FailoverError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isFailoverErrorMessage(message)) {
      const reason = classifyFailoverReason(message) ?? "unknown";
      const status = resolveFailoverStatus(reason);
      throw new FailoverError(message, {
        reason,
        provider: params.provider,
        model: modelId,
        status,
      });
    }
    throw err;
  } finally {
    if (cleanupExtension) await cleanupExtension();
    if (cleanupSystemPrompt) await cleanupSystemPrompt();
    if (cleanupImages) await cleanupImages();
  }
}

export async function runClaudeCliAgent(params: {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: OpenClawConfig;
  prompt: string;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  claudeSessionId?: string;
  images?: ImageContent[];
}): Promise<EmbeddedPiRunResult> {
  return runCliAgent({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    config: params.config,
    prompt: params.prompt,
    provider: params.provider ?? "claude-cli",
    model: params.model ?? "opus",
    thinkLevel: params.thinkLevel,
    timeoutMs: params.timeoutMs,
    runId: params.runId,
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    cliSessionId: params.claudeSessionId,
    images: params.images,
  });
}
