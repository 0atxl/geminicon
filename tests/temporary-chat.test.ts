import { describe, it, expect, vi } from "vitest";
import { GeminiPage } from "../src/providers/gemini-web/gemini-page.js";
import { GatewayError } from "../src/gateway/errors.js";

describe("Temporary Chat Logic", () => {
  describe("isTemporaryChatActive", () => {
    it("Case 1: returns false when activation button exists but no active indicator exists", async () => {
      const mockPage: any = {
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false), // Active indicator not visible
          }),
        })),
        evaluate: vi.fn().mockResolvedValue(false), // Normal page text, no "Just stopping by?"
      };

      const isActive = await GeminiPage.isTemporaryChatActive(mockPage);
      expect(isActive).toBe(false);
    });

    it("Case 2a: returns true when active indicator element is visible", async () => {
      const mockPage: any = {
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(true), // Close/Exit temporary chat button visible
          }),
        })),
        evaluate: vi.fn().mockResolvedValue(false),
      };

      const isActive = await GeminiPage.isTemporaryChatActive(mockPage);
      expect(isActive).toBe(true);
    });

    it("Case 2b: returns true when affirmative temporary chat text ('Just stopping by?') is present", async () => {
      const mockPage: any = {
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false),
          }),
        })),
        evaluate: vi.fn().mockResolvedValue(true), // "Just stopping by?" or "don't appear in recent chats"
      };

      const isActive = await GeminiPage.isTemporaryChatActive(mockPage);
      expect(isActive).toBe(true);
    });
  });

  describe("startTemporaryChat", () => {
    it("Case 3: throws temporary_chat_failed when activation button is clicked but active state never appears", async () => {
      const mockClick = vi.fn().mockResolvedValue(undefined);
      const mockPage: any = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue("https://gemini.google.com/app"),
        $: vi.fn().mockResolvedValue(null),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn((sel: string) => {
          if (sel.includes("Temporary chat") && !sel.includes("Close") && !sel.includes("Exit")) {
            return {
              first: () => ({
                waitFor: vi.fn().mockResolvedValue(undefined),
                click: mockClick,
                isVisible: vi.fn().mockResolvedValue(true),
              }),
            };
          }
          return {
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
              waitFor: vi.fn().mockResolvedValue(undefined),
            }),
          };
        }),
        evaluate: vi.fn().mockResolvedValue(false), // Mode never turns active
      };

      await expect(GeminiPage.startTemporaryChat(mockPage)).rejects.toThrowError(
        GatewayError
      );

      await expect(GeminiPage.startTemporaryChat(mockPage)).rejects.toMatchObject({
        errorType: "temporary_chat_failed",
        statusCode: 502,
      });

      expect(mockClick).toHaveBeenCalled();
    });

    it("Case 4: throws temporary_chat_unavailable when Temporary Chat control cannot be found", async () => {
      const mockPage: any = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue("https://gemini.google.com/app"),
        $: vi.fn().mockResolvedValue(null),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn(() => ({
          first: () => ({
            waitFor: vi.fn().mockRejectedValue(new Error("Timeout")),
            isVisible: vi.fn().mockResolvedValue(false),
          }),
        })),
        evaluate: vi.fn().mockResolvedValue(false),
      };

      await expect(GeminiPage.startTemporaryChat(mockPage)).rejects.toThrowError(
        GatewayError
      );

      await expect(GeminiPage.startTemporaryChat(mockPage)).rejects.toMatchObject({
        errorType: "temporary_chat_unavailable",
        statusCode: 502,
      });
    });
  });

  describe("submitPrompt defensive assertion", () => {
    it("Case 5: refuses to submit prompt and throws temporary_chat_failed if Temporary Chat is inactive", async () => {
      const mockFill = vi.fn().mockResolvedValue(undefined);
      const mockPage: any = {
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false), // Inactive
            fill: mockFill,
            waitFor: vi.fn().mockResolvedValue(undefined),
            click: vi.fn().mockResolvedValue(undefined),
          }),
          count: vi.fn().mockResolvedValue(0),
        })),
        evaluate: vi.fn().mockResolvedValue(false), // Inactive
      };

      await expect(
        GeminiPage.submitPrompt(mockPage, "Test prompt")
      ).rejects.toThrowError(GatewayError);

      await expect(
        GeminiPage.submitPrompt(mockPage, "Test prompt")
      ).rejects.toMatchObject({
        errorType: "temporary_chat_failed",
        statusCode: 502,
      });

      expect(mockFill).not.toHaveBeenCalled();
    });
  });

  describe("GeminiWorker session management", () => {
    it("starts fresh temporary chat on first call, reuses on same sessionId, resets on new or reset session", async () => {
      const { GeminiWorker } = await import(
        "../src/providers/gemini-web/gemini-worker.js"
      );

      const mockPage: any = {};
      const mockBrowserManager: any = {
        getPage: vi.fn().mockResolvedValue(mockPage),
      };
      const mockConfig: any = {
        generationTimeoutMs: 5000,
      };

      const ensureReadySpy = vi
        .spyOn(GeminiPage, "ensureReady")
        .mockResolvedValue(undefined);
      const startTempChatSpy = vi
        .spyOn(GeminiPage, "startTemporaryChat")
        .mockResolvedValue(undefined);
      const isTempChatActiveSpy = vi
        .spyOn(GeminiPage, "isTemporaryChatActive")
        .mockResolvedValue(true);
      const submitPromptSpy = vi
        .spyOn(GeminiPage, "submitPrompt")
        .mockResolvedValue(1);
      const waitAndExtractSpy = vi
        .spyOn(GeminiPage, "waitForCompletionAndExtract")
        .mockResolvedValue("Response text");

      const worker = new GeminiWorker(mockBrowserManager, mockConfig);

      // 1. First request with sessionId 'sess_1' -> must start temporary chat
      await worker.execute({
        id: "req_1",
        model: "gemini-web",
        prompt: "First turn",
        createdAt: Date.now(),
        sessionId: "sess_1",
      });
      expect(startTempChatSpy).toHaveBeenCalledTimes(1);

      // 2. Second request with same sessionId 'sess_1' -> should REUSE (no new startTemporaryChat)
      await worker.execute({
        id: "req_2",
        model: "gemini-web",
        prompt: "Second turn",
        createdAt: Date.now(),
        sessionId: "sess_1",
      });
      expect(startTempChatSpy).toHaveBeenCalledTimes(1); // still 1

      // 3. Third request with resetSession: true -> must start fresh temporary chat
      await worker.execute({
        id: "req_3",
        model: "gemini-web",
        prompt: "Reset turn",
        createdAt: Date.now(),
        sessionId: "sess_1",
        resetSession: true,
      });
      expect(startTempChatSpy).toHaveBeenCalledTimes(2);

      // 4. Fourth request with different sessionId 'sess_2' -> must start fresh temporary chat
      await worker.execute({
        id: "req_4",
        model: "gemini-web",
        prompt: "New session turn",
        createdAt: Date.now(),
        sessionId: "sess_2",
      });
      expect(startTempChatSpy).toHaveBeenCalledTimes(3);

      // 5. Fifth request without any sessionId -> must start fresh temporary chat
      await worker.execute({
        id: "req_5",
        model: "gemini-web",
        prompt: "Stateless turn",
        createdAt: Date.now(),
      });
      expect(startTempChatSpy).toHaveBeenCalledTimes(4);

      ensureReadySpy.mockRestore();
      startTempChatSpy.mockRestore();
      isTempChatActiveSpy.mockRestore();
      submitPromptSpy.mockRestore();
      waitAndExtractSpy.mockRestore();
    });
  });
});
