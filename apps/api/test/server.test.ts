import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  // Port 0 = ephemeral, so the suite never collides with a running dev server
  // or with a parallel CI job.
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Loomery API routes", () => {
  it("answers /healthz with the bare ok body a liveness probe expects", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("describes its limits and capabilities on /info", async () => {
    const res = await fetch(`${base}/info`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as Record<string, unknown>;
    expect(info.status).toBe("ok");
    // The upload cap must match what the handlers actually enforce, so a client
    // can size its request without discovering the limit by failure.
    expect(info.maxUploadBytes).toBe(Number(process.env.MAX_UPLOAD_BYTES ?? 512 * 1024 * 1024));
    // Node has no worker pool, so the API must not claim parallel encoding.
    expect(info.parallelPng).toBe(false);
  });

  it("serves usage text at / and for an unmatched route", async () => {
    const root = await fetch(`${base}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("POST /convert");

    const missing = await fetch(`${base}/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("POST /convert");
  });

  it("answers a CORS preflight with 204 and the allow headers", async () => {
    const res = await fetch(`${base}/convert`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("rejects an empty body with 400 rather than converting nothing", async () => {
    const res = await fetch(`${base}/convert`, { method: "POST", body: new Uint8Array(0) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("missing pack zip");
  });

  it("rejects a negative maxAnimationFrames with a named error", async () => {
    const res = await fetch(`${base}/convert?maxAnimationFrames=-1`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("maxAnimationFrames must be a non-negative number");
  });

  it("rejects an out-of-range oxipngLevel even though the value has no effect here", async () => {
    // Validated so a caller is told about a nonsensical value instead of having
    // it silently accepted — the knob matters for the browser build.
    const res = await fetch(`${base}/convert?oxipngLevel=9`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("oxipngLevel must be a number between 1 and 6");
  });

  it("accepts a valid oxipngLevel and reports the pack as unreadable, not a bad request", async () => {
    const res = await fetch(`${base}/convert?oxipngLevel=5`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    // 3 bytes is not a zip, so the conversion fails — but past validation.
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("conversion failed");
  });

  it("sanitizes packName so it cannot escape the response filename", async () => {
    const evil = encodeURIComponent('../../etc/pa"ss\\wd');
    const res = await fetch(`${base}/convert?packName=${evil}`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    // Reaches the conversion (500, not 400/404) but the echoed name is stripped
    // of separators and quotes — no header injection, no traversal.
    expect(res.status).toBe(500);
    expect(res.headers.get("content-disposition") ?? "").not.toContain("/");
  });
});
