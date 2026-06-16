const REFRESH_MS = 60000;

// Primary source: ESPN's public scoreboard (CORS-open, no key, gives live minutes).
// Full tournament date span so we get results + live + upcoming in one call.
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719";
// Fallback: cached football-data.org snapshot, refreshed by the GitHub Action.
const FALLBACK_URL = "matches.json";

const statusLine = document.getElementById("status-line");
const liveEl = document.getElementById("live-matches");
const upcomingEl = document.getElementById("upcoming-matches");
const finishedEl = document.getElementById("finished-matches");
const refreshBtn = document.getElementById("refresh-btn");

refreshBtn.addEventListener("click", () => loadMatches());

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- Normalize each source into a common match shape -----------------------
// { state: "live"|"upcoming"|"finished", stage, minute,
//   home: {name, crest, score}, away: {name, crest, score}, date }

function fromEspn(json) {
  return (json.events || []).map((e) => {
    const comp = e.competitions[0];
    const st = e.status.type; // state: pre | in | post
    const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
    const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
    const state = st.state === "in" ? "live" : st.state === "post" ? "finished" : "upcoming";
    const team = (c) => ({
      name: c.team.shortDisplayName || c.team.displayName,
      crest: c.team.logo || "",
      score: c.score,
    });
    return {
      state,
      stage: (comp.notes && comp.notes[0] && comp.notes[0].headline) || e.season?.slug || "",
      minute: state === "live" ? st.detail : "",
      home: team(home),
      away: team(away),
      date: e.date,
    };
  });
}

function fromFootballData(json) {
  return (json.matches || []).map((m) => {
    const state =
      m.status === "IN_PLAY" || m.status === "PAUSED"
        ? "live"
        : m.status === "FINISHED"
        ? "finished"
        : "upcoming";
    const hs = m.score.fullTime.home ?? m.score.halfTime.home;
    const as = m.score.fullTime.away ?? m.score.halfTime.away;
    const team = (t, s) => ({
      name: t.shortName || t.name,
      crest: t.crest || "",
      score: s ?? "",
    });
    return {
      state,
      stage: (m.group || m.stage || "").replace(/_/g, " "),
      minute: "",
      home: team(m.homeTeam, hs),
      away: team(m.awayTeam, as),
      date: m.utcDate,
    };
  });
}

// --- Rendering -------------------------------------------------------------

function teamRow(team, showScore, isWinner) {
  const crest = team.crest
    ? `<img class="crest" src="${team.crest}" alt="" onerror="this.style.display='none'">`
    : "";
  return `
    <div class="team-row${isWinner ? " winner" : ""}">
      <span class="team-name">${crest}${team.name}</span>
      <span class="team-score">${showScore ? team.score : ""}</span>
    </div>`;
}

function matchCard(m) {
  const isLive = m.state === "live";
  const showScore = m.state !== "upcoming";
  const hs = Number(m.home.score);
  const as = Number(m.away.score);

  const topRight = isLive
    ? `<span class="live-badge">${m.minute || "LIVE"}</span>`
    : `<span class="stage-tag">${m.state === "finished" ? "FT" : formatDate(m.date)}</span>`;

  const card = document.createElement("div");
  card.className = "match-card" + (isLive ? " live" : "");
  card.innerHTML = `
    <div class="card-top">
      <span class="stage-tag">${m.stage || ""}</span>
      ${topRight}
    </div>
    ${teamRow(m.home, showScore, m.state === "finished" && hs > as)}
    ${teamRow(m.away, showScore, m.state === "finished" && as > hs)}
    <div class="card-time">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      ${formatDate(m.date)}
    </div>
  `;
  return card;
}

function render(container, matches, emptyText) {
  container.innerHTML = "";
  if (matches.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = emptyText;
    container.appendChild(p);
    return;
  }
  matches.forEach((m) => container.appendChild(matchCard(m)));
}

async function fetchMatches() {
  try {
    const res = await fetch(`${ESPN_URL}&_=${Date.now()}`);
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
  refreshBtn.classList.add("loading");
  refreshBtn.disabled = true;
  try {
    const { matches, source } = await fetchMatches();
    matches.sort((a, b) => new Date(a.date) - new Date(b.date));

    const live = matches.filter((m) => m.state === "live");
    const upcoming = matches.filter((m) => m.state === "upcoming");
    const finished = matches
      .filter((m) => m.state === "finished")
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    render(liveEl, live, "No live matches right now.");
    render(upcomingEl, upcoming.slice(0, 12), "No upcoming matches scheduled.");
    render(finishedEl, finished.slice(0, 12), "No results yet.");

    const tag = source === "live" ? "" : " · cached";
    statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}${tag}`;
  } catch (err) {
    statusLine.textContent = `Could not load matches: ${err.message}`;
    console.error(err);
  } finally {
    refreshBtn.classList.remove("loading");
    refreshBtn.disabled = false;
  }
}

loadMatches();
setInterval(loadMatches, REFRESH_MS);
