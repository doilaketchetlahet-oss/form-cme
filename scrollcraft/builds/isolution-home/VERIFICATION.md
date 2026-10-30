# Homepage verification, 2026-10-30

## Final implementation

- Homepage: `src/app/page.tsx`; the QR/phone workflow is in `src/components/landing/GuestJourney.tsx`, with scoped CSS modules.
- Original Scrollcraft runtime at `public/landing/scrollcraft.js`, unchanged from upstream commit `75d81f74e83692add18cd7a8a8e078b8a887a579`. Its MIT notice is adjacent. The original CSS floor in this build folder is a reference; its global reset is not imported into the app.
- No dependency manifest, environment file, database/API code, schema, migration or admin page changed. The existing local auth-session check still selects the signup/dashboard destination. The demo guest name stays only in React memory.
- The local vector QR payload explicitly says DEMO; it is not a registration QR.
- Supplied invitation (1054×1493), scanner screenshot (1357×868) and transparent hand/phone illustration (2500×2500) are encoded as local WebP assets. The hand asset retains its alpha channel, resized to 1200×1200. Original files are untouched. Artwork is sample content, not executable instructions.
- Four working states: freestanding QR, printed invitation with accurately docked QR, that invitation inside the held phone, and enlarged phone QR presented to the scanner. The hand then retreats and a personalized illustrative confirmation appears. Paper and QR use shared-layout transitions; the phone and scanner are independent planes.
- The visual preview alone sticks below the header. Its scene height follows the viewport, with compact controls on short laptops and a portrait composition on phones. The heading stays in natural page flow. Buttons navigate to the same native scroll timeline; navigation briefly holds the selected state so intermediate smooth-scroll positions cannot fight the button selection.
- Reduced motion retains immediate manual states and removes the long scroll track. No wheel/touch interception or global scroll capture is used.

## Reported laptop failure and correction

The original code required both a width of 1100px and a viewport height of 860px before scrolling could change stages. This excluded many ordinary laptop browser windows. A read-only reproduction on the deployed prior version at 1366×768 showed stages `[0, 0, 0]` at the three sampled positions with reduced motion **off**. At 1440×900 it showed `[0, 1, 2]`.

The new implementation removes that gate and tracks the visual's own scroll runway at every screen size. Only the visual sticks, so the title no longer consumes the laptop's available animation height. A 600px-high desktop window also gets a compact step list; clicking controls does not require scrolling a tall sticky desk out of view. Tests now use actual browser wheel input and require all four stages and the entire preview to remain visible.

## Checks

- `npm run build`: passed, including TypeScript and static homepage generation.
- `npx eslint src/app/page.tsx src/components/landing/GuestJourney.tsx`: passed.
- `git diff --check`: passed.
- `node scripts/test-home-ui.cjs`: all eight configurations passed against the production server at `http://127.0.0.1:3115`.
- Eight configurations: desktop 1440×900, laptop 1366×768, short laptop 1280×600, phone 390×844, compact phone 360×640, tablet 820×1180, landscape 844×390 and desktop reduced motion.
- Checks cover initial CTA visibility, menu/Escape/focus, all four direct controls, name continuity, QR placement in the printed invitation and in the phone, the scanner confirmation, gallery controls, loaded images, no horizontal overflow, no browser/hydration exceptions, no non-GET writes and no external browser requests. All headless contexts disable native pointer lock/capture.
- In every motion-enabled viewport, wheel input at timeline fractions 12.5%, 37.5%, 62.5% and 87.5% must reach states 0–3. The entire animated preview must stay within the viewport. This explicitly includes the two laptop windows excluded or constrained before.
- Axe WCAG A/AA checks: zero violations in all eight configurations. This is an automated check, not full accessibility certification.
- JavaScript-disabled phone: reading and ordinary links remain available; no form can submit personal input in a URL.
- Prior runtime checks remain applicable: actual pointer-state screenshots differ; leaving for `/login` destroys the Scrollcraft runtime and returning creates exactly one instance. Runtime mounting and engine source were not changed in this revision.

## Visual evidence and revisions

Screenshots and reports are outside Git under the session visualization folder. `phone-motion-release/` is the final set for the hand/phone and laptop correction; `phone-motion-review/` and `phone-motion-short/` preserve development findings. `wow-release/` records the previous supplied invitation/scanner revision. `home-release/` records the initial placeholder design.

Reviewed the actual printed invitation, its QR slot, invitation inside the phone, the enlarged QR during scan, final phone retreat, and all four wheel-driven sticky states on laptop and phone. Intended and observed overall curve: curiosity → clarity → confidence → possibility → readiness. The workflow adds recognition as the invitation enters the phone, then a scan-and-confirm peak. The same event-desk grammar and fingerprint remain; no extra page-wide scene was added.

Findings corrected during this revision: laptop viewport gate disabled scroll; tall controls could fight stage selection while a browser scrolled them into view; button navigation and scroll updates could compete; a reduced-motion diagnostic attribute differed between SSR and hydration. The diagnostic attribute was removed. Reduced-motion states retain all useful content.

Earlier design findings fixed in previous revisions: text contrast, landscape CTA position, translucent header, and precise invitation QR placement.

## Reproduce

Install `playwright-core` and `@axe-core/playwright` into a separate temporary directory and set `HOME_UI_DEPS` to it. Start `npm run start -- --hostname 127.0.0.1 --port 3115` after building, then run `node scripts/test-home-ui.cjs`. `HOME_UI_BASE` and `HOME_UI_OUTPUT` override server and screenshot folder. `HOME_UI_VIEWS=short-laptop` limits a diagnostic run; omit it for the full suite. `PLAYWRIGHT_CHANNEL=msedge` selects Edge instead of Chrome.

Limits: mobile runs use browser viewport emulation, not a physical iPhone/Android device. No video scrubbing is used, so the skill's video-decoder diagnostic does not apply to this laptop report. Supplied artwork and local demo states were tested. No real registration, mail sending, check-in, database operation or storage upload was performed.
