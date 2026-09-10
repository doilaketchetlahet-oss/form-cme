"use client";
import type { CheckinTheme } from "@/lib/surveys";

/**
 * Reusable themed layer for the check-in scan screen.
 * Renders: background image + dark-blue overlay + header (logos + name) + footer (date/venue/organizer).
 * The scan UI (camera card) is passed as children and floats above this layer.
 * Designed landscape-first (16:9), responsive down to tablet/phone.
 */
export function CheckinThemeLayer({
  theme,
  children,
}: {
  theme: CheckinTheme | null;
  children: React.ReactNode;
}) {
  const t = theme ?? {};
  const accent = t.accentColor || "#6366f1";
  const overlay = Math.min(100, Math.max(0, t.overlayOpacity ?? 40)) / 100;
  const name = t.conferenceName || "";
  const hasFooter = t.date || t.venue || t.organizer;

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-900">
      {/* Background layer */}
      {t.backgroundImage ? (
        <img
          src={t.backgroundImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "blur(3px)", transform: "scale(1.04)" }}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#0369a1,#06b6d4)" }} />
      )}

      {/* Dark-blue gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgba(7,18,45,${overlay + 0.1}), rgba(7,18,45,${overlay}))`,
        }}
      />

      {/* UI layer */}
      <div className="absolute inset-0 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 px-6 sm:px-10 py-4 sm:py-6">
          <div className="w-16 sm:w-28 h-12 sm:h-16 flex items-center justify-start">
            {t.leftLogo && <img src={t.leftLogo} alt="" className="max-h-full max-w-full object-contain" />}
          </div>
          {name && (
            <h1 className="flex-1 text-center text-on-brand font-bold text-lg sm:text-2xl lg:text-3xl truncate drop-shadow">
              {name}
            </h1>
          )}
          <div className="w-16 sm:w-28 h-12 sm:h-16 flex items-center justify-end">
            {t.rightLogo && <img src={t.rightLogo} alt="" className="max-h-full max-w-full object-contain" />}
          </div>
        </header>

        {/* Check-in card area (children) */}
        <main className="flex-1 flex items-center justify-center px-4 min-h-0">
          {children}
        </main>

        {/* Footer */}
        {hasFooter && (
          <footer className="flex items-center justify-center gap-x-6 gap-y-1 flex-wrap px-6 py-3 sm:py-4 text-white/80 text-xs sm:text-sm">
            {t.date && <span>📅 {t.date}</span>}
            {t.venue && <span>📍 {t.venue}</span>}
            {t.organizer && <span>🏢 {t.organizer}</span>}
          </footer>
        )}
      </div>

      {/* expose accent via CSS var for children */}
      <style>{`:root{--checkin-accent:${accent}}`}</style>
    </div>
  );
}
