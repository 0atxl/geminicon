import crypto from "crypto";
import fs from "fs";
import path from "path";
import { GatewayError } from "../gateway/errors.js";

export interface PairedDeviceRecord {
  userId: string;
  deviceId?: string;
  deviceTokenHash?: string;
  pairingCodeHash?: string;
  pairingExpiresAt?: number;
  createdAt: number;
  lastSeenAt?: number;
  revoked: boolean;
}

// Crockford Base32-inspired alphabet excluding ambiguous characters: 0, O, 1, I, L
const PAIRING_CHARS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function generatePairingCodeString(): string {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes).map((b) => PAIRING_CHARS[b % PAIRING_CHARS.length]);
  return `PAIR-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function timingSafeEqualHex(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export class DeviceRegistry {
  private filePath: string;
  private records: Map<string, PairedDeviceRecord> = new Map(); // userId -> record

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(process.cwd(), ".geminicon-devices.json");
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      // No file yet — start with empty registry (first run).
      return;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Cannot read device registry at ${this.filePath}: ${(err as Error).message}`
      );
    }
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Corrupt device registry at ${this.filePath}: ${(err as Error).message}`
      );
    }
    if (!Array.isArray(list)) {
      throw new Error(
        `Corrupt device registry at ${this.filePath}: expected a JSON array.`
      );
    }
    this.records.clear();
    for (const item of list) {
      if (item && item.userId) {
        this.records.set(item.userId, item);
      }
    }
  }

  /**
   * Atomically persists the current in-memory registry to disk.
   * Throws on failure so callers can abort their mutation.
   */
  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = JSON.stringify(Array.from(this.records.values()), null, 2);
    const tempPath = `${this.filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(tempPath, data, { mode: 0o600, encoding: "utf-8" });
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      // Clean up temp file on failure
      try { fs.unlinkSync(tempPath); } catch { /* best-effort */ }
      throw err;
    }
  }

  /**
   * Creates a 10-minute, single-use pairing code for the specified userId.
   * Overwrites any pending pairing code for this user.
   * Fails if the new state cannot be persisted.
   */
  public createPairingCode(userId: string, ttlMs = 10 * 60 * 1000): { code: string; expiresAt: string } {
    if (!userId || typeof userId !== "string") {
      throw GatewayError.invalidRequest("Missing or invalid 'userId'.");
    }

    const code = generatePairingCodeString();
    const pairingCodeHash = sha256(code);
    const pairingExpiresAt = Date.now() + ttlMs;

    const existing = this.records.get(userId);
    const previous = existing ? { ...existing } : undefined;
    const record: PairedDeviceRecord = {
      userId,
      deviceId: existing?.deviceId,
      deviceTokenHash: existing?.deviceTokenHash,
      pairingCodeHash,
      pairingExpiresAt,
      createdAt: existing?.createdAt || Date.now(),
      revoked: false,
    };

    this.records.set(userId, record);
    try {
      this.save();
    } catch (err) {
      // Rollback in-memory state
      if (previous) {
        this.records.set(userId, previous);
      } else {
        this.records.delete(userId);
      }
      throw err;
    }

    return {
      code,
      expiresAt: new Date(pairingExpiresAt).toISOString(),
    };
  }

  /**
   * Claims a pairing code from the extension and exchanges it for a 256-bit persistent device token.
   * Single-use: the pairing code is consumed and cleared upon successful claim.
   * A newly paired device replaces the previous device for this user.
   * Fails if the new state cannot be persisted.
   */
  public claimPairingCode(rawCode: string, deviceId: string): { deviceToken: string; userId: string } {
    if (!rawCode || typeof rawCode !== "string") {
      throw GatewayError.invalidRequest("Missing or invalid pairing code.");
    }
    if (!deviceId || typeof deviceId !== "string") {
      throw GatewayError.invalidRequest("Missing or invalid 'deviceId'.");
    }

    const normalizedCode = rawCode.trim().toUpperCase();
    const candidateHash = sha256(normalizedCode);
    const now = Date.now();

    let matchedUser: string | undefined;
    for (const [userId, record] of this.records.entries()) {
      if (
        record.pairingCodeHash &&
        timingSafeEqualHex(record.pairingCodeHash, candidateHash)
      ) {
        if (record.pairingExpiresAt && record.pairingExpiresAt > now) {
          matchedUser = userId;
          break;
        } else {
          // Code is expired — clear it and persist
          const previous = { ...record };
          record.pairingCodeHash = undefined;
          record.pairingExpiresAt = undefined;
          try {
            this.save();
          } catch {
            // Rollback
            Object.assign(record, previous);
          }
          throw GatewayError.invalidRequest("Pairing code has expired. Please request a new one.");
        }
      }
    }

    if (!matchedUser) {
      throw GatewayError.invalidRequest("Invalid pairing code.");
    }

    // Snapshot the previous state for rollback
    const previousRecord = this.records.get(matchedUser);
    const previousSnapshot = previousRecord ? { ...previousRecord } : undefined;

    // Generate random 256-bit device token (32 bytes hex)
    const deviceToken = `gcon_dev_${crypto.randomBytes(32).toString("hex")}`;
    const deviceTokenHash = sha256(deviceToken);

    const record: PairedDeviceRecord = {
      userId: matchedUser,
      deviceId,
      deviceTokenHash,
      pairingCodeHash: undefined, // Burn single-use code
      pairingExpiresAt: undefined,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      revoked: false,
    };

    this.records.set(matchedUser, record);
    try {
      this.save();
    } catch (err) {
      // Rollback in-memory state
      if (previousSnapshot) {
        this.records.set(matchedUser, previousSnapshot);
      } else {
        this.records.delete(matchedUser);
      }
      throw err;
    }

    return { deviceToken, userId: matchedUser };
  }

  /**
   * Validates a deviceToken against the registry.
   */
  public validateDeviceToken(token?: string): { valid: boolean; userId?: string; deviceId?: string } {
    if (!token || typeof token !== "string" || !token.startsWith("gcon_dev_")) {
      return { valid: false };
    }

    const candidateHash = sha256(token);
    for (const record of this.records.values()) {
      if (
        !record.revoked &&
        record.deviceTokenHash &&
        timingSafeEqualHex(record.deviceTokenHash, candidateHash)
      ) {
        record.lastSeenAt = Date.now();
        return {
          valid: true,
          userId: record.userId,
          deviceId: record.deviceId,
        };
      }
    }

    return { valid: false };
  }

  /**
   * Revokes the paired device for the specified user.
   * Fails if the revocation cannot be persisted.
   */
  public revokeUserDevice(userId: string): boolean {
    const record = this.records.get(userId);
    if (!record) return false;

    const previous = { ...record };
    record.revoked = true;
    record.deviceTokenHash = undefined;
    record.pairingCodeHash = undefined;
    record.pairingExpiresAt = undefined;
    try {
      this.save();
    } catch (err) {
      // Rollback
      Object.assign(record, previous);
      throw err;
    }
    return true;
  }

  /**
   * Revokes a device by its token. Returns the userId if revoked, undefined otherwise.
   * Fails if the revocation cannot be persisted.
   */
  public revokeByDeviceToken(token: string): string | undefined {
    const validation = this.validateDeviceToken(token);
    if (!validation.valid || !validation.userId) return undefined;
    this.revokeUserDevice(validation.userId);
    return validation.userId;
  }

  public getDeviceForUser(userId: string): PairedDeviceRecord | undefined {
    const record = this.records.get(userId);
    if (record && !record.revoked && record.deviceTokenHash) {
      return record;
    }
    return undefined;
  }

  public clear(): void {
    this.records.clear();
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      // Ignore
    }
  }
}
