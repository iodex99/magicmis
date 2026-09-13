import "server-only";

import type { ChatProgress } from "@magicmis/chat/server";

/** Chat progress as JSON (credits as decimal strings). */
export function progressBody(p: ChatProgress) {
  return p.status === "completed" ? { ...p, capturedCredits: p.capturedCredits.toString() } : p;
}
