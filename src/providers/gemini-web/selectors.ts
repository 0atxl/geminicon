/**
 * Centralized DOM selectors for gemini.google.com
 * If Gemini updates its web UI, only this file requires adjustment.
 */
export const selectors = {
  // Chat input / composer
  promptInput: [
    'div[contenteditable="true"]',
    'textarea[placeholder*="Ask Gemini"]',
    'div.ql-editor',
    'rich-textarea p',
    'textarea',
  ].join(", "),

  // Send / Submit button
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Submit"]',
    'button.send-button',
    'button[aria-label*="Send"]',
  ].join(", "),

  // Temporary chat activation button (never treated as active state)
  temporaryChatButton: [
    'button[aria-label="Temporary chat"]',
    'button[aria-label="Temporary chat" i]',
    '[role="button"][aria-label="Temporary chat" i]',
    'button[data-test-id="temporary-chat-button"]',
  ].join(", "),

  // Temporary chat positive active indicators (only present when temporary mode is active)
  temporaryChatActiveIndicator: [
    'button[aria-label="Close temporary chat"]',
    'button[aria-label="Exit temporary chat"]',
    'button[aria-label*="Close temporary" i]',
    'button[aria-label*="Exit temporary" i]',
    '[data-test-id="temporary-chat-indicator"]',
    '[data-test-id="temporary-chat-active"]',
    '[aria-label*="temporary chat is on" i]',
    '[aria-label*="temporary chat is active" i]',
  ].join(", "),

  // Sidebar / menu toggle button
  menuButton: [
    'button[aria-label="Open sidebar"]',
    'button[aria-label="Main menu"]',
    'button[data-test-id="side-nav-sparkle-button"]',
  ].join(", "),

  // Active generation / stop indicators
  stopGeneratingButton: [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]',
    'button[aria-label*="Stop"]',
  ].join(", "),

  // Response text / markdown containers
  responseContainer: [
    "message-content",
    "model-response",
    ".model-response-text",
    ".response-container-content",
    "div.markdown",
    "[class*='response-content']",
  ].join(", "),

  // Upstream rate limit / quota indicators
  upstreamLimitIndicators: [
    'div:has-text("You\'ve reached your limit")',
    'div:has-text("rate limit exceeded")',
    'div:has-text("Please try again later")',
    '[data-test-id*="rate-limit"]',
  ].join(", "),

  // Login / Auth challenge indicators
  loginIndicators: [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    'a[aria-label*="Sign in"]',
    'div:has-text("Sign in to Gemini")',
  ].join(", "),

  // New Chat button
  newChatButton: [
    'a[aria-label="New chat"]',
    'button[aria-label="New chat"]',
    'a[href="/app"]',
    'side-nav-button[aria-label="New chat"]',
  ].join(", "),
};
