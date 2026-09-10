import { supabase } from "./supabase";

export type CheckinLogAction = "checkin" | "undo_checkin" | "session_checkin" | "session_uncheckin";
export type CheckinLogMethod = "qr" | "face" | "manual" | "bulk";

export interface CheckinLog {
  id: string;
  survey_id: string;
  response_id: string;
  action: CheckinLogAction;
  method: CheckinLogMethod;
  hall: string | null;
  session_name: string | null;
  created_at: string;
}

export async function logCheckinEvent(input: {
  surveyId: string;
  responseId: string;
  action: CheckinLogAction;
  method: CheckinLogMethod;
  hall?: string | null;
  sessionName?: string | null;
}) {
  const { error } = await supabase.from("checkin_logs").insert({
    survey_id: input.surveyId,
    response_id: input.responseId,
    action: input.action,
    method: input.method,
    hall: input.hall || null,
    session_name: input.sessionName || null,
  });

  if (error) console.warn("Failed to write check-in log:", error.message);
}
