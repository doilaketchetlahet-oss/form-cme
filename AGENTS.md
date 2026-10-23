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
  passwords and private Resend keys; defaults to the server-only service-role key.
  Changing the selected encryption key requires re-entering saved credentials.)
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
  Each session uses its own venue. Optional `checkHall: true` also checks the
  attendee's assigned `hall` against the operator's selected hall; omitted/false
  keeps the shared-venue behavior (e.g. Gala accepts guests from A and B).
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

### Excel attendance / CME and one QR

- Form editor Check-in tab can add the optional “Đăng ký cấp CME” Có/Không
  question. This is registration intent, not certification eligibility.
- Attendee import reads XLSX/CSV and shows all question columns. Named columns
  match form questions; a separate mapping panel can map each session to a
  Có/Không/Yes/No/1/0/x/✓ column or an explicit batch-wide Có/Không value.
  Every session needs a decision in this mode. Blank/unknown flags, impossible
  combinations and conflicting program columns are invalid, never auto-granted.
  The mapping produces the existing attendance-question answer; no second
  registration or QR is created. CME maps independently to a form question.
- Attendee import defaults to the first visible Excel sheet and lets operators
  select any sheet (hidden sheets are labeled) and the physical header row.
  Formatting-only trailing rows/columns are ignored; internal blank rows and
  original row/column coordinates are preserved. Changing the source resets
  mappings and preview edits. Generic per-question mappings and an Email-for-QR
  selector distinguish duplicate headers by Excel column letters. Ambiguous
  automatic matches need explicit mapping or operator review of the current
  preview; a selected blank email never falls back to another contact's column.
  The Import button follows valid-row readiness. Pending mappings or duplicate
  header warnings open a review before importing the existing preview, preserving
  manual edits instead of forcing a file reread. Cancel writes nothing. Required
  fields, choices, session rights, halls and latest email duplicates are still
  validated before insertion. Unmapped columns remain visible.
  Regression: `node scripts/test-attendance-sheets-ui.cjs` with the same port and
  Playwright setup as attendance UI tests. Unit tests optionally compare a local
  source workbook via `ATTENDANCE_SOURCE_XLSX`; fixture data stays outside Git.
- Invalid choices, missing attendance, missing required assigned halls and
  duplicate emails are checked; editing/deleting a row revalidates the preview.
  Reapplying mappings rereads the source file and replaces preview edits.
  Unmapped headers are visible. Import adds new registrations; it does not update
  an existing record with the same email.
- QR confirmation shows assigned hall when the form has a hall-selector field,
  every session's registration/check-in status and decoded choice answers
  including CME. Identity fields always precede other details: full name, academic
  title/degree, role, job title, independently of form/answer order. The QR welcome
  screen uses the labeled full name and these nonempty identity details, and only
  shows an assigned hall for forms with a hall selector (not the session venue).
  Denied guests still show
  details without a confirm button. Excel (.xlsx) and CSV export include assigned
  hall, question answers and separate eligibility/check-in columns per session.
- A session's venue is separate from assigned hall. Enable its hall check only
  where needed; existing configs remain unchanged. New conference presets enable
  it when the form already has a hall-selector question. QR/Face choose a hall;
  attendee list links preserve the selected hall. The assigned-hall list filter
  and statistics use each attendee's hall, not the session venue.
- `record_session_checkin` has a six-argument variant (`p_hall`) with atomic hall
  validation under the response lock. Five-argument callers use a wrapper with
  the same checks. Missing/wrong halls fail closed; manual check-in without an
  explicit hall uses the attendee's assigned hall. Undo stays available after
  hall/eligibility changes. Both RPCs are service-role only.
- Existing projects must rerun `supabase/checkin-sessions.sql`, or run
  `node scripts/setup-checkin-sessions.cjs` with `SUPABASE_DB_URL` before deploying.
  Optional `CHECKIN_DB_POOLER_HOST` supplies a known session-pooler host.
  The form-save API probes the new overload before enabling `checkHall` and
  refuses the save if unavailable. Existing configs use the five-argument RPC
  until hall checks are enabled, so pending migration does not stop old sessions.
