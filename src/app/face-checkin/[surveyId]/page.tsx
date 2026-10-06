"use client";
import { useEffect, useState } from "react";
import { VIPFaceCheckin } from "@/components/ekyc/VIPFaceCheckin";
import { PinGate } from "@/components/ui/PinGate";
import { supabase } from "@/lib/supabase";
import { logCheckinEvent } from "@/lib/checkinLogs";
import { recordSessionCheckin } from "@/lib/session-checkin-client";
import { normalizeSessionConfig } from "@/lib/checkin-sessions";

function getInitialFaceCheckinQuery() {
  if (typeof window === "undefined") return { hall: "", session: "" };
  const url = new URL(window.location.href);
  return {
    hall: url.searchParams.get("hall") ?? "",
    session: url.searchParams.get("session") ?? "",
  };
}

export default function FaceCheckinPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const initialQuery = getInitialFaceCheckinQuery();
  const [sid, setSid] = useState("");
  const [hall] = useState(initialQuery.hall);
  const [session] = useState(initialQuery.session);

  useEffect(() => {
    params.then(({ surveyId }) => setSid(surveyId));
  }, [params]);

  if (!sid) return <div className="min-h-dvh bg-sky-50" />;

  return (
    <PinGate surveyId={sid}>
      <VIPFaceCheckinInner surveyId={sid} hall={hall} session={session} />
    </PinGate>
  );
}

function VIPFaceCheckinInner({ surveyId, hall, session }: { surveyId: string; hall: string; session: string }) {
  const [display, setDisplay] = useState({ name: session, hall });
  useEffect(() => {
    let active = true;
    void supabase.from("surveys").select("checkin_theme").eq("id", surveyId).single().then(({ data }) => {
      const configured = normalizeSessionConfig(data?.checkin_theme?.sessionConfig)?.sessions.find((item) => item.id === session);
      if (active && configured) setDisplay({ name: configured.name, hall: configured.hall });
    });
    return () => { active = false; };
  }, [surveyId, session]);
  const handleManualConfirm = async (responseId: string) => {
    if (session) {
      const result = await recordSessionCheckin(surveyId, responseId, session, "checkin", "face");
      if (!result.ok) throw new Error(result.error ?? "Chưa ghi nhận được check-in.");
      if (result.code === "already") throw new Error("Người này đã check-in buổi này. Không ghi nhận thêm.");
    } else {
      const { data: form, error } = await supabase.from("surveys").select("checkin_theme").eq("id", surveyId).single();
      if (error) throw new Error("Không tải được cấu hình check-in.");
      if (normalizeSessionConfig(form?.checkin_theme?.sessionConfig)) throw new Error("Mở link VIP Face của từng buổi từ Danh sách khách.");
      await supabase
        .from("survey_responses")
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .eq("id", responseId);
      await logCheckinEvent({ surveyId, responseId, action: "checkin", method: "face", hall });
    }
  };

  return <VIPFaceCheckin surveyId={surveyId} hall={display.hall} session={display.name} onManualConfirm={handleManualConfirm} />;
}
