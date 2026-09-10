import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  const client = createDbClient();
  if (!client) {
    return NextResponse.json({ ok: false, setupRequired: true, ownerCount: 0 });
  }

  try {
    await client.connect();
    const tableCheck = await client.query<{ exists: boolean }>("select to_regclass('public.admin_members') is not null as exists");
    const tableExists = tableCheck.rows[0]?.exists ?? false;

    if (!tableExists) {
      return NextResponse.json({ ok: true, setupRequired: true, ownerCount: 0 });
    }

    const ownerCheck = await client.query<{ count: string }>(
      "select count(*)::text as count from admin_members where role = 'owner' and active = true",
    );
    const ownerCount = Number(ownerCheck.rows[0]?.count ?? 0);

    return NextResponse.json({ ok: true, setupRequired: ownerCount === 0, ownerCount });
  } catch (error) {
    return NextResponse.json(
      { ok: false, setupRequired: false, ownerCount: 0, error: error instanceof Error ? error.message : "Không kiểm tra được phân quyền." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
