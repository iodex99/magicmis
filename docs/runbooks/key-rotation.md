# Runbook: master key rotation and replacement

**Applies to:** envelope encryption (SPEC §10, ADR 0008).

**Audience:** the product owner and on-call engineers with the production KMS role.

## What is wrapped by the master key

| Store | Column | Context |
|---|---|---|
| `company_keys` | `wrapped_dek`, `kms_key_version` | `purpose=company_dek, account_id, company_id` |
| `account_keys` | `wrapped_dek`, `kms_key_version` | `purpose=account_dek, account_id` |
| `platform_keys` | `wrapped_dek`, `kms_key_version` | `purpose=platform_<purpose>_key` |
| `admin_users` | `totp_key_wrapped`, `totp_key_version` | `purpose=admin_totp, admin_id` |

Everything else is encrypted under one of those DEKs:
- snapshots, blueprints and outputs;
- redaction keys;
- account rules and exports;
- library names.

It never needs re-encrypting.

## Routine rotation: nothing to do

AWS KMS automatic rotation is enabled on the customer-managed key (365 days). KMS decrypts with whichever key material wrapped a DEK. Routine rotation needs no action and no re-wrap.

Once a year, confirm:
- rotation is still enabled (`aws kms get-key-rotation-status`);
- a nightly `integrity-verify` run has succeeded since.

## Replacement: moving to a new KMS key

Replace the key after a suspected compromise of the key or its IAM role, or when moving accounts or regions.

1. **Create the new key.** Make it a symmetric customer-managed key in `ap-south-1` with automatic rotation on. Grant the web, admin and worker roles `kms:GenerateDataKey`, `kms:Decrypt` and `kms:Encrypt` on it. Keep `kms:Decrypt` on the old key.
2. **Deploy all three apps in rotating mode.**
   - Set `KMS_MASTER_KEY_ID` to the new key.
   - Set `KMS_PREVIOUS_MASTER_KEY_ID` to the old key.
   - Redeploy web, admin and worker.

   New DEKs are now created under the new key, and old ones still open (`RotatingKeyWrapper`).
3. **Re-wrap.** From a trusted machine, or a one-off worker task with both keys:

   ```sh
   KMS_PREVIOUS_MASTER_KEY_ID=<old> KMS_MASTER_KEY_ID=<new> AWS_REGION=ap-south-1 \
     DATABASE_URL=<prod> RESEND_API_KEY=... EMAIL_FROM=... APP_URL=... \
     pnpm --filter @magicmis/worker rewrap-keys
   ```

   It prints the moved count per table. It is resumable; if it stops, run it again.
4. **Verify.** Nothing may still be on the old key. Count rows not at the new version (the version printed as `toVersion`):

   ```sql
   select count(*) from company_keys where wrapped_dek is not null and kms_key_version <> '<toVersion>';
   select count(*) from account_keys where wrapped_dek is not null and kms_key_version <> '<toVersion>';
   select count(*) from platform_keys where kms_key_version <> '<toVersion>';
   select count(*) from admin_users where totp_key_version not in ('<toVersion>', 'none');
   ```

   All must be 0. Then open one company dashboard and one admin sign-in.
5. **Drop the old key.**
   - Remove `KMS_PREVIOUS_MASTER_KEY_ID` and redeploy.
   - Revoke the roles' access to the old key.
   - Schedule the old key for deletion (the KMS waiting period applies).
6. **Record it.** Write an audit note in the incident record: the old and new key ids, and the time of each step.

## Never

- Never put a master key, or plaintext DEKs, in environment files, logs or tickets.
- Never regenerate a destroyed key. `wrapped_dek is null` means crypto-shredded on purpose; the re-wrap job skips those rows.
