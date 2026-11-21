# Publishing the playable preview (GitHub Pages)

Amazing Adventure is a static site: no build step at runtime, no network calls, every
dependency vendored. Publishing is a plain upload of one directory.

Target URL: **https://bananaman614305.github.io/amazing-adventure/**

## What gets published

`dist/` is committed to this repository. It is **not** hand-edited — it is produced by:

```sh
node scripts/build-preview.mjs
```

It contains exactly the files `src/manifest.js` declares (27 of them), plus two
metadata files:

| File | Why it exists |
| --- | --- |
| `.nojekyll` | GitHub Pages runs Jekyll by default, which drops underscore-prefixed paths and can rewrite content. This opts out so every byte is served verbatim. |
| `preview.json` | Version, entry point, file list and a SHA-256 of the game contents, so a deployment can be tied to exact bytes. |

Nothing else is published. `tests/`, `scripts/`, `node_modules/`, `artifacts/` and
`package.json` are deliberately excluded.

`tests/preview.test.mjs` rebuilds from the current sources and **fails if the committed
`dist/` no longer matches** the `sourceDigest` recorded in `dist/preview.json`.

## Pages-safe root layout

A Pages *project* site is served under a subpath (`/<repo>/`), not at the domain root,
so `dist/` is uploaded as the site root:

```
dist/                    ->  https://bananaman614305.github.io/amazing-adventure/
├── .nojekyll
├── index.html           <- startup file
├── preview.json
├── src/                 <- 24 ES modules, loaded relatively
└── vendor/              <- Three.js, vendored
```

`index.html` loads `./src/main.js` as an ES module. There is no client-side routing, so
no rewrite rules are needed. Every reference is **relative** — verified by a test, since
one root-absolute path would 404 on a project site.

## Publishing

Either of these works; both end with `dist/` as the served root.

**Option A — publish the committed directory (no build on the host).**

```sh
# From a clean checkout of the reviewed commit:
npm ci                            # only needed if you also want to run tests
node scripts/build-preview.mjs    # regenerates dist/; a no-op if already current
git subtree push --prefix dist origin gh-pages
```

Or copy `dist/` to a `gh-pages` branch by any means you prefer. The bytes are what
matter, not the method.

**Option B — let Pages build it.** Settings → Pages → *Deploy from a branch*, branch
`gh-pages`, folder `/ (root)`. If you'd rather have the build run on the host, use build
command `node scripts/build-preview.mjs` with output directory `dist`; it is
deterministic and installs nothing.

Then confirm the URL in **Settings → Pages** reads
`https://bananaman614305.github.io/amazing-adventure/`.

## Verifying a deployment before trusting it

The suites can be pointed at the exact bytes that get uploaded, served under the same
subpath Pages uses:

```sh
SERVE_DIR=dist BASE_PATH=/amazing-adventure/ npm run test:mobile   # 4 device profiles
SERVE_DIR=dist BASE_PATH=/amazing-adventure/ npm run test:browser  # desktop checks
```

Or serve it by hand and look:

```sh
SERVE_DIR=dist BASE_PATH=/amazing-adventure/ PORT=8000 node server.mjs
# http://127.0.0.1:8000/amazing-adventure/
```

Against the live host, the two things that break a static site are a wrong MIME type
and a cross-origin reference:

```sh
curl -sI https://bananaman614305.github.io/amazing-adventure/            # 200, text/html
curl -sI https://bananaman614305.github.io/amazing-adventure/src/main.js # 200, ...javascript...
```

## Requirements the published site must satisfy

- **HTTPS** — already true on Pages. `localStorage`, Web Audio and pointer lock all
  need a secure context (loopback is also treated as secure for local testing).
- **JavaScript MIME type** on `.js` responses — GitHub Pages sends this correctly.
  If it were wrong, `import` would fail and the page would stay blank with a console
  error.
- **No COOP/COEP headers needed** — the game uses no `SharedArrayBuffer` and no workers.
