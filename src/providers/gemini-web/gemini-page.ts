import { Page } from "playwright";
import { selectors } from "./selectors.js";
import { GatewayError } from "../../gateway/errors.js";

export class GeminiPage {
  /**
   * Checks if the current page is on Gemini and positively authenticated.
   */
  public static async isAuthenticated(page: Page): Promise<boolean> {
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes("gemini.google.com")) {
        return false;
      }

      if (
        currentUrl.includes("accounts.google.com") ||
        currentUrl.includes("/signin")
      ) {
        return false;
      }

      const loginElement = await page.$(selectors.loginIndicators);
      if (loginElement) {
        const isVisible = await loginElement.isVisible().catch(() => false);
        if (isVisible) return false;
      }

      const composer = page.locator(selectors.promptInput).first();
      const composerVisible = await composer.isVisible().catch(() => false);

      return composerVisible;
    } catch {
      return false;
    }
  }

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
   * Ensures the page is loaded on Gemini Web and ready for interaction.
   */
  public static async ensureReady(page: Page): Promise<void> {
    const url = page.url();
    if (!url.includes("gemini.google.com")) {
      await page.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }

    await this.ensureAuthenticated(page);

    const composer = page.locator(selectors.promptInput).first();
    await composer.waitFor({ state: "visible", timeout: 15000 });
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
   * Normalizes whitespace for comparing inserted composer text with expected prompt.
   */
  private static normalizeWhitespace(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  }

  /**
   * Inserts the full prompt into the composer, verifies it, and submits.
   * Returns the initial response count prior to submission for response tracking.
   */
  public static async submitPrompt(page: Page, prompt: string): Promise<number> {
    try {
      const composer = page.locator(selectors.promptInput).first();
      await composer.waitFor({ state: "visible", timeout: 15000 });
      await composer.click();
      await page.waitForTimeout(200);

      // Capture response count before submitting
      const responseElements = page.locator(selectors.responseContainer);
      const initialResponseCount = await responseElements.count().catch(() => 0);

      // Playwright .fill on contenteditable triggers Angular/Quill native change events
      await composer.fill(prompt);
      await page.waitForTimeout(300);

      // Verify content
      let text = (await composer.innerText().catch(() => "")) || "";
      if (!text || text.trim().length === 0) {
        // Fallback: keyboard insertText
        await page.keyboard.insertText(prompt);
        await page.waitForTimeout(300);
        text = (await composer.innerText().catch(() => "")) || "";
      }

      // Strict prompt verification
      const normExpected = this.normalizeWhitespace(prompt);
      const normActual = this.normalizeWhitespace(text);

      let isVerified = normActual === normExpected;
      if (!isVerified && prompt.length > 200) {
        // For large RAG prompts, verify length within 10% and prefix/suffix match
        const lengthDiff = Math.abs(normActual.length - normExpected.length);
        const lengthMatches = lengthDiff / normExpected.length < 0.1;
        const prefixMatches = normActual.startsWith(normExpected.slice(0, 50));
        const suffixMatches = normActual.endsWith(normExpected.slice(-50));
        isVerified = lengthMatches && prefixMatches && suffixMatches;
      }

      if (!isVerified) {
        throw GatewayError.promptSubmissionFailed(
          "Prompt insertion verification failed. Refusing to submit partial or corrupted prompt."
        );
      }

      // Locate send button (now active)
      const sendBtn = page.locator(selectors.sendButton).first();
      const sendBtnVisible = await sendBtn.isVisible().catch(() => false);

      if (sendBtnVisible) {
        await sendBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }

      return initialResponseCount;
    } catch (err: any) {
      if (err instanceof GatewayError) throw err;
      throw GatewayError.promptSubmissionFailed(
        `Failed to submit prompt to Gemini Web: ${err.message}`
      );
    }
  }

  /**
   * Waits for Gemini Web response generation to finish using multiple positive signals.
   * NEVER returns partial text on timeout.
   */
  public static async waitForCompletionAndExtract(
    page: Page,
    initialResponseCount: number,
    timeoutMs: number
  ): Promise<string> {
    const startTime = Date.now();
    let previousText = "";
    let stableCount = 0;
    const requiredStability = 3; // Stable across 3 consecutive checks

    // Wait a brief moment for Gemini to begin processing
    await page.waitForTimeout(1000);

    while (Date.now() - startTime < timeoutMs) {
      // 1. Check unauthenticated challenge mid-generation
      if (await this.isUnauthenticated(page)) {
        throw GatewayError.authenticationRequired();
      }

      // 2. Check for upstream limit banners
      const limitElement = await page.$(selectors.upstreamLimitIndicators);
      if (limitElement) {
        const isVisible = await limitElement.isVisible().catch(() => false);
        if (isVisible) {
          throw GatewayError.upstreamLimit();
        }
      }

      // 3. Check if stop generating button is visible
      const stopBtn = page.locator(selectors.stopGeneratingButton).first();
      const isGenerating = await stopBtn.isVisible().catch(() => false);

      // 4. Extract current response text from DOM
      const responseElements = page.locator(selectors.responseContainer);
      const count = await responseElements.count().catch(() => 0);

      // 5. Track newest response belonging to current request
      let currentText = "";
      if (count > initialResponseCount || count > 0) {
        currentText =
          (await responseElements
            .last()
            .innerText()
            .catch(() => "")) || "";
        currentText = currentText.trim();
      }

      // 6. Positive completion detection
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

      await page.waitForTimeout(600);
    }

    // Critical: NEVER return partial text on timeout
    throw GatewayError.generationTimeout();
  }
}
