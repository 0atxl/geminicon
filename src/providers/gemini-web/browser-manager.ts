import { chromium, BrowserContext, Page } from "playwright";
import fs from "fs";
import { GatewayConfig } from "../../config.js";
import { BrowserHealthStatus } from "./types.js";
import { GeminiPage } from "./gemini-page.js";
import { GatewayError } from "../../gateway/errors.js";

export class BrowserManager {
  private config: GatewayConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isLaunching = false;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /**
   * Initializes the persistent browser context and main page using standard Playwright defaults.
   */
  public async launch(): Promise<void> {
    if (this.context && this.page && !this.page.isClosed()) {
      return;
    }

    if (this.isLaunching) {
      while (this.isLaunching) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return;
    }

    this.isLaunching = true;

    try {
      if (!fs.existsSync(this.config.browserProfilePath)) {
        fs.mkdirSync(this.config.browserProfilePath, { recursive: true });
      }

      this.context = await chromium.launchPersistentContext(
        this.config.browserProfilePath,
        {
          headless: this.config.headless,
          viewport: { width: 1280, height: 800 },
        }
      );

      this.context.on("close", () => {
        this.context = null;
        this.page = null;
      });

      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      this.page.on("close", () => {
        this.page = null;
      });
    } catch (err: any) {
      this.context = null;
      this.page = null;
      throw GatewayError.browserUnavailable(
        `Failed to launch Playwright browser: ${err.message}`
      );
    } finally {
      this.isLaunching = false;
    }
  }

  /**
   * Returns a ready page instance, launching or recovering if needed.
   */
  public async getPage(): Promise<Page> {
    if (!this.context || !this.page || this.page.isClosed()) {
      await this.launch();
    }

    if (!this.page || this.page.isClosed()) {
      if (this.context) {
        this.page = await this.context.newPage();
      } else {
        throw GatewayError.browserUnavailable();
      }
    }

    return this.page;
  }

  /**
   * Positively checks the health of the browser and Gemini Web readiness.
   * Ensures about:blank is not reported as ready.
   */
  public async checkHealth(): Promise<BrowserHealthStatus> {
    if (!this.context || !this.page || this.page.isClosed()) {
      return { browser: "unavailable", gemini: "unknown" };
    }

    try {
      const currentUrl = this.page.url();
      if (!currentUrl.includes("gemini.google.com")) {
        // Navigate to Gemini if on about:blank
        await this.page.goto("https://gemini.google.com/app", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      }

      const isUnauth = await GeminiPage.isUnauthenticated(this.page);
      if (isUnauth) {
        return { browser: "ready", gemini: "authentication_required" };
      }

      const isAuth = await GeminiPage.isAuthenticated(this.page);
      if (isAuth) {
        return { browser: "ready", gemini: "ready" };
      }

      return { browser: "ready", gemini: "unavailable" };
    } catch {
      return { browser: "ready", gemini: "unavailable" };
    }
  }

  /**
   * Closes the browser context cleanly.
   */
  public async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch {
      // ignore
    } finally {
      this.context = null;
      this.page = null;
    }
  }

  /**
   * Restarts the browser context after an unexpected failure.
   */
  public async restart(): Promise<void> {
    await this.close();
    await this.launch();
  }
}
