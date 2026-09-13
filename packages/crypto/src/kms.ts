/**
 * AWS KMS key wrapper (ADR 0008).
 *
 * `GenerateDataKey` with `KeySpec: AES_256` and `Decrypt`, both with the encryption context.
 * Shapes verified 2026-09-13:
 *   https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html
 *   https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/kms/command/DecryptCommand/
 *   `Encrypt` (re-wrap onto a new key): KeyId, Plaintext, EncryptionContext → CiphertextBlob, KeyId, per
 *   @aws-sdk/client-kms 3.1131.0 typings and https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html
 *
 * NOT exercised against a live KMS key in this build -- there is no AWS account yet. The
 * `KeyWrapper` contract it implements is fully tested through `LocalKeyWrapper`, which
 * enforces the same context rule. Wire a real key before relying on this in production.
 */

import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";

import {
  DecryptionError,
  type EncryptionContext,
  type KeyWrapper,
  type WrappedKey,
} from "./envelope";

export class KmsKeyWrapper implements KeyWrapper {
  private readonly client: KMSClient;

  constructor(
    private readonly keyId: string,
    config: KMSClientConfig,
  ) {
    this.client = new KMSClient(config);
  }

  async generateDataKey(
    context: EncryptionContext,
  ): Promise<{ plaintext: Buffer; wrapped: WrappedKey }> {
    const result = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: { ...context },
      }),
    );
    if (result.Plaintext === undefined || result.CiphertextBlob === undefined) {
      throw new Error("KMS GenerateDataKey returned no key material");
    }
    return {
      plaintext: Buffer.from(result.Plaintext),
      wrapped: {
        ciphertext: result.CiphertextBlob,
        // The key ARN, the same value Encrypt reports: one version string per master key, so the
        // re-wrap job can tell which key a DEK is under. KMS rotation inside a key needs no tracking.
        keyVersion: result.KeyId ?? this.keyId,
      },
    };
  }

  async wrap(plaintext: Buffer, context: EncryptionContext): Promise<WrappedKey> {
    const result = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: plaintext,
        EncryptionContext: { ...context },
      }),
    );
    if (result.CiphertextBlob === undefined)
      throw new Error("KMS Encrypt returned no ciphertext");
    return { ciphertext: result.CiphertextBlob, keyVersion: result.KeyId ?? this.keyId };
  }

  async unwrap(wrapped: WrappedKey, context: EncryptionContext): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new DecryptCommand({
          CiphertextBlob: wrapped.ciphertext,
          EncryptionContext: { ...context },
          KeyId: this.keyId,
        }),
      );
      if (result.Plaintext === undefined) throw new DecryptionError();
      return Buffer.from(result.Plaintext);
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidCiphertextException") {
        throw new DecryptionError();
      }
      throw error;
    }
  }
}
