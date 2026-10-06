/* ============================================================
   Agenda Kuliah S-3 — Frontend gaya "Agenda Pimpinan"
   Tab: Agenda · Kalender · Tugas  (+ sheet Akun untuk kelola)
   ============================================================ */

const TOKEN_KEY = "agenda_s3_token";
const HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const DOW = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const BULAN_FULL = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

let token = localStorage.getItem(TOKEN_KEY) || null;
let me = null;
let currentView = "agenda";              // agenda|kalender|tugas|matkul|kelompok|jadwal|pengguna|catatan
const TABS = ["agenda", "kalender", "tugas"];
let agendaTime = "pekan";                // pekan|hari|lampau|semua
let agendaType = "semua";                // semua|pertemuan|kegiatan
let agendaMatkul = "";                   // filter mata kuliah (kosong = semua)
let tugasFilter = "aktif";               // aktif|semua|selesai
let searchTerm = "";
const store = { matkul: [], jadwal: [], tugas: [], agenda: [], catatan: [], users: [], pertemuan: [], kelompok: [], mahasiswa: [] };
const expandedTugas = new Set();
let calY, calM, calSel = null;

const isAdmin = () => me && me.role === "admin";
const isManager = () => me && (me.role === "dosen" || me.role === "admin");
// Mata kuliah yang relevan bagi pengguna: manager = semua; mahasiswa = yang ia ikuti (peserta kosong=semua, atau termasuk dirinya)
function myMatkul() {
  if (isManager()) return store.matkul;
  return store.matkul.filter(m => !Array.isArray(m.peserta) || m.peserta.length === 0 || m.peserta.includes(me.id));
}

/* ---------- API ---------- */
async function api(path, method = "GET", body) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch("/api" + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && me) { logout(); throw new Error("Sesi berakhir, silakan masuk lagi"); }
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

/* ---------- Helpers ---------- */
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function isoToday() { return new Date().toISOString().slice(0, 10); }
function fmtTanggal(iso) { if (!iso) return ""; const d = new Date(iso + "T00:00"); return `${d.getDate()} ${BULAN_FULL[d.getMonth()]} ${d.getFullYear()}`; }
function selisihHari(iso) { const t = new Date(); t.setHours(0,0,0,0); const d = new Date(iso + "T00:00"); return Math.round((d - t) / 86400000); }
function labelDeadline(iso) {
  if (!iso) return { txt: "Tanpa tenggat", urgent: false };
  const s = selisihHari(iso);
  if (s < 0) return { txt: `Terlambat ${Math.abs(s)} hari`, urgent: true };
  if (s === 0) return { txt: "Hari ini", urgent: true };
  if (s === 1) return { txt: "Besok", urgent: true };
  if (s <= 3) return { txt: `${s} hari lagi`, urgent: true };
  return { txt: `${s} hari lagi`, urgent: false };
}
function initial(n) { return (n || "?").trim().charAt(0).toUpperCase(); }
function kelompokNama(id) { const k = store.kelompok.find(x => x.id === id); return k ? k.nama : ""; }
function weekBounds() {
  const t = new Date(); t.setHours(0,0,0,0);
  const dow = (t.getDay() + 6) % 7; // Senin=0
  const start = new Date(t); start.setDate(t.getDate() - dow);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const iso = d => d.toISOString().slice(0, 10);
  return [iso(start), iso(end)];
}
function addMinutes(hhmm, mins) { if (!hhmm) return ""; const [h, m] = hhmm.split(":").map(Number); let t = (((h * 60 + m + mins) % 1440) + 1440) % 1440; return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); }
function jamRange(mulai, selesai) { if (!mulai) return ""; const end = selesai || addMinutes(mulai, 120); return end ? `${mulai} – ${end}` : mulai; }

let toastTimer;
function toast(msg) { const el = document.getElementById("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2400); }

/* ============================================================
   Auth
   ============================================================ */
function showLogin() { document.getElementById("loginScreen").hidden = false; document.getElementById("app").hidden = true; }
function showApp() { document.getElementById("loginScreen").hidden = true; document.getElementById("app").hidden = false; }

async function boot() {
  if (token) { try { me = (await api("/me")).user; return afterLogin(); } catch { token = null; localStorage.removeItem(TOKEN_KEY); } }
  showLogin();
}
async function afterLogin() {
  document.getElementById("avatarBtn").textContent = initial(me.nama);
  showApp();
  const now = new Date(); calY = now.getFullYear(); calM = now.getMonth();
  await loadData();
  setView("agenda");
  loadNotif();
  clearInterval(window._notifTimer);
  window._notifTimer = setInterval(loadNotif, 60000);
}
async function doLogin(u, p) { const r = await api("/login", "POST", { username: u, password: p }); token = r.token; me = r.user; localStorage.setItem(TOKEN_KEY, token); await afterLogin(); }
function logout() { token = null; me = null; localStorage.removeItem(TOKEN_KEY); clearInterval(window._notifTimer); closeModal(); showLogin(); }

/* ---------- Notifikasi ---------- */
let notifData = { unread: 0, reminders: [], events: [] };
async function loadNotif() {
  try {
    notifData = await api("/notifications");
    const badge = document.getElementById("bellBadge");
    const n = notifData.unread || 0;
    badge.textContent = n > 9 ? "9+" : n;
    badge.hidden = n === 0;
  } catch {}
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "baru saja";
  const m = Math.floor(s / 60); if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24); if (d < 7) return `${d} hari lalu`;
  return new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}
const NOTIF_IC = { tugas: "✔️", pertemuan: "🗓️", agenda: "◐", reminder: "⏰" };
async function openNotif() {
  document.getElementById("modalTitle").textContent = "Notifikasi";
  const { reminders = [], events = [] } = notifData;
  const remHTML = reminders.length ? `<div class="notif-sec">Tenggat terdekat</div>` + reminders.map(r => `
    <div class="notif-item"><div class="notif-ic">⏰</div><div class="notif-body">
      <div class="notif-title">${esc(r.body)}</div>
      <div class="notif-sub">Tenggat ${fmtTanggal(r.deadline)} • ${r.days===0?"hari ini":r.days===1?"besok":r.days+" hari lagi"}</div>
    </div></div>`).join("") : "";
  const evHTML = events.length ? `<div class="notif-sec">Aktivitas terbaru</div>` + events.map(n => `
    <div class="notif-item ${n.unread?"unread":""}"><div class="notif-ic">${NOTIF_IC[n.type]||"🔔"}</div><div class="notif-body">
      <div class="notif-title">${esc(n.title)}</div>
      <div class="notif-sub">${esc(n.body)}</div>
      <div class="notif-time">${timeAgo(n.ts)}</div>
    </div></div>`).join("") : "";
  const body = (remHTML + evHTML) || emptyHTML("🔔", "Belum ada notifikasi.");
  document.getElementById("modalBody").innerHTML = body;
  openModal();
  // tandai sudah dibaca
  try { await api("/notifications/read", "POST", {}); } catch {}
  const badge = document.getElementById("bellBadge"); badge.hidden = true;
  notifData.unread = 0;
}

/* ---------- Data ---------- */
async function loadData() {
  try {
    const [matkul, jadwal, tugas, agenda, catatan, pertemuan, kelompok] = await Promise.all([
      api("/matkul"), api("/jadwal"), api("/tugas"), api("/agenda"), api("/catatan"), api("/pertemuan"), api("/kelompok")
    ]);
    Object.assign(store, { matkul, jadwal, tugas, agenda, catatan, pertemuan, kelompok });
    if (isAdmin()) { try { store.users = await api("/users"); } catch {} }
    try { store.mahasiswa = await api("/mahasiswa"); } catch {}
  } catch (e) { toast(e.message); }
}
async function reload(r) { try { store[r === "users" ? "users" : r] = await api("/" + r); } catch (e) { toast(e.message); } }

/* ============================================================
   Navigation & chrome
   ============================================================ */
function setView(v) {
  currentView = v;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === v));
  updateChrome();
  render();
  window.scrollTo(0, 0);
}

