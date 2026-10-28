"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Trash2, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/lib/ui/confirm";

type Font = {
  id: string;
  family: string;
  weight: "regular" | "bold";
  fileName: string;
  sizeBytes: number;
  hasVietnamese: boolean;
  createdAt: string;
};

export function CustomFontsManager() {
  const confirm = useConfirm();
  const [fonts, setFonts] = useState<Font[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const token = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await token();
      if (!auth) return;
      const res = await fetch("/api/admin/fonts", { headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không tải được danh sách font.");
        return;
      }
      setFonts(body.fonts as Font[]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const auth = await token();
      if (!auth) {
        toast.error("Phiên đăng nhập đã hết hạn.");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/fonts", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}` },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không tải font lên được.", { duration: 8000 });
        return;
      }
      const font = body.font as Font;
      toast.success(
        font.hasVietnamese
          ? `Đã thêm “${font.family}” (có đủ dấu tiếng Việt).`
          : `Đã thêm “${font.family}” nhưng font THIẾU dấu tiếng Việt — tên có thể hiện ô vuông.`,
        { duration: font.hasVietnamese ? 4000 : 12000 },
      );
      await load();
    } finally {
      setUploading(false);
    }
  };

  const remove = async (font: Font) => {
    const ok = await confirm({
      title: `Xoá font “${font.family}”?`,
      description: "Thiệp đang dùng font này sẽ quay về Noto Sans.",
      confirmText: "Xoá",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const auth = await token();
      const res = await fetch(`/api/admin/fonts?id=${encodeURIComponent(font.id)}`, {
        method: "DELETE",
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không xoá được font.");
        return;
      }
      toast.success("Đã xoá font.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <span className="text-[11px] font-bold tracking-wider text-sky-600 uppercase">Cài đặt</span>
        <h1 className="font-display flex items-center gap-2 text-2xl font-black text-slate-900">
          <Type size={22} className="text-sky-500" /> Font thiệp mời
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Tải font thương hiệu của khách để dùng cho tên và QR trên thiệp. Chỉ nhận <strong>TTF/OTF</strong>,
          tối đa 5MB mỗi file, 20 font mỗi tài khoản.
        </p>
      </header>

      <label className={`mb-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${uploading ? "border-sky-300 bg-sky-50" : "border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50/50"}`}>
        {uploading ? <Loader2 size={22} className="animate-spin text-sky-500" /> : <Upload size={22} className="text-sky-500" />}
        <span className="text-sm font-semibold text-slate-800">{uploading ? "Đang tải lên và kiểm tra…" : "Chọn file font (.ttf / .otf)"}</span>
        <span className="text-xs text-slate-500">Hệ thống sẽ đọc tên font và kiểm tra dấu tiếng Việt trước khi lưu.</span>
        <input
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf,application/x-font-ttf,application/x-font-opentype"
          className="hidden"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </label>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Đang tải danh sách…
        </div>
      ) : fonts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Chưa có font tải lên. Bốn font có sẵn (Noto Sans, Noto Serif, Playfair Display, Be Vietnam Pro) vẫn dùng được trong thiết kế thiệp.
        </div>
      ) : (
        <ul className="space-y-3">
          {fonts.map((font) => (
            <li key={font.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {font.family}
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {font.weight === "bold" ? "Bold" : "Regular"}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {font.fileName} · {(font.sizeBytes / 1024).toFixed(0)}KB
                </p>
                <p className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${font.hasVietnamese ? "text-emerald-600" : "text-amber-600"}`}>
                  {font.hasVietnamese ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                  {font.hasVietnamese ? "Đủ dấu tiếng Việt" : "Thiếu dấu tiếng Việt — tên có thể ra ô vuông"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(font)}
                disabled={busy}
                className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={13} className="mr-1 inline" /> Xoá
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
