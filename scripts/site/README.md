# scripts/site — preview, shoot, record, diff

Verification tooling for the native-surface marketing site (`examples/site`,
base path `/native-surface/`). Chromium runs headless with SwiftShader so
CanvasKit / WebGL shaders paint.

Requires Node 20+, system `ffmpeg` (mp4 transcode), and either `/usr/bin/chromium`
or a Playwright Chromium in `~/.cache/ms-playwright`. Root devDependencies:
`playwright`, `pixelmatch`, `pngjs`.

`record-hero.mjs` also needs Playwright's bundled ffmpeg (webm muxer), once:

```bash
pnpm exec playwright install ffmpeg
```

Work artifacts default to the orchestrator dir
`/home/ryan/projects/wasm-playground-site/work` (`WORK_DIR` overrides).

## preview.sh

Build `examples/site` (flocked) and serve `dist` on `0.0.0.0:${PORT:-4870}`.

```bash
scripts/site/preview.sh
# → http://localhost:4870/native-surface/
```

| env | default | meaning |
|---|---|---|
| `PORT` | `4870` | vite preview `--strictPort` |
| `BASE` | `/native-surface/` | vite `--base` |
| `SKIP_BUILD` | unset | `1` to reuse existing dist |
| `HEAVY_LOCK` | orchestrator `.heavy.lock` | flock path |
| `SITE_FILTER` | `site` | pnpm filter |

If `examples/site/package.json` is missing the script exits 1 with a message.
That is expected until the site/shell lane lands. Preview itself is **not**
flocked (long-running server). Kill it when done.

## shoot.mjs

Full-page PNGs at 1440×900 and 390×844, plus `[data-section]` crops.

```bash
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  node scripts/site/shoot.mjs
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  node scripts/site/shoot.mjs http://localhost:4881/ /tmp/shots --dpr 2 --delay 2000
```

Waits for `document.fonts.ready`, then `window.__siteReady === true` (up to 8s,
capped by `--timeout`), then `--delay` (default 1500 ms). If the flag never
becomes true, falls back to `networkidle` then `--delay`.

**Contract:** the site sets `window.__siteReady = true` when live surfaces have
painted. Do not rely on the flag existing at `DOMContentLoaded`; shoot/record
wait for `=== true` rather than a one-shot `hasOwnProperty` check.

Writes `desktop-1440x900.png`, `mobile-390x844.png`, optional
`desktop-section-<name>.png`, and `manifest.json`.

## record-hero.mjs

Record the first ~6 s after load (Playwright `recordVideo` webm) and transcode
to H.264 yuv420p mp4.

```bash
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  node scripts/site/record-hero.mjs
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  node scripts/site/record-hero.mjs --url http://localhost:4881/ --out work/video/hero.mp4 --mobile
```

`--mobile` also writes `hero-mobile.mp4` at 390×844. `--seconds` defaults to 6.

## diff.mjs

Resize the screenshot to the design PNG's width, pad the shorter image, run
pixelmatch, write a diff PNG, print mismatch %.

```bash
node scripts/site/diff.mjs shot.png design-src/01.png work/shots/latest/diff.png
node scripts/site/diff.mjs a.png b.png --max-mismatch 1.5
```

Exit 0 unless `--max-mismatch` is set and exceeded.

## Temporary target (site package not built yet)

```bash
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  pnpm --filter embed-demo build
pnpm --filter embed-demo exec vite preview --host 0.0.0.0 --port 4881 --strictPort
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  node scripts/site/shoot.mjs http://localhost:4881/ \
  /home/ryan/projects/wasm-playground-site/work/shots/verify --dpr 2
flock /home/ryan/projects/wasm-playground-site/work/.heavy.lock \
  node scripts/site/record-hero.mjs --url http://localhost:4881/ \
  --out /home/ryan/projects/wasm-playground-site/work/video/hero.mp4 --seconds 6
node scripts/site/diff.mjs \
  /home/ryan/projects/wasm-playground-site/work/shots/verify/desktop-1440x900@2x.png \
  /home/ryan/projects/wasm-playground-site/design-src/02.png \
  /home/ryan/projects/wasm-playground-site/work/shots/verify/diff-vs-02.png
```

Pick preview ports in **4880–4899** for ad-hoc servers; 4870 is reserved for
the real site preview.

## Chromium

Launch args include `--use-angle=swiftshader` and `--enable-unsafe-swiftshader`.
`--no-sandbox` is on unless `CHROMIUM_NO_SANDBOX=0`. Override the binary with
`CHROMIUM_PATH`.
