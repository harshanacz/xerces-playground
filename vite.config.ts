import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  // Served from https://harshanacz.github.io/xerces-playground/ (a project
  // page, not a user page), so assets must resolve under this subpath.
  base: "/xerces-playground/",
  resolve: {
    alias: {
      // xerces-wasm's dist/index.js imports fs/promises for a Node-only
      // helper (validateFiles) that we never call from the browser.
      // Point it at an empty shim so the bundle doesn't fail to resolve it.
      "fs/promises": path.resolve(__dirname, "src/empty-shim.ts"),
    },
  },
});
