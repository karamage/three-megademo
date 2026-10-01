import { Hono } from "hono";
import { cache } from "hono/cache";

type Env = { ASSETS: Fetcher };

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

/** Build/meta info, cached at the edge. */
app.get("/api/meta", cache({ cacheName: "azure-eclipse", cacheControl: "public, max-age=300" }), (c) =>
  c.json({
    name: "Azure Eclipse",
    title: "蒼の日蝕",
    bpm: 76,
    chapters: ["Cosmos", "Moonrise", "Purification", "Eclipse", "Return"],
    colo: (c.req.raw as Request & { cf?: { colo?: string } }).cf?.colo ?? null,
  }),
);

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