function updateChrome() {
  const onAgenda = currentView === "agenda";
  const onTugas = currentView === "tugas";
  const isSecondary = !TABS.includes(currentView);
  document.getElementById("statBar").hidden = isSecondary || currentView === "kalender";
  document.getElementById("toolbar").hidden = isSecondary || currentView === "kalender";
  document.getElementById("searchInput").parentElement.style.display = onAgenda ? "" : "none";

  // FAB visibility
  const fab = document.getElementById("fab");
  fab.hidden = isSecondary; // tampil di agenda, kalender, tugas (mahasiswa & dosen boleh tambah)

  // filter mata kuliah (hanya tab Agenda)
  const mkFilter = document.getElementById("mkFilter");
  if (onAgenda) {
    mkFilter.hidden = false;
    mkFilter.innerHTML = `<option value="">📚 Semua Mata Kuliah</option>` +
      myMatkul().map(m => `<option value="${esc(m.nama)}" ${agendaMatkul===m.nama?"selected":""}>${esc(m.nama)}</option>`).join("");
    mkFilter.onchange = () => { agendaMatkul = mkFilter.value; updateChrome(); render(); };
  } else mkFilter.hidden = true;

  // chips
  const chips = document.getElementById("chips");
  if (onAgenda) {
    const timeChips = [["pekan","Pekan ini"],["hari","Hari ini"],["lampau","Lampau"],["semua","Semua"]];
    const typeChips = [["semua","Semua jenis"],["pertemuan","Pertemuan"],["kegiatan","Kegiatan"]];
    chips.innerHTML =
      timeChips.map(([k,l]) => `<button class="chip ${agendaTime===k?"is-active":""}" data-ct="time" data-k="${k}">${l}</button>`).join("") +
      `<span style="width:6px"></span>` +
      typeChips.map(([k,l]) => `<button class="chip ${agendaType===k?"is-active":""}" data-ct="type" data-k="${k}">${l}</button>`).join("");
  } else if (onTugas && !isManager()) {
    const f = [["aktif","Aktif"],["semua","Semua"],["selesai","Selesai"]];
    chips.innerHTML = f.map(([k,l]) => `<button class="chip ${tugasFilter===k?"is-active":""}" data-ct="tugas" data-k="${k}">${l}</button>`).join("");
  } else chips.innerHTML = "";
  chips.querySelectorAll(".chip").forEach(c => c.onclick = () => {
    const ct = c.dataset.ct, k = c.dataset.k;
    if (ct === "time") agendaTime = k; else if (ct === "type") agendaType = k; else if (ct === "tugas") tugasFilter = k;
    updateChrome(); render();
  });

  // stat bar
  const sb = document.getElementById("statBar");
  if (onAgenda) {
    const ev = agendaEvents();
    const [ws, we] = weekBounds();
    const pekan = ev.filter(e => e.date && e.date >= ws && e.date <= we).length;
    const hariIni = ev.filter(e => e.date && selisihHari(e.date) === 0).length;
    const lampau = ev.filter(e => e.date && selisihHari(e.date) < 0).length;
    sb.innerHTML = statHTML(pekan,"Pekan ini") + statHTML(hariIni,"Hari ini",true) + statHTML(lampau,"Lampau");
  } else if (onTugas) {
    if (isManager()) {
      const total = store.tugas.length;
      const tgt = store.tugas.filter(t => t.deadline && selisihHari(t.deadline)>=0 && selisihHari(t.deadline)<=7).length;
      const sub = store.tugas.reduce((n,t)=>n+((t.progres&&t.progres.submitted)||0),0);
      sb.innerHTML = statHTML(total,"Total Tugas") + statHTML(tgt,"Tenggat ≤7h",true) + statHTML(sub,"Terkumpul");
    } else {
      const aktif = store.tugas.filter(t => !(t.mine&&t.mine.selesai)).length;
      const tgt = store.tugas.filter(t => t.deadline && selisihHari(t.deadline)>=0 && selisihHari(t.deadline)<=7 && !(t.mine&&t.mine.selesai)).length;
      const selesai = store.tugas.filter(t => t.mine&&t.mine.selesai).length;
      sb.innerHTML = statHTML(aktif,"Aktif") + statHTML(tgt,"Tenggat ≤7h",true) + statHTML(selesai,"Selesai");
    }
  }
}
function statHTML(n, l, accent) { return `<div class="stat ${accent?"accent":""}"><div class="stat-num">${n}</div><div class="stat-lbl">${l}</div></div>`; }

/* ---------- Render dispatcher ---------- */
function render() {
  const root = document.getElementById("viewRoot");
  const map = { agenda: renderAgenda, kalender: renderKalender, tugas: renderTugas, matkul: renderMatkul, kelompok: renderKelompok, jadwal: renderJadwal, pengguna: renderPengguna, catatan: renderCatatan };
  root.innerHTML = (map[currentView] || renderAgenda)();
  bindView();
}

/* ============================================================
   AGENDA (pertemuan + kegiatan)
   ============================================================ */
function agendaEvents() {
  const ev = [];
  store.pertemuan.forEach(p => ev.push({
    kind: "pertemuan", id: p.id, label: `Pertemuan ${p.pertemuanKe}`, title: p.matkul, topik: p.topik,
    date: p.tanggal, time: jamRange(p.waktu, p.selesai), matkul: p.matkul, dosen: p.pengampu, mode: p.mode, ruangan: p.ruangan, raw: p
  }));
  store.agenda.forEach(a => ev.push({
    kind: "kegiatan", id: a.id, label: a.kategori || "Kegiatan", title: a.judul, date: a.tanggal, time: a.waktu,
    lokasi: a.lokasi, kategori: a.kategori, tipe: a.tipe, owner: a.ownerNama, raw: a
  }));
  return ev;
}
function renderAgenda() {
  let ev = agendaEvents();
  if (agendaMatkul) ev = ev.filter(e => e.matkul === agendaMatkul);
  if (agendaType !== "semua") ev = ev.filter(e => e.kind === agendaType);
  if (agendaTime === "pekan") { const [ws, we] = weekBounds(); ev = ev.filter(e => e.date && e.date >= ws && e.date <= we); }
  else if (agendaTime === "hari") ev = ev.filter(e => e.date && selisihHari(e.date) === 0);
  else if (agendaTime === "lampau") ev = ev.filter(e => e.date && selisihHari(e.date) < 0);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    ev = ev.filter(e => [e.title, e.label, e.topik, e.matkul, e.lokasi, e.dosen, e.kategori].some(x => (x||"").toLowerCase().includes(q)));
  }
  ev.sort((a, b) => (agendaTime === "lampau" ? -1 : 1) * (a.date || "").localeCompare(b.date || ""));
  if (!ev.length) return emptyHTML("🗓️", "Tidak ada agenda pada filter ini.");
  return `<div class="agenda-list">${ev.map(cardHTML).join("")}</div>`;
}
function cardHTML(e) {
  const d = e.date ? new Date(e.date + "T00:00") : null;
  const past = e.date && selisihHari(e.date) < 0;
  const badge = d ? `<div class="mcard-date-badge"><span class="d">${d.getDate()}</span><span class="m">${BULAN[d.getMonth()]}</span></div>` : "";
  let flags = "";
  if (e.kind === "pertemuan") {
    const tP = store.tugas.filter(t => t.pertemuanId === e.id);
    if (!isManager()) {
      const pres = tP.some(t => (t.jenisKumpul === "presentasi" || t.jenisKumpul === "keduanya") && (t.anggota || []).some(a => a.id === me.id));
      if (pres) flags += `<span class="flag pres">🎤 Giliran Presentasi</span>`;
      if (tP.length) flags += `<span class="flag tugas">📌 Ada Tugas</span>`;
    } else if (tP.length) {
      flags += `<span class="flag tugas">📌 ${tP.length} Tugas</span>`;
    }
  }
  const meta = e.kind === "pertemuan"
    ? `${e.time?`<span class="mi">🕑 ${esc(e.time)}</span>`:""}${e.mode==="luring" ? (e.ruangan?`<span class="mi">📍 ${esc(e.ruangan)}</span>`:"") : `<span class="mi">💻 Daring</span>`}${e.dosen?`<span class="mi">👤 ${esc(e.dosen)}</span>`:""}${e.topik?`<span class="mi">📖 ${esc(e.topik)}</span>`:""}`
    : `${e.time?`<span class="mi">🕑 ${esc(e.time)}</span>`:""}${e.kategori==="Tugas"&&e.tipe?`<span class="mi"><span class="badge ${e.tipe==="kelompok"?"sedang":"rendah"}">${e.tipe==="kelompok"?"Kelompok":"Individu"}</span></span>`:""}${e.lokasi?`<span class="mi">📍 ${esc(e.lokasi)}</span>`:""}${e.owner?`<span class="mi">✍ ${esc(e.owner)}</span>`:""}`;
  return `<div class="mcard k-${past?"selesai":e.kind}" data-detail="${e.kind}:${e.id}">
    <div class="mcard-head">
      <div class="mcard-headmain"><span class="pill">${esc(e.label)}</span><div class="mcard-title">${esc(e.title)}</div></div>
      ${badge}
    </div>
    ${flags?`<div class="mcard-flags">${flags}</div>`:""}
    <div class="mcard-meta">${meta}</div>
  </div>`;
}

