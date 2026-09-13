#!/usr/bin/env node
/**
 * HTTP load test for the wallet and job read endpoints (SPEC §30). Signed-in GETs at a fixed
 * concurrency; reports status counts (429s show the rate limits working) and latency percentiles.
 * The money paths under concurrency are covered by `pnpm --filter @magicmis/wallet load`.
 *
 *   LOAD_COOKIE='<Cookie header from a signed-in browser session>' \
 *     node scripts/load-http.mjs --base http://127.0.0.1:3000 --requests 500 --concurrency 20
 *
 * Refuses non-local targets unless --allow-remote is given (never point it at production).
 */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
const base = new URL(flag("base", "http://127.0.0.1:3000"));
const requests = Number.parseInt(flag("requests", "300"), 10);
const concurrency = Number.parseInt(flag("concurrency", "10"), 10);
const cookie = process.env["LOAD_COOKIE"] ?? "";
if (
  !["127.0.0.1", "localhost"].includes(base.hostname) &&
  !argv.includes("--allow-remote")
) {
  console.error(
    `load-http: refusing non-local target ${base.hostname} without --allow-remote`,
  );
  process.exit(1);
}
if (cookie === "") {
  console.error("load-http: set LOAD_COOKIE to a signed-in session's Cookie header");
  process.exit(1);
}

const PATHS = ["/api/wallet", "/api/account/profile", "/api/account/export"];

const latencies = new Map();
const statuses = new Map();
let next = 0;
const started = performance.now();

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (;;) {
      const n = next++;
      if (n >= requests) return;
      const path = PATHS[n % PATHS.length];
      const t = performance.now();
      let status = "network_error";
      try {
        const response = await fetch(new URL(path, base), { headers: { cookie } });
        await response.arrayBuffer();
        status = String(response.status);
      } catch {
        // counted as network_error
      }
      const list = latencies.get(path) ?? [];
      list.push(performance.now() - t);
      latencies.set(path, list);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
  }),
);

const seconds = (performance.now() - started) / 1000;
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const report = {
  base: base.origin,
  requests,
  concurrency,
  seconds: Math.ceil(seconds * 10) / 10,
  requestsPerSecond: Math.floor(requests / seconds),
  statuses: Object.fromEntries(statuses),
  latencyMs: Object.fromEntries(
    [...latencies].map(([path, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return [path, { p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99) }];
    }),
  ),
};
console.log(JSON.stringify(report, null, 2));
if ((statuses.get("500") ?? 0) > 0 || (statuses.get("network_error") ?? 0) > 0)
  process.exitCode = 1;
