import { buildSync } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function loadComponent(file) {
 const result = buildSync({ entryPoints: [new URL("../src/" + file, import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"], loader: { ".css": "empty" } });
 const module = { exports: {} };
 new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
 return module.exports;
}
