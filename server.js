/* ============================================================
   Agenda Kuliah S-3 — Server (Node.js tanpa dependensi)
   Auth (username+password), peran Dosen & Mahasiswa, REST API,
   penyimpanan JSON file, upload tugas (base64).
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SECRET_FILE = path.join(DATA_DIR, ".secret");
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (termasuk upload base64)

for (const d of [DATA_DIR, UPLOAD_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

/* ---------- Secret untuk token ---------- */
let SECRET;
if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE);
else { SECRET = crypto.randomBytes(48); fs.writeFileSync(SECRET_FILE, SECRET); }

/* ---------- DB ---------- */
let DB;
function loadDB() {
  if (fs.existsSync(DB_FILE)) { DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); ensureSeedAccounts(); return; }
  DB = seedDB();
  saveDB();
}
function ensureSeedAccounts() {
  if (!Array.isArray(DB.users)) DB.users = [];
  const need = [["admin", "admin123", "Administrator", "admin"]];
  let changed = false;
  for (const [u, p, n, r] of need) {
    if (!DB.users.some(x => x.username === u)) {
      DB.users.push({ id: uid(), nama: n, username: u, role: r, password: hashPassword(p), createdAt: Date.now() });
      changed = true;
    }
  }
  if (changed) saveNow();
  // pastikan koleksi baru ada
  let c2 = false;
  for (const k of ["pertemuan", "kelompok", "notifications", "chat"]) if (!Array.isArray(DB[k])) { DB[k] = []; c2 = true; }
  if (c2) saveNow();
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
  }, 20);
}
function saveNow() { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); }

function uid() { return crypto.randomBytes(9).toString("base64url"); }
function isoToday() { return new Date().toISOString().slice(0, 10); }

/* ---------- Password hashing (pbkdf2) ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return salt.toString("hex") + ":" + hash.toString("hex");
}
function verifyPassword(password, stored) {
  try {
    const [saltHex, hashHex] = stored.split(":");
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

/* ---------- Token (HMAC-signed) ---------- */
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

