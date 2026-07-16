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
  replaceFiles,
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
const xsdDropzoneEl = document.querySelector<HTMLDivElement>("#xsd-dropzone")!;
const xsdFileInputEl = document.querySelector<HTMLInputElement>("#xsd-file-input")!;
const xsdHostEl = document.querySelector<HTMLDivElement>("#xsd-editor-host")!;
const xmlHostEl = document.querySelector<HTMLDivElement>("#xml-editor-host")!;
const xsdStatusEl = document.querySelector<HTMLDivElement>("#xsd-status")!;
const xmlDropzoneEl = document.querySelector<HTMLDivElement>("#xml-dropzone")!;
const xmlFileInputEl = document.querySelector<HTMLInputElement>("#xml-file-input")!;
const xmlStatusEl = document.querySelector<HTMLDivElement>("#xml-status")!;
const xmlFileChipEl = document.querySelector<HTMLSpanElement>("#xml-file-chip")!;
const btnEl = document.querySelector<HTMLButtonElement>("#validate-btn")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const resultsEl = document.querySelector<HTMLDivElement>("#results")!;
const dockEl = document.querySelector<HTMLDivElement>(".bottom-dock")!;
const dockToggleEl = document.querySelector<HTMLButtonElement>("#dock-toggle")!;
const dockSummaryEl = document.querySelector<HTMLSpanElement>("#dock-summary")!;

dockToggleEl.addEventListener("click", () => {
  const minimized = dockEl.classList.toggle("minimized");
  dockToggleEl.setAttribute("aria-expanded", String(!minimized));
});

// VSCode-style problems summary — stays visible even when the dock is
// minimized, so error counts are never hidden.
function updateDockSummary(errors: number, warnings: number) {
  dockEl.classList.toggle("has-errors", errors > 0);
  if (errors === 0 && warnings === 0) {
    dockSummaryEl.innerHTML = `<span class="summary-ok">✓ no problems</span>`;
    return;
  }
  let html = "";
  if (errors > 0) html += `<span class="summary-err">✕ ${errors}</span>`;
  if (warnings > 0) html += `<span class="summary-warn">⚠ ${warnings}</span>`;
  dockSummaryEl.innerHTML = html;
}

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

  if (project.entry) {
    const entryLabel = document.createElement("span");
    entryLabel.className = "entry-label";
    entryLabel.textContent = `ENTRY FILE: ${project.entry}`;
    tabsEl.appendChild(entryLabel);
  }

  syncValidateButton();
  if (project.entry === null) {
    setXsdStatus("Multiple XSD files — click ☆ on one to set it as the entry file before validating.", "warn");
  }
}

async function handleIncomingFiles(fileList: FileList) {
  const files = Array.from(fileList);
  const xsdFiles = files.filter((f) => f.name.toLowerCase().endsWith(".xsd"));
  const ignored = files.length - xsdFiles.length;

  if (xsdFiles.length > 0) {
    const contents = await Promise.all(xsdFiles.map((f) => f.text()));

    const currentCount = project.files.size;
    const addAlongside = window.confirm(
      `Add ${xsdFiles.length} file${xsdFiles.length === 1 ? "" : "s"} to the project?\n\n` +
        `OK — keep the current ${currentCount} file${currentCount === 1 ? "" : "s"} and add ${xsdFiles.length === 1 ? "this one" : "these"} alongside them\n` +
        `Cancel — replace the current file${currentCount === 1 ? "" : "s"} with ${xsdFiles.length === 1 ? "this one" : "these"} instead`
    );

    if (addAlongside) {
      for (let i = 0; i < xsdFiles.length; i++) {
        importFile(project, xsdFiles[i].name, contents[i]);
      }
    } else {
      replaceFiles(
        project,
        xsdFiles.map((f, i) => [f.name, contents[i]] as [string, string])
      );
    }

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

xsdDropzoneEl.addEventListener("click", () => xsdFileInputEl.click());
xsdDropzoneEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  xsdDropzoneEl.classList.add("dragover");
});
xsdDropzoneEl.addEventListener("dragleave", () => {
  xsdDropzoneEl.classList.remove("dragover");
});
xsdDropzoneEl.addEventListener("drop", (e) => {
  e.preventDefault();
  xsdDropzoneEl.classList.remove("dragover");
  if (e.dataTransfer?.files.length) {
    handleIncomingFiles(e.dataTransfer.files);
  }
});
xsdFileInputEl.addEventListener("change", () => {
  if (xsdFileInputEl.files?.length) {
    handleIncomingFiles(xsdFileInputEl.files);
  }
  xsdFileInputEl.value = "";
});

// XML is a single document, not a multi-file project -- dropping a file just
// replaces its content directly, no merge-vs-replace choice to make.
async function handleIncomingXmlFile(fileList: FileList) {
  const files = Array.from(fileList);
  const xmlFile = files.find((f) => f.name.toLowerCase().endsWith(".xml"));
  const ignored = xmlFile ? files.length - 1 : files.length;

  if (xmlFile) {
    const text = await xmlFile.text();
    xmlView.setState(createXmlState(text));
    xmlFileChipEl.textContent = xmlFile.name;
    xmlStatusEl.textContent = "";
    xmlStatusEl.classList.remove("error");
    scheduleValidation(0);
  }

  if (ignored > 0) {
    xmlStatusEl.textContent = xmlFile
      ? `Ignored ${ignored} extra file${ignored === 1 ? "" : "s"} — only one .xml document is validated at a time`
      : "Only .xml files are supported here";
  }
}

xmlDropzoneEl.addEventListener("click", () => xmlFileInputEl.click());
xmlDropzoneEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  xmlDropzoneEl.classList.add("dragover");
});
xmlDropzoneEl.addEventListener("dragleave", () => {
  xmlDropzoneEl.classList.remove("dragover");
});
xmlDropzoneEl.addEventListener("drop", (e) => {
  e.preventDefault();
  xmlDropzoneEl.classList.remove("dragover");
  if (e.dataTransfer?.files.length) {
    handleIncomingXmlFile(e.dataTransfer.files);
  }
});
xmlFileInputEl.addEventListener("change", () => {
  if (xmlFileInputEl.files?.length) {
    handleIncomingXmlFile(xmlFileInputEl.files);
  }
  xmlFileInputEl.value = "";
});

function renderResult(result: ValidationResult) {
  const badge = result.valid
    ? `<span class="badge valid">VALID</span>`
    : `<span class="badge invalid">INVALID</span>`;

  const allDiagnostics = [...result.parseErrors, ...result.schemaErrors];

  const warnCount = allDiagnostics.filter((d) => d.severity === "warning").length;
  updateDockSummary(allDiagnostics.length - warnCount, warnCount);

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
    resultsEl.innerHTML = `<span class="placeholder">Click ☆ on an XSD file to set it as the entry file, then validation will run.</span>`;
    dockSummaryEl.innerHTML = "";
    dockEl.classList.remove("has-errors");
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
    updateDockSummary(1, 0);
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
