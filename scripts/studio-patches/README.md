# EventPlay source changes

The upstream project lives at `D:/Game Mới` and is not a Git repository.
`handslice-pointer.patch` preserves this feature's source changes alongside the
deployed bundle. It adds Camera / Mouse / Touch selection, pointer blades and
camera-free results for pointer play. It has already been applied locally.

`game-sharing.patch` preserves the project share button, play/edit recipient
screens, selected-project snapshot collection, isolated shared-session storage,
and media upload preparation. It also enables CORS when Jigsaw draws a
Supabase-hosted uploaded picture into puzzle-piece canvases. It has already been
applied locally, after `handslice-pointer.patch`.

`decodeletters-long-text.patch` removes two-line truncation from the Decode
Letters question and answers. Its viewport-sized dock scrolls long content while
keeping Confirm outside the scroll area; short screens can scroll the board.
It has already been applied locally. Regression:
`node scripts/test-decodeletters-text.cjs` (guest-only, no database writes).

`decodeletters-ui.patch` follows the long-text patch. It keeps the secret picture
reachable on phones, enlarges question/answer and touch controls, replaces the
sidebar tips with a compact help menu, and guides players to their next action.
Decode Letters has Vietnamese tutorial/chrome/results without changing the
workspace language. Its result card displays the full reveal image (or the
configured final image when no reveal image exists), with an explicit no-image
completion state. Other games retain their result screens. Already applied
locally. The same regression also completes all four unlocks, checks the result
image and replay reset at desktop, phone and landscape sizes.

To apply it to a copy of the upstream source from before this feature, run from
that source directory:

```powershell
git apply --check "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/handslice-pointer.patch"
git apply "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/handslice-pointer.patch"
git apply --check "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/game-sharing.patch"
git apply "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/game-sharing.patch"
git apply --check "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/decodeletters-long-text.patch"
git apply "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/decodeletters-long-text.patch"
git apply --check "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/decodeletters-ui.patch"
git apply "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/decodeletters-ui.patch"
```

To rebuild the web portal, run in the upstream directory:

```powershell
$env:VITE_BASE = './'
npm run build
Remove-Item Env:VITE_BASE
```

Then run from `form-cme` (the importer copies and optimizes assets):

```powershell
node scripts/import-studio.cjs "D:/Game Mới/dist"
node scripts/test-handslice-input.cjs
node scripts/test-game-sharing.cjs
```

The browser regression requires a running portal at `http://localhost:3001` and
the upstream Playwright install. `GAME_E2E_BASE` can target a deployed portal;
`EVENTPLAY_SOURCE` can point to a different upstream directory. Fixtures use
guest browser storage, with no Supabase writes. Mouse drag/release, pause,
restart, two-finger touch, camera selection and camera-free wins are checked.

The sharing regression uses the portal's real Supabase APIs. It creates two
confirmed throwaway accounts without sending email, then cleans up those
accounts, shares and uploaded media. It checks owner access, anonymous play/edit,
separate capabilities, snapshot privacy, account-storage isolation, upload,
concurrent revisions, conflict recovery, revocation, phone-sized share controls
and a Jigsaw game using a Supabase-hosted picture. Apply
`supabase/game-shares.sql` before running it.

After source changes also run `build-exe.bat` from the upstream directory,
as required by its `AGENTS.md`.
