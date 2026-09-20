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

- `/games` - catalog; any signed-in account (not admin-only) sees free modules
  plus modules it owns via `entitlements`.
- `/games/play?module=<id>` - embeds `/studio/index.html#/games/<id>` in an iframe.
- `/api/game/entitlements` - Bearer-token auth; returns `allowedIds`.
- `/api/game/save` - GET/PUT per-user studio state (workspace sync).
- `/api/game/assets` - uploads to Supabase Storage bucket `game-assets` (public,
  per-account quota: 30 files / 60MB).
- `public/studio/` - prebuilt EventPlay Studio bundle (do not edit by hand).

Auth handshake: `/games/play` posts an access token to the studio iframe via
`postMessage` after the iframe sends `{ type: "eventplay:ready" }`. The studio
calls the game APIs with `Authorization: Bearer <token>`.

SQL to run once: `supabase/game-modules.sql`, `supabase/game-saves.sql`.

Rebuild the studio bundle from the EventPlay project with `VITE_BASE=./`, copy
`dist` into `public/studio`, then run the asset optimizer.

Note: `/games/play` is the game launcher and is unrelated to the quiz-app's
`/play` player runtime mentioned below.

## Avoid

- Adding `/host`, `/q`, `/r`, replay, host, item, poll, slide, or badge code
  back into this app (the quiz-app game runtime).
- Sharing env vars with the original quiz app.
- Logging uploaded files, phone/email data, or face embeddings.
