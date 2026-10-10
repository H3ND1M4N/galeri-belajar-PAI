import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const id = context.params.id || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Tidak ditemukan", { status: 404 });
  const row: any = await getStore({ name: "galeri-meta", consistency: "strong" }).get(id, { type: "json" });
  if (!row?.fileType) return new Response("Tidak ditemukan", { status: 404 });
  const buf = await getStore({ name: "galeri-berkas", consistency: "strong" }).get(id, { type: "arrayBuffer" });
  if (!buf) return new Response("Tidak ditemukan", { status: 404 });

  const size = buf.byteLength;
  const headers: Record<string, string> = {
    "content-type": row.fileType,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600",
    "content-disposition": "inline",
  };
  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m) {
    let start: number, end: number;
    if (m[1] === "") { start = Math.max(size - Number(m[2]), 0); end = size - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(buf, { headers: { ...headers, "content-length": String(size) } });
};

export const config: Config = { path: "/api/file/:id", method: "GET" };
