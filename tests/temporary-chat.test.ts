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
});
