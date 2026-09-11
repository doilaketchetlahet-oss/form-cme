import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDbClient } from "@/lib/server/db";

export const runtime = "nodejs";

const CREATE_SQL = `
create extension if not exists pgcrypto;
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  owner_email text,
  name text not null,
  subject text,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_email_templates_updated on email_templates (updated_at desc);
`;

type TemplateRow = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  updated_at: string | null;
};

let tableEnsured = false;

async function authorize(request: Request): Promise<{ email: string } | { error: NextResponse }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 }) };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: "Bạn cần đăng nhập." }, { status: 401 }) };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return { error: NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 }) };
  }

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: NextResponse.json({ ok: false, error: "Bạn không có quyền quản lý template." }, { status: 403 }) };
  }

  return { email };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const client = createDbClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_DB_URL để dùng thư viện template." }, { status: 400 });
  }

  try {
    await client.connect();
    if (!tableEnsured) {
      await client.query(CREATE_SQL);
      tableEnsured = true;
    }
    const result = await client.query<TemplateRow>(
      "select id, name, subject, body, updated_at::text as updated_at from email_templates order by updated_at desc nulls last limit 200",
    );
    return NextResponse.json({ ok: true, templates: result.rows });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không tải được template." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const payload = await request.json().catch(() => null) as {
    id?: string;
    name?: string;
    subject?: string | null;
    body?: string;
  } | null;

  const name = payload?.name?.trim();
  const body = payload?.body?.trim();
  const subject = payload?.subject?.trim() || null;
  if (!name || !body) {
    return NextResponse.json({ ok: false, error: "Cần tên template và nội dung." }, { status: 400 });
  }

  const client = createDbClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_DB_URL để lưu template." }, { status: 400 });
  }

  try {
    await client.connect();
    if (!tableEnsured) {
      await client.query(CREATE_SQL);
      tableEnsured = true;
    }

    if (payload?.id) {
      const result = await client.query<{ id: string }>(
        "update email_templates set name = $1, subject = $2, body = $3, updated_at = now() where id = $4 returning id",
        [name, subject, body, payload.id],
      );
      if (result.rowCount === 0) {
        return NextResponse.json({ ok: false, error: "Không tìm thấy template." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id: result.rows[0].id });
    }

    const result = await client.query<{ id: string }>(
      "insert into email_templates (owner_email, name, subject, body) values ($1, $2, $3, $4) returning id",
      [auth.email, name, subject, body],
    );
    return NextResponse.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không lưu được template." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Thiếu id template." }, { status: 400 });
  }

  const client = createDbClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_DB_URL để xóa template." }, { status: 400 });
  }

  try {
    await client.connect();
    if (!tableEnsured) {
      await client.query(CREATE_SQL);
      tableEnsured = true;
    }
    await client.query("delete from email_templates where id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không xóa được template." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
