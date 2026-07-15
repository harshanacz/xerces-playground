// Stub for Node's fs/promises. xerces-wasm imports { readFile } from here
// only inside validateFiles(), which this playground never calls (we pass
// XSD/XML as in-memory strings instead of file paths). Throwing is safer
// than silently no-op-ing in case it's ever hit.
export function readFile(): Promise<string> {
  throw new Error("fs/promises is not available in the browser");
}
