import { redirect } from "next/navigation";

/** The dashboard, commentary and chat are one workspace now (ADR 0033); old links land there. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/companies/${encodeURIComponent(id)}`);
}
