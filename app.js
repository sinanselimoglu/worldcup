// Reads hourly-generated data.json (certificate COUNTS per apartment) and the
// live certificate price (DMLKT.G on Fintables), then shows TL values.
const statusLine = document.getElementById("status-line");
const refreshBtn = document.getElementById("refresh-btn");
const projectName = document.getElementById("project-name");

const el = (id) => document.getElementById(id);
const fmtInt = (n) => Math.round(n).toLocaleString("tr-TR");
const tl = (n) => Math.round(n).toLocaleString("tr-TR") + " ₺";
function tlShort(n) {
  if (n >= 1e9) return (n / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr ₺";
  if (n >= 1e6) return (n / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mn ₺";
  return tl(n);
}
const price4 = (n) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const STOCK_URL = (from, to) =>
  `https://gate.fintables.com/barbar/udf/history?symbol=DMLKT.G&resolution=5&from=${from}&to=${to}`;
const aptUrl = (id) => `https://proje.gayrimenkulsertifika.com/apartments/${id}`;

let certPrice = null; // live TL per certificate
let ipoPrice = 7.59;
let cachedData = null;

refreshBtn.addEventListener("click", load);

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

// TL value of a certificate count at the live price (falls back to IPO price).
function toTL(certCount) {
  return certCount * (certPrice || ipoPrice);
}

// ---- Live certificate price -------------------------------------------------
async function loadCertPrice() {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 3 * 86400;
  try {
    const r = await fetch(STOCK_URL(from, to));
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const closes = j.c || [];
    const times = j.t || [];
    if (!closes.length) throw new Error("no data");
    const last = j.realtime_price && typeof j.realtime_price === "number" ? j.realtime_price : closes[closes.length - 1];
    // day open = first close of the last calendar day in the series
    const lastDay = new Date(times[times.length - 1] * 1000).getDate();
    let dayOpen = closes[closes.length - 1];
    for (let i = 0; i < times.length; i++) {
      if (new Date(times[i] * 1000).getDate() === lastDay) { dayOpen = closes[i]; break; }
    }
    certPrice = last;
    const change = last - dayOpen;
    const changePct = dayOpen ? (change / dayOpen) * 100 : 0;
    renderCertBanner(last, change, changePct, times[times.length - 1]);
  } catch (err) {
    console.warn("cert price failed:", err.message);
    el("cert-price").textContent = `${price4(ipoPrice)} ₺`;
    el("cert-change").textContent = "";
    el("cert-meta").innerHTML = `<span class="pb-warn">Canlı fiyat alınamadı — halka arz fiyatı gösteriliyor</span>`;
  }
}

function renderCertBanner(last, change, changePct, ts) {
  el("cert-price").textContent = `${price4(last)} ₺`;
  const up = change >= 0;
  el("cert-change").className = "pb-change " + (up ? "up" : "down");
  el("cert-change").textContent = `${up ? "▲" : "▼"} ${price4(Math.abs(change))} (%${Math.abs(changePct).toFixed(2)})`;
  const when = ts ? new Date(ts * 1000).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  el("cert-meta").innerHTML = `Halka arz: ${price4(ipoPrice)} ₺ · Son: ${when}`;
}

// ---- Main render ------------------------------------------------------------
function render(d) {
  cachedData = d;
  projectName.textContent = d.project;
  ipoPrice = d.ipo_price || 7.59;
  const s = d.status;
  const total = d.total;

  // Headline stats
  el("stat-row").innerHTML =
    statCard("Toplam Daire", fmtInt(total), `${d.by_block.length} blok`, "total") +
    statCard("Müsait", fmtInt(s.available), `%${pct(s.available, total)}`, "available", "sw-available") +
    statCard("Satılan", fmtInt(s.sold), `%${pct(s.sold, total)}`, "sold", "sw-sold") +
    statCard("Rezerve", fmtInt(s.reserved), `%${pct(s.reserved, total)}`, "reserved", "sw-reserved");

  el("prog").innerHTML = `
    <span class="p-available" style="width:${pct(s.available, total)}%"></span>
    <span class="p-sold" style="width:${pct(s.sold, total)}%"></span>
    <span class="p-reserved" style="width:${pct(s.reserved, total)}%"></span>`;
  el("prog-legend").innerHTML = `
    <span><span class="swatch sw-available"></span> Müsait ${fmtInt(s.available)} (%${pct(s.available, total)})</span>
    <span><span class="swatch sw-sold"></span> Satılan ${fmtInt(s.sold)} (%${pct(s.sold, total)})</span>
    <span><span class="swatch sw-reserved"></span> Rezerve ${fmtInt(s.reserved)} (%${pct(s.reserved, total)})</span>`;

  renderRecent(d);
  renderCheapest(d);
  renderRooms(d);
  renderBlockSummary(d);
  renderBlocks(d);

  const when = new Date(d.updated_at);
  statusLine.textContent = `Güncellendi ${when.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

function statCard(label, value, sub, cls, swatch) {
  return `
    <div class="stat ${cls}">
      <div class="stat-label">${swatch ? `<span class="swatch ${swatch}"></span>` : ""}${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
}

// Recent status changes (sold / reserved), newest first.
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} dk önce`;
  if (diff < 86400) return `${Math.round(diff / 3600)} sa önce`;
  return `${Math.round(diff / 86400)} gün önce`;
}

function renderRecent(d) {
  const sub = el("recent-sub");
  const since = d.tracking_since ? new Date(d.tracking_since).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : null;
  sub.innerHTML = `<span class="rc-badge sold">${d.sold_24h || 0} son 24s</span><span class="rc-badge">${d.sold_7d || 0} son 7g</span>${since ? ` · ${since}'den beri takip` : ""}`;

  const changes = d.recent_changes || [];
  if (!changes.length) {
    el("recent").innerHTML = `<p class="empty">Takip başladığından beri durum değişikliği yok. Yeni satış/rezervasyonlar burada görünecek.</p>`;
    return;
  }
  el("recent").innerHTML = changes.map((e) => {
    const isSold = e.to === 2;
    const badge = isSold ? `<span class="rc-tag sold">Satıldı</span>` : e.to === 3 ? `<span class="rc-tag reserved">Rezerve</span>` : `<span class="rc-tag">${e.to_key}</span>`;
    return `
      <a class="rc-row" href="${aptUrl(e.id)}" target="_blank" rel="noopener">
        ${badge}
        <span class="rc-info">${e.room}${e.net_area ? ` · ${e.net_area} m²` : ""} · ${e.label} · No ${e.no}</span>
        <span class="rc-price">${tl(toTL(e.price))}</span>
        <span class="rc-time">${timeAgo(e.ts)}</span>
      </a>`;
  }).join("");
}

// Available units per room type, cheapest first, paginated (20 at a time).
const PAGE = 20;
const shown = {}; // room -> how many rows currently displayed

function chRow(u, i) {
  const tag = u.id ? "a" : "div";
  const href = u.id ? ` href="${aptUrl(u.id)}" target="_blank" rel="noopener"` : "";
  return `
    <${tag} class="ch-row"${href}>
      <span class="ch-rank">${i + 1}</span>
      <span class="ch-loc">${u.block} · No ${u.no}${u.net_area ? ` · ${u.net_area} m²` : ""}</span>
      <span class="ch-price">
        <span class="ch-tl">${tl(toTL(u.price))}</span>
        <span class="ch-cert">${fmtInt(u.price)} sertifika</span>
      </span>
    </${tag}>`;
}

// Re-render just one room card's rows + button (keeps its current "shown" count).
function paintRoom(room) {
  const d = cachedData;
  const units = (d.available_by_room && d.available_by_room[room]) || [];
  const n = Math.min(shown[room], units.length);
  const rowsEl = document.querySelector(`.ch-card[data-room="${room}"] .ch-rows`);
  const btnEl = document.querySelector(`.ch-card[data-room="${room}"] .ch-more`);
  if (!rowsEl) return;
  rowsEl.innerHTML = units.slice(0, n).map(chRow).join("") ||
    '<div class="empty">Müsait daire yok</div>';
  if (btnEl) {
    const remaining = units.length - n;
    if (remaining > 0) {
      btnEl.hidden = false;
      btnEl.textContent = `Daha fazla göster (${Math.min(PAGE, remaining)} / ${remaining} kaldı)`;
    } else {
      btnEl.hidden = true;
    }
  }
}

function renderCheapest(d) {
  const roomsMeta = Object.fromEntries(d.by_rooms.map((r) => [r.key, r]));
  el("cheapest").innerHTML = Object.keys(d.available_by_room).map((room) => {
    const meta = roomsMeta[room] || {};
    if (shown[room] == null) shown[room] = PAGE; // initial page
    return `
      <div class="ch-card" data-room="${room}">
        <div class="ch-head">
          <span class="ch-room">${room}</span>
          <span class="ch-stock">${fmtInt(meta.available || 0)} müsait · başlangıç ${tlShort(toTL(meta.min_available_price || 0))}</span>
        </div>
        <div class="ch-rows"></div>
        <button class="ch-more" data-room="${room}" hidden></button>
      </div>`;
  }).join("");
  Object.keys(d.available_by_room).forEach(paintRoom);
}

// "Daha fazla göster" — reveal 20 more for that room.
el("cheapest").addEventListener("click", (e) => {
  const btn = e.target.closest(".ch-more");
  if (!btn) return;
  const room = btn.dataset.room;
  shown[room] = (shown[room] || PAGE) + PAGE;
  paintRoom(room);
});

// By room type: starting + max price
function renderRooms(d) {
  el("rooms").innerHTML = d.by_rooms.map((r) => `
    <div class="room-row">
      <div class="room-head">
        <span class="room-name">${r.key}</span>
        <span class="room-nums"><b>${fmtInt(r.available)}</b> müsait</span>
      </div>
      <div class="room-prices">
        <span>Başlangıç: <b>${tl(toTL(r.min_available_price))}</b></span>
        <span>En yüksek: <b>${tl(toTL(r.max_available_price))}</b></span>
      </div>
      <div class="room-bar">
        <span class="rb-available" style="width:${pct(r.available, r.total)}%"></span>
        <span class="rb-sold" style="width:${pct(r.sold, r.total)}%"></span>
        <span class="rb-reserved" style="width:${pct(r.reserved, r.total)}%"></span>
      </div>
    </div>`).join("");
}

function renderBlockSummary(d) {
  const blocks = d.by_block;
  const soldOut = blocks.filter((b) => b.available === 0).length;
  const mostAvail = [...blocks].sort((a, b) => b.available - a.available)[0];
  const bestSold = [...blocks].sort((a, b) => b.sold - a.sold)[0];
  el("block-summary").innerHTML = `
    <div class="bs-row"><span class="bs-label">Toplam blok</span><span class="bs-val">${blocks.length}</span></div>
    <div class="bs-row"><span class="bs-label">Tükenen blok (0 müsait)</span><span class="bs-val">${soldOut}</span></div>
    <div class="bs-row"><span class="bs-label">En çok müsait</span><span class="bs-val">${mostAvail.label} · ${fmtInt(mostAvail.available)}</span></div>
    <div class="bs-row"><span class="bs-label">En çok satılan</span><span class="bs-val">${bestSold.label} · ${fmtInt(bestSold.sold)}</span></div>`;
}

// All blocks: min price + stock, max price + stock, average
function renderBlocks(d) {
  const blocks = d.by_block;
  el("block-count").textContent = blocks.length;
  el("blocks").innerHTML = blocks.map((b) => `
    <div class="block-cell ${b.available === 0 ? "sold-out" : ""}">
      <div class="bc-name">${b.name}</div>
      <div class="bc-ada">${b.island ? "Ada " + b.island : ""}</div>
      <div class="bc-bar">
        <span class="bc-available" style="width:${pct(b.available, b.total)}%"></span>
        <span class="bc-sold" style="width:${pct(b.sold, b.total)}%"></span>
        <span class="bc-reserved" style="width:${pct(b.reserved, b.total)}%"></span>
      </div>
      <div class="bc-nums"><b>${b.available}</b> müsait / ${b.total}</div>
      ${b.available ? `
      <div class="bc-prices">
        <div><span>Min</span> ${tlShort(toTL(b.min_available_price))}</div>
        <div><span>Ort</span> ${tlShort(toTL(b.avg_available_price))}</div>
        <div><span>Max</span> ${tlShort(toTL(b.max_available_price))}</div>
      </div>` : ""}
    </div>`).join("");
}

async function load() {
  refreshBtn.classList.add("loading");
  refreshBtn.disabled = true;
  try {
    // Live price first so TL values render correctly on first paint.
    await loadCertPrice();
    const res = await fetch(`data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`data ${res.status}`);
    render(await res.json());
  } catch (err) {
    statusLine.textContent = `Veri yüklenemedi: ${err.message}`;
    console.error(err);
  } finally {
    refreshBtn.classList.remove("loading");
    refreshBtn.disabled = false;
  }
}

load();
setInterval(load, 600000); // re-check every 10 min
