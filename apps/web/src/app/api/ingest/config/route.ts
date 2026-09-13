import { readConfig } from "@magicmis/db/config";
import { ingestLimitsSchema } from "@magicmis/ingest";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, withAccount } from "@/lib/http";

const capsSchema = z.object({
  sample_rows_per_sheet: z.number().int().positive(),
  distinct_values_per_column: z.number().int().positive(),
});

/** GET /api/ingest/config — file limits (SPEC §15) and payload caps (SPEC §14) for the browser. */
export async function GET(): Promise<Response> {
  return withAccount(async () => {
    const pool = db();
    const [limits, caps] = await Promise.all([
      readConfig(pool, "ingest.limits", ingestLimitsSchema),
      readConfig(pool, "ai.payload_caps", capsSchema.loose()),
    ]);
    return ok({
      limits,
      caps: {
        sampleRowsPerSheet: caps.sample_rows_per_sheet,
        distinctValuesPerColumn: caps.distinct_values_per_column,
      },
    });
  });
}
