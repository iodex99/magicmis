/**
 * The identity provider the browser suite signs in through (ADR 0082).
 *
 * Google and Apple cannot be driven from a test, and the identity service fixes both their
 * endpoints, so neither can be pointed at a stand-in. Its Keycloak provider can: it reads a base
 * URL, sends the browser to `<url>/protocol/openid-connect/auth`, and then itself calls
 * `/token` and `/userinfo` (https://github.com/supabase/auth, internal/api/provider/keycloak.go).
 * That is everything a provider does in a sign-in, and `supabase/config.toml` points it here.
 *
 * Only the two server-to-server calls need a server, and they come from the identity service's
 * container, so this runs as a container on the stack's own network, reached by name — the same
 * on Docker Desktop and on the Linux runner in CI. The step a person sees at the provider is
 * played by the test's browser (`signInThroughProvider` in `helpers.ts`), which decides who is
 * signing in. The person is carried in the code itself, so the stand-in keeps no state: the
 * code is the access token, and the access token is the identity.
 */

import { execFileSync } from "node:child_process";

export const IDENTITY_HOST = "magicmis-e2e-identity";
const NETWORK = "supabase_network_magicmis";
const IMAGE = "node:22-alpine";

/** Who is signing in, as the stand-in will vouch for them. */
export interface ProviderIdentity {
  readonly email: string;
  /** The provider's own id for this person; stable per address unless a test says otherwise. */
  readonly sub?: string;
}

export function identityCode(identity: ProviderIdentity): string {
  const sub = identity.sub ?? `e2e-${identity.email}`;
  return Buffer.from(JSON.stringify({ email: identity.email, sub })).toString(
    "base64url",
  );
}

// Plain Node with no dependencies, run with `node -e` so nothing has to be mounted.
const SERVER = String.raw`
const http = require("node:http");
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
http
  .createServer((req, res) => {
    const path = new URL(req.url, "http://stand-in").pathname;
    if (req.method === "POST" && path === "/protocol/openid-connect/token") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const code = new URLSearchParams(raw).get("code");
        if (!code) return send(res, 400, { error: "invalid_grant" });
        send(res, 200, { access_token: code, token_type: "Bearer", expires_in: 300 });
      });
      return;
    }
    if (req.method === "GET" && path === "/protocol/openid-connect/userinfo") {
      try {
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        const who = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
        return send(res, 200, { sub: who.sub, email: who.email, email_verified: true });
      } catch {
        return send(res, 401, { error: "invalid_token" });
      }
    }
    send(res, 404, { error: "not_found" });
  })
  .listen(8080, () => console.log("identity provider ready"));
`;

function docker(args: readonly string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" });
}

/** Start the stand-in on the stack's network, replacing one a previous run left behind. */
export async function startIdentityProvider(): Promise<() => void> {
  try {
    docker(["rm", "-f", IDENTITY_HOST]);
  } catch {
    // None running.
  }
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    IDENTITY_HOST,
    "--network",
    NETWORK,
    IMAGE,
    "node",
    "-e",
    SERVER,
  ]);
  const deadline = Date.now() + 60_000;
  while (!docker(["logs", IDENTITY_HOST]).includes("identity provider ready")) {
    if (Date.now() > deadline) throw new Error("The identity provider did not start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return () => {
    try {
      docker(["rm", "-f", IDENTITY_HOST]);
    } catch {
      // Already gone.
    }
  };
}
