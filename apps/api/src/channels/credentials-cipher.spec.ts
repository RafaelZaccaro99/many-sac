import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { CredentialsCipher } from "./credentials-cipher";

function buildCipher(key = crypto.randomBytes(32).toString("base64")): CredentialsCipher {
  const config = {
    getOrThrow: (k: string) => {
      if (k !== "CREDENTIALS_ENCRYPTION_KEY") throw new Error(`unexpected key ${k}`);
      return key;
    },
  } as ConfigService;
  return new CredentialsCipher(config);
}

describe("CredentialsCipher", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const cipher = buildCipher();
    const plaintext = "super-secret-access-token";
    const encrypted = cipher.encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const cipher = buildCipher();
    const a = cipher.encrypt("token");
    const b = cipher.encrypt("token");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with the wrong key", () => {
    const cipherA = buildCipher();
    const cipherB = buildCipher();
    const encrypted = cipherA.encrypt("token");
    expect(() => cipherB.decrypt(encrypted)).toThrow();
  });

  it("rejects a key that isn't exactly 32 bytes", () => {
    const cipher = buildCipher(Buffer.from("too-short").toString("base64"));
    expect(() => cipher.encrypt("x")).toThrow(/32 bytes/);
  });
});
