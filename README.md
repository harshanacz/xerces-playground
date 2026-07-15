# xerces-wasm playground

A tiny browser playground for [`xerces-wasm`](https://www.npmjs.com/package/xerces-wasm) —
build a multi-file XSD schema project (paste, add tabs, or drag-and-drop
`.xsd` files) and an XML document, then validate with pass/fail and
line/column diagnostics that update in real time as you type, with squiggly
underlines on the XML document. Everything runs client-side via WebAssembly;
nothing is uploaded anywhere.

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

This runs two suites, both against the real `xerces-wasm` npm package (no
mocks, no extra test dependencies — just Node's built-in `node:test` runner):

**`test/package.test.mjs`** — 13 input→output test cases that feed XSD + XML
into the package and assert on the `ValidationResult`, mirroring what the
playground UI does minus the DOM:

- *Single-file schema (the playground's default flow)*: valid XML returns
  `valid: true` with no diagnostics; a missing required attribute, an
  undeclared root element, malformed XML, and empty input each return
  `valid: false` with the right kind of error (`schemaErrors` vs. fatal
  `parseErrors`); diagnostics carry usable `message`/`line`/`column`/`severity`;
  and one validator instance handles many documents in a row (the cache-reuse
  pattern in `src/main.ts`).
- *Multi-file schema project*: a type defined in a second file and pulled in
  via `xs:include` resolves correctly, and its range/integer facets are
  enforced with specific error messages.
- *Validator lifecycle*: `reload()` genuinely swaps the schema (the old root
  element stops validating), and an uncompilable XSD rejects at creation with
  "failed to compile schema" (what triggers the ERROR badge in the UI).
- *Top-level `validate()`*: the one-shot `validate(xml, xsd)` API works
  without creating a validator instance.

These run in plain Node — Emscripten falls back to loading the `.wasm` from
disk when there's no browser, so no DOM scaffolding is needed.

**`test/browser-smoke.mjs`** — a JSDOM-based smoke test that exercises the
actual browser code path of `xerces-wasm`, including its relative `fetch()`
of the `.wasm` binary, rather than just asserting the build didn't error.

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
