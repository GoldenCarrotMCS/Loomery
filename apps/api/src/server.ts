/**
 * Loomery HTTP API — self-hostable, no GUI.
 *
 *   POST /convert
 *     Content-Type: application/zip           → body is the Java pack zip
 *     Content-Type: multipart/form-data       → fields:
 *         pack    (file, required)  Java resource pack zip
 *         config  (file, optional)  Oraxen/Nexo/ItemsAdder config zip
 *     Query params (both modes):
 *         packName, attachableMaterial, modernBaseItem, maxAnimationFrames,
 *         optimizePack (default true; "false" disables lossless minify/merge)
 *         maxCompression (default false; "true" runs the slow zopfli PNG pass)
 *
 *   Response: application/zip containing
 *     <packName>.mcpack, geyser_mappings.json, geyser_blocks.json,
 *     geyser_displayentity_mappings.yml, geyserdisplayentity_config.yml,
 *     modelengine_input.zip, report.json
 *
 *   GET /healthz → 200 "ok"
 *   GET /info    → 200 JSON readiness/limits (maxUploadBytes, node version)
 */
import http from "node:http";
import { URL } from "node:url";
import { pathToFileURL } from "node:url";
import Busboy from "busboy";
import { zipSync } from "fflate";
import { convertPack, optionsFromHints, parseOraxenConfigZips, type ConvertOptions } from "@loomery/core";

const PORT = Number(process.env.PORT ?? 3000);
/** Reject uploads larger than this (default 512 MB). */
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES ?? 512 * 1024 * 1024);

const USAGE = `Loomery API
POST /convert with the Java pack zip (application/zip body, or multipart fields "pack" + optional "config").
Query params:
  packName            output name (default "converted_pack"; sanitized, max 80 chars)
  attachableMaterial  material for generated attachables
  modernBaseItem      host item for modern item-model assets (default minecraft:paper)
  maxAnimationFrames  cap on flipbook timeline frames; 0 = full animation (default)
  optimizePack        "false" or "0" disables the lossless minify/merge pass (default on)
  maxCompression      "true" or "1" runs the slow zopfli PNG pass (default off)
  oxipngLevel         1-6; browser-build knob, validated here but with no effect on this
                      path (Node recompresses with zopfli, which takes no level)
Returns a zip: <packName>.mcpack + geyser_mappings.json + geyser_blocks.json + report.json
             (+ furniture mappings/config and modelengine_input.zip when the pack has them)
`;

