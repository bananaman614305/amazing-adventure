# Deploying the playable preview

The game is a static site with no build step at runtime and no network calls: every
dependency is vendored. A preview is therefore a plain upload of one directory.

## What is deployable

`dist/` is committed to this repository. It is **not** hand-edited — it is produced by:

```sh
node scripts/build-preview.mjs
```

and `tests/preview.test.mjs` fails if the committed copy ever drifts from the sources it
was built from (compare `sourceDigest` in `dist/preview.json`).

Everything else in the repo — `tests/`, `scripts/`, `node_modules/`, `artifacts/`,
`package.json` — is deliberately excluded from `dist/`. Only the 27 files the game
needs are published.

## Settings for Cloudflare Pages

| Setting | Value |
| --- | --- |
| Framework preset | *None* |
| Build command | *(leave empty — `dist/` is already committed)* |
| Build output directory | `dist` |
| Root directory | *(repo root)* |

If you would rather have Pages run the build, use build command
`node scripts/build-preview.mjs` with the same output directory; it is deterministic and
needs no dependencies installed.

## Startup file

`index.html` — it loads `./src/main.js` as an ES module. No client-side routing, no
rewrite rules required beyond the `/index.html` fallback already in `dist/_redirects`.

## Verifying a deployment before trusting it

```sh
# 1. From the repo, serve exactly the deployed directory:
SERVE_DIR=dist PORT=8000 node server.mjs

# 2. Or verify a real host: every request must be same-origin, and the JS must be
#    served as a JavaScript MIME type or module loading fails.
curl -sI https://<preview>.pages.dev/            # expect 200, text/html
curl -sI https://<preview>.pages.dev/src/main.js # expect 200, ...javascript...
```

## Requirements the preview must satisfy

- **HTTPS** — `localStorage`, Web Audio and pointer lock all need a secure context
  (Loopback addresses are also treated as secure during local development).
- **JavaScript MIME type** on `.js` responses — otherwise `import` fails and the page
  stays blank with a console error.
- **No COOP/COEP headers needed** — the game does not use `SharedArrayBuffer` or
  workers.

## Testing the deployed artefact, not just the sources

The mobile and desktop suites accept `SERVE_DIR` so they can be run against these exact
bytes:

```sh
SERVE_DIR=dist npm run test:mobile     # 4 device profiles
SERVE_DIR=dist npm run test:browser    # desktop checks
```
