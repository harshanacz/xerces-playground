import "./style.css";
import { EditorView } from "@codemirror/view";
import * as xercesWasm from "xerces-wasm";
import type { ProjectValidator, ValidationResult } from "xerces-wasm";
import { createXmlState, applyDiagnostics, toCmDiagnostics } from "./editor";
import {
  type XsdProject,
  createProject,
  getFilesRecord,
  addFile,
  importFile,
  removeFile,
  setEntry,
  setActive,
} from "./xsd-project";

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

const tabsEl = document.querySelector<HTMLDivElement>("#xsd-tabs")!;
const dropzoneEl = document.querySelector<HTMLDivElement>("#xsd-dropzone")!;
const fileInputEl = document.querySelector<HTMLInputElement>("#xsd-file-input")!;
const xsdHostEl = document.querySelector<HTMLDivElement>("#xsd-editor-host")!;
const xmlHostEl = document.querySelector<HTMLDivElement>("#xml-editor-host")!;
const xsdStatusEl = document.querySelector<HTMLDivElement>("#xsd-status")!;
const btnEl = document.querySelector<HTMLButtonElement>("#validate-btn")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const resultsEl = document.querySelector<HTMLDivElement>("#results")!;

const project: XsdProject = createProject("main.xsd", DEFAULT_XSD);

const xsdView = new EditorView({
  state: project.files.get(project.active)!,
  parent: xsdHostEl,
  dispatch(tr, view) {
    view.update([tr]);
    if (tr.docChanged) {
      project.files.set(project.active, view.state);
      scheduleValidation();
    }
  },
});

const xmlView = new EditorView({
  state: createXmlState(DEFAULT_XML),
  parent: xmlHostEl,
  dispatch(tr, view) {
    view.update([tr]);
    if (tr.docChanged) scheduleValidation();
  },
});

let validator: ProjectValidator | null = null;
let lastCompiledKey = "";
let debounceTimer: number | undefined;

function scheduleValidation(delay = 450) {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(runValidation, delay);
}

function setXsdStatus(text: string, kind: "info" | "warn" | "error" = "info") {
  xsdStatusEl.textContent = text;
  xsdStatusEl.classList.toggle("warn", kind === "warn");
  xsdStatusEl.classList.toggle("error", kind === "error");
}

// Validate is only ever clickable when there's an unambiguous entry file --
// with 2+ files and none chosen yet, there's nothing valid to compile.
function syncValidateButton() {
  btnEl.disabled = project.entry === null;
}

function switchActiveTab(name: string) {
  setActive(project, name);
  xsdView.setState(project.files.get(name)!);
  renderTabs();
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const name of project.files.keys()) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "xsd-tab" + (name === project.active ? " active" : "");

    const star = document.createElement("span");
    star.className = "entry-star" + (name === project.entry ? " is-entry" : "");
    star.title = name === project.entry ? "Entry file" : "Set as entry file";
    star.textContent = name === project.entry ? "★" : "☆";
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      setEntry(project, name);
      renderTabs();
      scheduleValidation(0);
    });

    const label = document.createElement("span");
    label.textContent = name;

    tab.append(star, label);

    if (project.files.size > 1) {
      const remove = document.createElement("span");
      remove.className = "remove-btn";
      remove.title = "Remove file";
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        const message = removeFile(project, name);
        if (project.active !== name) {
          // active didn't change; just refresh the tab list
        } else {
          xsdView.setState(project.files.get(project.active)!);
        }
        renderTabs();
        if (message) setXsdStatus(message, "info");
        scheduleValidation(0);
      });
      tab.append(remove);
    }

    tab.addEventListener("click", () => switchActiveTab(name));
    tabsEl.appendChild(tab);
  }

  const addTab = document.createElement("button");
  addTab.type = "button";
  addTab.className = "xsd-tab add-btn";
  addTab.textContent = "+ add file";
  addTab.addEventListener("click", () => {
    const name = window.prompt("New XSD filename (e.g. types.xsd):");
    if (!name) return;
    addFile(project, name);
    xsdView.setState(project.files.get(project.active)!);
    renderTabs();
    scheduleValidation(0);
  });
  tabsEl.appendChild(addTab);

  syncValidateButton();
  if (project.entry === null) {
    setXsdStatus("Multiple XSD files — choose an entry file (☆) before validating.", "warn");
  }
}