/* ============================================================
   KALENDER
   ============================================================ */
function eventsByDate() {
  const map = {};
  const add = (iso, item) => { if (!iso) return; (map[iso] = map[iso] || []).push(item); };
  store.pertemuan.forEach(p => add(p.tanggal, { t: "pertemuan", title: `P${p.pertemuanKe} ${p.matkul}`, time: jamRange(p.waktu, p.selesai) }));
  store.agenda.forEach(a => add(a.tanggal, { t: "kegiatan", title: a.judul, time: a.waktu }));
  store.tugas.forEach(t => add(t.deadline, { t: "tugas", title: "Tenggat: " + t.judul, time: "" }));
  return map;
}
function renderKalender() {
  const map = eventsByDate();
  const first = new Date(calY, calM, 1);
  const startDow = first.getDay(); // 0=Minggu, sesuai header Min..Sab
  const daysIn = new Date(calY, calM + 1, 0).getDate();
  const prevDays = new Date(calY, calM, 0).getDate();
  const todayIso = isoToday();
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell dim"><span class="num">${prevDays - startDow + i + 1}</span></div>`;
  for (let dnum = 1; dnum <= daysIn; dnum++) {
    const iso = `${calY}-${String(calM+1).padStart(2,"0")}-${String(dnum).padStart(2,"0")}`;
    const has = map[iso] && map[iso].length;
    const cls = [has ? "has-event" : "", iso === todayIso ? "today" : "", iso === calSel ? "selected" : ""].join(" ");
    cells += `<div class="cal-cell ${cls}" data-day="${iso}"><span class="num">${dnum}</span>${has?`<div class="cal-dots">${map[iso].slice(0,3).map(()=>"<i></i>").join("")}</div>`:""}</div>`;
  }
  let panel = "";
  if (calSel && map[calSel]) {
    panel = `<div class="day-panel"><h3>${fmtTanggal(calSel)}</h3>${map[calSel].map(it => `
      <div class="mcard k-${it.t==="tugas"?"kegiatan":it.t}"><div class="mcard-head"><div class="mcard-title">${esc(it.title)}</div></div>
      <div class="mcard-meta"><span class="mi"><span class="tag ${it.t==="pertemuan"?"blue":it.t==="tugas"?"gold":"cat"}">${it.t}</span></span>${it.time?`<span class="mi">🕑 ${esc(it.time)}</span>`:""}</div></div>`).join("")}</div>`;
  } else if (calSel) {
    panel = `<div class="day-panel"><h3>${fmtTanggal(calSel)}</h3>${emptyHTML("📭","Tidak ada kegiatan di tanggal ini.")}</div>`;
  }
  return `<div class="cal-head">
      <button class="round-btn" id="calPrev">‹</button>
      <h2>${BULAN_FULL[calM]} ${calY}</h2>
      <button class="round-btn" id="calNext">›</button>
    </div>
    <div class="cal-dow">${DOW.map(d=>`<div>${d}</div>`).join("")}</div>
    <div class="cal-grid">${cells}</div>${panel}`;
}

/* ============================================================
   TUGAS
   ============================================================ */
function renderTugas() {
  let list = [...store.tugas];
  if (!isManager()) {
    if (tugasFilter === "aktif") list = list.filter(t => !(t.mine && t.mine.selesai));
    else if (tugasFilter === "selesai") list = list.filter(t => t.mine && t.mine.selesai);
  }
  list.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  if (!list.length) return emptyHTML("✔️", isManager() ? "Belum ada tugas. Tekan + untuk menambah." : "Tidak ada tugas pada filter ini.");
  return list.map(taskHTML).join("");
}
function taskHTML(t) {
  const dl = labelDeadline(t.deadline);
  const done = t.mine && t.mine.selesai;
  const pr = t.prioritas || "sedang";
  const tipeBadge = `<span class="badge ${t.tipe==="kelompok"?"sedang":"rendah"}">${t.tipe==="kelompok"?"Kelompok":"Individu"}</span>`;
  const jkLabel = { submit:"Submit", presentasi:"Presentasi", keduanya:"Submit + Presentasi" }[t.jenisKumpul||"submit"];
  const jkBadge = `<span class="tag blue">${jkLabel}</span>`;
  const perluBerkas = (t.jenisKumpul||"submit") !== "presentasi";
  const canEdit = isManager() || (me && t.createdBy === me.id);
  let extra = "";
  if (isManager()) {
    const p = t.progres || { done:0,total:0,submitted:0 };
    const pct = p.total ? Math.round(p.done/p.total*100) : 0;
    extra = `<div class="progress"><div class="progress-bar"><span style="width:${pct}%"></span></div>
      <div class="progress-meta">${p.done}/${p.total} mahasiswa selesai • ${p.submitted} mengumpulkan</div></div>
      <button class="expand-btn" data-expand="${t.id}">${expandedTugas.has(t.id)?"▴ Sembunyikan":"▾ Lihat pengumpulan"}</button>
      <div id="sub-${t.id}">${expandedTugas.has(t.id)?subListHTML(t.id):""}</div>`;
  } else {
    const file = t.mine && t.mine.fileOrig ? `<a class="file-link" data-file="${esc(t.mine.fileName)}" data-orig="${esc(t.mine.fileOrig)}" href="#">⬇ ${esc(t.mine.fileOrig)}</a>` : "";
    extra = `<div class="mine-status ${done?"ok":""}">${done?"✔ Selesai"+(t.mine.fileOrig?" • berkas terkumpul":""):"○ Belum selesai"} ${file}</div>
      <div class="task-actions" style="margin-top:8px"><button class="btn sm gold" data-submit="${t.id}">${perluBerkas?"⬆ "+(t.mine&&t.mine.selesai?"Perbarui":"Kumpulkan"):(t.mine&&t.mine.selesai?"✎ Perbarui":"✓ Tandai Selesai")}</button></div>`;
  }
  return `<div class="task-item p-${pr} ${done?"done":""}">
    ${isManager()?`<span class="task-check" style="cursor:default;background:#f1f5fb;color:var(--navy)">${(t.progres&&t.progres.done)||0}</span>`:`<button class="task-check" data-toggle="${t.id}">✓</button>`}
    <div class="task-body"><div class="task-title">${esc(t.judul)}</div>
      <div class="task-meta"><span class="tag mk">${esc(t.matkul||"Umum")}</span>${tipeBadge}${jkBadge}
        <span class="due ${dl.urgent&&!done?"urgent":""}">🕑 ${t.deadline?fmtTanggal(t.deadline)+" • ":""}${dl.txt}</span></div>
      ${t.deskripsi?`<div class="task-meta"><span>📝 ${esc(t.deskripsi)}</span></div>`:""}
      ${t.anggota && t.anggota.length ? `<div class="task-meta"><span>${(t.jenisKumpul==="presentasi"||t.jenisKumpul==="keduanya")?"🎤 Presentasi":"👥 Anggota"} (${t.anggota.length}): ${t.anggota.map(a=>esc(a.nama)).join(", ")}</span></div>` : ""}
      ${!isManager() && t.createdByNama ? `<div class="task-meta"><span>✍ Dibuat oleh: ${esc(t.createdByNama)}</span></div>` : ""}
      ${extra}</div>
    ${canEdit?`<div class="task-actions"><button class="btn-icon" data-edit="tugas" data-id="${t.id}">✎</button><button class="btn-icon danger" data-del="tugas" data-id="${t.id}">🗑</button></div>`:""}
  </div>`;
}
function subListHTML(id) {
  const subs = store._subs && store._subs[id];
  if (!subs) return `<div class="sub-list"><div class="progress-meta">Memuat…</div></div>`;
  if (!subs.length) return `<div class="sub-list"><div class="progress-meta">Belum ada yang mengumpulkan.</div></div>`;
  return `<div class="sub-list">${subs.map(s => `<div class="sub-row ${s.selesai?"done":""}">
    <span class="dot"></span><span class="nm">${esc(s.studentNama)}${s.kelompok?` <span class="tag mk">${esc(s.kelompok)}</span>`:""}</span>
    <span class="meta">${s.fileOrig?`<a class="file-link" data-file="${esc(s.fileName)}" data-orig="${esc(s.fileOrig)}" href="#">⬇ berkas</a>`:""}${s.link?`<a class="file-link" href="${esc(s.link)}" target="_blank" rel="noopener">🔗</a>`:""}<span>${s.selesai?"Selesai":"Belum"}</span></span>
  </div>`).join("")}</div>`;
}

/* ============================================================
   Secondary views (dari sheet Akun)
   ============================================================ */
