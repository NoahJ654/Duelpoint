
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const KEY = "duelpoint-v1";
  const MATCH_TIME = 50 * 60;
  const EXTRA_TIME = 5 * 60;
  const MAX_PLAYERS = 16;

  let state = load();
  let selectedMatch = null;
  let selectedWinner = null;
  let toastTimeout;
  let timerInterval;

  function freshState() {
    return {
      tournament: {
        status: "setup",
        round: 0,
        phase: "idle",
        remaining: MATCH_TIME,
        deadline: null
      },
      players: [],
      rounds: []
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.tournament && Array.isArray(saved.players)) {
        return saved;
      }
    } catch (error) {
      console.warn("Could not load saved tournament", error);
    }
    return freshState();
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function id() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function notify(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function currentRound() {
    return state.rounds.find(round => round.number === state.tournament.round);
  }

  function currentMatches() {
    const round = currentRound();
    return round ? round.matches : [];
  }

  function player(id) {
    return state.players.find(item => item.id === id);
  }

  function statistics() {
    const stats = state.players.map(item => ({
      ...item,
      wins: 0,
      losses: 0,
      points: 0,
      opponents: [],
      byes: 0,
      opponentScore: 0
    }));

    const lookup = new Map(stats.map(item => [item.id, item]));

    state.rounds.forEach(round => {
      round.matches.forEach(match => {
        const a = lookup.get(match.player1);
        const b = match.player2 ? lookup.get(match.player2) : null;

        if (match.status === "bye" && a) {
          a.wins++;
          a.points += 3;
          a.byes++;
        }

        if (match.status === "complete" && a && b) {
          a.opponents.push(b.id);
          b.opponents.push(a.id);

          const winner = match.winner === a.id ? a : b;
          const loser = winner === a ? b : a;

          winner.wins++;
          winner.points += 3;
          loser.losses++;
        }
      });
    });

    stats.forEach(item => {
      item.opponentScore = item.opponents.reduce((total, opponentId) => {
        const opponent = lookup.get(opponentId);
        return total + (opponent ? opponent.points : 0);
      }, 0);
    });

    return stats.sort((a, b) =>
      b.points - a.points ||
      b.opponentScore - a.opponentScore ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name)
    );
  }

  function renderPlayers() {
    const players = state.players;
    $("playerCount").innerHTML = `${players.length}<span>/${MAX_PLAYERS}</span>`;
    $("playerProgress").style.width = `${players.length / MAX_PLAYERS * 100}%`;

    $("registeredPlayers").innerHTML = players.length
      ? players.map((item, index) => `
        <span class="player-chip">
          <b>${String(index + 1).padStart(2, "0")}</b>
          ${escapeHTML(item.name)}
          <button data-remove="${item.id}" aria-label="Remove player">×</button>
        </span>
      `).join("")
      : '<p class="empty-state">No players registered yet. Add your first duelist above.</p>';

    const locked = state.tournament.status !== "setup";
    $("playerName").disabled = locked || players.length >= MAX_PLAYERS;
    $("playerForm").querySelector("button").disabled = locked || players.length >= MAX_PLAYERS;
    $("startTournamentBtn").disabled = players.length < 2 || locked;

    $("setupHint").textContent = players.length < 2
      ? "Add at least 2 players to create Round 1."
      : `${players.length} players ready. ${players.length % 2 ? "One player will receive a bye." : "All players will be paired."}`;
  }

  function renderLeaderboard() {
    const rows = statistics();

    $("leaderboardBody").innerHTML = rows.length
      ? rows.map((item, index) => `
        <tr>
          <td>${index === 0 ? "♛" : index + 1}</td>
          <td class="player-cell">${escapeHTML(item.name)}</td>
          <td>${item.wins}</td>
          <td>${item.losses}</td>
          <td class="points-cell">${item.points}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" class="empty-cell">Standings will appear here.</td></tr>';
  }

  function renderMatches() {
    const matches = currentMatches();

    $("matchCount").textContent =
      `${matches.length} MATCH${matches.length === 1 ? "" : "ES"}`;

    $("matchesList").innerHTML = matches.length
      ? matches.map((match, index) => {
        const first = player(match.player1);
        const second = player(match.player2);
        const winner = player(match.winner);

        return `
          <article class="match-card">
            <span class="match-number">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <div class="match-players">
                <span>${escapeHTML(first?.name || "Unknown")}</span>
                ${second
                  ? `<span class="vs">VS</span><span>${escapeHTML(second.name)}</span>`
                  : '<span class="bye-label">ROUND BYE · 3 PTS</span>'}
              </div>
              <div class="match-meta">
                ${match.status === "complete"
                  ? `WINNER: ${escapeHTML(winner?.name || "Unknown")}`
                  : match.status === "bye"
                    ? "Automatic bye win"
                    : "Awaiting result"}
              </div>
            </div>
            <div class="match-actions">
              ${match.status === "complete" || match.status === "bye"
                ? '<span class="result-done">RECORDED ✓</span>'
                : `<button class="result-btn" data-result="${match.id}" ${state.tournament.phase === "complete" || state.tournament.status !== "active" ? "disabled" : ""}>ENTER RESULT</button>`}
            </div>
          </article>
        `;
      }).join("")
      : '<p class="empty-state">No matches have been generated.</p>';

    const allComplete = matches.length > 0 &&
      matches.every(match => ["complete", "bye"].includes(match.status));

    $("nextRoundBtn").disabled =
      !allComplete ||
      state.tournament.phase !== "complete" ||
      state.tournament.status !== "active";

    $("nextRoundBtn").textContent =
      state.tournament.phase === "complete"
        ? "COMPLETE ROUND & NEXT →"
        : "WAIT FOR ROUND TIMER TO FINISH";
  }

  function renderHistory() {
    const completed = state.rounds.filter(round => round.completed);

    $("roundHistory").innerHTML = completed.length
      ? completed.slice().reverse().map(round => `
        <div class="history-item">
          <span>ROUND ${round.number}</span>
          <strong>${round.matches.length}/${round.matches.length} RESULTS</strong>
        </div>
      `).join("")
      : '<p class="empty-state">No completed rounds yet.</p>';
  }

  function renderTimer() {
    const tournament = state.tournament;
    let remaining = tournament.remaining;

    if (["running", "extra"].includes(tournament.phase) && tournament.deadline) {
      remaining = Math.max(
        0,
        Math.ceil((tournament.deadline - Date.now()) / 1000)
      );
    }

    if (tournament.phase === "running" && remaining <= 0) {
      tournament.phase = "extra";
      tournament.remaining = EXTRA_TIME;
      tournament.deadline = Date.now() + EXTRA_TIME * 1000;
      remaining = EXTRA_TIME;
      save();
      notify("Match time is up! The 5-minute result window has started.");
    }

    if (tournament.phase === "extra" && remaining <= 0) {
      tournament.phase = "complete";
      tournament.remaining = 0;
      tournament.deadline = null;
      remaining = 0;
      save();
      notify("Result-entry time has ended.");
    }

    tournament.remaining = remaining;

    const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
    const seconds = String(remaining % 60).padStart(2, "0");

    $("timerDisplay").textContent = `${minutes}:${seconds}`;

    const phase = tournament.phase;
    $("timerPhase").textContent =
      phase === "extra" ? "EXTRA TIME · RESULT ENTRY" :
      phase === "complete" ? "ROUND TIME COMPLETE" :
      phase === "paused" ? "TIMER PAUSED" :
      "MATCH TIME · 50 MINUTES";

    $("roundStatus").textContent =
      phase === "running" ? "LIVE" :
      phase === "extra" ? "EXTRA TIME" :
      phase === "complete" ? "TIME UP" :
      phase === "paused" ? "PAUSED" : "READY";

    $("roundStatus").className =
      "status-pill" +
      (phase === "running" ? " live" : phase === "extra" ? " extra" : "");

    const total = phase === "extra" ? EXTRA_TIME : MATCH_TIME;
    $("timerProgress").style.width =
      `${Math.max(0, remaining / total * 100)}%`;

    $("startTimerBtn").disabled =
      ["running", "extra", "complete"].includes(phase) ||
      tournament.status !== "active";

    $("startTimerBtn").textContent =
      phase === "paused" ? "RESUME ROUND ▶" : "START ROUND ▶";

    $("pauseTimerBtn").disabled =
      !["running", "extra"].includes(phase);

    $("resetTimerBtn").disabled = tournament.status !== "active";

    $("timerNote").textContent =
      phase === "extra"
        ? "Extra time is active. Submit outstanding match results."
        : phase === "complete"
          ? "The 5-minute result-entry window has closed."
          : "The 5-minute result-entry window starts automatically when match time expires.";

    $("roundTitle").textContent = `Round ${tournament.round}`;
  }

  function render() {
    const active = state.tournament.status !== "setup";
    $("setupPanel").classList.toggle("hidden", active);
    $("tournamentPanel").classList.toggle("hidden", !active);

    if (active) {
      renderTimer();
      renderMatches();
      renderLeaderboard();
      renderHistory();
    } else {
      renderPlayers();
    }
  }

  function addPlayer(name) {
    name = name.trim();

    if (!name) return;
    if (state.players.length >= MAX_PLAYERS) {
      return notify("Maximum of 16 players reached.");
    }

    if (state.players.some(item => item.name.toLowerCase() === name.toLowerCase())) {
      return notify("That player is already registered.");
    }

    state.players.push({ id: id(), name });
    $("playerName").value = "";
    save();
    renderPlayers();
  }

  function removePlayer(playerId) {
    state.players = state.players.filter(item => item.id !== playerId);
    save();
    renderPlayers();
  }

  function createPairings() {
    const standings = statistics();
    const remaining = standings.map(item => item.id);
    const previousPairs = new Set();

    state.rounds.forEach(round => {
      round.matches.forEach(match => {
        if (match.player2) {
          previousPairs.add([match.player1, match.player2].sort().join("|"));
        }
      });
    });

    const matches = [];

    // Give a bye to the lowest-ranked player who has not already had one.
    if (remaining.length % 2) {
      const byePlayer = [...standings].reverse().find(item =>
        remaining.includes(item.id) &&
        !state.rounds.some(round =>
          round.matches.some(match => match.status === "bye" && match.player1 === item.id)
        )
      ) || standings[standings.length - 1];

      remaining.splice(remaining.indexOf(byePlayer.id), 1);
      matches.push({
        id: id(),
        player1: byePlayer.id,
        player2: null,
        winner: byePlayer.id,
        status: "bye"
      });
    }

    // Pair players with similar scores, avoiding repeat opponents where possible.
    while (remaining.length) {
      const first = remaining.shift();
      let opponentIndex = remaining.findIndex(second =>
        !previousPairs.has([first, second].sort().join("|"))
      );

      if (opponentIndex === -1) opponentIndex = 0;

      const second = remaining.splice(opponentIndex, 1)[0];

      matches.push({
        id: id(),
        player1: first,
        player2: second,
        winner: null,
        status: "pending"
      });
    }

    return matches;
  }

  function startTournament() {
    if (state.players.length < 2) return;

    if (!confirm(`Create Round 1 with ${state.players.length} players?`)) return;

    state.tournament.status = "active";
    state.tournament.round = 1;
    state.rounds.push({
      number: 1,
      matches: createPairings(),
      completed: false
    });

    resetRoundTimer();
    save();
    render();
    notify("Round 1 pairings are ready.");
  }

  function resetRoundTimer() {
    state.tournament.phase = "idle";
    state.tournament.remaining = MATCH_TIME;
    state.tournament.deadline = null;
  }

  function openResult(matchId) {
    const match = currentMatches().find(item => item.id === matchId);

    if (!match || match.status !== "pending") return;
    if (state.tournament.phase === "complete") {
      return notify("The result-entry window has closed.");
    }

    selectedMatch = match;
    selectedWinner = null;

    const first = player(match.player1);
    const second = player(match.player2);

    $("resultMatchTitle").textContent =
      `Table ${currentMatches().indexOf(match) + 1} · ${first.name} vs ${second.name}`;

    $("resultWindowMessage").textContent =
      state.tournament.phase === "extra"
        ? "Extra time is active. Select the match winner."
        : "Select the winner. The other player receives a loss.";

    $("winnerChoices").innerHTML = [first, second].map(item => `
      <button class="winner-choice" data-winner="${item.id}">
        ${escapeHTML(item.name)} <span>— WINNER</span>
      </button>
    `).join("");

    $("saveResultBtn").disabled = true;
    $("resultDialog").showModal();
  }

  function saveResult() {
    if (!selectedMatch || !selectedWinner) return;

    selectedMatch.winner = selectedWinner;
    selectedMatch.status = "complete";

    save();
    $("resultDialog").close();
    selectedMatch = null;
    selectedWinner = null;
    render();
    notify("Match result saved.");
  }

  function startTimer() {
    const tournament = state.tournament;

    if (tournament.phase === "paused") {
      tournament.deadline = Date.now() + tournament.remaining * 1000;
      tournament.phase = tournament.resumePhase || "running";
      tournament.resumePhase = null;
    } else {
      tournament.remaining = MATCH_TIME;
      tournament.deadline = Date.now() + MATCH_TIME * 1000;
      tournament.phase = "running";
    }

    save();
    render();
    notify("Round timer started.");
  }

  function pauseTimer() {
    const tournament = state.tournament;
    if (!["running", "extra"].includes(tournament.phase)) return;

    tournament.remaining = Math.max(
      0,
      Math.ceil((tournament.deadline - Date.now()) / 1000)
    );

    tournament.resumePhase = tournament.phase;
    tournament.phase = "paused";
    tournament.deadline = null;

    save();
    render();
    notify("Timer paused.");
  }

  function resetTimer() {
    if (!confirm("Reset this round timer to 50:00?")) return;
    resetRoundTimer();
    save();
    render();
  }

  function nextRound() {
    const matches = currentMatches();
    const allComplete = matches.length > 0 &&
      matches.every(match => ["complete", "bye"].includes(match.status));

    if (!allComplete) return notify("Record every match result first.");
    if (state.tournament.phase !== "complete") {
      return notify("Wait until the 50 + 5 minute timer has finished.");
    }

    const round = currentRound();
    round.completed = true;

    // Standard Swiss round count: ceil(log2(number of players)).
    const totalRounds = Math.ceil(Math.log2(state.players.length));

    if (state.tournament.round >= totalRounds) {
      state.tournament.status = "finished";
      save();
      render();
      notify("Tournament complete! Final standings are ready.");
      return;
    }

    state.tournament.round++;
    state.rounds.push({
      number: state.tournament.round,
      matches: createPairings(),
      completed: false
    });

    resetRoundTimer();
    save();
    render();
    notify(`Round ${state.tournament.round} pairings generated.`);
  }

  function endTournament() {
    if (!confirm("End this tournament now? Results will remain saved on this device.")) return;

    state.tournament.status = "finished";
    state.tournament.phase = "complete";
    state.tournament.deadline = null;
    state.tournament.remaining = 0;

    save();
    render();
    notify("Tournament ended.");
  }

  function tick() {
    if (state.tournament.status === "active") {
      renderTimer();
      renderMatches();
      save();
    }
  }

  // Settings are prepared for the later shared Supabase setup.
  $("settingsBtn").addEventListener("click", () => {
    $("settingsDialog").showModal();
  });

  $("connectBtn").addEventListener("click", () => {
    $("settingsMessage").textContent =
      "Online sharing is not configured yet. We will set up Supabase after the local tournament has been tested.";
  });

  $("disconnectBtn").addEventListener("click", () => {
    $("settingsMessage").textContent =
      "Local preview mode. Tournament data is saved in this browser only.";
  });

  $("loginForm").addEventListener("submit", event => {
    event.preventDefault();
    $("settingsMessage").textContent =
      "Online sign-in will be enabled after Supabase is configured.";
  });

  $("playerForm").addEventListener("submit", event => {
    event.preventDefault();
    addPlayer($("playerName").value);
  });

  $("registeredPlayers").addEventListener("click", event => {
    const button = event.target.closest("[data-remove]");
    if (button && confirm("Remove this player?")) {
      removePlayer(button.dataset.remove);
    }
  });

  $("startTournamentBtn").addEventListener("click", startTournament);

  $("matchesList").addEventListener("click", event => {
    const button = event.target.closest("[data-result]");
    if (button) openResult(button.dataset.result);
  });

  $("winnerChoices").addEventListener("click", event => {
    const button = event.target.closest("[data-winner]");
    if (!button) return;

    selectedWinner = button.dataset.winner;

    document.querySelectorAll(".winner-choice").forEach(choice => {
      choice.classList.toggle("selected", choice === button);
    });

    $("saveResultBtn").disabled = false;
  });

  $("saveResultBtn").addEventListener("click", saveResult);
  $("startTimerBtn").addEventListener("click", startTimer);
  $("pauseTimerBtn").addEventListener("click", pauseTimer);
  $("resetTimerBtn").addEventListener("click", resetTimer);
  $("nextRoundBtn").addEventListener("click", nextRound);
  $("endTournamentBtn").addEventListener("click", endTournament);

  // Recover an active timer accurately after refreshing the page.
  if (state.tournament.deadline &&
      ["running", "extra"].includes(state.tournament.phase)) {
    state.tournament.remaining = Math.max(
      0,
      Math.ceil((state.tournament.deadline - Date.now()) / 1000)
    );
  }

  if (state.tournament.status === "finished") {
    state.tournament.phase = "complete";
  }

  save();
  render();
  $("connectionStatus").innerHTML = "<i></i> Local preview";

  timerInterval = setInterval(tick, 500);
})();
