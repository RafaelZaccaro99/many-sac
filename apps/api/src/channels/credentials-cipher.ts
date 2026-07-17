import * as crypto from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Encrypts channel credentials (access tokens, etc.) at rest with AES-256-GCM.
 * The key comes from CREDENTIALS_ENCRYPTION_KEY (32 raw bytes, base64-encoded) -
 * never derived from a guessable secret, never logged.
 */
@Injectable()
export class CredentialsCipher {
  constructor(private readonly configService: ConfigService) {}

  private getKey(): Buffer {
    const key = Buffer.from(this.configService.getOrThrow<string>("CREDENTIALS_ENCRYPTION_KEY"), "base64");
    if (key.length !== 32) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }
    return key;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, "base64");
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = raw.subarray(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}
