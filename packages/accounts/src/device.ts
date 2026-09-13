/**
 * Device fingerprinting for new-device alerts (SPEC §8).
 *
 * A keyed hash of the normalised user agent. Keyed by account id so the same browser
 * hashes differently for two accounts: the stored value cannot be used to link accounts
 * or to recognise a person across tenants.
 *
 * Deliberately coarse. IP address is excluded because Indian mobile and broadband IPs
 * rotate constantly and would make every login look new, and an alert that fires on
 * every login gets ignored. Browser version digits are dropped for the same reason: an
 * automatic browser update is not a new device.
 */

import { createHmac } from "node:crypto";

export function normaliseUserAgent(userAgent: string): string {
  return userAgent
    .toLowerCase()
    .replace(/\d+(\.\d+)+/gu, "") // version numbers
    .replace(/\s+/gu, " ")
    .trim();
}

export function deviceFingerprintHash(accountId: string, userAgent: string): string {
  return createHmac("sha256", accountId)
    .update(normaliseUserAgent(userAgent))
    .digest("hex");
}

/** A short human label for login history ("Chrome on Windows"). Never used for decisions. */
export function describeUserAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox/")
      ? "Firefox"
      : ua.includes("chrome/")
        ? "Chrome"
        : ua.includes("safari/")
          ? "Safari"
          : "Unknown browser";
  const os = ua.includes("windows")
    ? "Windows"
    : ua.includes("mac os x") || ua.includes("macintosh")
      ? "macOS"
      : ua.includes("linux")
        ? "Linux"
        : "Unknown OS";
  return `${browser} on ${os}`;
}
