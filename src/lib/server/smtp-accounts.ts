import type { SmtpAccount } from "@/lib/mail-merge";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSmtpPassword, encryptSmtpPassword, validateSmtpAccount } from "./mail-merge-smtp";

/** Phần công khai của tài khoản SMTP — không bao giờ chứa mật khẩu. */
export type SmtpAccountPublic = {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  updatedAt: string;
};

type Row = {
  id: string;
  owner_email: string;
  name: string;
  config: Omit<SmtpAccount, "password">;
  secret: string;
  updated_at: string;
};

/** Mật khẩu do người dùng nhập; rỗng nghĩa là giữ mật khẩu đã lưu. */
export type SmtpAccountInput = Omit<SmtpAccount, "password"> & {
  name: string;
  password?: string;
};

export function toPublic(row: Row): SmtpAccountPublic {
  return {
    id: row.id,
    name: row.name,
    host: row.config.host,
    port: row.config.port,
    secure: row.config.secure,
    user: row.config.user,
    fromEmail: row.config.fromEmail,
    fromName: row.config.fromName,
    replyTo: row.config.replyTo,
    updatedAt: row.updated_at,
  };
}

export async function listSmtpAccounts(
  admin: SupabaseClient,
  ownerEmail: string,
): Promise<SmtpAccountPublic[]> {
  const { data } = await admin
    .from("smtp_accounts")
    .select("id, owner_email, name, config, secret, updated_at")
    .eq("owner_email", ownerEmail)
    .order("updated_at", { ascending: false });
  return ((data ?? []) as Row[]).map(toPublic);
}

/** Tạo mới hoặc cập nhật (giữ mật khẩu cũ nếu không nhập lại). */
export async function saveSmtpAccount(
  admin: SupabaseClient,
  ownerEmail: string,
  id: string | null,
  input: unknown,
): Promise<SmtpAccountPublic> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
  if (!name) throw new Error("Nhập tên gợi nhớ cho tài khoản (ví dụ: M365 - Bệnh viện X).");

  let password = typeof raw.password === "string" ? raw.password : "";
  if (!password && id) {
    // Giữ mật khẩu đã lưu.
    const existing = await getSmtpAccountRow(admin, ownerEmail, id);
    if (!existing) throw new Error("Không tìm thấy tài khoản SMTP.");
    password = decryptSmtpPassword(existing.secret, ownerEmail);
  }

  const account = validateSmtpAccount({ ...raw, password, name });
  const config: Omit<SmtpAccount, "password"> = {
    host: account.host,
    port: account.port,
    secure: account.secure,
    user: account.user,
    fromEmail: account.fromEmail,
    fromName: account.fromName,
    replyTo: account.replyTo,
  };
  const secret = encryptSmtpPassword(password, ownerEmail);
  const now = new Date().toISOString();

  if (id) {
    const { data, error } = await admin
      .from("smtp_accounts")
      .update({ name, config, secret, updated_at: now })
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .select("id, owner_email, name, config, secret, updated_at")
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "Không lưu được tài khoản SMTP.");
    return toPublic(data as Row);
  }

  const { data, error } = await admin
    .from("smtp_accounts")
    .insert({ owner_email: ownerEmail, name, config, secret, updated_at: now })
    .select("id, owner_email, name, config, secret, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Không lưu được tài khoản SMTP.");
  return toPublic(data as Row);
}

export async function getSmtpAccountRow(
  admin: SupabaseClient,
  ownerEmail: string,
  id: string,
): Promise<Row | null> {
  const { data } = await admin
    .from("smtp_accounts")
    .select("id, owner_email, name, config, secret, updated_at")
    .eq("id", id)
    .eq("owner_email", ownerEmail)
    .maybeSingle();
  return (data as Row) ?? null;
}

/** Trả tài khoản kèm mật khẩu đã giải mã để server dùng khi gửi. */
export async function loadSmtpAccountForSend(
  admin: SupabaseClient,
  ownerEmail: string,
  id: string,
): Promise<SmtpAccount | null> {
  const row = await getSmtpAccountRow(admin, ownerEmail, id);
  if (!row) return null;
  return { ...row.config, password: decryptSmtpPassword(row.secret, ownerEmail) };
}

/**
 * Dùng khi server gửi thay cho form: chỉ có id, không biết chủ tài khoản.
 * Mật khẩu được giải mã bằng owner lưu trên chính hàng đó (AAD gắn với owner).
 */
export async function loadSmtpAccountById(
  admin: SupabaseClient,
  id: string,
): Promise<SmtpAccount | null> {
  const { data } = await admin
    .from("smtp_accounts")
    .select("owner_email, config, secret")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { owner_email: string; config: Omit<SmtpAccount, "password">; secret: string };
  return { ...row.config, password: decryptSmtpPassword(row.secret, row.owner_email) };
}

/**
 * Tìm chủ sở hữu của form để giới hạn tài khoản SMTP theo đúng người tạo.
 * Form có thể chưa có owner (dữ liệu cũ) — khi đó trả null.
 */
export async function ownerOfSurvey(admin: SupabaseClient, surveyId: string): Promise<string | null> {
  const { data } = await admin
    .from("surveys")
    .select("quiz_id")
    .eq("id", surveyId)
    .maybeSingle();
  const quizId = (data as { quiz_id?: string } | null)?.quiz_id;
  if (!quizId) return null;
  const { data: quiz } = await admin
    .from("quizzes")
    .select("owner_id")
    .eq("id", quizId)
    .maybeSingle();
  const ownerId = (quiz as { owner_id?: string } | null)?.owner_id;
  if (!ownerId) return null;
  // quizzes.owner_id là auth user id; lấy email từ bảng auth qua service role.
  const { data: authUser } = await admin.auth.admin.getUserById(ownerId);
  return authUser?.user?.email?.trim().toLowerCase() ?? null;
}
