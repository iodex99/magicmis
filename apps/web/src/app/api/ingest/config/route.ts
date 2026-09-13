import { readConfig } from "@magicmis/db/config";
import { ingestLimitsSchema } from "@magicmis/ingest";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, withAccount } from "@/lib/http";

const capsSchema = z.object({
  sample_rows_per_sheet: z.number().int().positive(),
  distinct_values_per_column: z.number().int().positive(),
  chat_rows_per_round: z.number().int().positive(),
  chat_bytes_per_round: z.number().int().positive(),
});

/** GET /api/ingest/config — file limits (SPEC §15) and payload caps (SPEC §14, §27) for the browser. */
export async function GET(): Promise<Response> {
  return withAccount(async () => {
    const pool = db();
    const [limits, caps, timeoutMs] = await Promise.all([
      readConfig(pool, "ingest.limits", ingestLimitsSchema),
      readConfig(pool, "ai.payload_caps", capsSchema.loose()),
      readConfig(pool, "chat.query_timeout_ms", z.number().int().positive()),
    ]);
    return ok({
      limits,
      caps: {
        sampleRowsPerSheet: caps.sample_rows_per_sheet,
        distinctValuesPerColumn: caps.distinct_values_per_column,
      },
      chat: {
        rowsPerRound: caps.chat_rows_per_round,
        bytesPerRound: caps.chat_bytes_per_round,
        queryTimeoutMs: timeoutMs,
      },
    });
  });
}
