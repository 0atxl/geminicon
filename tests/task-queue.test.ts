import { describe, it, expect, vi } from "vitest";
import { TaskQueue } from "../src/queue/task-queue.js";
import { GatewayTask, WorkerResult } from "../src/types.js";
import { GatewayError } from "../src/gateway/errors.js";

describe("TaskQueue", () => {
  it("should process tasks strictly sequentially in FIFO order with concurrency = 1", async () => {
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

    const [resA, resB, resC] = await Promise.all([
      queue.enqueue(taskA),
      queue.enqueue(taskB),
      queue.enqueue(taskC),
    ]);

    expect(resA.text).toBe("Answer for A");
    expect(resB.text).toBe("Answer for B");
    expect(resC.text).toBe("Answer for C");

    expect(executionOrder).toEqual([
      "start-A",
      "finish-A",
      "start-B",
      "finish-B",
      "start-C",
      "finish-C",
    ]);
  });

  it("should propagate worker failure and continue processing subsequent tasks", async () => {
    const mockWorker = vi.fn(async (task: GatewayTask): Promise<WorkerResult> => {
      if (task.id === "fail") {
        throw GatewayError.promptSubmissionFailed("Simulated submission failure");
      }
      return {
        requestId: task.id,
        text: `Success ${task.id}`,
        latencyMs: 10,
      };
    });

    const queue = new TaskQueue(mockWorker, 10);

    const taskFail: GatewayTask = { id: "fail", model: "gemini-web", prompt: "Fail", createdAt: Date.now() };
    const taskSuccess: GatewayTask = { id: "success", model: "gemini-web", prompt: "Success", createdAt: Date.now() };

    const failPromise = queue.enqueue(taskFail);
    const successPromise = queue.enqueue(taskSuccess);

    await expect(failPromise).rejects.toThrowError(GatewayError);
    await expect(failPromise).rejects.toMatchObject({
      errorType: "prompt_submission_failed",
      statusCode: 502,
    });

    const successResult = await successPromise;
    expect(successResult.text).toBe("Success success");
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

    const p1 = queue.enqueue(task1);
    const p2 = queue.enqueue(task2);
    const p3 = queue.enqueue(task3);

    expect(() => queue.enqueue(task4)).toThrowError(GatewayError);

    unblockWorker();
    await Promise.all([p1, p2, p3]);
  });

  it("should track isBusy and pendingCount correctly and reject items on clear()", async () => {
    let unblock: () => void = () => {};
    const blocker = new Promise<void>((r) => {
      unblock = r;
    });

    const worker = vi.fn(async (task: GatewayTask): Promise<WorkerResult> => {
      await blocker;
      return { requestId: task.id, text: "done", latencyMs: 5 };
    });

    const queue = new TaskQueue(worker, 5);
    expect(queue.isBusy).toBe(false);
    expect(queue.pendingCount).toBe(0);

    const taskA: GatewayTask = { id: "A", model: "gemini-web", prompt: "A", createdAt: Date.now() };
    const taskB: GatewayTask = { id: "B", model: "gemini-web", prompt: "B", createdAt: Date.now() };
    const taskC: GatewayTask = { id: "C", model: "gemini-web", prompt: "C", createdAt: Date.now() };

    const pA = queue.enqueue(taskA);
    const pB = queue.enqueue(taskB);
    const pC = queue.enqueue(taskC);

    expect(queue.isBusy).toBe(true);
    expect(queue.pendingCount).toBe(2); // taskA is active, taskB and taskC are queued

    // Clear queue while taskA is still in-flight
    queue.clear();
    expect(queue.pendingCount).toBe(0);

    // Queued items should be rejected immediately
    await expect(pB).rejects.toMatchObject({
      errorType: "internal_error",
    });
    await expect(pC).rejects.toMatchObject({
      errorType: "internal_error",
    });

    // Unblock the active worker item
    unblock();
    const resA = await pA;
    expect(resA.text).toBe("done");
  });
});
