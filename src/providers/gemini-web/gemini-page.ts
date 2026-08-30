import { Page } from "playwright";
import { selectors } from "./selectors.js";
import { GatewayError } from "../../gateway/errors.js";

export class GeminiPage {
  /**
   * Navigates directly to Gemini Web.
   */
  public static async open(page: Page): Promise<void> {
    await page.goto("https://gemini.google.com/app", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  }

  /**
   * Positively checks if the current page is on Gemini Web and authenticated.
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
      await this.open(page);
    }

    await this.ensureAuthenticated(page);

    const composer = page.locator(selectors.promptInput).first();
    await composer.waitFor({ state: "visible", timeout: 15000 });
  }

  /**
   * Positively checks if Gemini Web is actively in Temporary Chat mode.
   * Returns true ONLY when affirmative evidence of temporary mode is present.
   */
  public static async isTemporaryChatActive(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(function () {
        const text = document.body.innerText;
        const hasTempText =
          text.includes("Just stopping by?") ||
          text.includes("Temporary chats don't appear in recent chats") ||
          text.includes("Temporary chat");

        const hasTempIndicator = !!document.querySelector(
          "button[aria-label*='temporary' i], [data-test-id*='temporary'], [aria-label*='Temporary chat']"
        );

        return hasTempText || hasTempIndicator;
      });
    } catch {
      return false;
    }
  }

  /**
   * Starts a fresh Temporary Chat session for the current request.
   * Never falls back to normal chat.
   */
  public static async startTemporaryChat(page: Page): Promise<void> {
    try {
      // 1. Navigate fresh to Gemini Web root
      await this.open(page);
      await this.ensureAuthenticated(page);

      // 2. Locate Temporary Chat button with wait
      let tempBtn = page.locator(selectors.temporaryChatButton).first();
      let isVisible = await tempBtn
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => true)
        .catch(() => false);

      if (!isVisible) {
        // Try opening the sidebar menu if collapsed
        const menuBtn = page.locator(selectors.menuButton).first();
        if (await menuBtn.isVisible().catch(() => false)) {
          await menuBtn.click();
          tempBtn = page.locator(selectors.temporaryChatButton).first();
          isVisible = await tempBtn
            .waitFor({ state: "visible", timeout: 4000 })
            .then(() => true)
            .catch(() => false);
        }
      }

      if (!isVisible) {
        throw GatewayError.temporaryChatUnavailable(
          "Temporary Chat button was not found. Refusing to fall back to normal chat."
        );
      }

      // 3. Click Temporary Chat button
      await tempBtn.click();

      // 4. Wait for Temporary Chat mode to activate positively
      let activated = false;
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(300);
        if (await this.isTemporaryChatActive(page)) {
          activated = true;
          break;
        }
      }

      if (!activated) {
        throw GatewayError.temporaryChatFailed(
          "Gemini did not enter Temporary Chat mode after button interaction."
        );
      }

      // 5. Wait for prompt composer to be visible & ready
      const composer = page.locator(selectors.promptInput).first();
      await composer.waitFor({ state: "visible", timeout: 15000 });
    } catch (err: any) {
      if (err instanceof GatewayError) throw err;
      const unauth = await this.isUnauthenticated(page);
      if (unauth) throw GatewayError.authenticationRequired();

      throw GatewayError.temporaryChatFailed(
        `Failed to activate fresh Temporary Chat: ${err.message}`
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

      // Fill prompt into composer
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

      if (normActual !== normExpected) {
        // Retry insertion once with clean focus and keyboard insertText
        await composer.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.insertText(prompt);
        await page.waitForTimeout(300);

        const retryText = (await composer.innerText().catch(() => "")) || "";
        if (this.normalizeWhitespace(retryText) !== normExpected) {
          throw GatewayError.promptSubmissionFailed(
            "Prompt insertion verification failed. Refusing to submit partial or corrupted prompt."
          );
        }
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
   * Strictly extracts the response for the current request (count > initialResponseCount).
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

      // 4. Extract current response count
      const responseElements = page.locator(selectors.responseContainer);
      const count = await responseElements.count().catch(() => 0);

      // 5. Track response strictly belonging to current request
      let currentText = "";
      if (count > initialResponseCount) {
        const latestElement = responseElements.nth(count - 1);
        currentText = (await latestElement.innerText().catch(() => "")) || "";
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
