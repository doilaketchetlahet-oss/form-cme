# Agent Handoff

This is `form-cme`, a standalone registration/check-in app split from the
original quiz project. Do not reintroduce game routes or game dependencies.

## Stack

- Next.js 16, React 19, TypeScript
- Supabase Auth, Postgres, Realtime, Storage
- Resend for check-in emails
- Framer Motion and Tailwind CSS 4
- Face recognition models in `public/models`

## Commands

Run from `form-cme/`.

```bash
npm run dev
npm run build
npm run lint
```

## Git

After every completed change, commit and push to `origin/main` so Vercel
deploys automatically. Stage only the files related to the change; never commit
secrets (`.env.local` stays ignored).

## OCR (đọc chữ trong ảnh)

`scripts/ocr.ps1` dùng Tesseract (đã cài ở `C:\Program Files\Tesseract-OCR`,
gói tiếng Việt ở `%LOCALAPPDATA%\tesseract-oss\tessdata`) để đọc chữ từ ảnh
chụp màn hình. Model không nhận ảnh trực tiếp, nên OCR là cách đọc nội dung ảnh.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/ocr.ps1 <file-hoặc-thư-mục> [vie+eng]
```

## Environment

This app is intended for its own Vercel, Supabase, and Resend projects.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; email templates, events,
  campaigns, permissions user list)
- `RESEND_API_KEY`
- `RESEND_FROM` (optional)
- `RESEND_WEBHOOK_SECRET` (optional; verifies Resend delivery webhooks)
- `EMAIL_PROVIDER` (optional; `resend` default or `smtp`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`,
  `SMTP_FROM` (when `EMAIL_PROVIDER=smtp`)
- `MAIL_MERGE_ENCRYPTION_KEY` (optional stable secret for standalone SMTP
  accounts; defaults to the server-only service-role key. Changing the selected
  encryption key requires re-entering saved SMTP passwords.)
- `CRON_SECRET` (optional; protects `/api/cron/email-campaigns`)
- `SUPABASE_DB_URL` (optional after setup; needed by `/admin/permissions` to
  bootstrap role tables and policies from the UI)

## Routes

- `/` marketing landing page (I-solution Manager); app entry stays at
  `/admin`, `/login`, `/signup`
- `/admin` dashboard
- `/admin/forms` form list
- `/admin/forms/[id]` form editor
- `/admin/permissions` role management
- `/s/[id]` public registration form
- `/attendees/[surveyId]` attendee/check-in dashboard
- `/scan/[surveyId]` QR scanner
- `/face-checkin/[surveyId]` VIP face check-in
- `/checkin/[id]` QR confirmation page

## Attendance sessions (conference / gala)

- In `/admin/forms/[id]`, Check-in tab → enable “Điểm danh theo buổi” →
  “Tạo mẫu Hội thảo + Gala”. This adds a required three-option question and two
  sessions. Set each venue and optional opening/closing time (Vietnam time), save.
- Sessions are shared in `surveys.checkin_theme.sessionConfig`; IDs remain stable
  when display names or venues change. `questionId` links to the choice question;
  each session's `optionIndexes` controls eligibility. Missing answers fail closed.
- One registration and `/checkin/[responseId]` QR covers all eligible sessions.
  `/attendees/[surveyId]` provides attendance-group/session filters, counts, CSV,
  manual check-in, and `/scan/[surveyId]?session=<stable-id>` / VIP Face links.
  Each session uses its own venue; the legacy single `hall` column is not a gate.
- `/api/checkin/[surveyId]` accepts preview/checkin/undo with PIN (if configured)
  or writable admin authentication. `record_session_checkin` validates eligibility,
  payment, and server time, then atomically updates `session_checkins` and logs.
  Opening is inclusive, closing exclusive; duplicates keep their first timestamp.
  Undo works after eligibility/window changes. Managed forms require a session.
- Existing forms without `sessionConfig` keep the old sessions and hall behavior.
  The migration does not rewrite registrations or general check-in flags. Reports
  derive one arrival per person from independent session timestamps. Once guests
  register, the save API rejects reordering/deleting the attendance question options.
