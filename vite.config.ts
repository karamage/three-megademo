import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev-only: lets the running piece save rendered frames (e.g. the OG image) into public/. */
function devFrameSaver(): Plugin {
  return {
    name: "dev-frame-saver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/save", (req, res) => {
        const name = basename(new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "");
        if (req.method !== "POST" || !/^[\w.-]+\.(jpg|png)$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", async () => {
          await writeFile(resolve("public", name), Buffer.concat(chunks));
          res.end("saved");
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), devFrameSaver()],
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
