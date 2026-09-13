import "server-only";

import {
  loadPublicEnv,
  loadServerEnv,
  type PublicEnv,
  type ServerEnv,
} from "@magicmis/core/config";

/**
 * Validated once per server process. SPEC §4: invalid config refuses to start -- the first
 * call throws, and it happens on the first request (and at build, where routes import it).
 */
let server: ServerEnv | undefined;
let publicEnv: PublicEnv | undefined;

export function serverEnv(): ServerEnv {
  server ??= loadServerEnv(process.env);
  return server;
}

export function appPublicEnv(): PublicEnv {
  publicEnv ??= loadPublicEnv(process.env);
  return publicEnv;
}
