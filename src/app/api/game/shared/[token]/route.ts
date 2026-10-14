import { SHARE_TABLE, shareAdmin, shareResponse, sameShareOrigin, readShareBody, validateSnapshot, findPublicShare } from "@/lib/game/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const row = await findPublicShare(token);
    if (!row) return shareResponse({ error: "not_found" }, 404);
    return shareResponse({ snapshot: row.snapshot, revision: row.rev, updatedAt: row.updated_at, permission: row.edit_token === token ? "edit" : "play" });
  } catch { return shareResponse({ error: "unavailable" }, 503); }
}

export async function PUT(request: Request, context: Context) {
  if (!sameShareOrigin(request)) return shareResponse({ error: "forbidden" }, 403);
  try {
    const { token } = await context.params;
    const row = await findPublicShare(token);
    if (!row) return shareResponse({ error: "not_found" }, 404);
    if (row.edit_token !== token) return shareResponse({ error: "read_only" }, 403);
    const body = await readShareBody(request);
    if (!body || !Number.isSafeInteger(body.expectedRev)) return shareResponse({ error: "invalid_body" }, 400);
    const snapshot = validateSnapshot(body.snapshot);
    if (!snapshot || snapshot.project.id !== row.project_id || snapshot.project.moduleId !== row.module_id) return shareResponse({ error: "invalid_snapshot" }, 400);
    if (body.expectedRev !== row.rev) return shareResponse({ error: "conflict" }, 409);
    const admin = shareAdmin()!;
    // Check the capability AND revision in the write itself: a concurrent
    // revocation or save must never let a stale editor overwrite the current game.
    const { data, error } = await admin.from(SHARE_TABLE).update({ snapshot, rev: row.rev + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("edit_token", token).eq("rev", row.rev).select("rev,updated_at").maybeSingle();
    if (error) return shareResponse({ error: "share_write_failed" }, 503);
    if (!data) return shareResponse({ error: "conflict" }, 409);
    return shareResponse({ revision: data.rev, updatedAt: data.updated_at });
  } catch { return shareResponse({ error: "unavailable" }, 503); }
}
