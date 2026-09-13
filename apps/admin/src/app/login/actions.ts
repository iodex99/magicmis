"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/server/identity";
import {
  adminEnv,
  allowlist,
  db,
  ipAllowlist,
  keyWrapper,
  requestMeta,
} from "@/server/runtime";
import { sessionCookieName, sessionToken } from "@/server/session";

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export async function signInAction(form: FormData): Promise<void> {
  const { ip, userAgent } = await requestMeta();
  const result = await signIn(db(), keyWrapper(), {
    email: text(form, "email"),
    password: text(form, "password"),
    code: text(form, "code").trim(),
    allowlist: allowlist(),
    ipAllowlist: ipAllowlist(),
    ip,
    userAgent,
  });
  if (!result.ok) {
    redirect(
      `/login?error=${result.reason === "locked_out" ? "locked" : result.reason === "ip_not_allowed" ? "ip" : "invalid"}`,
    );
  }
  (await cookies()).set(sessionCookieName(), result.token, {
    httpOnly: true,
    secure: adminEnv().APP_ENVIRONMENT !== "development",
    sameSite: "strict",
    path: "/",
    expires: result.expiresAt,
  });
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const token = await sessionToken();
  if (token !== "") await signOut(db(), token);
  (await cookies()).delete(sessionCookieName());
  redirect("/login");
}
