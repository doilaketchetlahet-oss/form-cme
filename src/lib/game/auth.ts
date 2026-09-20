import { createClient } from "@supabase/supabase-js";

export type GameAuthResult =
  | { user: { id: string; email: string } }
  | { error: string; status: number };

/**
 * Xác thực người dùng cho API cổng game: đọc Bearer access token do trang
 * /games (client) gửi lên. Mọi tài khoản đã đăng nhập đều dùng được game,
 * quyền mở module do bảng `entitlements` quyết định.
 */
export async function authorizeGame(request: Request): Promise<GameAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { error: "Thiếu cấu hình Supabase.", status: 500 };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: "not_authenticated", status: 401 };
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { error: "not_authenticated", status: 401 };
  }

  return { user: { id: data.user.id, email: data.user.email ?? "" } };
}
