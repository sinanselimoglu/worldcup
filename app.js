const REFRESH_MS = 60000;

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

function teamRow(team, score, hasScore, isWinner) {
  const name = team.shortName || team.name;
  const crest = team.crest
    ? `<img class="crest" src="${team.crest}" alt="" onerror="this.style.display='none'">`
    : "";
  return `
    <div class="team-row${isWinner ? " winner" : ""}">
      <span class="team-name">${crest}${name}</span>
      <span class="team-score">${hasScore ? score : ""}</span>
    </div>`;
}

function matchCard(match) {
  const isLive = match.status === "IN_PLAY" || match.status === "PAUSED";
  const homeScore = match.score.fullTime.home ?? match.score.halfTime.home;
  const awayScore = match.score.fullTime.away ?? match.score.halfTime.away;
  const hasScore = homeScore !== null && homeScore !== undefined;
  const stage = match.stage.replace(/_/g, " ");

  const topRight = isLive
    ? '<span class="live-badge">LIVE</span>'
    : `<span class="stage-tag">${stage}</span>`;

  const card = document.createElement("div");
  card.className = "match-card" + (isLive ? " live" : "");
  card.innerHTML = `
    <div class="card-top">
      <span class="stage-tag">${match.group ? match.group.replace(/_/g, " ") : stage}</span>
      ${topRight}
    </div>
    ${teamRow(match.homeTeam, homeScore, hasScore, hasScore && homeScore > awayScore)}
    ${teamRow(match.awayTeam, awayScore, hasScore, hasScore && awayScore > homeScore)}
    <div class="card-time">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      ${formatDate(match.utcDate)}
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

async function loadMatches() {
  refreshBtn.classList.add("loading");
  refreshBtn.disabled = true;
  try {
    const res = await fetch(`matches.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`error ${res.status}`);
    const data = await res.json();
    const matches = data.matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

    const live = matches.filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
    const upcoming = matches.filter((m) => m.status === "SCHEDULED" || m.status === "TIMED");
    const finished = matches
      .filter((m) => m.status === "FINISHED")
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

    render(liveEl, live, "No live matches right now.");
    render(upcomingEl, upcoming.slice(0, 10), "No upcoming matches scheduled.");
    render(finishedEl, finished.slice(0, 10), "No results yet.");

    statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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
