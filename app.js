// Reads the hourly-generated data.json and renders the availability summary.
const statusLine = document.getElementById("status-line");
const refreshBtn = document.getElementById("refresh-btn");
const projectName = document.getElementById("project-name");

const el = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("tr-TR");
const tl = (n) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
function tlShort(n) {
  if (n >= 1e9) return (n / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr ₺";
  if (n >= 1e6) return (n / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " Mn ₺";
  return tl(n);
}

refreshBtn.addEventListener("click", load);

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function statCard(label, value, sub, cls, swatch) {
  return `
    <div class="stat ${cls}">
      <div class="stat-label">${swatch ? `<span class="swatch ${swatch}"></span>` : ""}${label}</div>
      <div class="stat-value">${fmt(value)}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
}

function render(d) {
  projectName.textContent = d.project;
  const s = d.status;
  const total = d.total;

  // Headline stats
  el("stat-row").innerHTML =
    statCard("Toplam Daire", total, `${d.by_block.length} blok`, "total") +
    statCard("Müsait", s.available, `%${pct(s.available, total)}`, "available", "sw-available") +
    statCard("Satılan", s.sold, `%${pct(s.sold, total)}`, "sold", "sw-sold") +
    statCard("Rezerve", s.reserved, `%${pct(s.reserved, total)}`, "reserved", "sw-reserved");

  // Overall progress bar
  el("prog").innerHTML = `
    <span class="p-available" style="width:${pct(s.available, total)}%"></span>
    <span class="p-sold" style="width:${pct(s.sold, total)}%"></span>
    <span class="p-reserved" style="width:${pct(s.reserved, total)}%"></span>`;
  el("prog-legend").innerHTML = `
    <span><span class="swatch sw-available"></span> Müsait ${fmt(s.available)} (%${pct(s.available, total)})</span>
    <span><span class="swatch sw-sold"></span> Satılan ${fmt(s.sold)} (%${pct(s.sold, total)})</span>
    <span><span class="swatch sw-reserved"></span> Rezerve ${fmt(s.reserved)} (%${pct(s.reserved, total)})</span>`;

  // Pricing (available stock)
  const p = d.pricing || {};
  el("pricing").innerHTML = `
    <div class="price-cell"><div class="pc-label">Müsait stok değeri</div><div class="pc-val">${tlShort(p.available_value || 0)}</div></div>
    <div class="price-cell"><div class="pc-label">Satılan değeri</div><div class="pc-val">${tlShort(p.sold_value || 0)}</div></div>
    <div class="price-cell"><div class="pc-label">Ortalama fiyat</div><div class="pc-val">${tl(p.avg_available_price || 0)}</div></div>
    <div class="price-cell"><div class="pc-label">Fiyat aralığı</div><div class="pc-val small">${tl(p.min_available_price || 0)} – ${tl(p.max_available_price || 0)}</div></div>`;

  // Rooms
  el("rooms").innerHTML = d.by_rooms.map((r) => `
    <div class="room-row">
      <div class="room-head">
        <span class="room-name">${r.key}</span>
        <span class="room-nums"><b>${fmt(r.available)}</b> müsait / ${fmt(r.total)} toplam${r.avg_available_price ? ` · ort. ${tlShort(r.avg_available_price)}` : ""}</span>
      </div>
      <div class="room-bar">
        <span class="rb-available" style="width:${pct(r.available, r.total)}%"></span>
        <span class="rb-sold" style="width:${pct(r.sold, r.total)}%"></span>
        <span class="rb-reserved" style="width:${pct(r.reserved, r.total)}%"></span>
      </div>
    </div>`).join("");

  // Block summary highlights
  const blocks = d.by_block;
  const soldOut = blocks.filter((b) => b.available === 0).length;
  const mostAvail = [...blocks].sort((a, b) => b.available - a.available)[0];
  const bestSold = [...blocks].sort((a, b) => b.sold - a.sold)[0];
  el("block-summary").innerHTML = `
    <div class="bs-row"><span class="bs-label">Toplam blok</span><span class="bs-val">${blocks.length}</span></div>
    <div class="bs-row"><span class="bs-label">Tükenen blok (0 müsait)</span><span class="bs-val">${soldOut}</span></div>
    <div class="bs-row"><span class="bs-label">En çok müsait</span><span class="bs-val">${mostAvail.label} · ${fmt(mostAvail.available)}</span></div>
    <div class="bs-row"><span class="bs-label">En çok satılan</span><span class="bs-val">${bestSold.label} · ${fmt(bestSold.sold)}</span></div>`;

  // All blocks
  el("block-count").textContent = blocks.length;
  el("blocks").innerHTML = blocks.map((b) => `
    <div class="block-cell ${b.available === 0 ? "sold-out" : ""}" title="${b.label}: ${b.available} müsait, ${b.sold} satılan, ${b.reserved} rezerve${b.avg_available_price ? ` · ort. ${tl(b.avg_available_price)}` : ""}">
      <div class="bc-name">${b.name}</div>
      <div class="bc-ada">${b.island ? "Ada " + b.island : ""}</div>
      <div class="bc-bar">
        <span class="bc-available" style="width:${pct(b.available, b.total)}%"></span>
        <span class="bc-sold" style="width:${pct(b.sold, b.total)}%"></span>
        <span class="bc-reserved" style="width:${pct(b.reserved, b.total)}%"></span>
      </div>
      <div class="bc-nums"><b>${b.available}</b> / ${b.total}</div>
      ${b.avg_available_price ? `<div class="bc-price">${tlShort(b.avg_available_price)}</div>` : ""}
    </div>`).join("");

  const when = new Date(d.updated_at);
  statusLine.textContent = `Güncellendi ${when.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

async function load() {
  refreshBtn.classList.add("loading");
  refreshBtn.disabled = true;
  try {
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
// Re-check the file every 10 min (the Action refreshes it hourly).
setInterval(load, 600000);
