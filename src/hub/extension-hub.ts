import crypto from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import {
  GATEWAY_ERROR_CODES,
  GEMINICON_PROTOCOL_VERSION,
  GatewayErrorCode,
  GatewayTask,
  SUPPORTED_MODELS,
  SupportedModel,
  WorkerResult,
  WSClientMessage,
  WSServerMessage,
} from "../types.js";
import { GatewayError } from "../gateway/errors.js";
import { TaskQueue } from "../queue/task-queue.js";

const MAX_TASK_TEXT = 2 * 1024 * 1024;
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const envelope = {
  protocolVersion: z.literal(GEMINICON_PROTOCOL_VERSION),
};

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...envelope,
    type: z.literal("REGISTER"),
    credential: z.string().min(1).max(512).optional(),
    deviceId: idSchema,
    name: z.string().min(1).max(128).optional(),
    clientVersion: z.string().min(1).max(32),
  }).strict(),
  z.object({ ...envelope, type: z.literal("PONG"), nonce: idSchema }).strict(),
  z.object({
    ...envelope,
    type: z.literal("TASK_COMPLETE"),
    taskId: idSchema,
    attemptId: idSchema,
    text: z.string().max(MAX_TASK_TEXT),
    latencyMs: z.number().int().min(0).max(24 * 60 * 60_000),
  }).strict(),
  z.object({
    ...envelope,
    type: z.literal("TASK_ERROR"),
    taskId: idSchema,
    attemptId: idSchema,
    errorType: z.enum(GATEWAY_ERROR_CODES),
    message: z.string().min(1).max(2048),
  }).strict(),
  z.object({
    ...envelope,
    type: z.literal("TASK_CANCELLED"),
    taskId: idSchema,
    attemptId: idSchema,
    ready: z.boolean(),
  }).strict(),
  z.object({
    ...envelope,
    type: z.literal("DEVICE_STATUS"),
    probeId: idSchema,
    status: z.enum(["ready", "connected_not_ready"]),
    geminiAuthenticated: z.boolean(),
    contentScriptResponsive: z.boolean(),
    temporaryChatAvailable: z.boolean(),
    models: z.array(z.enum(SUPPORTED_MODELS)).max(SUPPORTED_MODELS.length),
  }).strict(),
]);

type WorkerState =
  | "connected_not_ready"
  | "probing"
  | "ready"
  | "busy"
  | "cancelling"
  | "degraded";

interface PendingTask {
  taskId: string;
  attemptId: string;
  resolve: (result: WorkerResult) => void;
  reject: (err: unknown) => void;
  generationTimer: NodeJS.Timeout;
  cancellationTimer?: NodeJS.Timeout;
  cancellationError?: GatewayError;
  state: "active" | "cancelling";
}

interface ConnectedWorker {
  ws: WebSocket;
  key: string;
  deviceId: string;
  connectedAt: number;
  lastHeartbeat: number;
  state: WorkerState;
  active?: PendingTask;
  pingInterval?: NodeJS.Timeout;
  pendingPingNonce?: string;
  pendingProbeId?: string;
  geminiAuthenticated: boolean;
  temporaryChatAvailable: boolean;
  models: SupportedModel[];
}

export class ExtensionHub {
  private workers = new Map<string, ConnectedWorker>();
  private wsToKey = new Map<WebSocket, string>();
  private userQueues = new Map<string, TaskQueue>();
  private sweepInterval: NodeJS.Timeout | null;
  private isClosed = false;

  constructor(
    private readonly queueMaxSize = 20,
    private readonly defaultTimeoutMs = 180000,
    private readonly cancellationAckTimeoutMs = 20_000
  ) {
    this.sweepInterval = setInterval(() => this.sweepStaleWorkers(), 30000);
  }

  public getConnectedWorkerCount(): number {
    return this.workers.size;
  }

