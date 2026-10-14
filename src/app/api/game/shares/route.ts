import { authorizeGame } from "@/lib/game/auth";
import { SHARE_TABLE, shareAdmin, shareResponse, sameShareOrigin, readShareBody, validateSnapshot, validProjectId, newShareToken, ownerShareInfo, type ShareRow } from "@/lib/game/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeGame(request);
  if ("error" in auth) return shareResponse({ error: auth.error }, auth.status);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!validProjectId(projectId)) return shareResponse({ error: "invalid_project" }, 400);
  const admin = shareAdmin();
  if (!admin) return shareResponse({ error: "unavailable" }, 503);
  const { data, error } = await admin.from(SHARE_TABLE).select("*").eq("user_id", auth.user.id).eq("project_id", projectId).maybeSingle();
  if (error) return shareResponse({ error: "share_read_failed" }, 503);
  return shareResponse({ share: data ? ownerShareInfo(data as ShareRow) : null });
}

/** Creates/updates a shared edition. Changing edit access rotates or revokes its capability. */
export async function POST(request: Request) {
  if (!sameShareOrigin(request)) return shareResponse({ error: "forbidden" }, 403);
  const auth = await authorizeGame(request);
  if ("error" in auth) return shareResponse({ error: auth.error }, auth.status);
  const body = await readShareBody(request);
  if (!body || !validProjectId(body.projectId) || typeof body.editEnabled !== "boolean") return shareResponse({ error: "invalid_body" }, 400);
  const snapshot = body.snapshot === undefined ? null : validateSnapshot(body.snapshot);
  if (body.snapshot !== undefined && (!snapshot || snapshot.project.id !== body.projectId)) return shareResponse({ error: "invalid_snapshot" }, 400);
  const admin = shareAdmin();
  if (!admin) return shareResponse({ error: "unavailable" }, 503);
  const { data, error } = await admin.from(SHARE_TABLE).select("*").eq("user_id", auth.user.id).eq("project_id", body.projectId).maybeSingle();
  if (error) return shareResponse({ error: "share_read_failed" }, 503);
  const current = data as ShareRow | null;
  if (current) {
    if (body.expectedRev !== current.rev) return shareResponse({ error: "conflict" }, 409);
    if (snapshot && snapshot.project.moduleId !== current.module_id) return shareResponse({ error: "invalid_module" }, 400);
    const { data: updated, error: updateError } = await admin.from(SHARE_TABLE).update({
      ...(snapshot ? { snapshot } : {}), edit_token: body.editEnabled ? current.edit_token || newShareToken() : null,
      rev: current.rev + 1, updated_at: new Date().toISOString(),
    }).eq("id", current.id).eq("user_id", auth.user.id).eq("rev", current.rev).select("*").maybeSingle();
    if (updateError) return shareResponse({ error: "share_write_failed" }, 503);
    if (!updated) return shareResponse({ error: "conflict" }, 409);
    return shareResponse({ share: ownerShareInfo(updated as ShareRow) });
  }
  if (!snapshot) return shareResponse({ error: "missing_snapshot" }, 400);
  const { count, error: countError } = await admin.from(SHARE_TABLE).select("id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  if (countError) return shareResponse({ error: "share_read_failed" }, 503);
  if ((count ?? 0) >= 100) return shareResponse({ error: "quota_shares" }, 429);
  const { data: created, error: createError } = await admin.from(SHARE_TABLE).insert({
    user_id: auth.user.id, project_id: body.projectId, module_id: snapshot.project.moduleId, snapshot,
    play_token: newShareToken(), edit_token: body.editEnabled ? newShareToken() : null,
  }).select("*").single();
  if (createError) return shareResponse({ error: createError.code === "23505" ? "conflict" : "share_write_failed" }, createError.code === "23505" ? 409 : 503);
  return shareResponse({ share: ownerShareInfo(created as ShareRow) }, 201);
}

export async function DELETE(request: Request) {
  if (!sameShareOrigin(request)) return shareResponse({ error: "forbidden" }, 403);
  const auth = await authorizeGame(request);
  if ("error" in auth) return shareResponse({ error: auth.error }, auth.status);
  const body = await readShareBody(request);
  if (!body || !validProjectId(body.projectId)) return shareResponse({ error: "invalid_body" }, 400);
  const admin = shareAdmin();
  if (!admin) return shareResponse({ error: "unavailable" }, 503);
  const { error } = await admin.from(SHARE_TABLE).delete().eq("user_id", auth.user.id).eq("project_id", body.projectId);
  return error ? shareResponse({ error: "share_write_failed" }, 503) : shareResponse({ ok: true });
}
