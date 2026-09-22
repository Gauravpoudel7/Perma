/**
 * `node:http` server for the P2 read APIs, plus the ingest loop.
 *
 * Binds loopback by default and answers `GET` only — there is no write surface
 * to protect because there are no writes. CORS is open for the Next dev origin;
 * everything served here is public on-chain data.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config, connection } from "./chain.ts";
import { openDb, type Db } from "./db.ts";
import { runIngestLoop } from "./ingest.ts";
import { API_PREFIX, handle, type RouteDeps } from "./routes.ts";

export function createApiServer(db: Db, deps: RouteDeps = {}) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end(JSON.stringify({ error: "read-only service" }));
      return;
    }

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const { status, body } = await handle(db, url, deps);
      res.writeHead(status).end(JSON.stringify(body));
    } catch (err) {
      res.writeHead(500).end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb(config.dbPath);
  const conn = connection();
  const server = createApiServer(db, {
    finalizedSlot: async () => {
      try {
        return await conn.getSlot("finalized");
      } catch {
        return null;
      }
    },
  });

  const controller = new AbortController();
  void runIngestLoop(db, controller.signal);

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`perma indexer on http://127.0.0.1:${config.port}${API_PREFIX} · rpc ${config.rpcUrl} · db ${config.dbPath}`);
  });

  const shutdown = () => {
    controller.abort();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
