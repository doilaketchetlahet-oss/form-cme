"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CreditCard, RotateCcw, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type PaymentCancelRow = {
  survey_id: string;
  payment_checkout_url: string | null;
  surveys?: { title?: string } | null;
};

export default function PaymentCancelPage() {
  return (
    <Suspense fallback={<PaymentCancelShell />}>
      <PaymentCancelContent />
    </Suspense>
  );
}

function PaymentCancelContent() {
  const searchParams = useSearchParams();
  const responseId = searchParams.get("responseId") ?? "";
  const [row, setRow] = useState<PaymentCancelRow | null>(null);

  useEffect(() => {
    if (!responseId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
      const { data } = await supabase
        .from("survey_responses")
        .select("survey_id, payment_checkout_url, surveys(title)")
        .eq("id", responseId)
        .single();
      setRow((data as PaymentCancelRow | null) ?? null);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [responseId]);

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <XCircle size={32} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Bạn đã huỷ thanh toán</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Đăng ký của bạn đang ở trạng thái chờ thanh toán. QR check-in chỉ được cấp sau khi thanh toán thành công.
          </p>

          {row?.payment_checkout_url && (
            <a
              href={row.payment_checkout_url}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-semibold text-on-brand hover:bg-cyan-800"
            >
              <CreditCard size={16} /> Thanh toán lại
            </a>
          )}

          {row?.survey_id && (
            <Link
              href={`/s/${row.survey_id}`}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw size={16} /> Quay lại form
            </Link>
          )}

          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
            {row?.surveys?.title || "Form đăng ký"}
          </div>
        </section>
      </div>
    </main>
  );
}

function PaymentCancelShell() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-5 h-16 w-16 animate-pulse rounded-2xl bg-slate-100" />
          <h1 className="text-xl font-bold text-slate-900">Đang mở trạng thái thanh toán...</h1>
        </section>
      </div>
    </main>
  );
}
