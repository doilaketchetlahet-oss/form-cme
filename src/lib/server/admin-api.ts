import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AdminApiRole = "owner" | "admin" | "viewer";

export type AdminApiAuth = {
  email: string;
  role: AdminApiRole;
  service: SupabaseClient;
};

export type AdminApiAuthError = {
  error: string;
  status: number;
};

/**
 * Authenticate an admin API request and return a strict service-role client.
 * This helper never falls back to the anon key for privileged operations.
 */
export async function authorizeAdminApi(
  request: Request,
  writable = false,
): Promise<AdminApiAuth | AdminApiAuthError> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return { error: "Thiếu cấu hình Supabase server.", status: 500 };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Bạn cần đăng nhập.", status: 401 };

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return { error: "Phiên đăng nhập không hợp lệ.", status: 401 };
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: member, error: memberError } = await service
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (memberError) return { error: memberError.message, status: 500 };
  const role = member?.role as AdminApiRole | undefined;
  if (!role) return { error: "Tài khoản chưa được cấp quyền quản trị.", status: 403 };
  if (writable && role === "viewer") {
    return { error: "Tài khoản chỉ có quyền xem.", status: 403 };
  }

  return { email, role, service };
}