function secHead(title, sub, addTipe) {
  return `<div class="view-head"><button class="round-btn" id="backHome">‹</button><div><h2>${title}</h2><div class="sub">${sub}</div></div>
    ${addTipe && isManager() ? `<button class="ghost-btn add-btn" data-add="${addTipe}">＋ Tambah</button>` : ""}${addTipe==="catatan"?`<button class="ghost-btn add-btn" data-add="catatan">＋ Tambah</button>`:""}${addTipe==="users"&&isAdmin()?`<button class="ghost-btn add-btn" data-add="users">＋ Tambah</button>`:""}</div>`;
}
function renderMatkul() {
  const totalSks = store.matkul.reduce((s,m)=>s+(Number(m.sks)||0),0);
  let h = secHead("Mata Kuliah", `${store.matkul.length} mata kuliah • ${totalSks} SKS`, "matkul");
  if (!store.matkul.length) return h + emptyHTML("📚","Belum ada mata kuliah.");
  h += `<div class="mk-grid">${store.matkul.map(m => `<div class="mk-card">
    <div class="mk-top"><span class="sks">${esc(m.kode||"—")}</span><span class="sks">${esc(m.sks)} SKS</span></div>
    <h3>${esc(m.nama)}</h3><div class="dsn">👤 ${esc(m.dosen||"-")}</div>
    <div class="dsn" style="margin-top:6px">👥 ${(m.peserta&&m.peserta.length)?`${m.peserta.length} peserta`:"Semua mahasiswa"}</div>
    ${isManager()?`<div class="mk-foot"><button class="btn sm gold" data-peserta="${m.id}">👥 Peserta</button><button class="btn sm" data-edit="matkul" data-id="${m.id}">✎</button><button class="btn-icon danger" data-del="matkul" data-id="${m.id}">🗑</button></div>`:""}
  </div>`).join("")}</div>`;
  return h;
}
function renderKelompok() {
  let h = secHead("Kelompok", "Presentasi & tugas kelompok", "kelompok");
  if (!store.kelompok.length) return h + emptyHTML("👥","Belum ada kelompok.");
  h += `<div class="mk-grid">${store.kelompok.map(k => `<div class="mk-card">
    <div class="mk-top"><span class="sks">${esc(k.matkul||"Umum")}</span>${k.ketua?`<span class="sks">Ketua: ${esc(k.ketua)}</span>`:""}</div>
    <h3>${esc(k.nama)}</h3><div class="dsn">${esc(k.anggota||"-")}</div>
    ${isManager()?`<div class="mk-foot"><button class="btn sm" data-edit="kelompok" data-id="${k.id}">✎ Edit</button><button class="btn-icon danger" data-del="kelompok" data-id="${k.id}">🗑</button></div>`:""}
  </div>`).join("")}</div>`;
  return h;
}
function renderJadwal() {
  const today = HARI[(new Date().getDay()+6)%7];
  let h = secHead("Jadwal Mingguan", "Jadwal kuliah per hari", "jadwal");
  if (!store.jadwal.length) return h + emptyHTML("🗓️","Belum ada jadwal.");
  HARI.forEach(hari => {
    const items = store.jadwal.filter(j => j.hari === hari).sort((a,b)=>a.mulai.localeCompare(b.mulai));
    if (!items.length) return;
    h += `<h3 style="color:var(--navy);margin:14px 0 8px;font-size:.92rem">${hari}${hari===today?" • Hari ini":""}</h3>`;
    h += items.map(j => `<div class="mcard k-pertemuan">
      <div class="mcard-head"><div class="mcard-title">${esc(j.matkul)}</div>
        <div class="mcard-date-badge"><span class="d">${esc(j.mulai)}</span><span class="m">${esc(j.selesai)}</span></div></div>
      <div class="mcard-meta"><span class="mi"><span class="tag mode">${esc(j.mode||"Luring")}</span></span><span class="mi">📍 ${esc(j.ruang||"-")}</span><span class="mi">👤 ${esc(j.dosen||"-")}</span>
        ${isManager()?`<span style="margin-left:auto;display:flex;gap:6px"><button class="btn-icon" data-edit="jadwal" data-id="${j.id}">✎</button><button class="btn-icon danger" data-del="jadwal" data-id="${j.id}">🗑</button></span>`:""}</div>
    </div>`).join("");
  });
  return h;
}
function renderPengguna() {
  let h = secHead("Pengguna", `${store.users.length} akun`, "users");
  const order = { admin:0, dosen:1, mahasiswa:2 };
  const list = [...store.users].sort((a,b)=>(order[a.role]-order[b.role])||a.nama.localeCompare(b.nama));
  h += list.map(u => `<div class="task-item" style="border-left-color:${u.role==="admin"?"var(--red)":u.role==="dosen"?"var(--gold)":"var(--blue)"};margin-bottom:10px">
    <span class="task-check" style="cursor:default;background:#f1f5fb;color:var(--navy)">${esc(initial(u.nama))}</span>
    <div class="task-body"><div class="task-title">${esc(u.nama)} ${u.id===me.id?'<span class="tag mk">Anda</span>':""}</div>
      <div class="task-meta"><span class="tag mk">@${esc(u.username)}</span><span class="badge ${u.role==="admin"?"tinggi":u.role==="dosen"?"sedang":"rendah"}">${esc(u.role)}</span></div></div>
    <div class="task-actions"><button class="btn-icon" data-edit="users" data-id="${u.id}">✎</button>${u.id!==me.id?`<button class="btn-icon danger" data-del="users" data-id="${u.id}">🗑</button>`:""}</div>
  </div>`).join("");
  return h;
}
function renderCatatan() {
  let h = secHead("Catatan", "Catatan pribadi Anda", "catatan");
  if (!store.catatan.length) return h + emptyHTML("📝","Belum ada catatan.");
  const list = [...store.catatan].sort((a,b)=>(b.tanggal||"").localeCompare(a.tanggal||""));
  h += `<div class="note-grid">${list.map(n => `<div class="note-card"><h3>${esc(n.judul)}</h3><p>${esc(n.isi)}</p>
    <div class="note-foot"><span class="note-date">${fmtTanggal(n.tanggal)}</span><div style="display:flex;gap:6px">
      <button class="btn-icon" data-edit="catatan" data-id="${n.id}">✎</button><button class="btn-icon danger" data-del="catatan" data-id="${n.id}">🗑</button></div></div></div>`).join("")}</div>`;
  return h;
}
function emptyHTML(ic, msg) { return `<div class="empty"><span class="big">${ic}</span>${esc(msg)}</div>`; }

/* ============================================================
   Bind events
   ============================================================ */
function bindView() {
  const c = document.getElementById("viewRoot");
  c.querySelectorAll("[data-add]").forEach(b => b.onclick = () => openForm(b.dataset.add));
  c.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openForm(b.dataset.edit, b.dataset.id));
  c.querySelectorAll("[data-del]").forEach(b => b.onclick = () => hapus(b.dataset.del, b.dataset.id));
  c.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => toggleTugas(b.dataset.toggle));
  c.querySelectorAll("[data-submit]").forEach(b => b.onclick = () => openSubmit(b.dataset.submit));
  c.querySelectorAll("[data-expand]").forEach(b => b.onclick = () => toggleExpand(b.dataset.expand));
  c.querySelectorAll("[data-file]").forEach(b => b.onclick = (e) => { e.preventDefault(); downloadFile(b.dataset.file, b.dataset.orig); });
  c.querySelectorAll("[data-detail]").forEach(b => b.onclick = () => { const [k,id] = b.dataset.detail.split(":"); openDetail(k, id); });
  c.querySelectorAll("[data-peserta]").forEach(b => b.onclick = () => openPeserta(b.dataset.peserta));
  const back = c.querySelector("#backHome"); if (back) back.onclick = () => setView("agenda");
  const cp = c.querySelector("#calPrev"), cn = c.querySelector("#calNext");
  if (cp) cp.onclick = () => { calM--; if (calM<0){calM=11;calY--;} render(); };
  if (cn) cn.onclick = () => { calM++; if (calM>11){calM=0;calY++;} render(); };
  c.querySelectorAll("[data-day]").forEach(d => d.onclick = () => { calSel = calSel === d.dataset.day ? null : d.dataset.day; render(); });
}

