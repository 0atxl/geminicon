import fs from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

function loadContent(options: {
  querySelector?: (selector: string) => any;
  querySelectorAll?: (selector: string) => any[];
  execCommand?: (...args: any[]) => boolean;
} = {}) {
  const listeners: any[] = [];
  const document = {
    body: { innerText: "", dispatchEvent: vi.fn() },
    querySelector: vi.fn((selector: string) => {
      const selected = options.querySelector?.(selector);
      if (selected !== undefined) return selected;
      return null;
    }),
    querySelectorAll: vi.fn((selector: string) =>
      options.querySelectorAll?.(selector) || []
    ),
    execCommand: options.execCommand || vi.fn(() => true),
  };
  const context: any = {
    console,
    document,
    window: { location: { href: "https://gemini.google.com/app" } },
    chrome: {
      runtime: {
        onMessage: { addListener: (listener: any) => listeners.push(listener) },
      },
    },
    KeyboardEvent: class { constructor(public type: string, public init: any) {} },
    Event: class { constructor(public type: string, public init: any) {} },
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync("extension/content.js", "utf8"), context);
  return { api: context.GeminiconContentTest, document, listeners };
}

describe("extension content task lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("acknowledges cancellation only after the matching task handler has stopped", async () => {
    vi.useFakeTimers();
    const composer: any = {
      offsetParent: {},
      innerText: "",
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    const visible = { offsetParent: {}, click: vi.fn() };
    const { listeners } = loadContent({
      querySelector: (selector) => {
        if (selector.includes("contenteditable")) return composer;
        if (selector.includes("Close temporary")) return visible;
        if (selector.includes("Send message")) return { ...visible, disabled: false };
        if (selector.includes("Stop response")) return null;
        return undefined;
      },
      querySelectorAll: () => [],
      execCommand: (_command, _ui, prompt) => {
        composer.innerText = prompt;
        return true;
      },
    });
    const listener = listeners[0];
    const executionResponse = vi.fn();
    const cancellationResponse = vi.fn();
    listener({
      action: "EXECUTE_PROMPT",
      taskId: "task-1",
      attemptId: "attempt-1",
      model: "gemini-web",
      prompt: "hello",
      resetSession: false,
      timeoutMs: 10000,
    }, {}, executionResponse);
    await vi.advanceTimersByTimeAsync(500);
    listener({
      action: "CANCEL_PROMPT",
      taskId: "task-1",
      attemptId: "attempt-1",
    }, {}, cancellationResponse);
    await vi.advanceTimersByTimeAsync(2000);
    expect(executionResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorType: "task_cancelled",
    }));
    expect(cancellationResponse).toHaveBeenCalledWith({ cancelled: true, safe: true });
  });
});
