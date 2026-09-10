"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildPublicUrl } from "@/lib/site-url";
import { QRCodeView } from "@/components/ui/QRCodeView";
import type { QRBranding, SurveyResponse } from "@/lib/surveys";

type PaymentRow = Pick<SurveyResponse, "id" | "survey_id" | "payment_status" | "payment_checkout_url" | "submitted_at"> & {
  surveys?: { title?: string; checkin_theme?: { qr?: QRBranding } | null } | null;
};

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<PaymentShell title="Đang mở kết quả thanh toán..." />}>
      <PaymentSuccessContent />
    </Suspense>
  );
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const responseId = searchParams.get("responseId") ?? "";
  const [row, setRow] = useState<PaymentRow | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!responseId) return;
    setLoading(true);
    const { data } = await supabase
      .from("survey_responses")
      .select("id, survey_id, payment_status, payment_checkout_url, submitted_at, surveys(title, checkin_theme)")
      .eq("id", responseId)
      .single();
    setRow((data as PaymentRow | null) ?? null);
    setLoading(false);
  }, [responseId]);

  useEffect(() => {
    if (!responseId) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    const interval = setInterval(() => { void load(); }, 4000);
    return () => {
      window.clearTimeout(timer);
      clearInterval(interval);
    };
  }, [load, responseId]);

  const paid = row?.payment_status === "paid";
  const checkinUrl = row?.id ? buildPublicUrl(`/checkin/${row.id}`) : "";
  const qrStyle = row?.surveys?.checkin_theme?.qr ?? null;

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${paid ? "bg-emerald-50 text-emerald-600" : "bg-cyan-50 text-cyan-700"}`}>
            {paid ? <CheckCircle2 size={32} /> : <Clock size={32} />}
          </div>

          <h1 className="text-xl font-bold text-slate-900">
            {paid ? "Thanh toán thành công" : "Đang xác nhận thanh toán"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {paid
              ? "Đăng ký của bạn đã được xác nhận. Vui lòng lưu QR bên dưới để check-in tại sự kiện."
              : "PayOS thường gửi xác nhận trong vài giây. Nếu bạn đã thanh toán, vui lòng chờ hoặc bấm kiểm tra lại."}
          </p>

          {loading && (
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
              <RefreshCw size={16} className="animate-spin" /> Đang kiểm tra...
            </div>
          )}

          {paid && checkinUrl && (
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                <QRCodeView value={checkinUrl} size={178} qrStyle={qrStyle} />
              </div>
              <a href={checkinUrl} className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                Mở trang QR <ExternalLink size={14} />
              </a>
            </div>
          )}

          {!paid && row?.payment_checkout_url && (
            <a
              href={row.payment_checkout_url}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-semibold text-on-brand hover:bg-cyan-800"
            >
              <CreditCard size={16} /> Mở lại trang thanh toán
            </a>
          )}

          {!paid && (
            <button
              type="button"
              onClick={load}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={16} /> Kiểm tra lại
            </button>
          )}

          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
            {row?.surveys?.title || "Form đăng ký"}
          </div>

          {!responseId && (
            <Link href="/" className="mt-5 inline-flex text-sm font-semibold text-slate-700 hover:text-slate-900">
              Về trang chính
            </Link>
          )}
        </section>
      </div>
    </main>
  );
}

function PaymentShell({ title }: { title: string }) {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-5 h-16 w-16 animate-pulse rounded-2xl bg-slate-100" />
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        </section>
      </div>
    </main>
  );
}