- Regression: `node --test scripts/test-attendance-import.cjs
  scripts/test-checkin-sessions.cjs`. With the optional CHECKIN_TEST_DEPS directory
  containing PGlite/React/Playwright, all SQL/React checks run. For browser checks,
  start the app on port 3107 and run `node scripts/test-attendance-ui.cjs` (optional
  `PLAYWRIGHT_CHANNEL=msedge`). It imports/exports XLSX, decodes QR from a synthetic
  camera on mobile/desktop, and uses mocked APIs only; no real emails or records.

- Check-in emails recognize normalized name labels including “Họ và tên”,
  “Họ tên” and “Full name”; saved registration names override caller guesses.
  An empty explicit name never falls back to an academic title or address.
  Regression: `node --test scripts/test-checkin-email-name.cjs` uses the real
  email renderer with mocked providers; it never sends a real message.

- Attendee lists, detail fields and check-in displays prioritize full name,
  academic degree, role, then job title independently of form question order.
  List names fall back to email, phone, another visible answer, then response ID.
  Assigned hall UI appears only when the form declares a hall-selector question.
  Regression: `node scripts/test-attendees-display-ui.cjs` (port 3107, same
  Playwright setup as attendance tests; mocked data, no writes or email).

- Editor sortable question cards must remain direct children of the question
  list: `restrictToParentElement` otherwise locks dragging inside a card wrapper.
  CME scroll/focus uses the same sortable root. Regression: start on port 3109,
  run `node scripts/test-editor-reorder-ui.cjs` with `CHECKIN_TEST_DEPS` pointing
  to Playwright (optional `PLAYWRIGHT_CHANNEL=msedge`). Mouse/touch, keyboard,
  CME focus and save/reload use mocked APIs and preserve question IDs.

- Editor Giao diện → Branding mã QR → “Khôi phục QR trắng đen” replaces the
  full branding with explicit black modules/accent, white background, square
  cells and no logo; save applies it to the form. Unconfigured QR uses the same
  `DEFAULT_QR_BRANDING` for previews, check-in, badges and generated email PNGs.
  The QR style version changes image URLs to invalidate old cached artwork.
  A missing logo must not paint a blank box over modules. Previously delivered
  inline email images need resending to change their appearance. Regression:
  `node --test scripts/test-qr-defaults.cjs`; browser reset/save/reload and real
  SVG/PNG decoding: `node scripts/test-qr-ui.cjs` (port 3109, CHECKIN_TEST_DEPS
  for Playwright, optional PLAYWRIGHT_CHANNEL=msedge; mocked auth/data, no mail).
- Attendees “QR ZIP” rereads the form's saved branding and question metadata at
  export time, then downloads the shared `/api/qr` PNG output; it must never
  apply a hardcoded client-side logo. Each PNG filename prefers a labeled full
  name, then the full email address, phone, another visible answered field, and
  finally the response ID. Uploads/signatures/face data are excluded. Safe Unicode
  filenames use case-insensitive unique suffixes, including suffix-shaped names.
  A failed settings/image read aborts export instead of guessing a QR style.
  Regression: `node --test scripts/test-qr-export.cjs`; `node scripts/test-qr-zip-ui.cjs`
  uses the same port/Playwright setup, mocked records and actual PNG decoding at
  the camera's 400px scan resolution. No real registrations or email are sent.

## Standalone Resend / SMTP mail merge

- `/admin/tools/mail-merge`: import Excel/CSV or paste a tab/comma/semicolon
  separated list. The first row supplies column names; Excel reads the first
  sheet and preserves formatted cell text. Up to 5,000 recipients / 60 columns.
- Select the email column. Other columns become insertion fields such as
  `{{ho_ten}}`, `{{truong}}`; duplicate column labels receive unique keys.
  Compose headings, paragraphs, images, buttons or dividers, then preview each
  row, select Resend or a private SMTP account, verify and send a test.
- **Cách gửi thư → Kênh gửi thư** defaults to Resend for new campaigns, with
  `bantochuc@vsot.com.vn` as the suggested sender. Resend can use server
  `RESEND_API_KEY` or a private API key entered in the UI and encrypted for the
  campaign owner. It does not change `RESEND_FROM` or the check-in mail settings.
  Saved configs use `smtp_public.provider: "resend"` with `keySource`, sender
  and reply-to fields; the existing `smtp_secret` holds only the encrypted private
  key (empty for the server key). Old configs without `provider` remain SMTP.
  A sending-only Resend key cannot list domains: **Kiểm tra Resend** reports
  this limitation instead of calling the key invalid or claiming verification.
  Full-access keys can check the sender domain. Neither check sends an email.
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
  template, attachments, card and saved sender account into a separate draft.
  Pause and wait for any in-flight message first. Edit cells or replace Excel,
  save, then explicitly send the new batch; all valid rows receive a new email,
  including recipients of the previous batch. No email is sent when copying.
  `previous_campaign_id` links back through **Xem tracking đợt trước**; the
  original recipient IDs, tokens and results stay intact and old pixels still work.
