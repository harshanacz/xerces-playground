import { EditorState } from "@codemirror/state";
import { createXsdState } from "./editor";

export interface XsdProject {
  files: Map<string, EditorState>;
  // null means ambiguous -- more than one file exists and the user hasn't
  // said which one is the schema root yet. Validation stays disabled until
  // it's set. A single-file project never needs this: there's only one
  // possible entry, so it's picked automatically.
  entry: string | null;
  active: string;
}

export function createProject(entryName: string, content: string): XsdProject {
  return {
    files: new Map([[entryName, createXsdState(content)]]),
    entry: entryName,
    active: entryName,
  };
}

export function getFilesRecord(project: XsdProject): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, state] of project.files) {
    record[name] = state.doc.toString();
  }
  return record;
}

// Adding a second file makes the entry ambiguous (a fresh empty file is
// never a sensible root), so clear it and force an explicit choice. Adding
// a third, fourth, etc. file on top of an already-confirmed entry leaves it
// alone -- only the 1-to-many transition needs re-confirming.
function clearEntryIfNowAmbiguous(project: XsdProject, sizeBefore: number): void {
  if (sizeBefore === 1 && project.files.size > 1) {
    project.entry = null;
  }
}

// Adds an empty new file (or switches to it if the name is already taken)
// and makes it active. Returns the resulting filename.
export function addFile(project: XsdProject, name: string): string {
  const sizeBefore = project.files.size;
  if (!project.files.has(name)) {
    project.files.set(name, createXsdState(""));
  }
  clearEntryIfNowAmbiguous(project, sizeBefore);
  project.active = name;
  return name;
}

// Adds or overwrites a file with the given content (used for drag-and-drop /
// file-picker imports) and makes it active.
export function importFile(project: XsdProject, name: string, content: string): void {
  const sizeBefore = project.files.size;
  project.files.set(name, createXsdState(content));
  clearEntryIfNowAmbiguous(project, sizeBefore);
  project.active = name;
}

// Removes a file. If exactly one file remains, it becomes entry automatically
// (no longer ambiguous). Otherwise, if the removed file was the entry,
// promotes the first remaining file to entry. If it was active, switches
// active to the (possibly new) entry. Returns a status message describing
// any entry reassignment, or null.
export function removeFile(project: XsdProject, name: string): string | null {
  if (project.files.size <= 1) return null;
  project.files.delete(name);

  let message: string | null = null;
  if (project.files.size === 1) {
    const only = project.files.keys().next().value as string;
    if (project.entry !== only) {
      project.entry = only;
      message = `Entry file set to ${only}`;
    }
  } else if (project.entry === name) {
    const next = project.files.keys().next().value as string;
    project.entry = next;
    message = `Entry file changed to ${next}`;
  }
  if (project.active === name) {
    project.active = project.entry ?? (project.files.keys().next().value as string);
  }
  return message;
}

export function setEntry(project: XsdProject, name: string): void {
  if (project.files.has(name)) {
    project.entry = name;
  }
}

export function setActive(project: XsdProject, name: string): void {
  if (project.files.has(name)) {
    project.active = name;
  }
}