async function toggleExpand(id) {
  if (expandedTugas.has(id)) { expandedTugas.delete(id); render(); return; }
  expandedTugas.add(id); render();
  try { store._subs = store._subs || {}; store._subs[id] = await api("/submissions/" + id); const el = document.getElementById("sub-"+id); if (el) el.innerHTML = subListHTML(id); bindView(); }
  catch (e) { toast(e.message); }
}
async function downloadFile(fn, orig) {
  try { const res = await fetch("/api/files/"+encodeURIComponent(fn), { headers: { Authorization: "Bearer "+token } }); if (!res.ok) throw new Error("Gagal mengunduh");
    const blob = await res.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = orig||fn; a.click(); URL.revokeObjectURL(a.href); }
  catch (e) { toast(e.message); }
}
async function toggleTugas(id) {
  const t = store.tugas.find(x => x.id === id); const next = !(t.mine && t.mine.selesai);
  try { await api("/submissions/"+id, "POST", { selesai: next }); await reload("tugas"); updateChrome(); render(); toast(next?"Ditandai selesai ✓":"Diaktifkan kembali"); }
  catch (e) { toast(e.message); }
}
async function hapus(tipe, id) {
  const nama = { jadwal:"jadwal", tugas:"tugas", matkul:"mata kuliah", agenda:"agenda", catatan:"catatan", pertemuan:"pertemuan", kelompok:"kelompok", users:"pengguna" }[tipe];
  if (!confirm(`Hapus ${nama} ini?`)) return;
  try { await api("/"+tipe+"/"+id, "DELETE"); await reload(tipe); if (tipe==="pertemuan") await reload("tugas"); closeModal(); updateChrome(); render(); toast(`${nama} dihapus`); }
  catch (e) { toast(e.message); }
}

/* ============================================================
   Detail sheet
   ============================================================ */
function infoRow(ic, k, v) { return `<div class="info-row"><span class="ic">${ic}</span><span class="k">${k}</span><span class="v">${v}</span></div>`; }
function dateBadge(iso) { const d = iso ? new Date(iso + "T00:00") : null; return d ? `<div class="dh-badge"><span class="d">${d.getDate()}</span><span class="m">${BULAN[d.getMonth()]}</span></div>` : ""; }

function openDetail(kind, id) {
  if (kind === "pertemuan") {
    const p = store.pertemuan.find(x => x.id === id); if (!p) return;
    const tugasP = store.tugas.filter(t => t.pertemuanId === id);
    const jkLabel = { submit:"Submit", presentasi:"Presentasi", keduanya:"Submit + Presentasi" };
    document.getElementById("modalTitle").textContent = "Detail Pertemuan";
    document.getElementById("modalBody").innerHTML = `
      <div class="detail-hero">${dateBadge(p.tanggal)}
        <div><div class="dh-title">Pertemuan ${esc(p.pertemuanKe)}</div><div class="dh-sub">${esc(p.matkul)}</div></div></div>
      <div class="info-list">
        ${p.topik?infoRow("📖","Topik",esc(p.topik)):""}
        ${infoRow("🗓️","Tanggal",fmtTanggal(p.tanggal)||"-")}
        ${infoRow("🕑","Waktu",esc(jamRange(p.waktu,p.selesai)||"-"))}
        ${p.mode==="luring"
          ? infoRow("📍","Ruangan",esc(p.ruangan||"-"))
          : infoRow("💻","Mode","Daring") + (p.link?infoRow("🔗","Link",`<a class="file-link" href="${esc(p.link)}" target="_blank" rel="noopener">Buka Meeting</a>`):"") + (p.meetId?infoRow("🆔","Meeting ID",esc(p.meetId)):"") + (p.passcode?infoRow("🔑","Passcode",esc(p.passcode)):"")}
        ${p.pengampu?infoRow("👤","Dosen",esc(p.pengampu)):""}
        ${p.catatan?infoRow("📝","Catatan",esc(p.catatan)):""}
      </div>
      <div class="detail-sec"><h4>Tugas Pertemuan</h4>
        <div class="dtask">${tugasP.length?tugasP.map(t=>{
          const isPres = t.jenisKumpul==="presentasi" || t.jenisKumpul==="keduanya";
          const presenters = isPres && t.anggota && t.anggota.length ? `<div class="dtask-pres">🎤 Presentasi: ${t.anggota.map(a=>esc(a.nama)).join(", ")}</div>` : "";
          const canT = isManager() || (me && t.createdBy === me.id);
          return `<div class="dtask-row"><div class="dtask-main"><div class="t">${esc(t.judul)}</div>${presenters}</div>
            <div class="dtask-badges"><span class="badge ${t.tipe==="kelompok"?"sedang":"rendah"}">${t.tipe==="kelompok"?"Kelompok":"Individu"}</span><span class="tag blue">${jkLabel[t.jenisKumpul||"submit"]}</span>${canT?`<button class="btn-icon" data-tedit="${t.id}" title="Edit tugas">✎</button>`:""}</div></div>`;
        }).join(""):'<div class="dtask-empty">Belum ada tugas untuk pertemuan ini.</div>'}</div>
      </div>
      <div class="modal-actions">
        <button class="btn gold" data-addtugas="${p.id}" data-mk="${esc(p.matkul)}">＋ Tambah Tugas</button>
        ${isManager()?`<button class="btn" id="dEdit">✎ Edit</button><button class="btn ghost" id="dDel">Hapus</button>`:""}
      </div>`;
    openModal();
    document.querySelector('[data-addtugas]').onclick = () => openForm("tugas", null, { pertemuanId: p.id, matkul: p.matkul });
    document.querySelectorAll('[data-tedit]').forEach(b => b.onclick = () => openForm("tugas", b.dataset.tedit));
    if (isManager()) {
      document.getElementById("dEdit").onclick = () => openForm("pertemuan", p.id);
      document.getElementById("dDel").onclick = () => hapus("pertemuan", p.id);
    }
  } else {
    const a = store.agenda.find(x => x.id === id); if (!a) return;
    const canEdit = isManager() || a.ownerId === me.id;
    document.getElementById("modalTitle").textContent = "Detail Kegiatan";
    document.getElementById("modalBody").innerHTML = `
      <div class="detail-hero">${dateBadge(a.tanggal)}
        <div><div class="dh-title">${esc(a.judul)}</div><div class="dh-sub">${esc(a.kategori||"Kegiatan")}</div></div></div>
      <div class="info-list">
        ${infoRow("🗓️","Tanggal",fmtTanggal(a.tanggal)||"-")}
        ${infoRow("🕑","Waktu",esc(a.waktu||"-"))}
        ${a.kategori==="Tugas"?infoRow("👥","Jenis",a.tipe==="kelompok"?"Kelompok":"Individu"):""}
        ${infoRow("📍","Lokasi",esc(a.lokasi||"-"))}
        ${a.ownerNama?infoRow("✍","Dibuat oleh",esc(a.ownerNama)):""}
      </div>
      ${a.kategori==="Tugas" && a.tipe==="kelompok" && a.anggota && a.anggota.length ? `<div class="detail-sec"><h4>Anggota Kelompok (${a.anggota.length})</h4><div class="dtask"><div class="dtask-row"><div class="dtask-main"><div class="t" style="font-weight:500">${a.anggota.map(x=>esc(x.nama)).join(", ")}</div></div></div></div></div>` : ""}
      ${canEdit?`<div class="modal-actions"><button class="btn" id="dEdit">✎ Edit</button><button class="btn ghost" id="dDel">Hapus</button></div>`:""}`;
    openModal();
    if (canEdit) { document.getElementById("dEdit").onclick = () => openForm("agenda", a.id); document.getElementById("dDel").onclick = () => hapus("agenda", a.id); }
  }
}

/* ============================================================
   FAB
   ============================================================ */
function onFab() {
  if (currentView === "tugas") return openForm("tugas");
  if (currentView === "kalender") return openForm("agenda", null, calSel ? { tanggal: calSel } : null);
  // agenda
  if (isManager()) openChoice();
  else openForm("agenda");
}
function openChoice() {
  document.getElementById("modalTitle").textContent = "Tambah Baru";
  document.getElementById("modalBody").innerHTML = `<div class="choice-grid">
    <button class="choice-card" id="chP"><span class="choice-ic">🗓️</span><span class="choice-txt"><b>Pertemuan Kuliah</b><small>Jadwal sesi, topik, mode &amp; tugas</small></span><span class="choice-arrow">→</span></button>
    <button class="choice-card" id="chK"><span class="choice-ic alt">◐</span><span class="choice-txt"><b>Kegiatan / Agenda</b><small>Bimbingan, seminar, ujian, atau tugas</small></span><span class="choice-arrow">→</span></button>
  </div>`;
  openModal();
  document.getElementById("chP").onclick = () => openForm("pertemuan");
  document.getElementById("chK").onclick = () => openForm("agenda");
}

/* ============================================================
   Account sheet
   ============================================================ */