- A campaign can upload shared files (up to 10 files, 10MB each and 20MB total)
  and can attach a personalized invitation card rendered from the existing
  overlay editor as a JPG, PDF, or both. Each row is rendered server-side before
  its delivery request; both providers accept only server-prepared buffers.
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
  and both providers use the same renderer; plain-text mail omits formatting markers.
- In paragraph/heading blocks, **Chèn liên kết** or Ctrl+K (Cmd+K on Mac)
  opens a dialog to insert, edit or remove a hyperlink on selected text. Merge
  fields and bold labels are supported; link targets allow HTTP/HTTPS/mailto only.
  `inlineLinks: true` enables author-written `[label](<url>)` before substituting
  escaped cell values, keeping older plain/markdown blocks literal. Bold changes
  format label characters and never URLs. Both providers and preview share this
  renderer; plain-text mail includes the destination in parentheses.
- `/api/admin/mail-merge` requires a writable admin. Campaigns are scoped to the
  creating account and use separate `mail_merge_campaigns` / `mail_merge_recipients`
  tables, with no survey/registration/check-in links. Private keys/passwords use AES-256-GCM
  encryption with owner binding; API responses never return encrypted/plain secrets.
- Save before sending. Keep the tab open; it drains one message per request.
  SQL claims serialize across tabs/devices, freeze each batch after sending begins,
  and preserve per-recipient progress. Provider acceptance means `sent`, not delivery.
  Connection loss with unclear acceptance pauses for operator review; stale claims
  become `uncertain` after 3 minutes and are never automatically resent.
- Resend sends through the fixed HTTPS API with an idempotency key per claimed
  recipient/attempt, no automatic retries, and the same attachments/cards/open
  tracking as SMTP. Network errors, 5xx, timeouts or ambiguous responses require
  operator review; explicit rejections become failed rows. Provider changes require
  a draft/new batch; paused campaigns can update credentials in their saved provider.
  No additional SQL migration is needed for Resend on an initialized mail-merge DB.
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
  field insertion, preview, Resend/SMTP forms and mobile layout against mocked APIs
  (requires Playwright; its dependency directory can be set via `MAIL_MERGE_UI_DEPS`).

## Tools & mini-games (added)

### Registration prize wheel

- Tool management requires explicit `admin_members.prize_draw_enabled = true`,
  default false for every role including owners. Owners grant/revoke it per member
  in `/admin/permissions`; viewers with a grant remain read-only. Sidebar, command
  palette and the management page hide/deny the tool without a grant, and every
  admin API request rechecks the grant. Public registration and spinning stay public.
  Run `supabase/prize-draw-permissions.sql` on existing installations; setup script,
  fresh schema and permissions bootstrap include it. Regression:
  `node --test scripts/test-prize-permissions.cjs` (same `PRIZE_TEST_DEPS`).
- `/admin/tools/prize-draw` manages configurable registration-linked prize campaigns;
  `/prize-draw/[id]` is the mobile wheel. Reuses `/s/[id]`, `ThankYouScreen`, QR,
  normalization and admin auth; `PrizeWheel` is shared with Booth Draw.
- Create a sample demo or a live draft. Defaults: 120 bottles, 90 bags, 60 umbrellas,
  30 special gifts; dates are Nov 12–24, 2026 in Vietnam (exclusive end Nov 25 00:00).
  Demos ignore the date window while active and have completely separate inventory.
  Demo/live identity, survey and phone question cannot change. There is no reset.
- One normalized Vietnamese phone per campaign, one draw per entry. No OTP: this
  deduplicates supplied phone numbers, not verified people. Each campaign uses a
  scoped HttpOnly cookie; another device cannot reclaim an entry by entering its phone.
  Lost cookies require operator assistance; never issue a second draw automatically.