- Existing installations: run `supabase/checkin-sessions.sql` once (re-runnable).
  Fresh installations have the same functions/guard in `supabase/schema.sql`.
  `SUPABASE_SERVICE_ROLE_KEY` is required for the new check-in API.
- Regression: `node --test scripts/test-checkin-sessions.cjs`; optional real
  PostgreSQL/React checks are documented at the top of that script.

## Standalone SMTP mail merge

- `/admin/tools/mail-merge`: import Excel/CSV or paste a tab/comma/semicolon
  separated list. The first row supplies column names; Excel reads the first
  sheet and preserves formatted cell text. Up to 5,000 recipients / 60 columns.
- Select the email column. Other columns become insertion fields such as
  `{{ho_ten}}`, `{{truong}}`; duplicate column labels receive unique keys.
  Compose headings, paragraphs, images, buttons or dividers, then preview each
  row, configure a private SMTP account, verify the connection and send a test.
- **Xử lý Email trùng** defaults to skipping duplicate addresses (also for old
  templates without `duplicateEmailPolicy`). Drafts can select **Gửi riêng từng
  dòng** (`duplicateEmailPolicy: "allow"`) so one speaker with multiple reports
  gets a separate personalized email/card per row. Save after switching modes.
  Invalid emails still skip; each row keeps its own send progress/open tracking.
  Each sending batch keeps its policy; SQL identity remains the source row.
- The recipient section can edit each imported cell while the campaign is a
  draft; preview and email validation update immediately. Save edits before sending.
  The send button is always visible, and is enabled after saving valid data.
- After sending starts, **Chỉnh sửa / tạo đợt mới** copies the saved list,
  template, attachments, card and private SMTP account into a separate draft.
  Pause and wait for any in-flight message first. Edit cells or replace Excel,
  save, then explicitly send the new batch; all valid rows receive a new email,
  including recipients of the previous batch. No email is sent when copying.
  `previous_campaign_id` links back through **Xem tracking đợt trước**; the
  original recipient IDs, tokens and results stay intact and old pixels still work.
- A campaign can upload shared files (up to 10 files, 10MB each and 20MB total)
  and can attach a personalized invitation card rendered from the existing
  overlay editor as a JPG, PDF, or both. Each row is rendered server-side before
  its SMTP request; the sender never passes remote URLs or file paths to Nodemailer.
- `survey-uploads` accepts images, PDF, Word, Excel and PowerPoint attachments.
  Existing installations run `supabase/email-attachments.sql` to add document
  MIME types while preserving current limits, custom types and storage policies.
  Regression: `node --test scripts/test-email-attachments.cjs` (optional SQL
  runtime uses `MAIL_MERGE_TEST_DEPS`, like the mail-merge checks).
- In text/heading/button blocks, select content and press **In đậm** or Ctrl+B
  (Cmd+B on Mac) to toggle bold; selections never split a merge placeholder.
  The block's optional `format: "markdown"` interprets only `**bold**` authored
  in the template, before inserting escaped cell values. Older blocks without
  this flag retain their plain text, including literal asterisks. Both preview
  and SMTP use the same renderer; plain-text mail omits formatting markers.
- `/api/admin/mail-merge` requires a writable admin. Campaigns are scoped to the
  creating account and use separate `mail_merge_campaigns` / `mail_merge_recipients`
  tables, with no survey/registration/check-in links. Passwords use AES-256-GCM
  encryption with owner binding; API responses never return encrypted/plain secrets.
- Save before sending. Keep the tab open; it drains one SMTP message per request.
  SQL claims serialize across tabs/devices, freeze each batch after sending begins,
  and preserve per-recipient progress. SMTP acceptance means `sent`, not delivery.
  Connection loss with unclear acceptance pauses for operator review; stale claims
  become `uncertain` after 3 minutes and are never automatically resent.
