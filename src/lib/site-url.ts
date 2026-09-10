export function getConfiguredSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
}

export function getBrowserSiteUrl() {
  if (typeof window === "undefined") return getConfiguredSiteUrl();
  return getConfiguredSiteUrl() || window.location.origin;
}

export function buildPublicUrl(path: string) {
  const base = getBrowserSiteUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function getRequestSiteUrl(fallbackOrigin: string) {
  return getConfiguredSiteUrl() || fallbackOrigin.replace(/\/+$/, "");
}
