import { NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import { isMergeEmail, prepareMergeRecipients, renderMergeMail, validateMergeTemplate, type MergeSourceRow, type MergeTemplate, type SmtpAccount } from "@/lib/mail-merge";
import { decryptSmtpPassword, encryptSmtpPassword, sendMergeSmtp, validateSmtpAccount, verifyMergeSmtp } from "@/lib/server/mail-merge-smtp";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_COLUMNS = "id,name,template,smtp_public,status,created_at";
type StoredCampaign = { id: string; owner_email: string; template: MergeTemplate; smtp_public: Omit<SmtpAccount, "password">; smtp_secret: string; status: string };

function databaseError(error: { code?: string; message?: string }) {
  if (["42P01", "PGRST205", "PGRST202"].includes(error.code ?? "")) return "Chạy supabase/mail-merge.sql để khởi tạo tool gửi thư.";
  if (error.message?.includes("LOCKED_CAMPAIGN")) return "Chiến dịch đã bắt đầu. Tạo chiến dịch mới để đổi nội dung / danh sách.";
  if (error.message?.includes("UNCERTAIN_DELIVERY")) return "Có thư chưa rõ kết quả. Kiểm tra và xử lý các dòng này trước khi tiếp tục.";
  if (error.message?.includes("EMPTY_QUEUE")) return "Không còn thư đang chờ gửi.";
  if (error.message?.includes("NOT_FOUND")) return "Không tìm thấy chiến dịch.";
  return "Không lưu được dữ liệu gửi thư. Vui lòng thử lại.";
}

async function loadCampaign(service: SupabaseClient, id: string, owner: string) {
  const { data, error } = await service.from("mail_merge_campaigns").select("*").eq("id", id).eq("owner_email", owner).maybeSingle();
  if (error) throw new Error(databaseError(error));
  if (!data) throw new Error("Không tìm thấy chiến dịch.");
  return data as StoredCampaign;
}

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request, true);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const id = new URL(request.url).searchParams.get("id");
  if (id && !UUID.test(id)) return NextResponse.json({ ok: false, error: "Mã chiến dịch không hợp lệ." }, { status: 400 });
  const query = auth.service.from("mail_merge_campaigns").select(PUBLIC_COLUMNS).eq("owner_email", auth.email);
  if (!id) {
    const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
    return error ? NextResponse.json({ ok: false, error: databaseError(error) }, { status: 503 }) : NextResponse.json({ ok: true, campaigns: data ?? [] });
  }
  const { data: campaign, error } = await query.eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: databaseError(error) }, { status: 503 });
  if (!campaign) return NextResponse.json({ ok: false, error: "Không tìm thấy chiến dịch." }, { status: 404 });
  const refreshed = await auth.service.rpc("control_mail_merge", { p_id: id, p_owner: auth.email, p_action: "refresh" });
  if (refreshed.error) return NextResponse.json({ ok: false, error: databaseError(refreshed.error) }, { status: 503 });
  const recipients = [];
  for (let start = 0; start < 5000; start += 500) {
    const result = await auth.service.from("mail_merge_recipients").select("id,source_row,email,fields,status,last_error,sent_at").eq("campaign_id", id).order("source_row").range(start, start + 499);
    if (result.error) return NextResponse.json({ ok: false, error: databaseError(result.error) }, { status: 503 });
    recipients.push(...(result.data ?? []).map(({ source_row, ...row }) => ({ ...row, sourceRow: source_row })));
    if ((result.data?.length ?? 0) < 500) break;
  }
  return NextResponse.json({ ok: true, campaign: { ...campaign, status: refreshed.data, hasPassword: true, recipients } });
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request, true);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > 3_500_000) return NextResponse.json({ ok: false, error: "Danh sách quá lớn. Chia thành các chiến dịch nhỏ hơn." }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false, error: "Dữ liệu không hợp lệ." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") return NextResponse.json({ ok: false, error: "Dữ liệu không hợp lệ." }, { status: 400 });
  const action = body.action;
  if (!["save", "account", "verify", "test", "start", "pause", "process", "retry_failed", "resolve_sent", "resolve_retry"].includes(action)) return NextResponse.json({ ok: false, error: "Thao tác không hợp lệ." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if ((id && !UUID.test(id)) || (!["verify", "test"].includes(action) && !id)) return NextResponse.json({ ok: false, error: "Mã chiến dịch không hợp lệ." }, { status: 400 });
  try {
    if (["save", "account", "verify", "test"].includes(action)) {
      const account = validateSmtpAccount(body.smtp);
      let stored: StoredCampaign | null = null;
      if (id) {
        const result = await auth.service.from("mail_merge_campaigns").select("*").eq("id", id).eq("owner_email", auth.email).maybeSingle();
        if (result.error) throw new Error(databaseError(result.error));
        stored = result.data as StoredCampaign | null;
      }
      if (!account.password && stored?.smtp_secret) account.password = decryptSmtpPassword(stored.smtp_secret, auth.email);
      if (!account.password) throw new Error("Nhập mật khẩu SMTP hoặc mật khẩu ứng dụng.");
      if (action === "verify") {
        try { await verifyMergeSmtp(account); } catch { throw new Error("Kết nối SMTP chưa thành công. Kiểm tra máy chủ, cổng, TLS và mật khẩu ứng dụng."); }
        return NextResponse.json({ ok: true });
      }
      if (action === "test" || action === "save") {
        const issue = validateMergeTemplate(body.template);
        if (issue) throw new Error(issue);
      }
      if (action === "test") {
        if (typeof body.to !== "string" || !isMergeEmail(body.to)) throw new Error("Nhập một địa chỉ email nhận thư thử.");
        const template = body.template as MergeTemplate;
        const fields = prepareMergeRecipients(template, [body.row as MergeSourceRow])[0].fields;
        const message = renderMergeMail(template, fields);
        const result = await sendMergeSmtp(account, { ...message, subject: `[Gửi thử] ${message.subject}`, to: body.to });
        if (result.status !== "sent") throw new Error(result.error);
        return NextResponse.json({ ok: true });
      }
      const { password, ...smtpPublic } = account;
      const smtpSecret = encryptSmtpPassword(password, auth.email);
      if (action === "account") {
        if (!stored) throw new Error("Không tìm thấy chiến dịch.");
        const result = await auth.service.from("mail_merge_campaigns").update({ smtp_public: smtpPublic, smtp_secret: smtpSecret, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_email", auth.email).neq("status", "running").select("id").maybeSingle();
        if (result.error || !result.data) throw new Error("Tạm dừng chiến dịch trước khi đổi SMTP.");
        return NextResponse.json({ ok: true });
      }
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 160) throw new Error("Nhập tên chiến dịch, tối đa 160 ký tự.");
      const recipients = prepareMergeRecipients(body.template as MergeTemplate, body.rows as MergeSourceRow[]);
      if (!recipients.some((row) => row.status === "pending")) throw new Error("Không có dòng hợp lệ để gửi.");
      const result = await auth.service.rpc("save_mail_merge", { p_id: id, p_owner: auth.email, p_name: body.name.trim(), p_template: body.template, p_smtp: smtpPublic, p_secret: smtpSecret, p_rows: recipients });
      if (result.error) throw new Error(databaseError(result.error));
      return NextResponse.json({ ok: true, id: result.data });
    }
    if (action !== "process") {
      if (action.startsWith("resolve_") && (typeof body.recipientId !== "string" || !UUID.test(body.recipientId))) throw new Error("Chọn dòng cần xử lý.");
      const result = await auth.service.rpc("control_mail_merge", { p_id: id, p_owner: auth.email, p_action: action, p_recipient: body.recipientId ?? null });
      if (result.error) throw new Error(databaseError(result.error));
      return NextResponse.json({ ok: true, status: result.data });
    }
    const campaign = await loadCampaign(auth.service, id, auth.email);
    if (campaign.status !== "running") return NextResponse.json({ ok: true, processed: false });
    const { data: claim, error: claimError } = await auth.service.rpc("claim_mail_merge", { p_id: id, p_owner: auth.email });
    if (claimError) throw new Error(databaseError(claimError));
    if (!claim) return NextResponse.json({ ok: true, processed: false });
    const job = claim.recipient;
    let result: { status: "sent" | "failed" | "uncertain"; messageId?: string; error?: string };
    let prepared: { account: SmtpAccount; mail: ReturnType<typeof renderMergeMail> } | undefined;
    try {
      const account = validateSmtpAccount({ ...claim.smtp_public, password: decryptSmtpPassword(claim.smtp_secret, auth.email) });
      prepared = { account, mail: renderMergeMail(claim.template, job.fields) };
    } catch { /* No SMTP request has been made. */ }
    if (!prepared) result = { status: "failed", error: "Không mở được cấu hình SMTP hoặc nội dung thư. Kiểm tra cấu hình trước khi thử lại." };
    else {
      try { result = await sendMergeSmtp(prepared.account, { ...prepared.mail, to: job.email }); }
      catch { result = { status: "uncertain", error: "Chưa xác nhận kết quả SMTP. Kiểm tra hộp thư trước khi gửi lại." }; }
    }
    const finish = await auth.service.rpc("finish_mail_merge", { p_id: job.id, p_owner: auth.email, p_attempt: job.attempt_id, p_status: result.status, p_message: result.messageId ?? null, p_error: result.error ?? null });
    if (finish.error || !finish.data) return NextResponse.json({ ok: false, error: "Chưa lưu được kết quả gửi. Dừng tại đây và kiểm tra trạng thái trước khi tiếp tục." }, { status: 503 });
    return NextResponse.json({ ok: true, processed: true, recipientId: job.id, status: result.status, error: result.error });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không thực hiện được thao tác gửi thư." }, { status: 400 });
  }
}
