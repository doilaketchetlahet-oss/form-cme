import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDbClient } from "@/lib/server/db";

export const runtime = "nodejs";

const AUTHORIZATION_SQL = `
create extension if not exists pgcrypto;

create table if not exists admin_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('owner', 'admin', 'viewer')),
  active boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_admin_members_email_active
  on admin_members (lower(email), active);

create or replace function current_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select am.role
  from admin_members am
  where am.active = true
    and lower(am.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function is_admin_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_admin_role() is not null;
$$;

create or replace function can_manage_forms()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_admin_role() in ('owner', 'admin');
$$;

alter table admin_members enable row level security;
alter table quizzes enable row level security;
alter table surveys enable row level security;
alter table survey_questions enable row level security;

drop policy if exists "admin members read own or owner" on admin_members;
create policy "admin members read own or owner" on admin_members
  for select to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or current_admin_role() = 'owner'
  );

drop policy if exists "owners insert admin members" on admin_members;
create policy "owners insert admin members" on admin_members
  for insert to authenticated
  with check (current_admin_role() = 'owner');

drop policy if exists "owners update admin members" on admin_members;
create policy "owners update admin members" on admin_members
  for update to authenticated
  using (current_admin_role() = 'owner')
  with check (current_admin_role() = 'owner');

drop policy if exists "owners delete admin members" on admin_members;
create policy "owners delete admin members" on admin_members
  for delete to authenticated
  using (current_admin_role() = 'owner');

drop policy if exists "owners read quizzes" on quizzes;
drop policy if exists "admin members read quizzes" on quizzes;
create policy "admin members read quizzes" on quizzes
  for select to authenticated
  using (is_admin_member());

drop policy if exists "owners insert quizzes" on quizzes;
drop policy if exists "admins insert quizzes" on quizzes;
create policy "admins insert quizzes" on quizzes
  for insert to authenticated
  with check (can_manage_forms());

drop policy if exists "owners update quizzes" on quizzes;
drop policy if exists "admins update quizzes" on quizzes;
create policy "admins update quizzes" on quizzes
  for update to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());

drop policy if exists "owners delete quizzes" on quizzes;
drop policy if exists "admins delete quizzes" on quizzes;
create policy "admins delete quizzes" on quizzes
  for delete to authenticated
  using (can_manage_forms());

drop policy if exists "owners write surveys" on surveys;
drop policy if exists "admins write surveys" on surveys;
create policy "admins write surveys" on surveys
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());

drop policy if exists "owners write survey_questions" on survey_questions;
drop policy if exists "admins write survey_questions" on survey_questions;
create policy "admins write survey_questions" on survey_questions
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());
`;

export async function POST(request: Request) {
  const client = createDbClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Thiếu SUPABASE_DB_URL trong biến môi trường Vercel." },
      { status: 400 },
    );
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { ok: false, error: "Thiếu cấu hình Supabase public URL hoặc anon key." },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập để khởi tạo phân quyền." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();

  if (userError || !email) {
    return NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 });
  }

  try {
    await client.connect();

    const tableCheck = await client.query<{ exists: boolean }>("select to_regclass('public.admin_members') is not null as exists");
    const tableExists = tableCheck.rows[0]?.exists ?? false;

    if (tableExists) {
      const ownerCheck = await client.query<{ count: string }>(
        "select count(*)::text as count from admin_members where role = 'owner' and active = true",
      );
      const ownerCount = Number(ownerCheck.rows[0]?.count ?? 0);

      const roleCheck = await client.query<{ role: string }>(
        "select role from admin_members where lower(email) = lower($1) and active = true limit 1",
        [email],
      );

      if (ownerCount > 0 && roleCheck.rows[0]?.role !== "owner") {
        return NextResponse.json({ ok: false, error: "Chỉ owner mới được cập nhật cấu hình phân quyền." }, { status: 403 });
      }
    }

    await client.query("begin");
    await client.query(AUTHORIZATION_SQL);
    await client.query(
      "insert into admin_members (email, role, active) values ($1, 'owner', true) on conflict (email) do update set role = 'owner', active = true",
      [email],
    );
    await client.query("commit");

    return NextResponse.json({ ok: true, ownerEmail: email });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không thể khởi tạo phân quyền." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