  public getReadyWorkerCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (this.isUsable(worker)) count++;
    }
    return count;
  }

  private resolveWorker(key = "default"): ConnectedWorker | undefined {
    return this.workers.get(key) || Array.from(this.workers.values())[0];
  }

  public hasWorker(key = "default"): boolean {
    const worker = this.resolveWorker(key);
    return !!worker && this.isUsable(worker);
  }

  public getUserQueue(key = "default"): TaskQueue {
    let queue = this.userQueues.get(key);
    if (!queue) {
      queue = new TaskQueue(
        (task: GatewayTask) => this.executeTask(key, task),
        this.queueMaxSize
      );
      this.userQueues.set(key, queue);
    }
    return queue;
  }

  public handleConnection(ws: WebSocket): void {
    if (this.isClosed) {
      ws.close(1001, "Gateway is shutting down");
      return;
    }

    const pingInterval = setInterval(() => {
      const key = this.wsToKey.get(ws);
      const worker = key ? this.workers.get(key) : undefined;
      if (worker && worker.ws === ws && ws.readyState === WebSocket.OPEN) {
        const nonce = crypto.randomUUID();
        worker.pendingPingNonce = nonce;
        this.send(ws, {
          type: "PING",
          protocolVersion: GEMINICON_PROTOCOL_VERSION,
          nonce,
        });
        if (
          worker.state === "ready" ||
          worker.state === "connected_not_ready" ||
          worker.state === "degraded"
        ) {
          this.requestStatus(worker);
        }
      }
    }, 25000);
    pingInterval.unref?.();

    ws.on("message", (data: Buffer | string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        ws.close(1007, "Invalid message");
        return;
      }
      const validation = wsClientMessageSchema.safeParse(parsed);
      if (!validation.success) {
        ws.close(1008, "Invalid message");
        return;
      }
      this.handleClientMessage(ws, validation.data);
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(pingInterval);
      const key = this.wsToKey.get(ws);
      if (key) this.unregisterWorker(key, ws);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);

    const registrationTimer = setTimeout(() => {
      if (!this.wsToKey.has(ws) && ws.readyState === WebSocket.OPEN) {
        ws.close(1008, "Registration required");
      }
    }, 10_000);
    registrationTimer.unref?.();
  }

  private registerWorker(key: string, deviceId: string, ws: WebSocket): void {
    const existing = this.workers.get(key);
    if (existing && existing.ws !== ws) {
      this.failActive(
        existing,
        GatewayError.workerNotConnected("Extension worker was replaced.")
      );
      this.wsToKey.delete(existing.ws);
      existing.ws.close(1008, "Device connection replaced");
    }

    const worker: ConnectedWorker = {
      ws,
      key,
      deviceId,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      state: "connected_not_ready",
      geminiAuthenticated: false,
      temporaryChatAvailable: false,
      models: [],
    };
    this.workers.set(key, worker);
    this.wsToKey.set(ws, key);
    this.send(ws, {
      type: "REGISTER_ACK",
      protocolVersion: GEMINICON_PROTOCOL_VERSION,
      status: "ok",
      connectionId: crypto.randomUUID(),
    });
    this.requestStatus(worker);
  }

  private unregisterWorker(key: string, ws: WebSocket): void {
    const worker = this.workers.get(key);
    if (!worker || worker.ws !== ws) return;
    if (worker.pingInterval) clearInterval(worker.pingInterval);
    this.failActive(
      worker,
      GatewayError.workerNotConnected("Extension worker disconnected.")
    );
    this.workers.delete(key);
    this.wsToKey.delete(ws);
  }

  private handleClientMessage(ws: WebSocket, msg: WSClientMessage): void {
    if (msg.type === "REGISTER") {
      if (this.wsToKey.has(ws)) {
        ws.close(1008, "Already registered");
        return;
      }
      const key = (msg as any).credential || "default";
      this.registerWorker(key, msg.deviceId, ws);
      return;
    }

    const key = this.wsToKey.get(ws);
    const worker = key ? this.workers.get(key) : undefined;
    if (!worker || worker.ws !== ws) {
      ws.close(1008, "Registration required");
      return;
    }

    switch (msg.type) {
      case "PONG":
        if (msg.nonce === worker.pendingPingNonce) {
          worker.pendingPingNonce = undefined;
          worker.lastHeartbeat = Date.now();
        }
        break;
      case "DEVICE_STATUS":
        if (
          msg.probeId !== worker.pendingProbeId ||
          worker.state === "busy" ||
          worker.state === "cancelling"
        ) {
          return;
        }
        worker.pendingProbeId = undefined;
        worker.lastHeartbeat = Date.now();
        worker.geminiAuthenticated = msg.geminiAuthenticated;
        worker.temporaryChatAvailable = msg.temporaryChatAvailable;
        worker.models = msg.models;
        worker.state =
          msg.status === "ready" &&
          msg.geminiAuthenticated &&
          msg.contentScriptResponsive &&
          msg.temporaryChatAvailable &&
          msg.models.includes("gemini-web")
            ? "ready"
            : "connected_not_ready";
        break;
      case "TASK_COMPLETE": {
        const pending = this.matchActive(worker, msg.taskId, msg.attemptId);
        if (!pending || pending.state !== "active" || worker.state !== "busy") return;
        this.finishActive(worker);
        pending.resolve({
          requestId: msg.taskId,
          text: msg.text,
          latencyMs: msg.latencyMs,
        });
        break;
      }
      case "TASK_ERROR": {
        const pending = this.matchActive(worker, msg.taskId, msg.attemptId);
        if (!pending || pending.state !== "active") return;
        this.finishActive(worker, false);
        pending.reject(
          new GatewayError(this.safeWorkerErrorMessage(msg.errorType), msg.errorType, 502)
        );
        this.requestStatus(worker);
        break;
      }
      case "TASK_CANCELLED": {
        const pending = this.matchActive(worker, msg.taskId, msg.attemptId);
        if (!pending || pending.state !== "cancelling") return;
        const error =
          pending.cancellationError ??
          new GatewayError("Task was cancelled.", "task_cancelled", 499);
        this.finishActive(worker, msg.ready);
        pending.reject(error);
        if (!msg.ready) this.requestStatus(worker);
        break;
      }
    }
  }

  public cancelTask(key = "default", taskId: string): void {
    const cancellationError = new GatewayError(
      "Task was cancelled by the client.",
      "task_cancelled",
      499
    );
    if (this.userQueues.get(key)?.cancelQueued(taskId, cancellationError)) return;
    const worker = this.resolveWorker(key);
    const pending = worker?.active;
    if (!worker || !pending || pending.taskId !== taskId) return;
    this.beginCancellation(worker, pending, cancellationError);
  }

  public sweepStaleWorkers(timeoutThresholdMs = 60000): void {
    const now = Date.now();
    for (const [key, worker] of this.workers) {
      if (now - worker.lastHeartbeat <= timeoutThresholdMs) continue;
      worker.state = "degraded";
      worker.ws.close(1001, "Heartbeat timeout");
      this.unregisterWorker(key, worker.ws);
    }
  }

  public async executeTask(
    key = "default",
    task: GatewayTask,
    timeoutMs = this.defaultTimeoutMs
  ): Promise<WorkerResult> {
    if (this.isClosed) {
      throw GatewayError.internalError("Gateway server is shutting down.");
    }
    const worker = this.resolveWorker(key);
    if (!worker || !this.isUsable(worker)) {
      throw GatewayError.workerNotConnected();
    }
    if (worker.active) {
      throw GatewayError.internalError("Worker already has an active task.");
    }

    const attemptId = crypto.randomUUID();
    return new Promise<WorkerResult>((resolve, reject) => {
      const pending: PendingTask = {
        taskId: task.id,
        attemptId,
        resolve,
        reject,
        state: "active",
        generationTimer: setTimeout(() => {
          this.beginCancellation(worker, pending, GatewayError.generationTimeout());
        }, timeoutMs),
      };
      worker.active = pending;
      worker.state = "busy";
      this.send(worker.ws, {
        type: "EXECUTE_TASK",
        protocolVersion: GEMINICON_PROTOCOL_VERSION,
        taskId: task.id,
        attemptId,
        model: task.model,
        prompt: task.prompt,
        sessionId: task.sessionId,
        resetSession: task.resetSession,
        timeoutMs,
      });
    });
  }

  private beginCancellation(
    worker: ConnectedWorker,
    pending: PendingTask,
    error: GatewayError
  ): void {
    if (worker.active !== pending || pending.state === "cancelling") return;
    clearTimeout(pending.generationTimer);
    pending.state = "cancelling";
    pending.cancellationError = error;
    worker.state = "cancelling";
    this.send(worker.ws, {
      type: "CANCEL_TASK",
      protocolVersion: GEMINICON_PROTOCOL_VERSION,
      taskId: pending.taskId,
      attemptId: pending.attemptId,
    });
    pending.cancellationTimer = setTimeout(() => {
      if (worker.active !== pending) return;
      this.finishActive(worker, false);
      worker.state = "degraded";
      pending.reject(error);
    }, this.cancellationAckTimeoutMs);
  }

  private matchActive(
    worker: ConnectedWorker,
    taskId: string,
    attemptId: string
  ): PendingTask | undefined {
    const pending = worker.active;
    return pending?.taskId === taskId && pending.attemptId === attemptId
      ? pending
      : undefined;
  }

  private finishActive(worker: ConnectedWorker, ready = true): void {
    const pending = worker.active;
    if (!pending) return;
    clearTimeout(pending.generationTimer);
    if (pending.cancellationTimer) clearTimeout(pending.cancellationTimer);
    worker.active = undefined;
    worker.state = ready ? "ready" : "connected_not_ready";
  }

  private failActive(worker: ConnectedWorker, error: GatewayError): void {
    const pending = worker.active;
    if (!pending) return;
    this.finishActive(worker, false);
    pending.reject(error);
  }

  private requestStatus(worker: ConnectedWorker): void {
    if (
      worker.ws.readyState !== WebSocket.OPEN ||
      worker.state === "busy" ||
      worker.state === "cancelling"
    ) {
      return;
    }
    const probeId = crypto.randomUUID();
    worker.pendingProbeId = probeId;
    worker.state = "probing";
    this.send(worker.ws, {
      type: "PROBE_STATUS",
      protocolVersion: GEMINICON_PROTOCOL_VERSION,
      probeId,
    });
  }

  private isUsable(worker: ConnectedWorker): boolean {
    return worker.ws.readyState === WebSocket.OPEN && worker.state === "ready";
  }

  private send(ws: WebSocket, message: WSServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      ws.close(1011, "Transport failure");
    }
  }

  private safeWorkerErrorMessage(errorType: GatewayErrorCode): string {
    switch (errorType) {
      case "authentication_required":
        return "The managed Gemini session requires authentication.";
      case "temporary_chat_unavailable":
      case "temporary_chat_failed":
        return "The extension could not verify Temporary Chat.";
      case "upstream_limit":
        return "Gemini Web reported an upstream usage limit.";
      case "generation_timeout":
        return "Gemini Web generation timed out.";
      case "unsupported_model":
        return "The requested model could not be verified.";
      default:
        return "The extension worker could not complete the task.";
    }
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    this.sweepInterval = null;
    for (const worker of this.workers.values()) {
      this.failActive(
        worker,
        GatewayError.internalError("Gateway server shutting down.")
      );
      if (worker.pingInterval) clearInterval(worker.pingInterval);
      if (
        worker.ws.readyState === WebSocket.OPEN ||
        worker.ws.readyState === WebSocket.CONNECTING
      ) {
        worker.ws.close(1001, "Server shutting down");
      }
    }
    for (const queue of this.userQueues.values()) queue.clear();
    this.workers.clear();
    this.wsToKey.clear();
    this.userQueues.clear();
  }
}
