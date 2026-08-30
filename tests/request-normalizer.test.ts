import { describe, it, expect } from "vitest";
import { RequestNormalizer } from "../src/gateway/request-normalizer.js";
import { GatewayError } from "../src/gateway/errors.js";

describe("RequestNormalizer", () => {
  it("should return single user message as-is when no system instruction is present", () => {
    const messages = [{ role: "user" as const, content: "Explain TCP congestion control." }];
    const result = RequestNormalizer.normalize(messages);
    expect(result).toBe("Explain TCP congestion control.");
  });

  it("should prepend SYSTEM INSTRUCTIONS when single user message and system instruction are provided", () => {
    const messages = [
      { role: "system" as const, content: "Answer in one sentence." },
      { role: "user" as const, content: "What is DNS?" },
    ];
    const result = RequestNormalizer.normalize(messages);
    expect(result).toBe(
      "SYSTEM INSTRUCTIONS\n\nAnswer in one sentence.\n\nUSER\n\nWhat is DNS?"
    );
  });

  it("should format multi-turn conversations with labeled turns", () => {
    const messages = [
      { role: "user" as const, content: "My name is Alex." },
      { role: "assistant" as const, content: "Hello Alex! How can I help you today?" },
      { role: "user" as const, content: "What is my name?" },
    ];
    const result = RequestNormalizer.normalize(messages);
    expect(result).toBe(
      "USER\n\nMy name is Alex.\n\nASSISTANT\n\nHello Alex! How can I help you today?\n\nUSER\n\nWhat is my name?"
    );
  });

  it("should format multi-turn conversations with system instruction at the top", () => {
    const messages = [
      { role: "system" as const, content: "You are a concise tutor." },
      { role: "user" as const, content: "What is 2+2?" },
      { role: "assistant" as const, content: "4" },
      { role: "user" as const, content: "Multiply that by 10" },
    ];
    const result = RequestNormalizer.normalize(messages);
    expect(result).toBe(
      "SYSTEM INSTRUCTIONS\n\nYou are a concise tutor.\n\nUSER\n\nWhat is 2+2?\n\nASSISTANT\n\n4\n\nUSER\n\nMultiply that by 10"
    );
  });

  it("should combine multiple system messages if present", () => {
    const messages = [
      { role: "system" as const, content: "Rule 1: Be polite." },
      { role: "system" as const, content: "Rule 2: Respond only in English." },
      { role: "user" as const, content: "Hello" },
    ];
    const result = RequestNormalizer.normalize(messages);
    expect(result).toBe(
      "SYSTEM INSTRUCTIONS\n\nRule 1: Be polite.\n\nRule 2: Respond only in English.\n\nUSER\n\nHello"
    );
  });

  it("should throw GatewayError.invalidRequest if messages array is empty", () => {
    expect(() => RequestNormalizer.normalize([])).toThrow(GatewayError);
  });

  it("should throw GatewayError.invalidRequest if messages contain only system instructions", () => {
    expect(() =>
      RequestNormalizer.normalize([{ role: "system", content: "Instruction only" }])
    ).toThrow(GatewayError);
  });

  it("should throw GatewayError.invalidRequest if invalid role is passed", () => {
    expect(() =>
      RequestNormalizer.normalize([
        { role: "invalid_role" as any, content: "Hello" },
      ])
    ).toThrow(GatewayError);
  });

  it("should throw GatewayError.invalidRequest if multimodal content object is passed", () => {
    expect(() =>
      RequestNormalizer.normalize([
        { role: "user", content: [{ type: "text", text: "hi" }] as any },
      ])
    ).toThrow(GatewayError);
  });
});
