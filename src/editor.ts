import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { xml } from "@codemirror/lang-xml";
import { linter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Diagnostic as WasmDiagnostic } from "xerces-wasm";

// Matches the dark palette in style.css so CodeMirror doesn't look like a
// foreign component dropped onto the page.
const theme = EditorView.theme(
  {
    "&": {
      color: "var(--text)",
      backgroundColor: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      fontSize: "0.8rem",
    },
    "&.cm-focused": { outline: "none", borderColor: "var(--accent)" },
    ".cm-content": { fontFamily: "inherit", caretColor: "var(--text)" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5" },
    ".cm-gutters": {
      backgroundColor: "var(--panel)",
      color: "var(--muted)",
      border: "none",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(91, 140, 255, 0.25)",
    },
  },
  { dark: true }
);

const sharedExtensions: Extension[] = [
  lineNumbers(),
  history(),
  highlightActiveLine(),
  bracketMatching(),
  indentOnInput(),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  xml(),
  theme,
  EditorView.lineWrapping,
];

export function createXsdState(content: string): EditorState {
  return EditorState.create({ doc: content, extensions: sharedExtensions });
}

// A no-op source: diagnostics are pushed externally via applyDiagnostics()
// whenever our own validation pipeline finishes, not computed by CodeMirror's
// own re-lint scheduler. Installing linter() is still required -- it's what
// registers the state field + squiggly-underline rendering + hover tooltips
// that setDiagnostics() then drives. Passing `null` as the source (rather
// than a no-op function) is deliberate: with a real source function, the
// plugin's own auto-lint timer (750ms after every doc change) would call it
// and dispatch its (empty) result, silently wiping out the diagnostics we
// pushed manually a moment earlier. A `null` source is filtered out of the
// plugin's source list entirely, so that timer becomes a no-op.
export function createXmlState(content: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [...sharedExtensions, linter(null)],
  });
}

export function applyDiagnostics(view: EditorView, diagnostics: CmDiagnostic[]): void {
  view.dispatch(setDiagnostics(view.state, diagnostics));
}

// xerces-wasm gives 1-based line/column relative to the validated XML string;
// CodeMirror wants absolute character offsets. Clamp defensively since the
// user may keep typing after a validate() call resolves, making an older
// diagnostic's position point past the now-current document.
export function toCmDiagnostics(doc: Text, diagnostics: readonly WasmDiagnostic[]): CmDiagnostic[] {
  return diagnostics.map((d) => {
    const lineNum = Math.min(Math.max(1, d.line), doc.lines);
    const line = doc.line(lineNum);
    let from = Math.min(line.from + Math.max(0, d.column - 1), line.to);
    const to = Math.min(from + 1, doc.length);
    // A diagnostic pointing at end-of-line (e.g. "missing required
    // attribute", reported right after the offending tag) clamps to a
    // zero-width range, which CodeMirror renders as an invisible point
    // marker rather than a squiggly underline. Pull `from` back one
    // character so there's always something visible to underline.
    if (to === from && from > line.from) from -= 1;
    return {
      from,
      to,
      severity: d.severity === "warning" ? "warning" : "error",
      message: d.message,
    };
  });
}
