import { createClient } from "@supabase/supabase-js";
import { getGameAccessToken } from "./session";

export type GameAuthResult =
  | { user: { id: string; email: string } }
  | { error: string; status: number };

/**
 * Xác thực người dùng cho API cổng game: đọc Bearer access token do trang
 * /games (client) gửi lên. Mọi tài khoản đã đăng nhập đều dùng được game,
 * tạm thời được mở toàn bộ module trong catalog.
 */
export async function authorizeGame(request: Request): Promise<GameAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { error: "Thiếu cấu hình Supabase.", status: 500 };
  }

  const token = getGameAccessToken(request);
  if (!token) {
    return { error: "not_authenticated", status: 401 };
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { error: "not_authenticated", status: 401 };
  }

  return { user: { id: data.user.id, email: data.user.email ?? "" } };
}

/** Validate the JWT signature and expiry; Supabase caches its public signing keys. */
export async function authorizeStudio(request: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = getGameAccessToken(request);
  if (!url || !anonKey || !token) return false;
  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    return !error && typeof data?.claims.sub === "string" && data.claims.role === "authenticated";
  } catch {
    return false;
  }
}
