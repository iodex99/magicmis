/**
 * Envelope encryption (SPEC §5, §10; ADR 0008).
 *
 * Data is encrypted with a per-tenant data key (DEK) using AES-256-GCM. The DEK is stored
 * only in wrapped form, wrapped by a master key held by a `KeyWrapper` -- AWS KMS in
 * production, a local AES key in tests and development.
 *
 * Every wrap and every data encryption binds an *encryption context* (tenant ids and a
 * purpose) as authenticated data. A ciphertext or wrapped key moved to another tenant's
 * row fails to decrypt rather than silently decrypting under the wrong tenant.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Non-secret key-value pairs bound as authenticated data. Ids only, never names. */
export type EncryptionContext = Readonly<Record<string, string>>;

export interface WrappedKey {
  /** Opaque wrapped DEK bytes, as returned by the wrapper. */
  readonly ciphertext: Uint8Array;
  /** Which master key version wrapped it, for rotation bookkeeping (`kms_key_version`). */
  readonly keyVersion: string;
}

export interface KeyWrapper {
  /** Generate a fresh 256-bit DEK: plaintext for immediate use, wrapped for storage. */
  generateDataKey(
    context: EncryptionContext,
  ): Promise<{ plaintext: Buffer; wrapped: WrappedKey }>;
  /** Unwrap a stored DEK. Must fail if the context differs from the one used to wrap. */
  unwrap(wrapped: WrappedKey, context: EncryptionContext): Promise<Buffer>;
  /** Wrap an existing DEK under this master key: re-wrapping when moving to a new master key (ADR 0008). */
  wrap(plaintext: Buffer, context: EncryptionContext): Promise<WrappedKey>;
}

export class DecryptionError extends Error {
  constructor(message = "Decryption failed: wrong key, wrong context, or tampered data") {
    super(message);
    this.name = "DecryptionError";
  }
}

const FORMAT_VERSION = 1;
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

/**
 * Canonical bytes for a context: keys sorted, JSON-encoded. Two callers building the same
 * context in a different key order must produce identical authenticated data.
 */
export function canonicalContext(context: EncryptionContext): Buffer {
  const sorted = Object.keys(context)
    .sort()
    .map((k) => [k, context[k] ?? ""]);
  return Buffer.from(JSON.stringify(sorted), "utf8");
}

/**
 * AES-256-GCM encrypt. Output layout: [version:1][iv:12][tag:16][ciphertext].
 * A fresh random IV per call; GCM must never reuse an IV under the same key.
 */
export function encryptWithKey(
  key: Buffer,
  plaintext: Buffer,
  context: EncryptionContext,
): Buffer {
  if (key.length !== 32) throw new RangeError("encryptWithKey: key must be 32 bytes");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(canonicalContext(context));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, body]);
}

export function decryptWithKey(
  key: Buffer,
  sealed: Uint8Array,
  context: EncryptionContext,
): Buffer {
  if (key.length !== 32) throw new RangeError("decryptWithKey: key must be 32 bytes");
  const bytes = Buffer.from(sealed);
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES || bytes[0] !== FORMAT_VERSION) {
    throw new DecryptionError("Decryption failed: unrecognised ciphertext format");
  }
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = bytes.subarray(1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(canonicalContext(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

/**
 * Local master-key wrapper for tests and development.
 *
 * Enforces the encryption context exactly as KMS does -- a wrong context fails -- so a test
 * cannot pass by skipping a check production would apply (ADR 0008).
 */
export class LocalKeyWrapper implements KeyWrapper {
  private readonly masterKey: Buffer;

  constructor(
    masterKey: Buffer,
    private readonly keyVersion = "local-1",
  ) {
    if (masterKey.length !== 32)
      throw new RangeError("LocalKeyWrapper: master key must be 32 bytes");
    this.masterKey = Buffer.from(masterKey);
  }

  static fromBase64(value: string, keyVersion?: string): LocalKeyWrapper {
    return new LocalKeyWrapper(Buffer.from(value, "base64"), keyVersion);
  }

  generateDataKey(
    context: EncryptionContext,
  ): Promise<{ plaintext: Buffer; wrapped: WrappedKey }> {
    const plaintext = randomBytes(32);
    const ciphertext = encryptWithKey(this.masterKey, plaintext, context);
    return Promise.resolve({
      plaintext,
      wrapped: { ciphertext, keyVersion: this.keyVersion },
    });
  }

  wrap(plaintext: Buffer, context: EncryptionContext): Promise<WrappedKey> {
    return Promise.resolve({
      ciphertext: encryptWithKey(this.masterKey, plaintext, context),
      keyVersion: this.keyVersion,
    });
  }

  unwrap(wrapped: WrappedKey, context: EncryptionContext): Promise<Buffer> {
    try {
      return Promise.resolve(decryptWithKey(this.masterKey, wrapped.ciphertext, context));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new DecryptionError());
    }
  }
}

/** Encrypt a value under a fresh DEK in one step: returns the sealed data and the wrapped DEK. */
export async function sealWithNewKey(
  wrapper: KeyWrapper,
  plaintext: Buffer,
  context: EncryptionContext,
): Promise<{ sealed: Buffer; wrapped: WrappedKey }> {
  const { plaintext: dek, wrapped } = await wrapper.generateDataKey(context);
  try {
    return { sealed: encryptWithKey(dek, plaintext, context), wrapped };
  } finally {
    dek.fill(0); // AWS guidance: erase the plaintext data key after use.
  }
}

export async function openWithWrappedKey(
  wrapper: KeyWrapper,
  sealed: Uint8Array,
  wrapped: WrappedKey,
  context: EncryptionContext,
): Promise<Buffer> {
  const dek = await wrapper.unwrap(wrapped, context);
  try {
    return decryptWithKey(dek, sealed, context);
  } finally {
    dek.fill(0);
  }
}

/** Constant-time buffer equality, for callers comparing secrets. */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Master-key replacement (ADR 0008): new DEKs are generated and wrapped under `current`, while DEKs
 * still wrapped under `previous` keep opening until the re-wrap job has moved them. Run the app with
 * this wrapper for the length of the migration, then with `current` alone.
 */
export class RotatingKeyWrapper implements KeyWrapper {
  constructor(
    private readonly current: KeyWrapper,
    private readonly previous: KeyWrapper,
  ) {}

  generateDataKey(
    context: EncryptionContext,
  ): Promise<{ plaintext: Buffer; wrapped: WrappedKey }> {
    return this.current.generateDataKey(context);
  }

  wrap(plaintext: Buffer, context: EncryptionContext): Promise<WrappedKey> {
    return this.current.wrap(plaintext, context);
  }

  async unwrap(wrapped: WrappedKey, context: EncryptionContext): Promise<Buffer> {
    try {
      return await this.current.unwrap(wrapped, context);
    } catch (currentError) {
      try {
        return await this.previous.unwrap(wrapped, context);
      } catch {
        throw currentError;
      }
    }
  }
}