- Public submission goes through `/api/prize-draw/[id]` and creates the form response
  and secret-bound entry together. `prize_campaign_id` suppresses ordinary submission,
  repeat-submission button, email/check-in and static redirect for linked forms.
  Linked forms are feedback forms; existing forms must be empty. Supported questions:
  text, paragraph, phone, choice, date, province, rating, NPS and decorative sections/images.
  Phone must remain required/unconditional; SQL triggers guard these restrictions.
- `prize_campaigns`, `prize_items`, `prize_entries` and draw/admin RPCs are service-only.
  Restrictive RLS blocks public access to linked responses without changing unrelated
  forms. Entry snapshots/phone uniqueness survive deletion of a form response.
- All stock changes/draws lock the campaign. Weight is remaining quantity; zero-stock
  gifts never win. Registration does not reserve stock. Sold-out stops new registration
  and draws. Retries restore the first stored award, even after pause/close/end.
  Save uses revision checks; quantities cannot fall below awarded counts; after any
  entry, old prize IDs cannot be removed. Redemption is optional and idempotent.
- Admin can edit branding, dates, gifts/counts, status and redemption instructions;
  look up guests and confirm handout. CSV escapes formula injection; list/export is
  explicitly limited to the latest 1,000 registrations. Stock stats use all awards.
- Apply `supabase/prize-draw.sql` (also included in `schema.sql`) or run
  `node scripts/setup-prize-draw.cjs --seed-demo`. It creates only one sample demo,
  no guests/email, and never resets an existing demo. Optional `PRIZE_DB_POOLER_HOST`
  selects the project's known session-pooler host; password stays in `SUPABASE_DB_URL`.
- Regression: `node --test scripts/test-prize-draw.cjs`; `PRIZE_TEST_DEPS` can point
  to a temporary package folder with `@electric-sql/pglite` for actual SQL checks.
  `node scripts/test-prize-draw-ui.cjs` uses port 3111 (`PRIZE_E2E_BASE` override),
  Playwright from the same folder and optional `PLAYWRIGHT_CHANNEL=msedge`.
  Browser tests mock all auth/data/writes, test mobile/desktop and never send email.

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

- `/games` - public catalog; all 19 modules are open, no login required.
- `/games/play?module=<id>` - embeds `/studio/index.html#/games/<id>` in an iframe.
- `worddecode` ("Giải Mã Ô Chữ") lives in `D:/Game Mới/src/modules/WordDecode/`.
  Its video-reference flow uses separate full-stage screens: start → letter-row
  board → timed question/feedback → manually choose a picture tile → board →
  full-image result. By default every answered question (including wrong/timeout)
  grants exactly one reveal; only correct answers award points. Back grants nothing.
  Cài đặt → Luồng chơi has “Cho mở mảnh ảnh khi trả lời sai” (`allowOpenOnWrong`,
  default true for new/old projects). When disabled, wrong/timeout returns to the
  board without revealing letters or an image tile. Each question has exactly
  one attempt: correct, wrong and timeout all lock that row. The game finishes
  after all questions are answered and earned reveals are spent, even with no
  tiles earned. The final full-image result reports actual tiles opened in the
  round. Only replay resets attempts. Correct answers grant exactly one tile.
  Patches: `worddecode-wrong-answer-policy.patch`, then
  `worddecode-single-attempt.patch`; regression:
  `node scripts/test-worddecode-policy.cjs` (mocked shares, no database writes).
  Replay returns to start. New projects default to 4 questions / 2×2 image;
  older projects retain their configured questions/grid. Each question has an
  optional `phrase` (fallback: correct answer text); optional `background` is
  independent of `revealImage`. Source changes are preserved in
  `scripts/studio-patches/worddecode-flow.patch`; guest-only regression:
  `node scripts/test-worddecode-flow.cjs`. It is bundled like
  the others: rebuild the studio with `VITE_BASE=./`, then run
  `node scripts/import-studio.cjs "D:/Game Mới/dist"`. It is reachable at
  `/games/play?module=worddecode`.
  Follow-up source patch: `worddecode-share-music-celebration.patch` keeps music
  continuous through WordDecode completion/replay (stops on exit), retries
  browser-blocked audio after interaction, and celebrates the last image tile.
  Shared result screens hide library actions for play-only links and retain
  them for edit links, based on the API-returned permission. Regressions:
  `node scripts/test-game-music.cjs`, `node scripts/test-worddecode-polish.cjs`
  (mocked shares; no database writes).
