import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { SurveyResponse } from "./surveys";

const RECONCILE_MS = 60_000;
const FALLBACK_MS = 30_000;
const BATCH_MS = 100;
const PAGE_SIZE = 500;

type Change = { id: string; row: SurveyResponse | null };
type UpdateResponses = (update: (previous: SurveyResponse[]) => SurveyResponse[]) => void;

function applyChanges(rows: SurveyResponse[], changes: Iterable<Change>): SurveyResponse[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const { id, row } of changes) {
    if (row) byId.set(id, { ...byId.get(id), ...row });
    else byId.delete(id);
  }
  return [...byId.values()].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id));
}

/** Subscribe once, patch rows locally, and periodically repair missed events.
 * No schema changes or extra server requests are needed for individual events.
 */
export function startAttendeeSync(client: SupabaseClient, surveyId: string, updateResponses: UpdateResponses) {
  let stopped = false;
  let healthy = false;
  let channel: RealtimeChannel | null = null;
  let refreshTimer: number | undefined;
  let refreshDue = Infinity;
  let batchTimer: number | undefined;
  let reading: AbortController | null = null;
  let readChanges = new Map<string, Change>();
  const pending = new Map<string, Change>();
  let refreshQueued = false;

  const isActive = () => !stopped && document.visibilityState !== "hidden" && navigator.onLine !== false;

  const clearRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    refreshDue = Infinity;
  };

  const flushChanges = () => {
    window.clearTimeout(batchTimer);
    batchTimer = undefined;
    if (stopped || !pending.size) return;
    const changes = [...pending.values()];
    pending.clear();
    updateResponses((rows) => applyChanges(rows, changes));
  };

  const scheduleRefresh = (delay: number) => {
    if (!isActive() || refreshDue <= Date.now() + delay) return;
    clearRefresh();
    refreshDue = Date.now() + delay;
    refreshTimer = window.setTimeout(() => {
      clearRefresh();
      void refresh();
    }, delay);
  };

  const refresh = async () => {
    if (!isActive()) return;
    if (reading) { refreshQueued = true; return; }
    const request = new AbortController();
    reading = request;
    readChanges = new Map();
    let failed = false;
    const timeout = window.setTimeout(() => request.abort(), 20_000);
    try {
      const rows: SurveyResponse[] = [];
      // Page through large events instead of silently hitting the API row limit.
      // Stable ID order avoids check-in changes moving records between pages.
      let after: string | undefined;
      while (true) {
        let query = client.from("survey_responses").select("*").eq("survey_id", surveyId).order("id").limit(PAGE_SIZE);
        if (after) query = query.gt("id", after);
        const { data, error } = await query.abortSignal(request.signal);
        if (error || !data) throw error ?? new Error("Attendee read failed");
        if (request.signal.aborted || reading !== request || !isActive()) return;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        after = data[data.length - 1].id;
      }
      // A snapshot may have started before an event: replay those events so a
      // slow read cannot undo a newer check-in, insertion or deletion.
      const changes = [...readChanges.values()];
      pending.clear();
      window.clearTimeout(batchTimer);
      batchTimer = undefined;
      updateResponses(() => applyChanges(rows, changes));
    } catch {
      // Retain the last successful list on network/API failures.
      failed = true;
    } finally {
      window.clearTimeout(timeout);
      if (reading === request) {
        reading = null;
        readChanges.clear();
        const delay = refreshQueued ? 0 : failed || !healthy ? FALLBACK_MS : RECONCILE_MS;
        refreshQueued = false;
        scheduleRefresh(delay);
      }
    }
  };

  const connect = () => {
    if (channel || !isActive()) return;
    const next = client.channel(`attendees-${surveyId}-${crypto.randomUUID()}`);
    channel = next;
    next.on("postgres_changes", {
      event: "*", schema: "public", table: "survey_responses", filter: `survey_id=eq.${surveyId}`,
    }, (payload) => {
      if (channel !== next || !isActive()) return;
      let change: Change;
      if (payload.eventType === "DELETE") {
        if (typeof payload.old.id !== "string") { scheduleRefresh(BATCH_MS); return; }
        // With RLS, DELETE may expose only its primary key. Removing an ID that
        // isn't in this form's list is harmless; periodic reads also repair
        // installations where filtered DELETE events aren't delivered.
        change = { id: payload.old.id, row: null };
      } else {
        const row = payload.new;
        if (row.survey_id && row.survey_id !== surveyId) return;
        if (payload.errors?.length || typeof row.id !== "string" || row.survey_id !== surveyId
          || typeof row.submitted_at !== "string" || !row.answers || typeof row.answers !== "object") {
          // Never replace a complete row with a truncated Realtime payload.
          scheduleRefresh(BATCH_MS);
          return;
        }
        change = { id: row.id, row: row as SurveyResponse };
      }
      pending.set(change.id, change);
      if (reading) readChanges.set(change.id, change);
      if (batchTimer === undefined) batchTimer = window.setTimeout(flushChanges, BATCH_MS);
    }).subscribe((status) => {
      if (channel !== next || !isActive()) return;
      const wasHealthy = healthy;
      healthy = status === "SUBSCRIBED";
      // Refresh after (re)joining to cover the gap before subscription was ready.
      if (healthy && !wasHealthy) scheduleRefresh(0);
      else if (!healthy) scheduleRefresh(FALLBACK_MS);
    });
  };

  const suspend = () => {
    healthy = false;
    clearRefresh();
    flushChanges();
    reading?.abort();
    reading = null;
    refreshQueued = false;
    readChanges.clear();
    const previous = channel;
    channel = null;
    if (previous) void client.removeChannel(previous);
  };

  const resume = () => {
    if (!isActive()) { suspend(); return; }
    connect();
    scheduleRefresh(0);
  };

  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("offline", resume);
  connect();
  scheduleRefresh(0);

  return () => {
    stopped = true;
    suspend();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("offline", resume);
  };
}
