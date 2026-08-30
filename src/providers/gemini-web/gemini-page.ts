import { Page } from "playwright";
import { selectors } from "./selectors.js";
import { GatewayError } from "../../gateway/errors.js";

export class GeminiPage {
  /**
   * Checks if the current page indicates an unauthenticated session.
   */
  public static async isUnauthenticated(page: Page): Promise<boolean> {
    try {
      const currentUrl = page.url();
      if (
        currentUrl.includes("accounts.google.com") ||
        currentUrl.includes("/signin")
      ) {
        return true;
      }

      const loginElement = await page.$(selectors.loginIndicators);
      if (loginElement) {
        const isVisible = await loginElement.isVisible().catch(() => false);
        if (isVisible) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Asserts that the page is authenticated. Throws GatewayError if not.
   */
  public static async ensureAuthenticated(page: Page): Promise<void> {
    const unauth = await this.isUnauthenticated(page);
    if (unauth) {
      throw GatewayError.authenticationRequired();
    }
  }

  /**
   * Navigates to Gemini Web and starts a fresh conversation (guaranteed Temporary Chat mode if enabled).
   */
  public static async startFreshChat(
    page: Page,
    useTemporaryChat = true
  ): Promise<void> {
    try {
      await page.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await this.ensureAuthenticated(page);

      // If temporary chat requested, check if Temporary Chat is already active
      if (useTemporaryChat) {
        const isAlreadyTemp = await page.evaluate(function () {
          const text = document.body.innerText;
          return (
            text.includes("Just stopping by?") ||
            text.includes("Temporary chat") ||
            text.includes("Temporary chats don't appear in recent chats")
          );
        });

        if (!isAlreadyTemp) {
          const tempBtn = page.locator('button[aria-label="Temporary chat"]').first();
          if (await tempBtn.isVisible().catch(() => false)) {
            await tempBtn.click();
            await page.waitForTimeout(500);
          }
        }
      }

      // Wait for prompt composer to appear
      const composer = page.locator(selectors.promptInput).first();
      await composer.waitFor({
        timeout: 15000,
        state: "visible",
      });
    } catch (err: any) {
      if (err instanceof GatewayError) throw err;
      const unauth = await this.isUnauthenticated(page);
      if (unauth) throw GatewayError.authenticationRequired();

      throw GatewayError.browserUnavailable(
        `Failed to open fresh Gemini Web chat: ${err.message}`
      );
    }
  }

  /**
   * Inserts the full prompt into the composer, verifies it, and submits.
   */
  public static async submitPrompt(page: Page, prompt: string): Promise<void> {
    try {
      const composer = page.locator(selectors.promptInput).first();
      await composer.waitFor({ state: "visible", timeout: 15000 });
      await composer.click();
      await page.waitForTimeout(200);

      // Playwright .fill on contenteditable triggers Angular/Quill native change events
      await composer.fill(prompt);
      await page.waitForTimeout(300);

      // Verify content
      const text = (await composer.innerText().catch(() => "")) || "";
      if (!text || text.trim().length === 0) {
        // Fallback: keyboard insertText
        await page.keyboard.insertText(prompt);
        await page.waitForTimeout(300);
      }

      // Locate send button (now active)
      const sendBtn = page.locator(selectors.sendButton).first();
      const sendBtnVisible = await sendBtn.isVisible().catch(() => false);

      if (sendBtnVisible) {
        await sendBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
    } catch (err: any) {
      if (err instanceof GatewayError) throw err;
      throw GatewayError.promptSubmissionFailed(
        `Failed to submit prompt to Gemini Web: ${err.message}`
      );
    }
  }

  /**
   * Waits for Gemini Web response generation to finish using multiple signals.
   */
  public static async waitForCompletionAndExtract(
    page: Page,
    timeoutMs: number
  ): Promise<string> {
    const startTime = Date.now();
    let previousText = "";
    let stableCount = 0;
    const requiredStability = 2; // Stable checks across consecutive intervals

    // Wait a brief moment for Gemini to begin processing
    await page.waitForTimeout(1000);

    while (Date.now() - startTime < timeoutMs) {
      // Check unauthenticated challenge mid-generation
      if (await this.isUnauthenticated(page)) {
        throw GatewayError.authenticationRequired();
      }

      // Check if stop generating button is visible
      const stopBtn = page.locator(selectors.stopGeneratingButton).first();
      const isGenerating = await stopBtn.isVisible().catch(() => false);

      // Extract current response text from DOM
      const responseElements = page.locator(selectors.responseContainer);
      const count = await responseElements.count().catch(() => 0);

      let currentText = "";
      if (count > 0) {
        currentText =
          (await responseElements
            .last()
            .innerText()
            .catch(() => "")) || "";
        currentText = currentText.trim();
      }

      // If response text exists
      if (currentText.length > 0) {
        if (!isGenerating) {
          if (currentText === previousText) {
            stableCount++;
            if (stableCount >= requiredStability) {
              return currentText;
            }
          } else {
            stableCount = 0;
            previousText = currentText;
          }
        } else {
          stableCount = 0;
          previousText = currentText;
        }
      }

      await page.waitForTimeout(800);
    }

    if (previousText.length > 0) {
      return previousText;
    }

    throw GatewayError.generationTimeout();
  }
}