- SMTP uses the entered account (TLS or mandatory STARTTLS), independently of
  `EMAIL_PROVIDER` and the existing check-in sender. Public DNS/IP checks prevent
  the custom host from accessing LAN/metadata endpoints. No real test messages
  should be sent during development without a user-specified recipient.
- **Theo dõi mở thư** adds an opaque per-recipient image URL at
  `/api/mail-merge/open/[id]`; the server stores only a token digest and exposes
  the first-open timestamp/count in the campaign table. Tracking can be disabled
  per campaign, and image blocking or privacy prefetching can make the metric
  incomplete.
- Run `supabase/mail-merge.sql` on existing installs; fresh `schema.sql` includes
  the same tables/RPCs. RLS and revoked browser privileges keep credentials private.
- Regression: `node --test scripts/test-mail-merge.cjs`; optional SQL dependency
  setup is documented there. `node scripts/test-mail-merge-ui.cjs` exercises XLSX,
  field insertion, preview, SMTP form and mobile layout against mocked APIs
  (requires Playwright; its dependency directory can be set via `MAIL_MERGE_UI_DEPS`).

## Tools & mini-games (added)

- `/admin/tools/booth-draw` - booth lucky draw (admin); public at `/booth-draw`.
- `/admin/tools/flap` - MC console for the "Lắc điện thoại, Đại bàng tung cánh"
  team game; creates a room, shows the join QR and the LED board link.
- `/flap/[code]` - player screen (shakes the phone; falls back to tap when the
  motion sensor is unavailable or denied).
- `/flap/[code]/board` - LED race board (open on the venue PC).
- `/api/flap/[code]` - GET room snapshot / POST create / PUT MC controls.
- `/api/flap/[code]/join` - issues a per-device session token (hash stored only).
- `/api/flap/[code]/score` - the referee: token check + per-second and per-batch
  score caps server-side, then Broadcast for the LED.

Architecture: phones POST batched score deltas to the API (referee), Postgres is
the ledger, Supabase Realtime Broadcast (`flap:<CODE>`) is the display channel,
and the LED board re-syncs from the API every 2s so a reconnect never loses the
true score. Run `supabase/flap-race.sql` once.

## Wish wall (added)

"Trao lời chúc, nhận yêu thương" — a two-screen experience:

- `/admin/tools/wish-wall` - create the event, theme, item, moderation,
  collector/background images, QR for the tablet and the LED wall.
- `/wish/[code]` - tablet/mobile: pick a symbol, type or draw a wish, send
  (optional `?edge=left|right|center|bottom` overrides the event default;
  `center` retains its legacy meaning of entry from the top of the LED).
- `/wish/[code]/wall` - LED screen: wishes enter from the chosen edge,
  then drift and slowly crystallize into a collective shape
  (heart/star/flower/text/image). A sound toggle (WebAudio whoosh/chime) and a
  fullscreen button sit in the header; completion triggers a flash + fireworks.
  The admin Setup tab has one QR per tablet edge (left/center/right/bottom) and the
  Display tab has a "Gửi lời chúc thử" button (broadcast-only demo wish).
- After sending, the tablet shows a random wish from someone else
  ("Một lời chúc gửi đến bạn").
- `/api/wish/[code]` - GET snapshot (public; `?scope=all` + admin bearer for
  the moderation queue), POST `create` (admin) / `submit` (public),
  PUT `settings|moderate|delete|clear|spotlight|absorb-all` (admin).
- `/api/wish/[code]/asset` - admin upload for collector/background
  images into the public `wish-assets` bucket.

Architecture: phones POST to the API (referee: length caps, per-IP cooldown,
moderation), Postgres is the ledger, Supabase Realtime Broadcast
(`wish:<CODE>`) is the display channel, and the LED wall re-syncs from the API
every 6s so a reconnect never loses a wish. The wall renders on Canvas 2D
(no extra deps) and only tracks a bounded number of floating items; older
wishes absorb into the target shape.