- `/api/game/entitlements` - public; returns all `allowedIds` and `user: null`.
- `/api/game/session` - POST verifies a Bearer token and sets the HttpOnly studio
  session cookie for account sync; DELETE clears it on sign-out/guest launch.
  Guest launch sends `token: null` to the iframe and plays with local browser
  storage. Login is optional and only needed for cloud saves/uploads.
- `/api/game/save` - GET/PUT per-user studio state (workspace sync).
- `/api/game/assets` - uploads to Supabase Storage bucket `game-assets` (public,
  per-account quota: 30 files / 60MB).
- `/games/shared/[token]` - public play/edit capability link; embeds the isolated
  studio `#/shared/<token>` route. Recipients do not need an account.
- `/api/game/shares` - authenticated owner creates, publishes, changes edit access
  or revokes a project's shared edition. The studio has **Chia sẻ** on each
  project card and in its editor. Play and edit links use separate random tokens.
- `/api/game/shared/[token]` - public GET; PUT requires the current edit token
  and revision. Play links cannot write. Edit re-enable rotates the edit token.
- `/api/game/shared/[token]/assets` - edit-token media upload, charged to the
  original owner's existing Storage quota; play links cannot upload.
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

Sharing publishes a separate edition containing one project, its selected theme
and referenced media/music. It never publishes the whole workspace or scores.
Owner changes to the private project require **Cập nhật nội dung**; anonymous
edit recipients use **Lưu thay đổi** to update the shared edition. Revision
checks prevent stale/simultaneous saves from overwriting each other. Shared
sessions never hydrate/write the recipient's normal `eventplay-studio` storage
or sync their account. Revocation prevents new loads/saves; already-loaded game
content remains in a recipient's tab. Capability URLs should not be logged.

Session regression checks: `node --test scripts/test-game-session.cjs`.

SQL to run once: `supabase/game-modules.sql`, `supabase/game-saves.sql`,
`supabase/game-shares.sql` (service-role API only; no browser table privileges).
`node scripts/setup-game-shares.cjs` applies the sharing migration with
`SUPABASE_DB_URL`; optional `GAME_SHARE_DB_POOLER_HOST` selects the project's
session pooler on networks without direct database IPv6 access.
Sharing regression: `node scripts/test-game-sharing.cjs` (local server on 3001;
`GAME_E2E_BASE` can target production). Creates confirmed throwaway Supabase
accounts, sends no email, and removes test accounts/media afterward.

Rebuild the studio bundle from the EventPlay project with `VITE_BASE=./`, then
run `node scripts/import-studio.cjs "D:/Game Mới/dist"` to copy and optimize it.
Source changes for Camera / Mouse / Touch HandSlice are preserved in
`scripts/studio-patches/handslice-pointer.patch` (already applied locally).
See the adjacent README for rebuild instructions. HandSlice shows a control
picker before mounting the engine; pointer mode never opens the camera,
including the win screen. Regression: `node scripts/test-handslice-input.cjs`.
Sharing source changes are preserved in `scripts/studio-patches/game-sharing.patch`
(already applied locally). It includes the CORS fix for Supabase-hosted Jigsaw
pictures so shared uploads can be drawn into puzzle-piece canvases.
Decode Letters long-question/answer layout changes are preserved in
`scripts/studio-patches/decodeletters-long-text.patch` (already applied locally).
Text wraps without line clamping; long content scrolls above the fixed Confirm
action. Regression: `node scripts/test-decodeletters-text.cjs` covers desktop,
phone and short landscape screens using guest fixtures only.
The follow-up `scripts/studio-patches/decodeletters-ui.patch` adds a responsive
picture panel (including phones), larger touch controls, compact help and next-step
guidance. Decode Letters tutorial/chrome/results use Vietnamese independently of
the workspace language. The result shows the complete reveal image with a
final-image fallback, and supports replay and combo progression. The same test
also checks all four image unlocks and replay at every viewport.

Note: `/games/play` is the game launcher and is unrelated to the quiz-app's
`/play` player runtime mentioned below.

## Avoid

- Adding `/host`, `/q`, `/r`, replay, host, item, poll, slide, or badge code
  back into this app (the quiz-app game runtime).
- Sharing env vars with the original quiz app.
- Logging uploaded files, phone/email data, or face embeddings.