async function handleIncomingFiles(fileList: FileList) {
  const files = Array.from(fileList);
  const xsdFiles = files.filter((f) => f.name.toLowerCase().endsWith(".xsd"));
  const ignored = files.length - xsdFiles.length;

  for (const file of xsdFiles) {
    const text = await file.text();
    importFile(project, file.name, text);
  }

  if (xsdFiles.length > 0) {
    xsdView.setState(project.files.get(project.active)!);
    renderTabs();
    scheduleValidation(0);
  }

  // Don't stomp the "choose an entry file" prompt if it's now showing --
  // that's the more actionable message when both conditions occur at once.
  if (ignored > 0 && project.entry !== null) {
    setXsdStatus(`Ignored ${ignored} non-.xsd file${ignored === 1 ? "" : "s"}`, "info");
  }
}

dropzoneEl.addEventListener("click", () => fileInputEl.click());
dropzoneEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzoneEl.classList.add("dragover");
});
dropzoneEl.addEventListener("dragleave", () => {
  dropzoneEl.classList.remove("dragover");
});
dropzoneEl.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzoneEl.classList.remove("dragover");
  if (e.dataTransfer?.files.length) {
    handleIncomingFiles(e.dataTransfer.files);
  }
});
fileInputEl.addEventListener("change", () => {
  if (fileInputEl.files?.length) {
    handleIncomingFiles(fileInputEl.files);
  }
  fileInputEl.value = "";
});

function renderResult(result: ValidationResult) {
  const badge = result.valid
    ? `<span class="badge valid">VALID</span>`
    : `<span class="badge invalid">INVALID</span>`;

  const allDiagnostics = [...result.parseErrors, ...result.schemaErrors];

  const diagnosticsHtml = allDiagnostics.length
    ? allDiagnostics
        .map(
          (d) =>
            `<div class="diagnostic diagnostic-${d.severity}"><span class="loc">[${d.severity} ${d.line}:${d.column}]</span> ${escapeHtml(d.message)}</div>`
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
  if (project.entry === null) {
    // Ambiguous entry -- nothing valid to compile. Leave the "choose an
    // entry file" prompt (set by renderTabs) up rather than overwriting it.
    resultsEl.innerHTML = `<span class="placeholder">Select an entry file to validate.</span>`;
    applyDiagnostics(xmlView, []);
    syncValidateButton();
    return;
  }
  const entryName = project.entry;

  btnEl.disabled = true;
  statusEl.textContent = "compiling schema + validating…";

  const filesRecord = getFilesRecord(project);
  const key = JSON.stringify({ entry: entryName, filesRecord });

  try {
    if (key !== lastCompiledKey) {
      // reload() can't change which file is the entry, so always recreate --
      // the cache-key check above already keeps this from running needlessly.
      // Keep the old validator alive until the new one exists, so a failed
      // compile doesn't leave `validator` pointing at an already-destroyed
      // instance (which the catch block below would then double-destroy).
      const previous = validator;
      validator = await createProjectValidator({ entry: entryName, files: filesRecord });
      previous?.destroy();
      lastCompiledKey = key;
    }

    setXsdStatus("", "info");

    // Guaranteed non-null: either just created above, or left over from a
    // prior successful run (any failure resets lastCompiledKey, forcing the
    // `if` block above to run again before this line is reached).
    const result = await validator!.validate(xmlView.state.doc.toString());
    renderResult(result);
    applyDiagnostics(xmlView, toCmDiagnostics(xmlView.state.doc, [...result.parseErrors, ...result.schemaErrors]));
    statusEl.textContent = "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setXsdStatus(message, "error");
    resultsEl.innerHTML = `<div class="result-line"><span class="badge invalid">ERROR</span>${escapeHtml(message)}</div>`;
    applyDiagnostics(xmlView, []);
    statusEl.textContent = "";
    if (validator) {
      validator.destroy();
      validator = null;
    }
    lastCompiledKey = "";
  } finally {
    syncValidateButton();
  }
}

btnEl.addEventListener("click", () => {
  window.clearTimeout(debounceTimer);
  runValidation();
});

resultsEl.innerHTML = `<span class="placeholder">Results will appear here.</span>`;
renderTabs();

// Validate once on load so the page isn't empty on first paint.
runValidation();
