import { describe, it, expect, vi } from "vitest";
import { TaskQueue } from "../src/queue/task-queue.js";
import { GatewayTask, WorkerResult } from "../src/types.js";
import { GatewayError } from "../src/gateway/errors.js";

describe("TaskQueue", () => {
  it("should process tasks strictly sequentially with concurrency = 1", async () => {
    const executionOrder: string[] = [];

    const mockWorker = vi.fn(async (task: GatewayTask): Promise<WorkerResult> => {
      executionOrder.push(`start-${task.id}`);
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push(`finish-${task.id}`);
      return {
        requestId: task.id,
        text: `Answer for ${task.id}`,
        latencyMs: 20,
      };
    });

    const queue = new TaskQueue(mockWorker, 10);

    const taskA: GatewayTask = { id: "A", model: "gemini-web", prompt: "Task A", createdAt: Date.now() };
    const taskB: GatewayTask = { id: "B", model: "gemini-web", prompt: "Task B", createdAt: Date.now() };
    const taskC: GatewayTask = { id: "C", model: "gemini-web", prompt: "Task C", createdAt: Date.now() };

    // Enqueue all concurrently
    const [resA, resB, resC] = await Promise.all([
      queue.enqueue(taskA),
      queue.enqueue(taskB),
      queue.enqueue(taskC),
    ]);

    expect(resA.text).toBe("Answer for A");
    expect(resB.text).toBe("Answer for B");
    expect(resC.text).toBe("Answer for C");

    // Must be strictly start-A -> finish-A -> start-B -> finish-B -> start-C -> finish-C
    expect(executionOrder).toEqual([
      "start-A",
      "finish-A",
      "start-B",
      "finish-B",
      "start-C",
      "finish-C",
    ]);
  });

  it("should reject with 429 queue_full when queue maximum size is reached", async () => {
    let unblockWorker: () => void = () => {};
    const blockingPromise = new Promise<void>((r) => {
      unblockWorker = r;
    });

    const slowWorker = vi.fn(async (task: GatewayTask): Promise<WorkerResult> => {
      await blockingPromise;
      return { requestId: task.id, text: "ok", latencyMs: 10 };
    });

    const queue = new TaskQueue(slowWorker, 2);

    const task1: GatewayTask = { id: "1", model: "gemini-web", prompt: "1", createdAt: Date.now() };
    const task2: GatewayTask = { id: "2", model: "gemini-web", prompt: "2", createdAt: Date.now() };
    const task3: GatewayTask = { id: "3", model: "gemini-web", prompt: "3", createdAt: Date.now() };
    const task4: GatewayTask = { id: "4", model: "gemini-web", prompt: "4", createdAt: Date.now() };

    // task1 starts immediately (active)
    const p1 = queue.enqueue(task1);
    // task2 is queued (item 1 in queue)
    const p2 = queue.enqueue(task2);
    // task3 is queued (item 2 in queue, reaching max 2)
    const p3 = queue.enqueue(task3);

    // task4 should immediately throw queue_full error
    expect(() => queue.enqueue(task4)).toThrowError(GatewayError);

    unblockWorker();
    await Promise.all([p1, p2, p3]);
  });
});
