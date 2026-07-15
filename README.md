# xerces-wasm playground

A tiny browser playground for [`xerces-wasm`](https://www.npmjs.com/package/xerces-wasm) —
paste an XSD schema and an XML document, hit validate, and see pass/fail with
line/column diagnostics. Everything runs client-side via WebAssembly; nothing
is uploaded anywhere.

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL, edit the XSD/XML, click **Validate**.

## Build

```bash
npm run build
npm run preview
```

## Test

```bash
npm test
```

This runs a JSDOM-based smoke test (`test/browser-smoke.mjs`) that exercises
the actual browser code path of `xerces-wasm` — including its relative
`fetch()` of the `.wasm` binary — rather than just asserting the build didn't
error.

## Notable gotchas fixed here (in case you're integrating `xerces-wasm` yourself)

- **`fs/promises` import**: `xerces-wasm`'s `dist/index.js` imports Node's
  `fs/promises` at the top level for its Node-only `validateFiles()` helper
  (unused here — we pass XSD/XML as strings, not paths). Bundlers can fail to
  resolve that in a browser build, so `vite.config.ts` aliases it to a tiny
  shim (`src/empty-shim.ts`).
- **Locating the `.wasm` binary**: the compiled Emscripten module resolves its
  `.wasm` file relative to `document.currentScript.src` when running in a
  browser — but `document.currentScript` is `null` for `<script type="module">`,
  so it falls back to resolving the path relative to the page itself. That
  means `xerces_validator.wasm` needs to be served at your site's root as a
  static asset — here that's `public/xerces_validator.wasm`, which Vite
  copies to `dist/` untouched.

## Links

- [xerces-wasm on npm](https://www.npmjs.com/package/xerces-wasm)
- [xerces-wasm-validator on GitHub](https://github.com/harshanacz/xerces-wasm-validator)
