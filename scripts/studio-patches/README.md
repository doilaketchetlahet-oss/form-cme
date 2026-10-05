# EventPlay source changes

The upstream project lives at `D:/Game Mới` and is not a Git repository.
`handslice-pointer.patch` preserves this feature's source changes alongside the
deployed bundle. It adds Camera / Mouse / Touch selection, pointer blades and
camera-free results for pointer play. It has already been applied locally.

To apply it to a copy of the upstream source from before this feature, run from
that source directory:

```powershell
git apply --check "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/handslice-pointer.patch"
git apply "D:/Game Quiz Quét Mã/form-cme/scripts/studio-patches/handslice-pointer.patch"
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
```

The browser regression requires a running portal at `http://localhost:3001` and
the upstream Playwright install. `GAME_E2E_BASE` can target a deployed portal;
`EVENTPLAY_SOURCE` can point to a different upstream directory. Fixtures use
guest browser storage, with no Supabase writes. Mouse drag/release, pause,
restart, two-finger touch, camera selection and camera-free wins are checked.

After source changes also run `build-exe.bat` from the upstream directory,
as required by its `AGENTS.md`.
