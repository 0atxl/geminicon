/**
 * Geminicon Content Script
 * Executes inside https://gemini.google.com/
 */

const SELECTORS = {
  promptInput: [
    'div[contenteditable="true"]',
    'textarea[placeholder*="Ask Gemini"]',
    'div.ql-editor',
    'rich-textarea p',
  ].join(", "),

  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Submit"]',
    'button.send-button',
  ].join(", "),

  temporaryChatButton: [
    'button[aria-label="Temporary chat"]',
    'button[aria-label="Temporary chat" i]',
    '[role="button"][aria-label="Temporary chat" i]',
  ].join(", "),

  temporaryChatActiveIndicator: [
    'button[aria-label="Close temporary chat"]',
    'button[aria-label="Exit temporary chat"]',
    'button[aria-label*="Close temporary" i]',
    'button[aria-label*="Exit temporary" i]',
    '[data-test-id="temporary-chat-indicator"]',
    '[data-test-id="temporary-chat-active"]',
  ].join(", "),

  menuButton: [
    'button[aria-label="Open sidebar"]',
    'button[aria-label="Main menu"]',
    'button[data-test-id="side-nav-sparkle-button"]',
  ].join(", "),

  stopGeneratingButton: [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]',
  ].join(", "),

  responseContainer: [
    "message-content",
    "model-response",
    ".model-response-text",
    ".response-container-content",
    "div.markdown",
  ].join(", "),

};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(text) {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

/**
 * Checks if Temporary Chat is affirmatively active.
 */
function isTemporaryChatActive() {
  const indicator = document.querySelector(SELECTORS.temporaryChatActiveIndicator);
  if (indicator && indicator.offsetParent !== null) {
    return true;
  }

  const text = document.body.innerText || "";
  return (
    text.includes("Just stopping by?") ||
    text.includes("Temporary chats don't appear in recent chats") ||
    text.includes("don't appear in recent chats")
  );
}

/**
 * Activates a fresh Temporary Chat.
 */
async function activateTemporaryChat() {
  let tempBtn = document.querySelector(SELECTORS.temporaryChatButton);
  if (!tempBtn || tempBtn.offsetParent === null) {
    const menuBtn = document.querySelector(SELECTORS.menuButton);
    if (menuBtn) {
      menuBtn.click();
      await sleep(400);
      tempBtn = document.querySelector(SELECTORS.temporaryChatButton);
    }
  }

  if (!tempBtn) {
    throw new Error("Temporary Chat activation button not found.");
  }

  tempBtn.click();

  // Wait up to 5 seconds for affirmative activation
  for (let i = 0; i < 15; i++) {
    await sleep(300);
    if (isTemporaryChatActive()) {
      return true;
    }
  }

  throw new Error("Gemini did not enter Temporary Chat mode.");
}

/**
 * Exits current Temporary Chat if active and enters a brand new one.
 */
async function ensureFreshTemporaryChat() {
  if (isTemporaryChatActive()) {
    const exitBtn = document.querySelector(SELECTORS.temporaryChatActiveIndicator);
    if (exitBtn && exitBtn.offsetParent !== null) {
      exitBtn.click();
      await sleep(500);
    } else {
      const newChatBtn = document.querySelector(
        'a[href="/app"], button[aria-label="New chat"]'
      );
      if (newChatBtn && newChatBtn.offsetParent !== null) {
        newChatBtn.click();
        await sleep(500);
      }
    }
  }

  await activateTemporaryChat();
}

/**
 * Inserts prompt into composer with verification.
 */
async function insertPromptAndSubmit(prompt) {
  const composer = document.querySelector(SELECTORS.promptInput);
  if (!composer) {
    throw new Error("Composer input element not found.");
  }

  composer.focus();
  await sleep(150);

  // Capture response count before submission
  const responsesBefore = document.querySelectorAll(SELECTORS.responseContainer);
  const initialResponseCount = responsesBefore.length;

  // Insert text into contenteditable
  composer.innerText = "";
  document.execCommand("insertText", false, prompt);
  await sleep(200);

  let insertedText = composer.innerText || "";
  if (!insertedText || insertedText.trim().length === 0) {
    // Fallback direct textContent assignment with input event
    composer.textContent = prompt;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(200);
    insertedText = composer.innerText || "";
  }

  // Strict verification
  if (normalizeWhitespace(insertedText) !== normalizeWhitespace(prompt)) {
    throw new Error(
      "Prompt verification failed in composer. Refusing to submit partial text."
    );
  }

  // Find send button
  const sendBtn = document.querySelector(SELECTORS.sendButton);
  if (sendBtn && sendBtn.offsetParent !== null && !sendBtn.disabled) {
    sendBtn.click();
  } else {
    // Press Enter
    composer.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
      })
    );
  }

  return initialResponseCount;
}