function openAccount() {
  document.getElementById("modalTitle").textContent = "Akun";
  const items = [];
  items.push(`<button data-go="catatan">📝 Catatan Pribadi</button>`);
  if (isManager()) {
    items.unshift(`<button data-go="jadwal">🗓️ Jadwal Mingguan</button>`);
    items.unshift(`<button data-go="kelompok">👥 Kelompok</button>`);
    items.unshift(`<button data-go="matkul">📚 Mata Kuliah</button>`);
  }
  if (isAdmin()) items.push(`<button data-go="pengguna">⚙️ Kelola Pengguna</button>`);
  items.push(`<button class="danger" id="acLogout">⎋ Keluar</button>`);
  document.getElementById("modalBody").innerHTML = `
    <div class="account-head"><div class="account-avatar">${esc(initial(me.nama))}</div>
      <div><div class="account-name">${esc(me.nama)}</div><div class="account-role"><span class="tag gold">${esc(me.role)}</span></div></div></div>
    <div class="account-actions">${items.join("")}</div>`;
  openModal();
  document.querySelectorAll("#modalBody [data-go]").forEach(b => b.onclick = () => { closeModal(); setView(b.dataset.go); });
  document.getElementById("acLogout").onclick = logout;
}

/* ============================================================
   Forms
   ============================================================ */
function matkulOptions(sel) { return `<option value="">— Umum / lainnya —</option>` + myMatkul().map(m => `<option ${m.nama===sel?"selected":""}>${esc(m.nama)}</option>`).join(""); }
function kelompokOptions(sel) { return `<option value="">— Tidak ada —</option>` + store.kelompok.map(k => `<option value="${esc(k.id)}" ${k.id===sel?"selected":""}>${esc(k.nama)}${k.matkul?" ("+esc(k.matkul)+")":""}</option>`).join(""); }
function pertemuanOptions(sel, matkulNama) {
  let list = store.pertemuan;
  if (matkulNama) list = list.filter(p => p.matkul === matkulNama);
  list = [...list].sort((a, b) => (a.pertemuanKe || 0) - (b.pertemuanKe || 0));
  return `<option value="">— Tanpa pertemuan —</option>` + list.map(p => `<option value="${esc(p.id)}" ${p.id===sel?"selected":""}>P${esc(p.pertemuanKe)}${matkulNama?"":" — "+esc(p.matkul)}${p.topik?" · "+esc(p.topik):""}</option>`).join("");
}