/* ---------- Seed awal ---------- */
function seedDB() {
  const ruang = "Kelas B — Pascasarjana";
  const matkul = [
    { id: uid(), nama: "Al Islam Kemuhammadiyahan Transformatif", sks: 3, dosen: "Dr. Amirah Mawardi, S.Ag., M.Si. / Prof. Dr. H. Irwan Akib, M.Pd.", kode: "MK-1" },
    { id: uid(), nama: "Filsafat Ilmu dan Konstruksi Teori Pendidikan", sks: 3, dosen: "Prof. Sulfasyah, Ph.D. / Prof. Dr. Andi Sukri Syamsuri, M.Hum. / Dr. Aliem Bahri, M.Pd.", kode: "MK-2" },
    { id: uid(), nama: "Metodologi Riset dan Desain Inovasi Pendidikan", sks: 3, dosen: "Dr. Sukmawati, M.Pd. / Dr. Syamsiarna Nappu, M.Pd. / Prof. Dr. Muhammad Yaumi, M.A.", kode: "MK-3" },
    { id: uid(), nama: "Review Hasil Riset Terkini dan Sintesis Literatur", sks: 3, dosen: "Prof. Dr. Agustan S, M.Pd. / Prof. Hartono Bancong, Ph.D. / Prof. Dr. Eny Syatriana, M.Pd.", kode: "MK-4" },
    { id: uid(), nama: "Kajian Pendidikan Kontemporer dan Multikultural", sks: 3, dosen: "Prof. Erwin Akib, Ph.D. / Prof. Dr. Dra. Munirah, M.Pd. / Prof. Dr. H. Nursalam, M.Si.", kode: "MK-5" },
    { id: uid(), nama: "Analisis Kritis Problematika Transformasi Pendidikan", sks: 3, dosen: "Prof. Dr. Nurlina, M.Pd. / Prof. Dr. Hj. Andi Tenri Ampa, M.Hum. / Dr. Fatimah Azis, M.Pd.", kode: "MK-6" }
  ];
  const jadwal = [
    { id: uid(), matkul: "Analisis Kritis Problematika Transformasi Pendidikan", hari: "Jumat", mulai: "13:30", selesai: "15:30", ruang, dosen: "Tim Dosen (lihat Catatan)", mode: "Luring" },
    { id: uid(), matkul: "Kajian Pendidikan Kontemporer dan Multikultural", hari: "Jumat", mulai: "16:00", selesai: "18:00", ruang, dosen: "Tim Dosen (lihat Catatan)", mode: "Luring" },
    { id: uid(), matkul: "Review Hasil Riset Terkini dan Sintesis Literatur", hari: "Sabtu", mulai: "08:00", selesai: "10:00", ruang, dosen: "Tim Dosen (lihat Catatan)", mode: "Luring" },
    { id: uid(), matkul: "Metodologi Riset dan Desain Inovasi Pendidikan", hari: "Sabtu", mulai: "10:00", selesai: "12:00", ruang, dosen: "Tim Dosen (lihat Catatan)", mode: "Luring" },
    { id: uid(), matkul: "Filsafat Ilmu dan Konstruksi Teori Pendidikan", hari: "Sabtu", mulai: "13:30", selesai: "15:30", ruang, dosen: "Tim Dosen (lihat Catatan)", mode: "Luring" },
    { id: uid(), matkul: "Al Islam Kemuhammadiyahan Transformatif", hari: "Sabtu", mulai: "16:00", selesai: "18:00", ruang, dosen: "Tim Dosen (lihat Catatan)", mode: "Luring" }
  ];
  const dosenCat = [
    ["Jadwal Dosen — Al Islam Kemuhammadiyahan (Sabtu 16.00-18.00)", "Dr. Amirah Mawardi, S.Ag., M.Si.:\n3, 10, 17, 24, 31 Okt; 7, 14, 21 Nov 2026\n\nProf. Dr. H. Irwan Akib, M.Pd.:\n28 Nov; 5, 12, 19, 26 Des 2026; 2, 9, 16 Jan 2027"],
    ["Jadwal Dosen — Filsafat Ilmu & Konstruksi Teori (Sabtu 13.30-15.30)", "Prof. Sulfasyah, Ph.D.:\n3, 10, 17, 24, 31 Okt; 7 Nov 2026\n\nProf. Dr. Andi Sukri Syamsuri, M.Hum.:\n14, 21, 28 Nov; 5, 12 Des 2026\n\nDr. Aliem Bahri, M.Pd.:\n19, 26 Des 2026; 2, 9, 16 Jan 2027"],
    ["Jadwal Dosen — Metodologi Riset & Desain Inovasi (Sabtu 10.00-12.00)", "Dr. Sukmawati, M.Pd.:\n3, 10, 17, 24, 31 Okt 2026\n\nDr. Syamsiarna Nappu, M.Pd.:\n7, 14, 21, 28 Nov; 5 Des 2026\n\nProf. Dr. Muhammad Yaumi, M.A.:\n12, 19, 26 Des 2026; 2, 9, 16 Jan 2027"],
    ["Jadwal Dosen — Review Hasil Riset & Sintesis Literatur (Sabtu 08.00-10.00)", "Prof. Dr. Agustan S, M.Pd.:\n3, 10, 17, 24, 31 Okt; 7 Nov 2026\n\nProf. Hartono Bancong, Ph.D.:\n14, 21, 28 Nov; 5, 12 Des 2026\n\nProf. Dr. Eny Syatriana, M.Pd.:\n19, 26 Des 2026; 2, 9, 16 Jan 2027"],
    ["Jadwal Dosen — Kajian Pendidikan Kontemporer & Multikultural (Jumat 16.00-18.00)", "Prof. Erwin Akib, Ph.D.:\n2, 9, 16, 23, 30 Okt; 6 Nov 2026\n\nProf. Dr. Dra. Munirah, M.Pd.:\n13, 20, 27 Nov; 4, 11 Des 2026\n\nProf. Dr. H. Nursalam, M.Si.:\n18, 25 Des 2026; 1, 8, 15 Jan 2027"],
    ["Jadwal Dosen — Analisis Kritis Problematika Transformasi (Jumat 13.30-15.30)", "Prof. Dr. Nurlina, M.Pd.:\n2, 9, 16, 23, 30 Okt 2026\n\nProf. Dr. Hj. Andi Tenri Ampa, M.Hum.:\n6, 13, 20, 27 Nov; 4 Des 2026\n\nDr. Fatimah Azis, M.Pd.:\n11, 18, 25 Des 2026; 1, 8, 15 Jan 2027"]
  ];

  const dosenId = uid();
  const mhsId = uid();
  const users = [
    { id: uid(), nama: "Administrator", username: "admin", role: "admin", password: hashPassword("admin123"), createdAt: Date.now() },
    { id: dosenId, nama: "Dosen Contoh", username: "dosen", role: "dosen", password: hashPassword("dosen123"), createdAt: Date.now() },
    { id: mhsId, nama: "Mahasiswa Contoh", username: "mahasiswa", role: "mahasiswa", password: hashPassword("mahasiswa123"), createdAt: Date.now() }
  ];

  return {
    users,
    matkul,
    jadwal,
    agenda: [],
    tugas: [],            // dibuat dosen
    pertemuan: [],        // sesi pertemuan per mata kuliah
    kelompok: [],         // pembagian kelompok mahasiswa
    notifications: [],    // notifikasi pengguna
    submissions: [],      // status tiap mahasiswa per tugas
    catatan: dosenCat.map(([judul, isi]) => ({ id: uid(), judul, isi, tanggal: isoToday(), ownerId: dosenId }))
  };
}

