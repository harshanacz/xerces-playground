// Exercises the real browser code path of xerces-wasm: JSDOM gives us a real
// `document`/`window` and same-document relative URL resolution, so this
// proves the package actually fetches its .wasm binary and validates
// correctly the way a real page would -- not just that the build succeeds.
import { JSDOM } from "jsdom";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

// Serve public/ (where xerces_validator.wasm lives) on a local port so the
// package's relative fetch("xerces_validator.wasm") has something real to hit.
const server = createServer(async (req, res) => {
  try {
    const filePath = path.join(publicDir, decodeURIComponent(req.url ?? "/"));
    const data = await readFile(filePath);
    const contentType = filePath.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/`;

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
  url: baseUrl,
  runScripts: "outside-only",
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.XMLHttpRequest = dom.window.XMLHttpRequest;
// Node's native fetch doesn't resolve relative URLs against a document base
// the way browsers do -- patch it here to match real browser behavior.
const realFetch = fetch;
globalThis.fetch = (url, opts) => {
  const resolved = new URL(url, dom.window.document.baseURI).href;
  return realFetch(resolved, opts);
};

let failed = false;
try {
  const { createProjectValidator } = await import("xerces-wasm");

  const xsd = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="log">
    <xs:complexType>
      <xs:attribute name="level" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  const v = await createProjectValidator({ entry: "main.xsd", files: { "main.xsd": xsd } });

  const r1 = await v.validate(`<log level="full"/>`);
  console.log("valid XML       -> valid:", r1.valid);
  if (r1.valid !== true) failed = true;

  const r2 = await v.validate(`<log/>`);
  console.log("missing attr    -> valid:", r2.valid, JSON.stringify(r2.schemaErrors));
  if (r2.valid !== false || r2.schemaErrors.length === 0) failed = true;

  v.destroy();
} catch (err) {
  console.error("Smoke test threw:", err);
  failed = true;
} finally {
  server.close();
}

if (failed) {
  console.error("BROWSER SMOKE TEST FAILED");
  process.exit(1);
}
console.log("BROWSER SMOKE TEST PASSED");