Run (or re-run for an existing installation) `supabase/wish-wall.sql` before
using the bottom edge. This preserves existing events/wishes and the `center`
default. Tablets fly right for left entry, left for right entry, down for
center/top entry, and up for bottom entry. Omitted API edges use the event
default; explicit invalid edges return HTTP 400. Partial settings updates
preserve omitted values. The collective shape is procedural; upload a designed
image from the admin Setup tab to replace it.

Regression checks: `node --test scripts/test-wish-wall.cjs`; optional full
React/SQL check setup is documented at the top of that script.

## Data Model Note

The app keeps the legacy `quizzes` table as a lightweight owner/container table
for compatibility. The UI calls these records forms/events. The important tables
are:

- `quizzes` - owner-scoped form container
- `surveys` - registration form settings
- `survey_questions` - form fields
- `survey_responses` - registrations and check-in status
- `face_registrations` - VIP face embeddings
- `admin_members` - owner/admin/viewer access to admin routes

For a new Supabase project, use `supabase/schema.sql`. It is trimmed for this app
and intentionally does not include game tables such as rooms, players, answers,
items, polls, slides, or badges.

## Keep

- `src/lib/forms.ts`
- `src/lib/surveys.ts`
- `src/lib/ekyc.ts`
- `src/components/admin/Forms*`
- `src/components/admin/SurveyEditor.tsx`
- `src/components/survey/*`
- `src/components/ekyc/*`
- check-in routes under `src/app`

## Game portal (added)

This app now also hosts the EventPlay game portal (kiosk mini-games):

- `/games` - public catalog; all 18 modules are open, no login required.
- `/games/play?module=<id>` - embeds `/studio/index.html#/games/<id>` in an iframe.
- `/api/game/entitlements` - public; returns all `allowedIds` and `user: null`.
- `/api/game/session` - POST verifies a Bearer token and sets the HttpOnly studio
  session cookie for account sync; DELETE clears it on sign-out/guest launch.
  Guest launch sends `token: null` to the iframe and plays with local browser
  storage. Login is optional and only needed for cloud saves/uploads.
- `/api/game/save` - GET/PUT per-user studio state (workspace sync).
- `/api/game/assets` - uploads to Supabase Storage bucket `game-assets` (public,
  per-account quota: 30 files / 60MB).
- `studio/` - prebuilt EventPlay Studio bundle, served by the public
  `/studio/[[...slug]]` route (do not edit by hand).
- `public/games/covers/` - optimized copies of demo images and screenshots from
  `D:/Game Mới`, mapped by `cover` in `src/config/gameModules.json`. Re-import
  with `node scripts/import-game-covers.cjs "D:/Game Mới"` after exporting a new
  catalog. Modules without original cover art keep their icon fallback.

Auth handshake: `/games/play` posts an access token to the studio iframe via
`postMessage` after the iframe sends `{ type: "eventplay:ready" }` (null for guests). The studio
calls the game APIs with `Authorization: Bearer <token>`. A standalone studio
tab can use the verified HttpOnly cookie for account APIs instead. The save and
asset upload APIs still require authentication; guests do not sync to Supabase.

Session regression checks: `node --test scripts/test-game-session.cjs`.

SQL to run once: `supabase/game-modules.sql`, `supabase/game-saves.sql`.

Rebuild the studio bundle from the EventPlay project with `VITE_BASE=./`, then
run `node scripts/import-studio.cjs "D:/Game Mới/dist"` to copy and optimize it.
Source changes for Camera / Mouse / Touch HandSlice are preserved in
`scripts/studio-patches/handslice-pointer.patch` (already applied locally).
See the adjacent README for rebuild instructions. HandSlice shows a control
picker before mounting the engine; pointer mode never opens the camera,
including the win screen. Regression: `node scripts/test-handslice-input.cjs`.

Note: `/games/play` is the game launcher and is unrelated to the quiz-app's
`/play` player runtime mentioned below.

## Avoid

- Adding `/host`, `/q`, `/r`, replay, host, item, poll, slide, or badge code
  back into this app (the quiz-app game runtime).
- Sharing env vars with the original quiz app.
- Logging uploaded files, phone/email data, or face embeddings.
