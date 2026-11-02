import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canonicalOrigin, robotsText } from "./shared/seo.mjs";
import { writeFile } from "node:fs/promises";
const publicOrigin = canonicalOrigin(process.env.PUBLIC_SITE_URL) || "";

export default defineConfig({
  define: { "import.meta.env.VITE_PUBLIC_SITE_URL": JSON.stringify(publicOrigin) },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), {
    name: "explicit-public-seo-config",
    apply: "build",
    async closeBundle() { await writeFile("dist/client/robots.txt", robotsText(publicOrigin)); },
  }],
});
