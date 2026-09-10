"use client";
import { useEffect, useState } from "react";
import { VIPFaceCheckin } from "@/components/ekyc/VIPFaceCheckin";
import { PinGate } from "@/components/ui/PinGate";
import { supabase } from "@/lib/supabase";
import { logCheckinEvent } from "@/lib/checkinLogs";

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
  const handleManualConfirm = async (responseId: string) => {
    if (session) {
      await supabase.rpc("checkin_session", { resp_id: responseId, session_name: session });
      await logCheckinEvent({ surveyId, responseId, action: "session_checkin", method: "face", hall, sessionName: session });
    } else {
      await supabase
        .from("survey_responses")
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .eq("id", responseId);
      await logCheckinEvent({ surveyId, responseId, action: "checkin", method: "face", hall });
    }
  };

  return <VIPFaceCheckin surveyId={surveyId} hall={hall} session={session} onManualConfirm={handleManualConfirm} />;
}
