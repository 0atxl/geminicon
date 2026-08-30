import { GatewayTask, WorkerResult } from "../../types.js";
import { BrowserManager } from "./browser-manager.js";
import { GeminiPage } from "./gemini-page.js";
import { GatewayConfig } from "../../config.js";
import { GatewayError } from "../../gateway/errors.js";

export class GeminiWorker {
  private browserManager: BrowserManager;
  private config: GatewayConfig;

  constructor(browserManager: BrowserManager, config: GatewayConfig) {
    this.browserManager = browserManager;
    this.config = config;
  }

  /**
   * Executes a single inference task against Gemini Web via Temporary Chat.
   */
  public async execute(task: GatewayTask): Promise<WorkerResult> {
    const startTime = Date.now();
    const page = await this.browserManager.getPage();

    // 1. Ensure Gemini Web page is ready & authenticated
    await GeminiPage.ensureReady(page);
    await GeminiPage.ensureAuthenticated(page);

    // 2. Start fresh Temporary Chat per API request (never normal chat)
    await GeminiPage.startTemporaryChat(page);

    if (!(await GeminiPage.isTemporaryChatActive(page))) {
      throw GatewayError.temporaryChatFailed();
    }

    // 3. Submit full normalized prompt and capture response tracking state
    const initialResponseCount = await GeminiPage.submitPrompt(
      page,
      task.prompt
    );

    // 4. Wait for Gemini Web generation to complete and extract text
    const text = await GeminiPage.waitForCompletionAndExtract(
      page,
      initialResponseCount,
      this.config.generationTimeoutMs
    );

    const latencyMs = Date.now() - startTime;

    return {
      requestId: task.id,
      text,
      latencyMs,
    };
  }
}
