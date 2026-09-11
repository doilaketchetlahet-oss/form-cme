import { supabase } from "./supabase";
import { listRegistrationForms, type RegistrationFormSummary } from "./forms";

export type DashboardResponseRow = {
  survey_id: string;
  submitted_at: string;
  checked_in: boolean | null;
  checked_in_at: string | null;
  email_status: string | null;
  payment_status: string | null;
  payment_amount: number | null;
};

export type DashboardLogRow = {
  id: string;
  survey_id: string;
  action: string;
  method: string;
  hall: string | null;
  created_at: string;
};

export type DashboardData = {
  forms: RegistrationFormSummary[];
  responses: DashboardResponseRow[];
  logs: DashboardLogRow[];
  pins: Record<string, string | null>;
};

const EMPTY: DashboardData = { forms: [], responses: [], logs: [], pins: {} };

export async function loadDashboardData(): Promise<DashboardData> {
  const forms = await listRegistrationForms();
  if (forms.length === 0) return EMPTY;

  const surveyIds = forms.map((form) => form.id);

  let responses: DashboardResponseRow[] = [];
  const full = await supabase
    .from("survey_responses")
    .select("survey_id, submitted_at, checked_in, checked_in_at, email_status, payment_status, payment_amount")
    .in("survey_id", surveyIds);

  if (full.error) {
    const basic = await supabase
      .from("survey_responses")
      .select("survey_id, submitted_at, checked_in, checked_in_at")
      .in("survey_id", surveyIds);
    responses = ((basic.data ?? []) as Omit<DashboardResponseRow, "email_status" | "payment_status" | "payment_amount">[])
      .map((row) => ({ ...row, email_status: null, payment_status: null, payment_amount: null }));
  } else {
    responses = (full.data ?? []) as DashboardResponseRow[];
  }

  const [logsResult, pinsResult] = await Promise.all([
    supabase
      .from("checkin_logs")
      .select("id, survey_id, action, method, hall, created_at")
      .in("survey_id", surveyIds)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.from("surveys").select("id, checkin_pin").in("id", surveyIds),
  ]);

  const pins: Record<string, string | null> = {};
  (pinsResult.data ?? []).forEach((row: { id: string; checkin_pin: string | null }) => {
    pins[row.id] = row.checkin_pin;
  });

  return {
    forms,
    responses,
    logs: (logsResult.data ?? []) as DashboardLogRow[],
    pins,
  };
}
