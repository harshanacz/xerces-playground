import { EditorState } from "@codemirror/state";
import { createXsdState } from "./editor";

export interface XsdProject {
  files: Map<string, EditorState>;
  entry: string;
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

// Adds an empty new file (or switches to it if the name is already taken)
// and makes it active. Returns the resulting filename.
export function addFile(project: XsdProject, name: string): string {
  if (!project.files.has(name)) {
    project.files.set(name, createXsdState(""));
  }
  project.active = name;
  return name;
}

// Adds or overwrites a file with the given content (used for drag-and-drop /
// file-picker imports) and makes it active.
export function importFile(project: XsdProject, name: string, content: string): void {
  project.files.set(name, createXsdState(content));
  project.active = name;
}

// Removes a file. If it was the entry, promotes the first remaining file to
// entry. If it was active, switches active to the (possibly new) entry.
// Returns a status message describing any entry reassignment, or null.
export function removeFile(project: XsdProject, name: string): string | null {
  if (project.files.size <= 1) return null;
  project.files.delete(name);

  let message: string | null = null;
  if (project.entry === name) {
    const next = project.files.keys().next().value as string;
    project.entry = next;
    message = `Entry file changed to ${next}`;
  }
  if (project.active === name) {
    project.active = project.entry;
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