function openForm(tipe, id, preset) {
  const editing = !!id;
  const data = editing ? (store[tipe==="users"?"users":tipe].find(x => x.id === id) || {}) : (preset || {});
  document.getElementById("modalTitle").textContent = (editing?"Edit ":"Tambah ") + ({ jadwal:"Jadwal", tugas:"Tugas", matkul:"Mata Kuliah", agenda:"Kegiatan", catatan:"Catatan", pertemuan:"Pertemuan", kelompok:"Kelompok", users:"Pengguna" }[tipe]);
  let b = "";
  if (tipe === "jadwal") b = `
    <div class="field"><label>Mata Kuliah</label><select name="matkul">${matkulOptions(data.matkul)}</select></div>
    <div class="field"><label>Hari</label><select name="hari">${HARI.map(h=>`<option ${data.hari===h?"selected":""}>${h}</option>`).join("")}</select></div>
    <div class="field-row"><div class="field"><label>Mulai</label><input type="time" name="mulai" value="${esc(data.mulai||"08:00")}"></div><div class="field"><label>Selesai</label><input type="time" name="selesai" value="${esc(data.selesai||"10:00")}"></div></div>
    <div class="field"><label>Mode</label><select name="mode">${["Luring","Daring","Hibrida"].map(m=>`<option ${data.mode===m?"selected":""}>${m}</option>`).join("")}</select></div>
    <div class="field"><label>Ruang / Tautan</label><input name="ruang" value="${esc(data.ruang||"")}"></div>
    <div class="field"><label>Dosen</label><input name="dosen" value="${esc(data.dosen||"")}"></div>`;
  else if (tipe === "tugas") b = `
    <div class="field"><label>Mata Kuliah</label><select name="matkul" id="mMatkulT">${matkulOptions(data.matkul)}</select></div>
    <div class="field"><label>Judul Tugas</label><input name="judul" value="${esc(data.judul||"")}" placeholder="mis. Makalah / presentasi"></div>
    <div class="field-row"><div class="field"><label>Jenis</label><select name="tipe" id="mTipe">${["individu","kelompok"].map(x=>`<option value="${x}" ${data.tipe===x?"selected":""}>${x[0].toUpperCase()+x.slice(1)}</option>`).join("")}</select></div>
      <div class="field"><label>Pertemuan</label><select name="pertemuanId" id="mPertemuan">${pertemuanOptions(data.pertemuanId, data.matkul)}</select></div></div>
    <div class="field" id="mAnggotaWrap" style="${data.tipe==="kelompok"?"":"display:none"}">
      <label>Anggota Kelompok</label>
      <div style="display:flex;gap:8px;margin-bottom:6px"><button type="button" class="btn sm ghost" id="aAll">Pilih semua</button><button type="button" class="btn sm ghost" id="aNone">Kosongkan</button><span style="margin-left:auto;align-self:center;font-size:.78rem;color:var(--muted)" id="aCount"></span></div>
      <div id="mAnggota" style="max-height:34vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:6px"></div>
    </div>
    <div class="field"><label>Tenggat</label><input type="date" name="deadline" value="${esc(data.deadline||isoToday())}"></div>
    <div class="field"><label>Pengumpulan</label><select name="jenisKumpul">${[["submit","Submit"],["presentasi","Presentasi"],["keduanya","Keduanya"]].map(([v,l])=>`<option value="${v}" ${(data.jenisKumpul||"submit")===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label>Deskripsi / Instruksi</label><textarea name="deskripsi">${esc(data.deskripsi||"")}</textarea></div>`;
  else if (tipe === "pertemuan") b = `
    <div class="field"><label>Mata Kuliah</label><select name="matkul">${matkulOptions(data.matkul)}</select></div>
    <div class="field-row"><div class="field"><label>Pertemuan Ke-</label><input type="number" name="pertemuanKe" min="1" max="30" value="${esc(data.pertemuanKe||1)}"></div><div class="field"><label>Tanggal</label><input type="date" name="tanggal" value="${esc(data.tanggal||isoToday())}"></div></div>
    <div class="field-row"><div class="field"><label>Jam Mulai</label><input type="time" name="waktu" value="${esc(data.waktu||"")}"></div><div class="field"><label>Jam Selesai</label><input type="time" name="selesai" value="${esc(data.selesai||(data.waktu?addMinutes(data.waktu,120):""))}"></div></div>
    <div class="field"><label>Mode</label><select name="mode" id="mPMode">${[["daring","Daring"],["luring","Luring"]].map(([v,l])=>`<option value="${v}" ${(data.mode||"daring")===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div id="mPLuring" style="${data.mode==="luring"?"":"display:none"}"><div class="field"><label>Nama Ruangan</label><input name="ruangan" value="${esc(data.ruangan||"")}" placeholder="mis. Ruang Pascasarjana A"></div></div>
    <div id="mPDaring" style="${data.mode==="luring"?"display:none":""}">
      <div class="field"><label>Link Meeting</label><input name="link" value="${esc(data.link||"")}" placeholder="https://zoom.us/j/…"></div>
      <div class="field-row"><div class="field"><label>Meeting ID</label><input name="meetId" value="${esc(data.meetId||"")}" placeholder="988 2520 1146"></div><div class="field"><label>Passcode</label><input name="passcode" value="${esc(data.passcode||"")}" placeholder="passcode"></div></div>
    </div>
    <div class="field"><label>Topik</label><input name="topik" value="${esc(data.topik||"")}"></div>
    <div class="field"><label>Dosen Pengampu</label><input name="pengampu" value="${esc(data.pengampu||"")}"></div>
    <div class="field"><label>Catatan</label><textarea name="catatan">${esc(data.catatan||"")}</textarea></div>`;
  else if (tipe === "kelompok") b = `
    <div class="field"><label>Nama Kelompok</label><input name="nama" value="${esc(data.nama||"")}" placeholder="Kelompok 1"></div>
    <div class="field-row"><div class="field"><label>Mata Kuliah</label><select name="matkul">${matkulOptions(data.matkul)}</select></div><div class="field"><label>Ketua</label><input name="ketua" value="${esc(data.ketua||"")}"></div></div>
    <div class="field"><label>Anggota (satu per baris)</label><textarea name="anggota">${esc(data.anggota||"")}</textarea></div>`;
  else if (tipe === "users") b = `
    <div class="field"><label>Nama Lengkap</label><input name="nama" value="${esc(data.nama||"")}"></div>
    <div class="field"><label>Username</label><input name="username" value="${esc(data.username||"")}" ${editing?"disabled":""}></div>
    <div class="field"><label>Password ${editing?"(kosongkan jika tetap)":""}</label><input name="password" type="password" placeholder="min. 6 karakter"></div>
    <div class="field"><label>Peran</label><select name="role">${["mahasiswa","dosen","admin"].map(r=>`<option value="${r}" ${data.role===r?"selected":""}>${r[0].toUpperCase()+r.slice(1)}</option>`).join("")}</select></div>`;
  else if (tipe === "matkul") b = `
    <div class="field"><label>Nama Mata Kuliah</label><input name="nama" value="${esc(data.nama||"")}"></div>
    <div class="field-row"><div class="field"><label>Kode</label><input name="kode" value="${esc(data.kode||"")}"></div><div class="field"><label>SKS</label><input type="number" name="sks" min="0" max="12" value="${esc(data.sks??3)}"></div></div>
    <div class="field"><label>Dosen Pengampu</label><input name="dosen" value="${esc(data.dosen||"")}"></div>`;
  else if (tipe === "agenda") b = `
    <div class="field"><label>Kategori</label><select name="kategori" id="mAgKat">${["Bimbingan","Seminar","Ujian","Kuliah","Rapat","Tugas","Lainnya"].map(k=>`<option ${data.kategori===k?"selected":""}>${k}</option>`).join("")}</select></div>
    <div class="field"><label>Judul Kegiatan</label><input name="judul" value="${esc(data.judul||"")}" placeholder="mis. Bimbingan / Seminar / Tugas"></div>
    <div class="field" id="mAgJenis" style="${data.kategori==="Tugas"?"":"display:none"}"><label>Jenis</label><select name="tipe" id="mAgTipe">${[["individu","Individu"],["kelompok","Kelompok"]].map(([v,l])=>`<option value="${v}" ${(data.tipe||"individu")===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="field" id="mAgAnggotaWrap" style="${(data.kategori==="Tugas"&&data.tipe==="kelompok")?"":"display:none"}">
      <label>Anggota Kelompok</label>
      <div style="display:flex;gap:8px;margin-bottom:6px"><button type="button" class="btn sm ghost" id="agAll">Pilih semua</button><button type="button" class="btn sm ghost" id="agNone">Kosongkan</button><span style="margin-left:auto;align-self:center;font-size:.78rem;color:var(--muted)" id="agCount"></span></div>
      <div id="mAgAnggota" style="max-height:34vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:6px"></div>
    </div>
    <div class="field-row"><div class="field"><label>Tanggal</label><input type="date" name="tanggal" value="${esc(data.tanggal||isoToday())}"></div><div class="field"><label>Waktu</label><input type="time" name="waktu" value="${esc(data.waktu||"09:00")}"></div></div>
    <div class="field"><label>Lokasi</label><input name="lokasi" value="${esc(data.lokasi||"")}"></div>`;
  else if (tipe === "catatan") b = `
    <div class="field"><label>Judul</label><input name="judul" value="${esc(data.judul||"")}"></div>
    <div class="field"><label>Isi</label><textarea name="isi" style="min-height:140px">${esc(data.isi||"")}</textarea></div>`;
  b += `<div class="modal-actions"><button class="btn ghost" id="fCancel">Batal</button><button class="btn gold" id="fSave">${editing?"Simpan":"Tambah"}</button></div>`;
  document.getElementById("modalBody").innerHTML = b;
  openModal();
  if (tipe === "tugas") setupTugasForm(data);
  if (tipe === "agenda") setupAgendaForm(data);
  const pm = document.getElementById("mPMode");
  if (pm) pm.onchange = () => {
    const luring = pm.value === "luring";
    document.getElementById("mPLuring").style.display = luring ? "" : "none";
    document.getElementById("mPDaring").style.display = luring ? "none" : "";
  };
  document.getElementById("fCancel").onclick = closeModal;
  document.getElementById("fSave").onclick = () => simpanForm(tipe, id);
}

/* Daftar mahasiswa yang bisa jadi anggota kelompok (sesuai peserta matkul; kosong = semua) */
function availMahasiswa(matkulNama) {
  const m = store.matkul.find(x => x.nama === matkulNama);
  let list = store.mahasiswa;
  if (m && Array.isArray(m.peserta) && m.peserta.length) { const set = new Set(m.peserta); list = list.filter(u => set.has(u.id)); }
  return [...list].sort((a, b) => (a.username||"").localeCompare(b.username||""));
}
function setupTugasForm(data) {
  const tipeSel = document.getElementById("mTipe");
  const mkSel = document.getElementById("mMatkulT");
  const pertSel = document.getElementById("mPertemuan");
  const wrap = document.getElementById("mAnggotaWrap");
  const cont = document.getElementById("mAnggota");
  const countEl = document.getElementById("aCount");
  if (!tipeSel || !cont) return;
  const preselected = new Set((data.anggota || []).map(a => a.id));
  let firstDone = false;
  const updCount = () => { if (countEl) countEl.textContent = `${cont.querySelectorAll("input:checked").length} dipilih`; };
  const checkedNow = () => firstDone ? new Set(Array.from(cont.querySelectorAll("input:checked")).map(i => i.value)) : preselected;
  const fillAnggota = () => {
    const checked = checkedNow();
    const list = availMahasiswa(mkSel ? mkSel.value : data.matkul);
    cont.innerHTML = list.map(u => `<label style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #f1f5fb;font-size:.88rem">
      <input type="checkbox" value="${esc(u.id)}" data-nama="${esc(u.nama)}" ${checked.has(u.id)?"checked":""} style="width:auto">
      <span><b>${esc(u.nama)}</b> <span style="color:var(--muted);font-size:.76rem">@${esc(u.username)}</span></span></label>`).join("")
      || '<div class="progress-meta" style="padding:8px">Tidak ada mahasiswa pada mata kuliah ini.</div>';
    firstDone = true; updCount(); cont.onchange = updCount;
  };
  const refreshPertemuan = () => { if (pertSel) pertSel.innerHTML = pertemuanOptions(pertSel.value, mkSel ? mkSel.value : data.matkul); };
  const toggleAnggota = () => { const on = tipeSel.value === "kelompok"; wrap.style.display = on ? "" : "none"; if (on) fillAnggota(); };
  tipeSel.onchange = toggleAnggota;
  if (mkSel) mkSel.onchange = () => { refreshPertemuan(); if (tipeSel.value === "kelompok") fillAnggota(); };
  const aAll = document.getElementById("aAll"), aNone = document.getElementById("aNone");
  if (aAll) aAll.onclick = () => { cont.querySelectorAll("input").forEach(i => i.checked = true); updCount(); };
  if (aNone) aNone.onclick = () => { cont.querySelectorAll("input").forEach(i => i.checked = false); updCount(); };
  if (tipeSel.value === "kelompok") fillAnggota();
}
function setupAgendaForm(data) {
  const kat = document.getElementById("mAgKat");
  const jenisWrap = document.getElementById("mAgJenis");
  const tipeSel = document.getElementById("mAgTipe");
  const angWrap = document.getElementById("mAgAnggotaWrap");
  const cont = document.getElementById("mAgAnggota");
  const countEl = document.getElementById("agCount");
  if (!kat || !cont) return;
  const preselected = new Set((data.anggota || []).map(a => a.id));
  let firstDone = false;
  const updCount = () => { if (countEl) countEl.textContent = `${cont.querySelectorAll("input:checked").length} dipilih`; };
  const checkedNow = () => firstDone ? new Set(Array.from(cont.querySelectorAll("input:checked")).map(i => i.value)) : preselected;
  const fill = () => {
    const checked = checkedNow();
    cont.innerHTML = availMahasiswa("").map(u => `<label style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #f1f5fb;font-size:.88rem">
      <input type="checkbox" value="${esc(u.id)}" data-nama="${esc(u.nama)}" ${checked.has(u.id)?"checked":""} style="width:auto">
      <span><b>${esc(u.nama)}</b> <span style="color:var(--muted);font-size:.76rem">@${esc(u.username)}</span></span></label>`).join("")
      || '<div class="progress-meta" style="padding:8px">Belum ada mahasiswa.</div>';
    firstDone = true; updCount(); cont.onchange = updCount;
  };
  const updVis = () => {
    const isTugas = kat.value === "Tugas";
    jenisWrap.style.display = isTugas ? "" : "none";
    const on = isTugas && tipeSel.value === "kelompok";
    angWrap.style.display = on ? "" : "none";
    if (on) fill();
  };
  kat.onchange = updVis;
  tipeSel.onchange = updVis;
  const agAll = document.getElementById("agAll"), agNone = document.getElementById("agNone");
  if (agAll) agAll.onclick = () => { cont.querySelectorAll("input").forEach(i => i.checked = true); updCount(); };
  if (agNone) agNone.onclick = () => { cont.querySelectorAll("input").forEach(i => i.checked = false); updCount(); };
  if (kat.value === "Tugas" && tipeSel.value === "kelompok") fill();
}
function readForm() { const o = {}; document.querySelectorAll("#modalBody [name]").forEach(el => o[el.name] = typeof el.value === "string" ? el.value.trim() : el.value); return o; }
async function simpanForm(tipe, id) {
  const f = readForm();
  if ((tipe==="jadwal"||tipe==="pertemuan") && !f.matkul) return toast("Pilih mata kuliah dahulu");
  if ((tipe==="tugas"||tipe==="agenda"||tipe==="catatan") && !f.judul) return toast("Judul wajib diisi");
  if (tipe==="matkul" && !f.nama) return toast("Nama mata kuliah wajib");
  if (tipe==="kelompok" && !f.nama) return toast("Nama kelompok wajib");
  if (tipe==="users") { if (!f.nama || (!id && !f.username)) return toast("Nama & username wajib"); if (!id && (!f.password || f.password.length<6)) return toast("Password minimal 6 karakter"); }
  if (tipe==="matkul") f.sks = Number(f.sks)||0;
  if (tipe==="tugas") {
    const cont = document.getElementById("mAnggota");
    f.anggota = (f.tipe === "kelompok" && cont) ? Array.from(cont.querySelectorAll("input:checked")).map(i => ({ id: i.value, nama: i.dataset.nama || "" })) : [];
  }
  if (tipe==="agenda") {
    const cont = document.getElementById("mAgAnggota");
    f.anggota = (f.kategori === "Tugas" && f.tipe === "kelompok" && cont) ? Array.from(cont.querySelectorAll("input:checked")).map(i => ({ id: i.value, nama: i.dataset.nama || "" })) : [];
  }
  const ep = tipe==="users"?"users":tipe;
  try {
    if (id) await api(`/${ep}/${id}`, "PUT", f); else await api(`/${ep}`, "POST", f);
    await reload(ep);
    if (tipe==="pertemuan"||tipe==="tugas") { await reload("tugas"); await reload("pertemuan"); }
    closeModal(); updateChrome(); render(); loadNotif(); toast(id?"Tersimpan ✓":"Ditambahkan ✓");
  } catch (e) { toast(e.message); }
}

/* ---------- Kelola peserta mata kuliah ---------- */
function openPeserta(matkulId) {
  const m = store.matkul.find(x => x.id === matkulId); if (!m) return;
  const sel = new Set(m.peserta || []);
  document.getElementById("modalTitle").textContent = "Peserta — " + m.nama;
  const list = [...store.mahasiswa].sort((a,b) => (a.username||"").localeCompare(b.username||""));
  document.getElementById("modalBody").innerHTML = `
    <div class="field"><label>Pilih mahasiswa yang mengikuti mata kuliah ini. Jika tidak ada yang dipilih, dianggap diikuti semua mahasiswa.</label></div>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <button class="btn sm ghost" id="pAll">Pilih semua</button><button class="btn sm ghost" id="pNone">Kosongkan</button>
      <span style="margin-left:auto;align-self:center;font-size:.8rem;color:var(--muted)" id="pCount"></span>
    </div>
    <div id="pList" style="max-height:48vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:6px">
      ${list.map(u => `<label style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid #f1f5fb;font-size:.9rem">
        <input type="checkbox" value="${esc(u.id)}" ${sel.has(u.id)?"checked":""} style="width:auto">
        <span><b>${esc(u.nama)}</b><br><span style="color:var(--muted);font-size:.78rem">@${esc(u.username)}</span></span>
      </label>`).join("") || '<div class="progress-meta" style="padding:10px">Belum ada mahasiswa terdaftar.</div>'}
    </div>
    <div class="modal-actions"><button class="btn ghost" id="fCancel">Batal</button><button class="btn gold" id="fSave">Simpan</button></div>`;
  openModal();
  const boxes = () => Array.from(document.querySelectorAll('#pList input[type=checkbox]'));
  const upd = () => document.getElementById("pCount").textContent = `${boxes().filter(b=>b.checked).length} dipilih`;
  document.getElementById("pList").onchange = upd; upd();
  document.getElementById("pAll").onclick = () => { boxes().forEach(b=>b.checked=true); upd(); };
  document.getElementById("pNone").onclick = () => { boxes().forEach(b=>b.checked=false); upd(); };
  document.getElementById("fCancel").onclick = closeModal;
  document.getElementById("fSave").onclick = async () => {
    const peserta = boxes().filter(b=>b.checked).map(b=>b.value);
    try { await api(`/matkul/${matkulId}/peserta`, "PUT", { peserta }); await reload("matkul"); closeModal(); render(); toast("Peserta disimpan ✓"); }
    catch (e) { toast(e.message); }
  };
}

/* ---------- Submit tugas ---------- */
function openSubmit(id) {
  const t = store.tugas.find(x => x.id === id); const mine = t.mine || {};
  const jk = t.jenisKumpul || "submit";
  const perluBerkas = jk !== "presentasi";
  const isKelompok = t.tipe === "kelompok";
  const jkLabel = { submit:"Submit berkas", presentasi:"Presentasi", keduanya:"Submit + Presentasi" }[jk];
  document.getElementById("modalTitle").textContent = "Kumpulkan Tugas";
  document.getElementById("modalBody").innerHTML = `
    <div class="field"><label>Tugas</label><input value="${esc(t.judul)}" disabled></div>
    <div class="field"><label>Jenis Pengumpulan</label><input value="${jkLabel}" disabled></div>
    ${isKelompok?`<div class="field"><label>Nama Kelompok</label><input name="kelompok" value="${esc(mine.kelompok||"")}" placeholder="Kelompok 1"></div>`:""}
    ${perluBerkas?`<div class="field"><label>Unggah Berkas (maks 6 MB)</label><div class="file-input-row"><input type="file" id="subFile">${mine.fileOrig?`<span class="file-name-tag">Saat ini: ${esc(mine.fileOrig)}</span>`:""}</div></div>
    <div class="field"><label>Tautan Jawaban (opsional)</label><input name="link" value="${esc(mine.link||"")}" placeholder="https://…"></div>`:""}
    <div class="field"><label>Catatan untuk Dosen</label><textarea name="catatan">${esc(mine.catatan||"")}</textarea></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;margin-bottom:10px"><input type="checkbox" id="subDone" ${mine.selesai?"checked":""} style="width:auto"> ${jk==="presentasi"?"Tandai sudah presentasi":"Tandai selesai"}</label>
    <div class="modal-actions"><button class="btn ghost" id="fCancel">Batal</button><button class="btn gold" id="fSave">Kirim</button></div>`;
  openModal();
  document.getElementById("fCancel").onclick = closeModal;
  document.getElementById("fSave").onclick = () => kirimTugas(id);
}
function fileToB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); }); }
async function kirimTugas(id) {
  const g = s => { const el = document.querySelector(s); return el ? el.value.trim() : ""; };
  const payload = { catatan: g('#modalBody [name="catatan"]'), link: g('#modalBody [name="link"]'), kelompok: g('#modalBody [name="kelompok"]'), selesai: document.getElementById("subDone").checked };
  try {
    const fileEl = document.getElementById("subFile"); const file = fileEl && fileEl.files[0];
    if (file) { if (file.size > 6*1024*1024) return toast("Ukuran file maksimal 6 MB"); payload.fileBase64 = await fileToB64(file); payload.fileOrig = file.name; }
    await api("/submissions/"+id, "POST", payload); await reload("tugas"); closeModal(); updateChrome(); render(); toast("Tugas dikumpulkan ✓");
  } catch (e) { toast(e.message); }
}

/* ---------- Modal ---------- */
function openModal() { document.getElementById("modalOverlay").hidden = false; }
function closeModal() { document.getElementById("modalOverlay").hidden = true; }

/* ============================================================
   Init
   ============================================================ */
function init() {
  document.getElementById("loginForm").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const err = document.getElementById("loginError"); err.hidden = true;
    try { await doLogin(fd.get("username").trim(), fd.get("password")); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => setView(t.dataset.tab));
  document.getElementById("fab").onclick = onFab;
  document.getElementById("avatarBtn").onclick = openAccount;
  document.getElementById("bellBtn").onclick = openNotif;
  document.getElementById("modalClose").onclick = closeModal;
  document.getElementById("modalOverlay").onclick = (e) => { if (e.target.id === "modalOverlay") closeModal(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
  const si = document.getElementById("searchInput");
  si.oninput = () => { searchTerm = si.value.trim(); if (currentView === "agenda") render(); };
  boot();
}
document.addEventListener("DOMContentLoaded", init);
