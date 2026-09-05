import { GatewayTask, WorkerResult } from "../types.js";
import { GatewayError } from "../gateway/errors.js";

export type TaskWorker = (task: GatewayTask) => Promise<WorkerResult>;

interface QueueItem {
  task: GatewayTask;
  resolve: (result: WorkerResult) => void;
  reject: (err: any) => void;
}

export class TaskQueue {
  private queue: QueueItem[] = [];
  private active = false;
  private worker: TaskWorker;
  private maxQueueSize: number;

  constructor(worker: TaskWorker, maxQueueSize = 20) {
    this.worker = worker;
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Enqueues a GatewayTask and returns a promise that resolves with the WorkerResult.
   */
  public enqueue(task: GatewayTask): Promise<WorkerResult> {
    if (this.queue.length >= this.maxQueueSize) {
      throw GatewayError.queueFull();
    }

    return new Promise<WorkerResult>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.active || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.active = true;

    try {
      const result = await this.worker(item.task);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.active = false;
      // Process next item in FIFO order
      this.processNext();
    }
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public get isBusy(): boolean {
    return this.active;
  }

  public cancelQueued(taskId: string, error: GatewayError): boolean {
    const index = this.queue.findIndex((item) => item.task.id === taskId);
    if (index === -1) return false;
    const [item] = this.queue.splice(index, 1);
    item.reject(error);
    return true;
  }

  public clear(): void {
    const error = GatewayError.internalError("Task queue was cleared.");
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(error);
    }
    this.active = false;
  }
}
