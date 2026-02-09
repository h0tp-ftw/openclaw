import { describe, expect, it, vi, beforeEach } from "vitest";
import { runCliAgent } from "./cli-runner.js";
import { runCommandWithTimeout } from "../process/exec.js";

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: vi.fn(),
  runExec: vi.fn(),
}));

// Mock the helpers that create temp files / extensions
vi.mock("./cli-runner/helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli-runner/helpers.js")>();
  return {
    ...actual,
    createGeminiExtension: vi.fn(async () => ({
      path: "/tmp/mock-ext",
      cleanup: async () => {},
    })),
    writeSystemPromptFile: vi.fn(async () => ({
      path: "/tmp/mock-sysprompt.md",
      cleanup: async () => {},
    })),
  };
});

vi.mock("./pi-tools.js", () => ({
  createOpenClawCodingTools: vi.fn(() => [
    {
      name: "mock_tool",
      description: "A mock tool",
      parameters: { type: "object", properties: {} },
      execute: async () => "ok",
    },
  ]),
}));

describe("runCliAgent streaming", () => {
  beforeEach(() => {
    vi.mocked(runCommandWithTimeout).mockReset();
  });

  it("emits reasoning and assistant events from JSONL output", async () => {
    const onPartialReply = vi.fn();
    const onReasoningStream = vi.fn();
    const onAgentEvent = vi.fn();

    vi.mocked(runCommandWithTimeout).mockImplementation(async (argv, opts) => {
      if (opts.onStdout) {
        opts.onStdout('{"type": "thinking", "content": "Thinking about it..."}\n');
        opts.onStdout('{"type": "text", "content": "The answer is "}\n');
        opts.onStdout('{"type": "text", "content": "42."}\n');
        opts.onStdout('{"type": "event", "stream": "tool", "data": {"phase": "start", "tool": "calc"}}\n');
      }
      return {
        stdout: '{"type": "text", "content": "The answer is 42."}', // Simplified for test
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      };
    });

    await runCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "gemini-cli",
      timeoutMs: 1000,
      runId: "run-1",
      onPartialReply,
      onReasoningStream,
      onAgentEvent,
    });

    // Verify reasoning
    expect(onReasoningStream).toHaveBeenCalledWith({ text: "Thinking about it..." });
    expect(onAgentEvent).toHaveBeenCalledWith({ 
      stream: "reasoning", 
      data: { text: "Thinking about it...", delta: "Thinking about it..." } 
    });

    // Verify partial replies (deltas)
    expect(onPartialReply).toHaveBeenCalledWith({ text: "The answer is " });
    expect(onPartialReply).toHaveBeenCalledWith({ text: "42." });

    // Verify assistant events (accumulated + delta)
    expect(onAgentEvent).toHaveBeenCalledWith({ 
      stream: "assistant", 
      data: { text: "The answer is ", delta: "The answer is " } 
    });
    expect(onAgentEvent).toHaveBeenCalledWith({ 
      stream: "assistant", 
      data: { text: "The answer is 42.", delta: "42." } 
    });

    // Verify custom events
    expect(onAgentEvent).toHaveBeenCalledWith({ 
      stream: "tool", 
      data: { phase: "start", tool: "calc" } 
    });
  });

  it("uses streamingArgs when callbacks are present", async () => {
    vi.mocked(runCommandWithTimeout).mockResolvedValue({
      stdout: "{}",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    await runCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "gemini-cli",
      timeoutMs: 1000,
      runId: "run-2",
      onPartialReply: () => {},
    });

    const argv = vi.mocked(runCommandWithTimeout).mock.calls[0][0];
    // Gemini backend is configured with --output-format stream-json in streamingArgs
    expect(argv).toContain("stream-json");
  });
});
