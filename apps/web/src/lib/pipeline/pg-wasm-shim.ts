/**
 * libpg-query 17.7.4 loads `libpg-query.wasm` relative to its own script as soon as it is imported
 * (Emscripten `locateFile`), which inside a bundled worker points at a chunk directory. This module
 * is imported first by the pipeline worker and redirects that one request to the self-hosted copy
 * under /vendor/pg (copied at build from the installed package; no CDN at runtime).
 */

const originalFetch = self.fetch.bind(self);

self.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // Bundled, the module's own directory resolves to nothing, so the request is often the bare name.
  if (url.endsWith("libpg-query.wasm") && !url.includes("/vendor/pg/"))
    return originalFetch(`${self.location.origin}/vendor/pg/libpg-query.wasm`, init);
  return originalFetch(input, init);
};

export {};
