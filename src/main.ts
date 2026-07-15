import "./style.css";
import * as xercesWasm from "xerces-wasm";
import type { ProjectValidator, ValidationResult } from "xerces-wasm";

const { createProjectValidator } = xercesWasm;

const DEFAULT_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="log">
    <xs:complexType>
      <xs:attribute name="level" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

const DEFAULT_XML = `<log level="full"/>\n`;

const xsdEl = document.querySelector<HTMLTextAreaElement>("#xsd")!;
const xmlEl = document.querySelector<HTMLTextAreaElement>("#xml")!;
const btnEl = document.querySelector<HTMLButtonElement>("#validate-btn")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const resultsEl = document.querySelector<HTMLDivElement>("#results")!;

xsdEl.value = DEFAULT_XSD;
xmlEl.value = DEFAULT_XML;
resultsEl.innerHTML = `<span class="placeholder">Results will appear here.</span>`;

// Cache the compiled grammar pool per XSD text so we don't recompile on
// every keystroke — only when the schema itself actually changes.
let cachedValidator: ProjectValidator | null = null;
let cachedXsdText = "";

async function getValidator(xsdText: string): Promise<ProjectValidator> {
  if (cachedValidator && cachedXsdText === xsdText) {
    return cachedValidator;
  }
  if (cachedValidator) {
    cachedValidator.destroy();
    cachedValidator = null;
  }
  cachedValidator = await createProjectValidator({
    entry: "main.xsd",
    files: { "main.xsd": xsdText },
  });
  cachedXsdText = xsdText;
  return cachedValidator;
}

function renderResult(result: ValidationResult) {
  const badge = result.valid
    ? `<span class="badge valid">VALID</span>`
    : `<span class="badge invalid">INVALID</span>`;

  const allDiagnostics = [...result.parseErrors, ...result.schemaErrors];

  const diagnosticsHtml = allDiagnostics.length
    ? allDiagnostics
        .map(
          (d) =>
            `<div class="diagnostic"><span class="loc">[${d.severity} ${d.line}:${d.column}]</span> ${escapeHtml(d.message)}</div>`
        )
        .join("")
    : "";

  resultsEl.innerHTML = `<div class="result-line">${badge}${diagnosticsHtml}</div>`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function runValidation() {
  btnEl.disabled = true;
  statusEl.textContent = "compiling schema + validating…";
  try {
    const validator = await getValidator(xsdEl.value);
    const result = await validator.validate(xmlEl.value);
    renderResult(result);
    statusEl.textContent = "";
  } catch (err) {
    resultsEl.innerHTML = `<div class="result-line"><span class="badge invalid">ERROR</span>${escapeHtml(
      err instanceof Error ? err.message : String(err)
    )}</div>`;
    statusEl.textContent = "";
    // A schema compile failure invalidates the cache so the next attempt
    // recompiles instead of reusing a broken validator.
    cachedValidator = null;
    cachedXsdText = "";
  } finally {
    btnEl.disabled = false;
  }
}

btnEl.addEventListener("click", runValidation);

// Validate once on load so the page isn't empty on first paint.
runValidation();