async function handleConvert(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const contentType = req.headers["content-type"] ?? "";

  let packBytes: Uint8Array | undefined;
  let configZips: Uint8Array[] = [];

  if (contentType.startsWith("multipart/form-data")) {
    ({ packBytes, configZips } = await readMultipart(req));
  } else {
    packBytes = await readBody(req);
  }
  if (packBytes === undefined || packBytes.length === 0) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end('missing pack zip (raw body or multipart field "pack")');
    return;
  }

  const rawPackName = url.searchParams.get("packName") ?? "converted_pack";
  // Sanitize: strip control chars, path separators, quotes — prevents header
  // injection and path traversal in the zip entry / content-disposition.
  const packName = rawPackName.replace(/[\x00-\x1F\x7F\/\\":]/g, "").slice(0, 80) || "converted_pack";
  const options: Partial<ConvertOptions> = { packName };
  const material = url.searchParams.get("attachableMaterial");
  if (material) options.attachableMaterial = material;
  const baseItem = url.searchParams.get("modernBaseItem");
  if (baseItem) options.modernBaseItem = baseItem;
  const maxFrames = url.searchParams.get("maxAnimationFrames");
  if (maxFrames) {
    const n = Number(maxFrames);
    if (!Number.isFinite(n) || n < 0) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("maxAnimationFrames must be a non-negative number");
      return;
    }
    options.maxAnimationFrames = n;
  }
  // oxipngLevel is validated for forward compatibility but has no effect here:
  // it is a browser-build knob (apps/web threads it into its oxipng worker
  // pool), while this Node path recompresses with zopfli, which takes no level.
  // The range check stays so a caller gets told about a nonsensical value
  // rather than having it silently accepted.
  const oxipngLvl = url.searchParams.get("oxipngLevel");
  if (oxipngLvl !== null) {
    const n = Number(oxipngLvl);
    if (!Number.isFinite(n) || n < 1 || n > 6) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("oxipngLevel must be a number between 1 and 6");
      return;
    }
  }
  const optimize = url.searchParams.get("optimizePack");
  if (optimize !== null) options.optimizePack = optimize !== "false" && optimize !== "0";
  const maxComp = url.searchParams.get("maxCompression");
  if (maxComp !== null) options.maxCompression = maxComp === "true" || maxComp === "1";
  if (configZips.length > 0) {
    const hints = parseOraxenConfigZips(configZips);
    // Shared with the web worker so a new hint field cannot reach one caller
    // and silently miss the other. Carries furnitureTransforms and
    // pluginConfigZips too, which this path used to drop.
    Object.assign(options, optionsFromHints(hints, configZips));
  }

  const result = await convertPack(packBytes, options);

  const bundle: Record<string, Uint8Array> = {
    [`${packName}.mcpack`]: result.mcpack,
    "report.json": new TextEncoder().encode(JSON.stringify(result.report, null, 2)),
  };
  if (result.geyserMappings) bundle["geyser_mappings.json"] = new TextEncoder().encode(result.geyserMappings);
  if (result.geyserBlockMappings) bundle["geyser_blocks.json"] = new TextEncoder().encode(result.geyserBlockMappings);
  if (result.displayEntityMappings) bundle["geyser_displayentity_mappings.yml"] = new TextEncoder().encode(result.displayEntityMappings);
  if (result.displayEntityConfig) bundle["geyserdisplayentity_config.yml"] = new TextEncoder().encode(result.displayEntityConfig);
  // ModelEngine mob models — unzip into extensions/geysermodelengineextension/input/.
  // The web app has always offered this; the API used to silently drop it.
  if (result.modelEngineInput) bundle["modelengine_input.zip"] = result.modelEngineInput;

  const out = zipSync(bundle, { level: 6 });
  res.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${packName}_bedrock.zip"`,
    "content-length": out.length,
  });
  res.end(Buffer.from(out));
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_UPLOAD) {
        reject(new Error("upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function readMultipart(
  req: http.IncomingMessage,
): Promise<{ packBytes?: Uint8Array; configZips: Uint8Array[] }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD } });
    const out: { packBytes?: Uint8Array; configZips: Uint8Array[] } = { configZips: [] };
    bb.on("file", (field, stream) => {
      const chunks: Buffer[] = [];
      // Busboy's fileSize limit TRUNCATES rather than failing: without this the
      // handler silently converts the first MAX_UPLOAD bytes of an oversized
      // zip, producing a pack missing assets (or an opaque "not a zip" error).
      // The raw-body path already rejects, so reject here too.
      stream.on("limit", () => {
        reject(new Error("upload too large"));
      });
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const bytes = new Uint8Array(Buffer.concat(chunks));
        if (field === "pack") out.packBytes = bytes;
        // Repeatable: -F config=@nexo.zip -F config=@hmcc.zip
        else if (field === "config") out.configZips.push(bytes);
      });
    });
    bb.on("finish", () => resolve(out));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

/**
 * The request handler, built as a factory so tests can start it on an ephemeral
 * port without the module's import side effect binding a fixed one. Behaviour is
 * unchanged: `createServer()` returns a server that is not yet listening.
 */
export function createServer(): http.Server {
  return http.createServer((req, res) => {
    // CORS: allow browser tools to call the API too.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && (req.url === "/" || req.url === "/healthz")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(req.url === "/healthz" ? "ok" : USAGE);
      return;
    }
    // Readiness/limits for orchestrators. Additive: /healthz keeps its bare "ok"
    // body so an existing liveness probe is unaffected.
    if (req.method === "GET" && req.url === "/info") {
      const info = {
        status: "ok",
        maxUploadBytes: MAX_UPLOAD,
        // This path runs everything in-process: no worker pool is available on
        // Node, so PNG encoding and the max-compression pass are single-threaded.
        // Reported so a caller can tell why a large pack is slower here than in
        // the browser build, instead of assuming the server is stuck.
        parallelPng: false,
        node: process.version,
      };
      const body = JSON.stringify(info, null, 2);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/convert")) {
      handleConvert(req, res).catch((err) => {
        console.error(err);
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end(`conversion failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(USAGE);
  });
}

// Only bind a port when this file is the entry point (`tsx src/server.ts`), so
// importing it from a test does not open a socket on the configured port.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(PORT, () => {
    console.log(`Loomery API listening on http://localhost:${PORT}`);
  });
}
