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
  resolveSessionIdToSend,
  resolveSystemPromptUsage,
  writeCliImages,
  writeSystemPromptFile,
  createGeminiExtension,
} from "./cli-runner/helpers.js";
import { resolveOpenClawDocsPath } from "./docs-path.js";
import { FailoverError, resolveFailoverStatus } from "./failover-error.js";
import { classifyFailoverReason, isFailoverErrorMessage } from "./pi-embedded-helpers.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
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

    // Determine whether to resume an existing Gemini CLI session.
    // When cliSessionId is set, we have a previous session to continue.
    const { sessionId: resolvedCliSessionId, isNew: isNewCliSession } = resolveSessionIdToSend({
      backend,
      cliSessionId: params.cliSessionId,
    });
    const useResume =
      !isNewCliSession && !!resolvedCliSessionId && (backend.resumeArgs?.length ?? 0) > 0;

    const isStreaming = !!(
      params.onPartialReply ||
      params.onReasoningStream ||
      params.onAgentEvent
    );
    const baseArgs = useResume
      ? (backend.resumeArgs ?? backend.args ?? [])
      : isStreaming && backend.streamingArgs
        ? backend.streamingArgs
        : (backend.args ?? []);

    const args = buildCliArgs({
      backend,
      baseArgs: useResume
        ? baseArgs.map((arg) => arg.replaceAll("{sessionId}", resolvedCliSessionId!))
        : baseArgs,
      modelId: normalizedModel,
      sessionId: resolvedCliSessionId,
      systemPrompt: resolveSystemPromptUsage({
        backend,
        isNewSession: isNewCliSession,
        systemPrompt,
      }),
      imagePaths,
      promptArg: argsPrompt,
      useResume,
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
        OPENCLAW_SESSION_KEY: params.sessionKey ?? params.sessionId,
        OPENCLAW_AGENT_ID: sessionAgentId,
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
    // Track the Gemini CLI session ID (from init event) and usage (from result event)
    let geminiCliSessionId: string | undefined;
    let streamUsage:
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
      | undefined;
    // Track accumulated reasoning text
    let accumulatedReasoning = "";
    // Track streaming errors (e.g. "Loop detected, stopping execution")
    const streamErrors: string[] = [];

    log.info(
      `cli exec: provider=${params.provider} model=${normalizedModel} promptChars=${params.prompt.length} resume=${useResume} cliSession=${resolvedCliSessionId ?? "new"}`,
    );

    const result = await runCommandWithTimeout([backend.command ?? "gemini", ...args], {
      timeoutMs: params.timeoutMs,
      // Enforce a strict total timeout to prevent infinite loops (e.g. continuous "thinking" output)
      // from keeping the process alive indefinitely.
      maxTotalTimeoutMs: params.timeoutMs,
      cwd: workspaceDir,
      env,
      input: stdin ?? "",
      onStdout: (data) => {
        const lines = data.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          try {
            const chunk = JSON.parse(trimmed);

            // Gemini stream-json event: init — capture session_id for continuation
            if (chunk.type === "init") {
              if (typeof chunk.session_id === "string" && chunk.session_id.trim()) {
                geminiCliSessionId = chunk.session_id.trim();
              }
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "init",
                  data: {
                    sessionId: geminiCliSessionId,
                    model: chunk.model,
                    resumed: useResume,
                  },
                });
              }
            }

            // Gemini stream-json event: assistant message
            else if (
              (chunk.type === "message" &&
                (chunk.role === "model" || chunk.role === "assistant")) ||
              chunk.type === "text"
            ) {
              const content = chunk.content ?? chunk.text ?? "";
              if (params.onPartialReply) {
                void params.onPartialReply({ text: content });
              }
              accumulatedText += content;
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "assistant",
                  data: { text: accumulatedText, delta: content },
                });
              }
            }

            // Gemini stream-json event: thinking / reasoning
            // The Gemini CLI may emit these as "thinking" type events or inline
            // in the model's response. We surface them for the UI.
            else if (chunk.type === "thinking") {
              const content = chunk.content ?? chunk.text ?? "";
              accumulatedReasoning += content;
              if (params.onReasoningStream) {
                void params.onReasoningStream({ text: content });
              }
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "reasoning",
                  data: { text: accumulatedReasoning, delta: content },
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

            // Gemini stream-json event: result — capture usage stats
            else if (chunk.type === "result") {
              const stats = chunk.stats;
              if (stats && typeof stats === "object") {
                streamUsage = {
                  input:
                    typeof stats.input_tokens === "number"
                      ? stats.input_tokens
                      : typeof stats.input === "number"
                        ? stats.input
                        : undefined,
                  output:
                    typeof stats.output_tokens === "number"
                      ? stats.output_tokens
                      : typeof stats.output === "number"
                        ? stats.output
                        : undefined,
                  total:
                    typeof stats.total_tokens === "number"
                      ? stats.total_tokens
                      : typeof stats.total === "number"
                        ? stats.total
                        : undefined,
                  cacheRead:
                    typeof stats.cached === "number" && stats.cached > 0 ? stats.cached : undefined,
                };
              }
              if (params.onAgentEvent) {
                params.onAgentEvent({
                  stream: "result",
                  data: {
                    status: chunk.status,
                    usage: streamUsage,
                    sessionId: geminiCliSessionId,
                    durationMs:
                      typeof stats?.duration_ms === "number" ? stats.duration_ms : undefined,
                    toolCalls: typeof stats?.tool_calls === "number" ? stats.tool_calls : undefined,
                  },
                });
              }
            }

            // Gemini stream-json event: error
            else if (chunk.type === "error") {
              const errMsg = typeof chunk.message === "string" ? chunk.message.trim() : "";
              if (errMsg) {
                streamErrors.push(errMsg);
                log.warn(`cli stream error: ${errMsg}`);
              }
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
      if (stdout) {
        log.debug(`cli stdout:\n${stdout}`);
      }
      if (stderr) {
        log.debug(`cli stderr:\n${stderr}`);
      }
    }

    // --- Error handling with Gemini-specific exit codes ---
    if (result.code !== 0) {
      const errorText = stderr || stdout || "CLI failed.";
      let reason: string | null = null;

      // Map Gemini CLI-specific exit codes
      switch (result.code) {
        case 41:
          reason = "auth";
          break; // FatalAuthenticationError
        case 53:
          reason = "rate_limit";
          break; // FatalTurnLimitedError (retryable)
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
    // Prefer usage captured from streaming result events; fall back to final parse
    let usage = streamUsage;

    if (outputMode === "json" || outputMode === "jsonl") {
      const parsed =
        outputMode === "jsonl" ? parseCliJsonl(stdout, backend) : parseCliJson(stdout, backend);
      if (parsed) {
        text = parsed.text;
        // If we didn't capture usage from streaming, use the parsed value
        if (!usage) {
          usage = parsed.usage;
        }
        // If we didn't capture session ID from streaming, use the parsed value
        if (!geminiCliSessionId && parsed.sessionId) {
          geminiCliSessionId = parsed.sessionId;
        }
      }
    }

    // If the CLI produced stream errors (e.g. loop detection) but no assistant
    // text, surface the error messages so the user actually sees what happened.
    if (!text?.trim() && streamErrors.length > 0) {
      text = `⚠️ ${streamErrors.join("\n")}`;
    }

    const payloads = text?.trim() ? [{ text: text.trim() }] : undefined;

    // Return the Gemini CLI session ID (not the OpenClaw session ID) so it gets
    // stored for conversation continuation on the next message.
    return {
      payloads,
      meta: {
        durationMs: Date.now() - started,
        agentMeta: {
          sessionId: geminiCliSessionId ?? params.sessionId,
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
    if (cleanupExtension) {
      await cleanupExtension();
    }
    if (cleanupSystemPrompt) {
      await cleanupSystemPrompt();
    }
    if (cleanupImages) {
      await cleanupImages();
    }
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
