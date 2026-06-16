const REFRESH_MS = 60000;

const SPORT = "soccer/fifa.world";
const ESPN_BASE = `https://site.api.espn.com/apis/site/v2/sports/${SPORT}`;
const ESPN_SCOREBOARD = `${ESPN_BASE}/scoreboard?dates=20260611-20260719`;
const ESPN_SUMMARY = (id) => `${ESPN_BASE}/summary?event=${id}`;
const ESPN_STANDINGS = `https://site.api.espn.com/apis/v2/sports/${SPORT}/standings`;
const FALLBACK_URL = "matches.json";

const statusLine = document.getElementById("status-line");
const liveEl = document.getElementById("live-matches");
const upcomingEl = document.getElementById("upcoming-matches");
const finishedEl = document.getElementById("finished-matches");
const standingsEl = document.getElementById("standings");
const refreshBtn = document.getElementById("refresh-btn");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
const tabs = document.getElementById("tabs");
const liveCount = document.getElementById("live-count");
let defaultTabPicked = false;

tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const name = btn.dataset.tab;
  tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
});

refreshBtn.addEventListener("click", () => loadAll());
modal.addEventListener("click", (e) => {
  if (e.target === modal || e.target.closest("[data-close]")) closeModal();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// --- Normalize ESPN scoreboard --------------------------------------------

function fromEspn(json) {
  return (json.events || []).map((e) => {
    const comp = e.competitions[0];
    const st = e.status.type;
    const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
    const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
    const state = st.state === "in" ? "live" : st.state === "post" ? "finished" : "upcoming";

    const goals = (comp.details || [])
      .filter((d) => d.scoringPlay)
      .map((d) => ({
        teamId: d.team?.id,
        clock: d.clock?.displayValue || "",
        scorer: (d.athletesInvolved?.[0]?.displayName) || "",
        ownGoal: !!d.ownGoal,
        penalty: !!d.penaltyKick,
      }));

    const team = (c) => ({
      id: c.team.id,
      name: c.team.shortDisplayName || c.team.displayName,
      crest: c.team.logo || "",
      score: c.score,
    });

    return {
      id: e.id,
      state,
      stage: (comp.notes && comp.notes[0] && comp.notes[0].headline) || "",
      minute: state === "live" ? st.detail : "",
      home: team(home),
      away: team(away),
      goals,
      venue: comp.venue?.fullName || "",
      tv: (comp.broadcasts?.[0]?.names || []).join(", "),
      date: e.date,
    };
  });
}

function fromFootballData(json) {
  return (json.matches || []).map((m) => {
    const state =
      m.status === "IN_PLAY" || m.status === "PAUSED" ? "live"
      : m.status === "FINISHED" ? "finished" : "upcoming";
    const hs = m.score.fullTime.home ?? m.score.halfTime.home;
    const as = m.score.fullTime.away ?? m.score.halfTime.away;
    const team = (t, s) => ({ id: t.id, name: t.shortName || t.name, crest: t.crest || "", score: s ?? "" });
    return {
      id: m.id, state, stage: (m.group || m.stage || "").replace(/_/g, " "), minute: "",
      home: team(m.homeTeam, hs), away: team(m.awayTeam, as),
      goals: [], venue: m.venue || "", tv: "", date: m.utcDate,
    };
  });
}

// --- Match cards -----------------------------------------------------------

function scorerList(goals) {
  if (!goals.length) return "";
  return `<div class="scorers">${goals
    .map((g) => `<span>⚽ ${g.scorer}${g.penalty ? " (P)" : ""}${g.ownGoal ? " (OG)" : ""} ${g.clock}</span>`)
    .join("")}</div>`;
}

function teamRow(team, goals, showScore, isWinner) {
  const crest = team.crest
    ? `<img class="crest" src="${team.crest}" alt="" onerror="this.style.display='none'">` : "";
  const mine = goals.filter((g) => g.teamId === team.id);
  return `
    <div class="team-row${isWinner ? " winner" : ""}">
      <div>
        <span class="team-name">${crest}${team.name}</span>
        ${scorerList(mine)}
      </div>
      <span class="team-score">${showScore ? team.score : ""}</span>
    </div>`;
}

function matchCard(m) {
  const isLive = m.state === "live";
  const showScore = m.state !== "upcoming";
  const hs = Number(m.home.score), as = Number(m.away.score);
  const topRight = isLive
    ? `<span class="live-badge">${m.minute || "LIVE"}</span>`
    : `<span class="stage-tag">${m.state === "finished" ? "FT" : formatDate(m.date)}</span>`;

  const meta = [m.venue, m.tv].filter(Boolean).join(" · ");

  const card = document.createElement("div");
  card.className = "match-card" + (isLive ? " live" : "");
  card.dataset.id = m.id;
  card.innerHTML = `
    <div class="card-top">
      <span class="stage-tag">${m.stage || ""}</span>
      ${topRight}
    </div>
    ${teamRow(m.home, m.goals, showScore, m.state === "finished" && hs > as)}
    ${teamRow(m.away, m.goals, showScore, m.state === "finished" && as > hs)}
    <div class="card-time">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      ${formatDate(m.date)}${meta ? ` · ${meta}` : ""}
    </div>
  `;
  card.addEventListener("click", () => openMatch(m));
  return card;
}

function render(container, matches, emptyText) {
  container.innerHTML = "";
  if (!matches.length) {
    container.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }
  matches.forEach((m) => container.appendChild(matchCard(m)));
}

// --- Match detail modal ----------------------------------------------------

function openModal(html) {
  modalBody.innerHTML = html;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  modal.classList.remove("open");
  document.body.style.overflow = "";
}

async function openMatch(m) {
  openModal(`<div class="modal-loading">Loading match details…</div>`);
  let detail = "";
  try {
    const res = await fetch(`${ESPN_SUMMARY(m.id)}&_=${Date.now()}`);
    if (res.ok) detail = renderSummary(await res.json());
  } catch (err) {
    console.warn("summary failed", err.message);
  }
  const header = `
    <button class="modal-close" data-close aria-label="Close">×</button>
    <div class="modal-head">
      <div class="modal-team">${m.home.crest ? `<img src="${m.home.crest}" alt="">` : ""}<span>${m.home.name}</span></div>
      <div class="modal-score">${m.state === "upcoming" ? "vs" : `${m.home.score} – ${m.away.score}`}</div>
      <div class="modal-team">${m.away.crest ? `<img src="${m.away.crest}" alt="">` : ""}<span>${m.away.name}</span></div>
    </div>
    <div class="modal-sub">${[m.stage, m.minute || (m.state === "finished" ? "Full time" : formatDate(m.date))].filter(Boolean).join(" · ")}</div>
  `;
  openModal(header + (detail || `<p class="empty">No extra details available yet.</p>`));
}

function renderSummary(d) {
  let out = "";
  const gi = d.gameInfo || {};
  const info = [
    gi.venue?.fullName && `🏟️ ${gi.venue.fullName}`,
    gi.attendance && `👥 ${Number(gi.attendance).toLocaleString()}`,
  ].filter(Boolean);
  if (info.length) out += `<div class="modal-info">${info.join(" · ")}</div>`;

  const ke = (d.keyEvents || []).filter((e) => {
    const t = e.type?.text || "";
    return /Goal|Card|Penalty|Substitution/i.test(t);
  });
  if (ke.length) {
    out += `<h3>Timeline</h3><ul class="timeline">`;
    for (const e of ke) {
      const clock = e.clock?.displayValue || "";
      const type = e.type?.text || "";
      const icon = /Goal/i.test(type) ? "⚽" : /Yellow/i.test(type) ? "🟨" : /Red/i.test(type) ? "🟥" : /Substitution/i.test(type) ? "🔄" : "•";
      out += `<li><span class="tl-clock">${clock}</span><span class="tl-icon">${icon}</span><span>${e.text || type}</span></li>`;
    }
    out += `</ul>`;
  }

  const rosters = d.rosters || [];
  if (rosters.length === 2 && rosters[0].roster?.length) {
    out += `<h3>Lineups</h3><div class="lineups">`;
    for (const r of rosters) {
      const starters = (r.roster || []).filter((p) => p.starter !== false).slice(0, 11);
      out += `<div><div class="lineup-team">${r.team?.displayName || ""}</div><ul>${
        starters.map((p) => `<li>${p.athlete?.displayName || ""}</li>`).join("")
      }</ul></div>`;
    }
    out += `</div>`;
  }
  return out;
}

// --- Standings -------------------------------------------------------------

async function loadStandings() {
  try {
    const res = await fetch(`${ESPN_STANDINGS}?_=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    const groups = d.children || [];
    standingsEl.innerHTML = "";
    for (const g of groups) {
      const entries = g.standings?.entries || [];
      if (!entries.length) continue;
      const stat = (e, name) => e.stats.find((s) => s.name === name)?.displayValue ?? "";
      const rows = entries.map((e, i) => `
        <tr>
          <td class="pos">${i + 1}</td>
          <td class="t">${e.team.logos?.[0]?.href ? `<img src="${e.team.logos[0].href}" alt="">` : ""}${e.team.abbreviation || e.team.displayName}</td>
          <td>${stat(e, "gamesPlayed")}</td>
          <td>${stat(e, "wins")}</td>
          <td>${stat(e, "ties")}</td>
          <td>${stat(e, "losses")}</td>
          <td>${stat(e, "pointDifferential")}</td>
          <td class="pts">${stat(e, "points")}</td>
        </tr>`).join("");
      standingsEl.insertAdjacentHTML("beforeend", `
        <div class="group-table">
          <h3>${g.name}</h3>
          <table>
            <thead><tr><th></th><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`);
    }
  } catch (err) {
    console.warn("standings failed", err.message);
    document.getElementById("standings-section").style.display = "none";
  }
}

// --- Load orchestration ----------------------------------------------------

async function fetchMatches() {
  try {
    const res = await fetch(`${ESPN_SCOREBOARD}&_=${Date.now()}`);
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    return { matches: fromEspn(await res.json()), source: "live" };
  } catch (err) {
    console.warn("ESPN failed, using fallback:", err.message);
    const res = await fetch(`${FALLBACK_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`fallback ${res.status}`);
    return { matches: fromFootballData(await res.json()), source: "cache" };
  }
}

async function loadMatches() {
  const { matches, source } = await fetchMatches();
  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  const live = matches.filter((m) => m.state === "live");
  const upcoming = matches.filter((m) => m.state === "upcoming");
  const finished = matches.filter((m) => m.state === "finished")
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  render(liveEl, live, "No live matches right now.");
  render(upcomingEl, upcoming.slice(0, 20), "No upcoming matches scheduled.");
  render(finishedEl, finished.slice(0, 30), "No results yet.");

  // Live count badge
  if (live.length) {
    liveCount.textContent = live.length;
    liveCount.hidden = false;
  } else {
    liveCount.hidden = true;
  }

  // On first load, open the most useful tab: Live if any, else Upcoming.
  if (!defaultTabPicked) {
    defaultTabPicked = true;
    const name = live.length ? "live" : "upcoming";
    tabs.querySelector(`.tab[data-tab="${name}"]`)?.click();
  }

  statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}${source === "live" ? "" : " · cached"}`;
}

async function loadAll() {
  refreshBtn.classList.add("loading");
  refreshBtn.disabled = true;
  try {
    await Promise.all([loadMatches(), loadStandings()]);
  } catch (err) {
    statusLine.textContent = `Could not load: ${err.message}`;
    console.error(err);
  } finally {
    refreshBtn.classList.remove("loading");
    refreshBtn.disabled = false;
  }
}

loadAll();
setInterval(loadAll, REFRESH_MS);
