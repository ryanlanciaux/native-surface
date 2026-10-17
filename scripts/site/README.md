# scripts/site — preview, shoot, record, diff, copy check

## check-emdash.mjs (build gate)

Copy rule: no em dash (U+2014) in user-visible text. The script parses
TS/TSX/JS with the TypeScript compiler API and flags U+2014 in string
literals, template literals and JSX text (comments are ignored). It also scans
`examples/site/*.html` raw, minus `<!-- -->` comments.

Scanned: `examples/site/src`, `examples/site/*.html`,
`examples/ignite-app/{app,src}`, `packages/playground/src`.

```bash
node scripts/site/check-emdash.mjs        # exit 1 on hits
node scripts/site/check-emdash.mjs --all  # same, ignoring the allowlist
```

It fails the build: `examples/site/vite.config.ts` registers a `site:check-emdash`
plugin (`apply: 'build'`) whose `buildStart` calls `checkEmdash()` and
`this.error`s on hits, so `pnpm --filter site build` and the Pages workflow's
`vite build` both stop. Dev server is unaffected.

`emdash-allowlist.json` (`{ "paths": [...] }`, repo-relative files or dir
prefixes) skips files owned by lanes that have not done their copy pass yet.
It should be empty once they have. Fix a hit by rewriting the sentence with a
comma, period or colon, never an en dash or hyphen.

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

Work artifacts default to `work/` at the repo root (git-excluded). `WORK_DIR`
overrides it (e.g. from a git worktree, point it at the shared work dir), and
`HEAVY_LOCK` overrides the lock file (default `$WORK_DIR/.heavy.lock`).

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
| `HEAVY_LOCK` | `$WORK_DIR/.heavy.lock` (`work/` at the repo root) | flock path |
| `SITE_FILTER` | `site` | pnpm filter |

If `examples/site/package.json` is missing the script exits 1 with a message.
That is expected until the site/shell lane lands. Preview itself is **not**
flocked (long-running server). Kill it when done.

## shoot.mjs

Full-page PNGs at 1440×900 and 390×844, plus `[data-section]` crops.

```bash
flock work/.heavy.lock \
  node scripts/site/shoot.mjs
flock work/.heavy.lock \
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
flock work/.heavy.lock \
  node scripts/site/record-hero.mjs
flock work/.heavy.lock \
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
flock work/.heavy.lock \
  pnpm --filter embed-demo build
pnpm --filter embed-demo exec vite preview --host 0.0.0.0 --port 4881 --strictPort
flock work/.heavy.lock \
  node scripts/site/shoot.mjs http://localhost:4881/ \
  work/shots/verify --dpr 2
flock work/.heavy.lock \
  node scripts/site/record-hero.mjs --url http://localhost:4881/ \
  --out work/video/hero.mp4 --seconds 6
node scripts/site/diff.mjs \
  work/shots/verify/desktop-1440x900@2x.png \
  design-src/02.png \
  work/shots/verify/diff-vs-02.png
```

Pick preview ports in **4880–4899** for ad-hoc servers; 4870 is reserved for
the real site preview.

## Chromium

Launch args include `--use-angle=swiftshader` and `--enable-unsafe-swiftshader`.
`--no-sandbox` is on unless `CHROMIUM_NO_SANDBOX=0`. Override the binary with
`CHROMIUM_PATH`.