/* ============================================================
   HTTP helpers
   ============================================================ */
function sendJSON(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("Payload terlalu besar")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("JSON tidak valid")); }
    });
    req.on("error", reject);
  });
}
function authUser(req) {
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return DB.users.find(u => u.id === payload.uid) || null;
}
function publicUser(u) { return { id: u.id, nama: u.nama, username: u.username, role: u.role }; }
function userName(id) { const u = DB.users.find(x => x.id === id); return u ? u.nama : ""; }
function pushNotif(type, title, body, matkul, meta) {
  if (!Array.isArray(DB.notifications)) DB.notifications = [];
  DB.notifications.push({ id: uid(), ts: Date.now(), type, title, body: body || "", matkul: matkul || "", ...(meta || {}) });
  if (DB.notifications.length > 300) DB.notifications = DB.notifications.slice(-300);
}

/* ============================================================
   Static file serving
   ============================================================ */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

/* ============================================================
   API Router
   ============================================================ */
const server = http.createServer(async (req, res) => {
  const url = req.url;
  if (!url.startsWith("/api/")) return serveStatic(req, res, url);

  // Serve uploaded files (auth required)
  try {
    const [pathname, qs] = url.split("?");
    const parts = pathname.split("/").filter(Boolean); // ["api", ...]
    const method = req.method;

    // ---- Public auth endpoints ----
    if (pathname === "/api/login" && method === "POST") {
      const b = await readBody(req);
      const user = DB.users.find(u => u.username.toLowerCase() === String(b.username || "").toLowerCase().trim());
      if (!user || !verifyPassword(String(b.password || ""), user.password))
        return sendJSON(res, 401, { error: "Username atau password salah" });
      const token = signToken({ uid: user.id, role: user.role, exp: Date.now() + 3650 * 864e5 });
      return sendJSON(res, 200, { token, user: publicUser(user) });
    }
    // ---- Authenticated below ----
    const me = authUser(req);
    if (!me) return sendJSON(res, 401, { error: "Tidak terautentikasi" });
    const isDosen = me.role === "dosen";
    const isManager = me.role === "dosen" || me.role === "admin";
    const isAdmin = me.role === "admin";

    if (pathname === "/api/me" && method === "GET") {
      // Perbarui token (sliding) agar tetap login selama dipakai, sampai logout manual.
      const token = signToken({ uid: me.id, role: me.role, exp: Date.now() + 3650 * 864e5 });
      return sendJSON(res, 200, { user: publicUser(me), token });
    }

    // Daftar mahasiswa (untuk enroll / anggota kelompok) — semua pengguna login
    if (pathname === "/api/mahasiswa" && method === "GET") {
      return sendJSON(res, 200, DB.users.filter(u => u.role === "mahasiswa").map(publicUser));
    }

    // Uploaded file download: /api/files/:name
    if (parts[1] === "files" && method === "GET") {
      const name = path.basename(decodeURIComponent(parts[2] || ""));
      const file = path.join(UPLOAD_DIR, name);
      if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
      // Otorisasi: dosen boleh semua; mahasiswa hanya file miliknya
      const sub = DB.submissions.find(s => s.fileName === name);
      if (!isManager && sub && sub.studentId !== me.id) { res.writeHead(403); return res.end("Forbidden"); }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${(sub && sub.fileOrig) || name}"` });
      return fs.createReadStream(file).pipe(res);
    }

    const resource = parts[1];
    const id = parts[2];
    const body = (method === "POST" || method === "PUT" || method === "PATCH") ? await readBody(req) : {};

    // Ganti sandi sendiri (semua pengguna login)
    if (pathname === "/api/me/password" && method === "POST") {
      const current = String(body.current || "");
      const baru = String(body.baru || "");
      if (baru.length < 6) return sendJSON(res, 400, { error: "Sandi baru minimal 6 karakter" });
      if (!verifyPassword(current, me.password)) return sendJSON(res, 400, { error: "Sandi lama salah" });
      me.password = hashPassword(baru); saveDB();
      return sendJSON(res, 200, { ok: true });
    }

    // ---------- USERS (admin) ----------
    if (resource === "users") {
      if (!isAdmin) return sendJSON(res, 403, { error: "Hanya admin yang dapat mengelola pengguna" });
      if (method === "GET") return sendJSON(res, 200, DB.users.map(publicUser));
      if (method === "POST") {
        const nama = s(body.nama);
        const username = s(body.username).toLowerCase();
        const password = String(body.password || "");
        const role = ["dosen", "mahasiswa", "admin"].includes(body.role) ? body.role : "mahasiswa";
        if (nama.length < 2 || username.length < 3 || password.length < 6)
          return sendJSON(res, 400, { error: "Nama min 2, username min 3, password min 6 karakter" });
        if (!/^[a-z0-9._]+$/.test(username))
          return sendJSON(res, 400, { error: "Username hanya huruf kecil, angka, titik, underscore" });
        if (DB.users.some(u => u.username === username))
          return sendJSON(res, 409, { error: "Username sudah dipakai" });
        const user = { id: uid(), nama, username, role, password: hashPassword(password), createdAt: Date.now() };
        DB.users.push(user); saveDB();
        return sendJSON(res, 201, publicUser(user));
      }
      if (method === "PUT") {
        const u = DB.users.find(x => x.id === id);
        if (!u) return sendJSON(res, 404, { error: "Tidak ditemukan" });
        if (body.nama) u.nama = s(body.nama);
        if (["dosen", "mahasiswa", "admin"].includes(body.role)) u.role = body.role;
        if (body.password) { if (String(body.password).length < 6) return sendJSON(res, 400, { error: "Password min 6 karakter" }); u.password = hashPassword(String(body.password)); }
        saveDB(); return sendJSON(res, 200, publicUser(u));
      }
      if (method === "DELETE") {
        if (id === me.id) return sendJSON(res, 400, { error: "Tidak dapat menghapus akun sendiri" });
        DB.users = DB.users.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true });
      }
    }

    // ---------- JADWAL ----------
    if (resource === "jadwal") {
      if (method === "GET") return sendJSON(res, 200, DB.jadwal);
      if (!isManager) return sendJSON(res, 403, { error: "Hanya dosen/admin yang dapat mengelola jadwal" });
      const shape = () => ({ matkul: s(body.matkul), hari: s(body.hari), mulai: s(body.mulai), selesai: s(body.selesai), ruang: s(body.ruang), dosen: s(body.dosen), mode: s(body.mode) || "Luring" });
      if (method === "POST") { if (!body.matkul) return sendJSON(res, 400, { error: "Mata kuliah wajib" }); const it = { id: uid(), ...shape() }; DB.jadwal.push(it); saveDB(); return sendJSON(res, 201, it); }
      if (method === "PUT") { const i = DB.jadwal.findIndex(x => x.id === id); if (i < 0) return sendJSON(res, 404, { error: "Tidak ditemukan" }); DB.jadwal[i] = { ...DB.jadwal[i], ...shape() }; saveDB(); return sendJSON(res, 200, DB.jadwal[i]); }
      if (method === "DELETE") { DB.jadwal = DB.jadwal.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    // ---------- AGENDA (keduanya boleh buat; pemilik/dosen boleh ubah) ----------
    if (resource === "agenda") {
      if (method === "GET") return sendJSON(res, 200, DB.agenda);
      const shape = () => ({ judul: s(body.judul), kategori: s(body.kategori) || "Umum", tanggal: s(body.tanggal), waktu: s(body.waktu), lokasi: s(body.lokasi), tipe: body.tipe === "kelompok" ? "kelompok" : "individu", anggota: Array.isArray(body.anggota) ? body.anggota.filter(a => a && a.id).map(a => ({ id: String(a.id), nama: String(a.nama || "") })) : [] });
      if (method === "POST") { if (!body.judul) return sendJSON(res, 400, { error: "Judul wajib" }); const it = { id: uid(), ...shape(), ownerId: me.id, ownerNama: me.nama }; DB.agenda.push(it); pushNotif("agenda", "Kegiatan baru", it.judul, ""); saveDB(); return sendJSON(res, 201, it); }
      const it = DB.agenda.find(x => x.id === id);
      if (!it) return sendJSON(res, 404, { error: "Tidak ditemukan" });
      if (it.ownerId !== me.id && !isManager) return sendJSON(res, 403, { error: "Hanya pembuat atau dosen/admin" });
      if (method === "PUT") { Object.assign(it, shape()); saveDB(); return sendJSON(res, 200, it); }
      if (method === "DELETE") { DB.agenda = DB.agenda.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    // ---------- MATKUL ----------
    if (resource === "matkul") {
      // Peserta mata kuliah: /api/matkul/:id/peserta
      if (parts[3] === "peserta") {
        if (!isManager) return sendJSON(res, 403, { error: "Hanya dosen/admin" });
        const m = DB.matkul.find(x => x.id === id);
        if (!m) return sendJSON(res, 404, { error: "Mata kuliah tidak ditemukan" });
        if (method === "GET") return sendJSON(res, 200, { peserta: m.peserta || [] });
        if (method === "PUT") {
          const valid = new Set(DB.users.filter(u => u.role === "mahasiswa").map(u => u.id));
          m.peserta = (Array.isArray(body.peserta) ? body.peserta : []).filter(x => valid.has(x));
          saveDB(); return sendJSON(res, 200, { peserta: m.peserta });
        }
      }
      if (method === "GET") return sendJSON(res, 200, DB.matkul);
      if (!isManager) return sendJSON(res, 403, { error: "Hanya dosen/admin yang dapat mengelola mata kuliah" });
      if (method === "POST") { const it = { id: uid(), nama: s(body.nama), kode: s(body.kode), sks: Number(body.sks) || 0, dosen: s(body.dosen), peserta: [] }; if (!it.nama) return sendJSON(res, 400, { error: "Nama wajib" }); DB.matkul.push(it); saveDB(); return sendJSON(res, 201, it); }
      if (method === "PUT") { const i = DB.matkul.findIndex(x => x.id === id); if (i < 0) return sendJSON(res, 404, { error: "Tidak ditemukan" }); DB.matkul[i] = { ...DB.matkul[i], nama: s(body.nama), kode: s(body.kode), sks: Number(body.sks) || 0, dosen: s(body.dosen) }; saveDB(); return sendJSON(res, 200, DB.matkul[i]); }
      if (method === "DELETE") { DB.matkul = DB.matkul.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    // ---------- PERTEMUAN (dosen/admin kelola; semua baca) ----------
    if (resource === "pertemuan") {
      if (method === "GET") {
        let list = DB.pertemuan;
        if (!isManager) list = list.filter(p => enrolled(me.id, p.matkul));
        // Sertakan daftar penyaji (dari tugas presentasi) agar tampil ke semua peserta.
        const out = list.map(p => {
          const presenters = DB.tugas
            .filter(t => t.pertemuanId === p.id && (t.jenisKumpul === "presentasi" || t.jenisKumpul === "keduanya"))
            .flatMap(t => (t.anggota || []).map(a => userName(a.id) || a.nama))
            .filter(Boolean);
          return { ...p, presentasi: [...new Set(presenters)] };
        });
        return sendJSON(res, 200, out);
      }
      if (!isManager) return sendJSON(res, 403, { error: "Hanya dosen/admin yang dapat mengelola pertemuan" });
      const shape = () => ({ matkul: s(body.matkul), pertemuanKe: Number(body.pertemuanKe) || 1, tanggal: s(body.tanggal), waktu: s(body.waktu), selesai: s(body.selesai), topik: s(body.topik), pengampu: s(body.pengampu), catatan: s(body.catatan), mode: body.mode === "luring" ? "luring" : "daring", ruangan: s(body.ruangan), link: s(body.link), meetId: s(body.meetId), passcode: s(body.passcode) });
      if (method === "POST") { if (!body.matkul) return sendJSON(res, 400, { error: "Mata kuliah wajib" }); const it = { id: uid(), ...shape() }; DB.pertemuan.push(it); pushNotif("pertemuan", "Pertemuan baru", `Pertemuan ${it.pertemuanKe} — ${it.matkul}`, it.matkul); saveDB(); return sendJSON(res, 201, it); }
      if (method === "PUT") { const i = DB.pertemuan.findIndex(x => x.id === id); if (i < 0) return sendJSON(res, 404, { error: "Tidak ditemukan" }); DB.pertemuan[i] = { ...DB.pertemuan[i], ...shape() }; saveDB(); return sendJSON(res, 200, DB.pertemuan[i]); }
      if (method === "DELETE") { DB.pertemuan = DB.pertemuan.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    // ---------- KELOMPOK (dosen/admin kelola; semua baca) ----------
    if (resource === "kelompok") {
      if (method === "GET") return sendJSON(res, 200, DB.kelompok);
      if (!isManager) return sendJSON(res, 403, { error: "Hanya dosen/admin yang dapat mengelola kelompok" });
      const shape = () => ({ nama: s(body.nama), matkul: s(body.matkul), ketua: s(body.ketua), anggota: s(body.anggota) });
      if (method === "POST") { if (!body.nama) return sendJSON(res, 400, { error: "Nama kelompok wajib" }); const it = { id: uid(), ...shape() }; DB.kelompok.push(it); saveDB(); return sendJSON(res, 201, it); }
      if (method === "PUT") { const i = DB.kelompok.findIndex(x => x.id === id); if (i < 0) return sendJSON(res, 404, { error: "Tidak ditemukan" }); DB.kelompok[i] = { ...DB.kelompok[i], ...shape() }; saveDB(); return sendJSON(res, 200, DB.kelompok[i]); }
      if (method === "DELETE") { DB.kelompok = DB.kelompok.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    // ---------- TUGAS (dosen buat; semua baca) ----------
    if (resource === "tugas") {
      // Toggle status selesai tingkat-tugas (dosen/admin): PUT /api/tugas/:id/selesai
      if (parts[3] === "selesai") {
        if (!isManager) return sendJSON(res, 403, { error: "Hanya dosen/admin yang dapat menandai tugas selesai" });
        const t = DB.tugas.find(x => x.id === id);
        if (!t) return sendJSON(res, 404, { error: "Tidak ditemukan" });
        if (method === "PUT") { t.selesai = !!body.selesai; saveDB(); return sendJSON(res, 200, t); }
      }
      if (method === "GET") {
        let list = DB.tugas;
        // Mahasiswa: hanya tugas matkul yang diikuti; tugas kelompok hanya jika ditandai sebagai anggota.
        if (!isManager) list = list.filter(t => {
          if (!enrolled(me.id, t.matkul)) return false;
          if (t.tipe === "kelompok" && Array.isArray(t.anggota) && t.anggota.length) return t.anggota.some(a => a.id === me.id);
          return true;
        });
        const out = list.map(t => {
          const ids = enrolledIds(t.matkul);
          const subs = DB.submissions.filter(sb => sb.tugasId === t.id && ids.includes(sb.studentId));
          const done = subs.filter(sb => sb.selesai).length;
          const mine = DB.submissions.find(sb => sb.tugasId === t.id && sb.studentId === me.id) || null;
          const anggota = (t.anggota || []).map(a => ({ id: a.id, nama: userName(a.id) || a.nama }));
          return { ...t, anggota, progres: { done, total: ids.length, submitted: subs.length }, mine: mine ? publicSub(mine) : null };
        });
        return sendJSON(res, 200, out);
      }
      const shape = () => ({ judul: s(body.judul), matkul: s(body.matkul), deadline: s(body.deadline), prioritas: ["tinggi", "sedang", "rendah"].includes(body.prioritas) ? body.prioritas : "sedang", deskripsi: s(body.deskripsi), tipe: body.tipe === "kelompok" ? "kelompok" : "individu", jenisKumpul: ["submit", "presentasi", "keduanya"].includes(body.jenisKumpul) ? body.jenisKumpul : "submit", pertemuanId: s(body.pertemuanId), anggota: Array.isArray(body.anggota) ? body.anggota.filter(a => a && a.id).map(a => ({ id: String(a.id), nama: String(a.nama || "") })) : [] });
      // Semua pengguna boleh membuat tugas; edit/hapus hanya pembuat atau dosen/admin.
      if (method === "POST") { if (!body.judul) return sendJSON(res, 400, { error: "Judul wajib" }); const it = { id: uid(), ...shape(), createdBy: me.id, createdByNama: me.nama, createdByRole: me.role, createdAt: Date.now() }; DB.tugas.push(it); pushNotif("tugas", "Tugas baru", `${it.judul}${it.matkul ? " — " + it.matkul : ""}`, it.matkul, { tipe: it.tipe, anggota: it.anggota }); saveDB(); return sendJSON(res, 201, it); }
      const ti = DB.tugas.findIndex(x => x.id === id);
      if (ti < 0) return sendJSON(res, 404, { error: "Tidak ditemukan" });
      if (!isManager && DB.tugas[ti].createdBy !== me.id) return sendJSON(res, 403, { error: "Hanya pembuat atau dosen/admin yang dapat mengubah tugas ini" });
      if (method === "PUT") { DB.tugas[ti] = { ...DB.tugas[ti], ...shape() }; saveDB(); return sendJSON(res, 200, DB.tugas[ti]); }
      if (method === "DELETE") { DB.tugas = DB.tugas.filter(x => x.id !== id); DB.submissions = DB.submissions.filter(sb => sb.tugasId !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    // ---------- SUBMISSIONS (mahasiswa kumpul / tandai selesai) ----------
    if (resource === "submissions") {
      // GET /api/submissions/:tugasId -> dosen: semua; mahasiswa: miliknya
      if (method === "GET") {
        const tugasId = id;
        let subs = DB.submissions.filter(sb => sb.tugasId === tugasId);
        if (!isManager) subs = subs.filter(sb => sb.studentId === me.id);
        const withNama = subs.map(sb => ({ ...publicSub(sb), studentNama: (DB.users.find(u => u.id === sb.studentId) || {}).nama || "—" }));
        return sendJSON(res, 200, withNama);
      }
      // POST /api/submissions/:tugasId -> mahasiswa submit/toggle
      if (method === "POST") {
        if (me.role !== "mahasiswa") return sendJSON(res, 403, { error: "Hanya mahasiswa yang mengumpulkan tugas" });
        const tugasId = id;
        const tugas = DB.tugas.find(t => t.id === tugasId);
        if (!tugas) return sendJSON(res, 404, { error: "Tugas tidak ditemukan" });
        // Tandai selesai hanya boleh setelah jam pertemuan dimulai (zona WITA/UTC+8).
        if (body.selesai === true && tugas.pertemuanId) {
          const p = DB.pertemuan.find(x => x.id === tugas.pertemuanId);
          if (p && p.tanggal) {
            const start = Date.parse(p.tanggal + "T" + (p.waktu || "00:00") + ":00+08:00");
            if (!isNaN(start) && Date.now() < start) return sendJSON(res, 400, { error: "Belum dapat ditandai selesai — pertemuan belum dimulai." });
          }
        }
        let sub = DB.submissions.find(sb => sb.tugasId === tugasId && sb.studentId === me.id);
        if (!sub) { sub = { id: uid(), tugasId, studentId: me.id, selesai: false, fileName: null, fileOrig: null, catatan: "", submittedAt: null }; DB.submissions.push(sub); }
        if (typeof body.selesai === "boolean") sub.selesai = body.selesai;
        if (typeof body.catatan === "string") sub.catatan = s(body.catatan);
        if (typeof body.kelompok === "string") sub.kelompok = s(body.kelompok);
        if (typeof body.link === "string") sub.link = s(body.link);
        // Upload file (base64)
        if (body.fileBase64 && body.fileOrig) {
          const safeOrig = path.basename(String(body.fileOrig)).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
          const buf = Buffer.from(String(body.fileBase64), "base64");
          if (buf.length > 6 * 1024 * 1024) return sendJSON(res, 400, { error: "Ukuran file maksimal 6 MB" });
          if (sub.fileName) { try { fs.unlinkSync(path.join(UPLOAD_DIR, sub.fileName)); } catch {} }
          const fname = uid() + path.extname(safeOrig);
          fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
          sub.fileName = fname; sub.fileOrig = safeOrig; sub.selesai = true;
        }
        sub.submittedAt = Date.now();
        saveDB();
        return sendJSON(res, 200, publicSub(sub));
      }
    }

    // ---------- CHAT (obrolan kelas) ----------
    if (resource === "chat") {
      if (method === "GET") {
        const list = (DB.chat || []).slice(-200).map(m => ({ id: m.id, userId: m.userId, nama: userName(m.userId) || m.nama, role: (DB.users.find(u => u.id === m.userId) || {}).role || m.role, text: m.text, ts: m.ts }));
        return sendJSON(res, 200, list);
      }
      if (method === "POST") {
        const text = String(body.text || "").trim();
        if (!text) return sendJSON(res, 400, { error: "Pesan kosong" });
        if (text.length > 2000) return sendJSON(res, 400, { error: "Pesan terlalu panjang (maks 2000 karakter)" });
        if (!Array.isArray(DB.chat)) DB.chat = [];
        const msg = { id: uid(), userId: me.id, nama: me.nama, role: me.role, text, ts: Date.now() };
        DB.chat.push(msg);
        if (DB.chat.length > 500) DB.chat = DB.chat.slice(-500);
        saveDB();
        return sendJSON(res, 201, msg);
      }
      if (method === "DELETE") {
        const m = (DB.chat || []).find(x => x.id === id);
        if (!m) return sendJSON(res, 404, { error: "Tidak ditemukan" });
        if (m.userId !== me.id && !isManager) return sendJSON(res, 403, { error: "Hanya pengirim atau dosen/admin yang dapat menghapus" });
        DB.chat = DB.chat.filter(x => x.id !== id);
        saveDB();
        return sendJSON(res, 200, { ok: true });
      }
    }

    // ---------- NOTIFICATIONS ----------
    if (resource === "notifications") {
      if (method === "POST" && parts[2] === "read") { me.lastReadTs = Date.now(); saveDB(); return sendJSON(res, 200, { ok: true }); }
      if (method === "POST" && parts[2] === "dismiss") { const nid = String(body.id || ""); if (nid) me.dismissedNotif = [...new Set([...(me.dismissedNotif || []), nid])]; saveDB(); return sendJSON(res, 200, { ok: true }); }
      if (method === "POST" && parts[2] === "clear") { me.notifClearedTs = Date.now(); me.dismissedNotif = []; saveDB(); return sendJSON(res, 200, { ok: true }); }
      if (method === "GET") {
        const lastRead = me.lastReadTs || 0;
        const dismissed = new Set(me.dismissedNotif || []);
        const clearedTs = me.notifClearedTs || 0;
        // Tugas kelompok hanya relevan utk anggota yang ditandai; tugas individu utk semua peserta matkul.
        const relevant = n => {
          if (isManager) return true;
          if (n.matkul && !enrolled(me.id, n.matkul)) return false;
          if (n.type === "tugas" && n.tipe === "kelompok" && Array.isArray(n.anggota) && n.anggota.length) return n.anggota.some(a => a.id === me.id);
          return true;
        };
        const events = (DB.notifications || []).filter(relevant).filter(n => n.ts > clearedTs && !dismissed.has(n.id)).sort((a, b) => b.ts - a.ts).slice(0, 50)
          .map(n => ({ id: n.id, ts: n.ts, type: n.type, title: n.title, body: n.body, unread: n.ts > lastRead }));
        const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00").getTime();
        const tugasRelevan = t => {
          if (!enrolled(me.id, t.matkul)) return false;
          if (t.tipe === "kelompok" && Array.isArray(t.anggota) && t.anggota.length) return t.anggota.some(a => a.id === me.id);
          return true;
        };
        const reminders = [];
        DB.tugas.forEach(t => {
          if (!t.deadline) return;
          if (!isManager && !tugasRelevan(t)) return;
          const days = Math.round((new Date(t.deadline + "T00:00").getTime() - today) / 86400000);
          if (days < 0 || days > 3) return;
          if (!isManager) { const sub = DB.submissions.find(s => s.tugasId === t.id && s.studentId === me.id); if (sub && sub.selesai) return; }
          reminders.push({ id: "rem-" + t.id, type: "reminder", title: "Tenggat tugas", body: `${t.judul}${t.matkul ? " — " + t.matkul : ""}`, deadline: t.deadline, days, _when: new Date(t.deadline + "T00:00").getTime() });
        });
        // Pengingat jadwal kuliah (pertemuan) 24 jam ke depan.
        (DB.pertemuan || []).forEach(p => {
          if (!p.tanggal) return;
          if (!isManager && !enrolled(me.id, p.matkul)) return;
          const start = Date.parse(p.tanggal + "T" + (p.waktu || "00:00") + ":00+08:00");
          if (isNaN(start)) return;
          const mins = (start - Date.now()) / 60000;
          if (mins < -15 || mins > 1440) return;
          reminders.push({ id: "kul-" + p.id, type: "kuliah", title: "Kuliah: " + p.matkul, tanggal: p.tanggal, waktu: p.waktu || "", _when: start });
        });
        reminders.sort((a, b) => (a._when || 0) - (b._when || 0));
        reminders.forEach(r => delete r._when);
        return sendJSON(res, 200, { unread: events.filter(e => e.unread).length, reminders, events });
      }
    }

    // ---------- CATATAN (pribadi) ----------
    if (resource === "catatan") {
      if (method === "GET") return sendJSON(res, 200, DB.catatan.filter(c => c.ownerId === me.id));
      if (method === "POST") { if (!body.judul) return sendJSON(res, 400, { error: "Judul wajib" }); const it = { id: uid(), judul: s(body.judul), isi: s(body.isi), tanggal: isoToday(), ownerId: me.id }; DB.catatan.push(it); saveDB(); return sendJSON(res, 201, it); }
      const it = DB.catatan.find(x => x.id === id);
      if (!it || it.ownerId !== me.id) return sendJSON(res, 404, { error: "Tidak ditemukan" });
      if (method === "PUT") { it.judul = s(body.judul); it.isi = s(body.isi); saveDB(); return sendJSON(res, 200, it); }
      if (method === "DELETE") { DB.catatan = DB.catatan.filter(x => x.id !== id); saveDB(); return sendJSON(res, 200, { ok: true }); }
    }

    return sendJSON(res, 404, { error: "Endpoint tidak ditemukan" });
  } catch (e) {
    return sendJSON(res, 400, { error: e.message || "Permintaan tidak valid" });
  }
});

function s(v) { return v == null ? "" : String(v).trim(); }
// Daftar id mahasiswa peserta suatu mata kuliah (kosong/umum = semua mahasiswa)
function enrolledIds(nama) {
  const all = DB.users.filter(u => u.role === "mahasiswa").map(u => u.id);
  const m = DB.matkul.find(x => x.nama === nama);
  if (!m || !Array.isArray(m.peserta) || m.peserta.length === 0) return all;
  return m.peserta.filter(id => all.includes(id));
}
function enrolled(userId, nama) {
  const m = DB.matkul.find(x => x.nama === nama);
  if (!m || !Array.isArray(m.peserta) || m.peserta.length === 0) return true;
  return m.peserta.includes(userId);
}
function publicSub(sb) { return { id: sb.id, tugasId: sb.tugasId, studentId: sb.studentId, selesai: sb.selesai, catatan: sb.catatan, kelompok: sb.kelompok || "", link: sb.link || "", fileName: sb.fileName, fileOrig: sb.fileOrig, submittedAt: sb.submittedAt }; }

loadDB();
server.listen(PORT, () => {
  console.log(`Agenda Kuliah S-3 server berjalan di http://localhost:${PORT}`);
  console.log(`Akun contoh -> dosen/dosen123  |  mahasiswa/mahasiswa123`);
});
