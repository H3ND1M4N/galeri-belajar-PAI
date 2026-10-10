import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_BYTES = 4 * 1024 * 1024; // batas payload function ~4,5 MB
const MAX_ITEMS = 300;
const JENIS = ["game", "video", "materi"];
const TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45,
  "application/pdf": (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  "video/mp4": (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  "video/webm": (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};

const meta = () => getStore({ name: "galeri-meta", consistency: "strong" });
const files = () => getStore({ name: "galeri-berkas", consistency: "strong" });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function isAdmin(req: Request): boolean {
  const real = Netlify.env.get("ADMIN_PASSWORD");
  const given = req.headers.get("x-admin-password") || "";
  if (!real || !given) return false;
  const a = createHash("sha256").update(real).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}
const clean = (v: FormDataEntryValue | null, max: number) =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export default async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/api/admin") {
    return isAdmin(req) ? json({ ok: true }) : json({ ok: false }, 401);
  }

  if (req.method === "GET") {
    const { blobs } = await meta().list();
    const rows = await Promise.all(blobs.map((b) => meta().get(b.key, { type: "json" })));
    const list = rows.filter(Boolean).sort((a: any, b: any) => (b.tgl || 0) - (a.tgl || 0));
    return json(list);
  }

  if (req.method === "DELETE") {
    if (!isAdmin(req)) return json({ error: "Khusus admin." }, 401);
    const id = url.searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "ID tidak valid." }, 400);
    await Promise.all([meta().delete(id), files().delete(id)]);
    return json({ ok: true });
  }

  if (req.method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "Data tidak terbaca." }, 400);
    }
    if (clean(form.get("website"), 10)) return json({ ok: true }); // jebakan bot
    const judul = clean(form.get("judul"), 90);
    const jenis = clean(form.get("jenis"), 10);
    const link = clean(form.get("link"), 500);
    const deskripsi = clean(form.get("deskripsi"), 300);
    const nama = clean(form.get("nama"), 60) || "Anonim";
    const file = form.get("file");
    if (!judul) return json({ error: "Judul wajib diisi." }, 400);
    if (!JENIS.includes(jenis)) return json({ error: "Jenis tidak valid." }, 400);
    if (link && !/^https?:\/\//i.test(link)) return json({ error: "Tautan harus diawali https://" }, 400);
    const hasFile = file instanceof File && file.size > 0;
    if (!link && !hasFile) return json({ error: "Isi tautan atau pilih file." }, 400);

    const { blobs } = await meta().list();
    if (blobs.length >= MAX_ITEMS) return json({ error: "Galeri penuh. Hubungi guru." }, 507);

    const id = crypto.randomUUID();
    const row: Record<string, unknown> = { id, judul, jenis, link, deskripsi, nama, tgl: Date.now() };

    if (hasFile) {
      const f = file as File;
      if (f.size > MAX_BYTES) return json({ error: "File maksimal 4 MB. Untuk video besar, unggah ke YouTube lalu tempel tautannya." }, 413);
      const buf = new Uint8Array(await f.arrayBuffer());
      const check = TYPES[f.type];
      if (!check || !check(buf)) return json({ error: "Jenis file tidak diizinkan. Boleh: mp4, webm, pdf, png, jpg, gif, webp." }, 415);
      await files().set(id, buf.buffer as ArrayBuffer);
      row.fileType = f.type;
      row.fileName = clean(f.name, 80);
      row.fileUrl = `/api/file/${id}`;
    }
    await meta().setJSON(id, row);
    return json({ ok: true, id }, 201);
  }

  return json({ error: "Metode tidak didukung." }, 405);
};

export const config: Config = {
  path: ["/api/items", "/api/admin"],
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
