# ClipTrio Release Checklist

Use this checklist for `v1.0.0` and later PC Web releases. A release tag must point to a reviewed commit on `main`.

## 1. Release definition

- [ ] Confirm the release target and supported runtime.
- [ ] Confirm that `package.json` and the release notes use the same version.
- [ ] Confirm that README output semantics match the frontend and `/api/render`.
- [ ] Confirm that unfinished WASM or Mobile Web behavior is not presented as part of the stable release.
- [ ] Confirm that no generated videos, PNG files, upload data, temporary files, logs, or secrets are tracked.
- [ ] Confirm that `LICENSE` and `THIRD_PARTY_NOTICES.md` are included and match the release contents.

## 2. Automated verification

Run:

```powershell
npm run verify:release
```

- [ ] Syntax checks pass.
- [ ] All Node tests pass.
- [ ] The working tree contains no unexpected changes produced by the checks.

## 3. Native render smoke

Start the Docker renderer:

```powershell
docker compose up -d --build
```

Start the local proxy UI in a second terminal:

```powershell
$env:PORT='3001'
$env:RENDER_PROXY_URL='http://127.0.0.1:3000/api/render'
npm start
```

Run:

```powershell
npm run fixtures
npm run smoke:render
```

- [ ] Direct Docker render passes.
- [ ] Local proxy render passes.
- [ ] Both outputs are H.264/AAC, 1080 × 1920, 30fps, yuv420p, and 4 seconds.
- [ ] Section order, selected start times, and two-second looping pass.
- [ ] Review frames show top, middle, and bottom captions without gaps or misplaced sections.
- [ ] Generated artifacts remain under ignored `tmp/`.

## 4. Browser acceptance

Test the release commit in a Chromium browser at 1440 × 900 and 1280 × 720.

- [ ] No horizontal page overflow.
- [ ] The central 9:16 preview remains stable.
- [ ] The export action remains visible and reachable.
- [ ] Empty, partially loaded, ready, processing, success, and persistent error states are correct.
- [ ] Select, replace, reset, and reorder preserve the correct source timing and caption state.
- [ ] Preview play, pause, seek, and loop behavior match the selected segment.
- [ ] Switching MP4/PNG updates settings, facts, checks, status, and button text.
- [ ] MP4 export works for both resolutions and the supported frame rates.
- [ ] PNG export has exact selected dimensions and matches the current preview frame.
- [ ] An export failure preserves all selected files and settings.
- [ ] Retrying or dismissing an error behaves correctly.
- [ ] The browser console contains no new errors.

Use the deterministic fixtures for the encoded browser PNG check documented in `RENDER_SMOKE_TEST.md`.

## 5. Operations and documentation

- [ ] `README.md`, `CHANGELOG.md`, and `RENDER_SMOKE_TEST.md` reflect the release.
- [ ] Docker image builds from a clean checkout.
- [ ] The built image contains `/app/LICENSE`, `/app/THIRD_PARTY_NOTICES.md`, and Debian package copyright records.
- [ ] `/api/health` succeeds for direct and proxy development services.
- [ ] Known deployment limitations are included in the release notes.
- [ ] Public deployment has explicit access control, rate limits, and bounded render concurrency/queue behavior.
- [ ] Any published prebuilt image records its base-image digest, package versions, and corresponding-source plan.

## 6. Tag and publish

Create a release candidate first:

```powershell
git tag -a v1.0.0-rc.1 -m "ClipTrio v1.0.0 release candidate 1"
git push origin v1.0.0-rc.1
```

After release-candidate acceptance, create the final tag from the accepted `main` commit:

```powershell
git tag -a v1.0.0 -m "ClipTrio v1.0.0"
git push origin v1.0.0
```

- [ ] Tag points to the accepted `main` commit.
- [ ] GitHub Release uses the corresponding `CHANGELOG.md` entry.
- [ ] Final release URL and deployment health have been checked.