function isUpstreamLimitReached() {
  const text = document.body.innerText || "";
  return (
    text.includes("You've reached your limit") ||
    text.includes("rate limit exceeded") ||
    text.includes("Please try again later") ||
    !!document.querySelector('[data-test-id*="rate-limit"]')
  );
}

function isAuthenticationRequired() {
  const url = window.location.href;
  if (url.includes("accounts.google.com") || url.includes("/signin")) {
    return true;
  }
  const text = document.body.innerText || "";
  return text.includes("Sign in to Gemini");
}

let activeTask = null;

function assertNotCancelled(task) {
  if (task.cancelled) throw new Error("Task generation was cancelled.");
}

/**
 * Polls for response completion and extracts text.
 */
async function waitForCompletion(task, initialResponseCount, timeoutMs = 180000) {
  const startTime = Date.now();
  let previousText = "";
  let stableCount = 0;
  const requiredStability = 3;

  await sleep(1000);

  while (Date.now() - startTime < timeoutMs) {
    assertNotCancelled(task);

    if (isAuthenticationRequired()) {
      throw new Error("Authentication required: Google Gemini session expired.");
    }

    if (isUpstreamLimitReached()) {
      throw new Error("Upstream Gemini rate limit reached.");
    }

    const stopBtn = document.querySelector(SELECTORS.stopGeneratingButton);
    const isGenerating = !!stopBtn && stopBtn.offsetParent !== null;

    const responseElements = document.querySelectorAll(SELECTORS.responseContainer);
    const count = responseElements.length;

    let currentText = "";
    if (count > initialResponseCount) {
      const latestEl = responseElements[count - 1];
      currentText = (latestEl.innerText || "").trim();
    }

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

    await sleep(500);
  }

  throw new Error("Generation timed out on Gemini Web.");
}

/**
 * Message listener from background service worker.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "CANCEL_PROMPT") {
    const task = activeTask;
    if (task && task.taskId === request.taskId && task.attemptId === request.attemptId) {
      task.cancelled = true;
      const stopBtn = document.querySelector(SELECTORS.stopGeneratingButton);
      if (stopBtn && stopBtn.offsetParent !== null) {
        stopBtn.click();
      }
      (async () => {
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          const generating = document.querySelector(SELECTORS.stopGeneratingButton);
          if ((!generating || generating.offsetParent === null) && activeTask !== task) {
            sendResponse({ cancelled: true, safe: true });
            return;
          }
          await sleep(100);
        }
        sendResponse({ cancelled: true, safe: false });
      })();
      return true;
    }
    sendResponse({ cancelled: false, safe: false });
    return true;
  }

  if (request.action === "EXECUTE_PROMPT") {
    if (activeTask) {
      sendResponse({
        success: false,
        errorType: "internal_error",
        message: "Managed tab is already processing a task.",
      });
      return true;
    }
    const task = {
      taskId: request.taskId,
      attemptId: request.attemptId,
      cancelled: false,
    };
    activeTask = task;

    (async () => {
      try {
        // 1. Ensure fresh Temporary Chat (or reset if requested / default without session)
        if (request.resetSession) {
          await ensureFreshTemporaryChat();
        } else if (!isTemporaryChatActive()) {
          await activateTemporaryChat();
        }
        assertNotCancelled(task);

        if (!isTemporaryChatActive()) {
          throw new Error("Temporary Chat is not active.");
        }

        // 2. Submit prompt. The protocol accepts only the generic gemini-web model.
        const initialCount = await insertPromptAndSubmit(request.prompt);
        assertNotCancelled(task);

        // 3. Wait for completion and extract response (respecting timeoutMs & cancellation)
        const text = await waitForCompletion(
          task,
          initialCount,
          request.timeoutMs || 180000
        );

        sendResponse({ success: true, text });
      } catch (err) {
        sendResponse({
          success: false,
          errorType: task.cancelled ? "task_cancelled" : "upstream_error",
          message: err.message || "Failed to execute prompt on Gemini Web",
        });
      } finally {
        if (activeTask === task) activeTask = null;
      }
    })();

    return true; // Keep channel open for async response
  }

  if (request.action === "PING" || request.action === "PROBE_STATUS") {
    const composer = document.querySelector(SELECTORS.promptInput);
    const temporaryControl = document.querySelector(SELECTORS.temporaryChatButton);
    sendResponse({
      pong: true,
      authenticated: !isAuthenticationRequired() && !!composer && composer.offsetParent !== null,
      temporaryChatAvailable:
        isTemporaryChatActive() || (!!temporaryControl && temporaryControl.offsetParent !== null),
      models: ["gemini-web"],
    });
    return true;
  }
});

globalThis.GeminiconContentTest = Object.freeze({
  isTemporaryChatActive,
  normalizeWhitespace,
});
