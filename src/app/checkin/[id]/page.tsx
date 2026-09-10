"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { QrCode, User, Clock, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { QRCodeView } from "@/components/ui/QRCodeView";
import type { PaymentStatus, QRBranding } from "@/lib/surveys";

interface CheckinData {
  id: string;
  survey_title: string;
  submitted_at: string;
  answers: Record<string, string | number | number[]>;
  qrStyle?: QRBranding | null;
  paymentStatus?: PaymentStatus | null;
}

export default function CheckinPage({ params }: { params: Promise<{ id: string }> }) {
  const [data, setData] = useState<CheckinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [resolvedId, setResolvedId] = useState("");

  useEffect(() => {
    params.then(({ id }) => {
      setResolvedId(id);
      (async () => {
        const { data: resp } = await supabase
          .from("survey_responses")
          .select("id, submitted_at, answers, survey_id, payment_status")
          .eq("id", id)
          .single();
        if (!resp) { setNotFound(true); setLoading(false); return; }

        const { data: survey } = await supabase
          .from("surveys")
          .select("title, checkin_theme")
          .eq("id", resp.survey_id)
          .single();

        setData({
          id: resp.id,
          survey_title: survey?.title ?? "Khảo sát",
          submitted_at: resp.submitted_at,
          answers: resp.answers,
          qrStyle: ((survey as { checkin_theme?: { qr?: QRBranding } } | null)?.checkin_theme?.qr) ?? null,
          paymentStatus: resp.payment_status as PaymentStatus | null,
        });
        setLoading(false);
      })();
    });
  }, [params]);

  if (loading) {
    return <div className="min-h-dvh bg-slate-50 flex items-center justify-center"><div className="animate-pulse w-48 h-48 bg-white rounded-2xl" /></div>;
  }

  if (notFound || !data) {
    return (
      <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-4">❌</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">Mã check-in không hợp lệ</h1>
        <p className="text-slate-600 text-sm">Không tìm thấy phản hồi với mã này.</p>
      </div>
    );
  }

  const time = new Date(data.submitted_at).toLocaleString("vi-VN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const waitingPayment = data.paymentStatus && data.paymentStatus !== "paid" && data.paymentStatus !== "not_required";

  if (waitingPayment) {
    return (
      <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-4">💳</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">Đăng ký chưa hoàn tất thanh toán</h1>
        <p className="max-w-sm text-slate-600 text-sm">
          QR check-in sẽ được mở sau khi PayOS xác nhận thanh toán thành công. Vui lòng kiểm tra lại email hoặc trang thanh toán.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-white flex flex-col items-center justify-center px-4 py-8">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-lg border border-slate-100 p-6 sm:p-8 w-full max-w-sm text-center"
      >
        {/* QR icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.2 }}
          className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center mx-auto mb-4"
        >
          <QrCode size={32} className="text-sky-600" />
        </motion.div>

        <h1 className="text-xl font-bold text-slate-800 mb-1">Mã check-in của bạn</h1>
        <p className="text-sm text-slate-600 mb-5">Xuất trình mã QR bên dưới cho ban tổ chức để check-in</p>

        {/* Info */}
        <div className="flex flex-col gap-2 mb-5 text-left">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50">
            <FileText size={14} className="text-slate-500 flex-shrink-0" />
            <span className="text-xs text-slate-700 flex-1">{data.survey_title}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50">
            <Clock size={14} className="text-slate-500 flex-shrink-0" />
            <span className="text-xs text-slate-700 flex-1">{time}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50">
            <User size={14} className="text-slate-500 flex-shrink-0" />
            <span className="text-xs text-slate-700 flex-1 font-mono">{data.id.slice(0, 8).toUpperCase()}</span>
          </div>
        </div>

        {/* QR for verification */}
        {pageUrl && (
          <div className="flex flex-col items-center gap-2">
            <div className="bg-white rounded-2xl p-3 border border-slate-100">
              <QRCodeView value={pageUrl} size={160} qrStyle={data.qrStyle} />
            </div>
            <p className="text-[11px] text-slate-500">Đưa mã này cho ban tổ chức quét</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
