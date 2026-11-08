
/* DUELPOINT - Complete tournament manager with Supabase sync */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const STORAGE = "duelpoint-v1";
  const MATCH_TIME = 3000;
  const EXTRA_TIME = 300;
  const MAX_PLAYERS = 16;

  const SUPABASE_URL = "https://ftgujisjygpcdtrgbzdk.supabase.co";
  const SUPABASE_KEY = "sb_publishable_BvvXqO89ZysFP-nEsKXqRw_EvkC71Yj";

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  let tournament = null;
  let players = [];
  let rounds = [];
  let matches = [];
  let user = null;
  let online = false;
  let channel = null;
  let selectedMatch = null;
  let selectedWinner = null;
  let timerBusy = false;
  let refreshing = false;
  let toastTimer = null;

  const blankState = () => ({
    tournament: {
      id: "local",
      status: "setup",
      current_round: 0,
      timer_phase: "idle",
      timer_deadline: null,
      timer_remaining_seconds: MATCH_TIME
    },
    players: [],
    rounds: [],
    matches: []
  });

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2800);
  }

  function message(text) {
    $("settingsMessage").textContent = text;
  }

  function connection(text, connected = false) {
    $("connectionStatus").innerHTML = `<i></i> ${text}`;
    $("connectionStatus").classList.toggle("online", connected);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function localSave() {
    localStorage.setItem(STORAGE, JSON.stringify({
      tournament, players, rounds, matches
    }));
  }

  function localLoad() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved?.tournament) {
        tournament = saved.tournament;
        players = saved.players || [];
        rounds = saved.rounds || [];
        matches = saved.matches || [];
        return;
      }
    } catch (e) {
      console.warn("Local save could not be loaded", e);
    }

    const empty = blankState();
    tournament = empty.tournament;
    players = [];
    rounds = [];
    matches = [];
  }

  function currentRound() {
    return rounds.find(r =>
      r.round_number === tournament.current_round
    );
  }

  function currentMatches() {
    const round = currentRound();
    return round
      ? matches.filter(m => m.round_id === round.id)
          .sort((a, b) => a.table_number - b.table_number)
      : [];
  }

  async function saveTournament(patch = {}) {
    Object.assign(tournament, patch);
    tournament.updated_at = new Date().toISOString();

    if (online) {
      const { error } = await db
        .from("tournaments")
        .update(patch)
        .eq("id", tournament.id);

      if (error) throw error;
    } else {
      localSave();
    }

    render();
  }

  async function addPlayer(name) {
    const clean = name.trim();

    if (!clean) return;
    if (players.length >= MAX_PLAYERS) {
      return toast("Maximum of 16 players.");
    }

    if (tournament.status !== "setup") {
      return toast("Players cannot be added after the tournament starts.");
    }

    if (players.some(p =>
      p.name.toLowerCase() === clean.toLowerCase()
    )) {
      return toast("That player is already registered.");
    }

    let newPlayer;

    if (online) {
      const { data, error } = await db
        .from("players")
        .insert({
          tournament_id: tournament.id,
          name: clean
        })
        .select()
        .single();

      if (error) throw error;
      newPlayer = data;
    } else {
      newPlayer = {
        id: crypto.randomUUID(),
        name: clean
      };
    }

    players.push(newPlayer);
    if (!online) localSave();

    $("playerName").value = "";
    render();
  }

  async function removePlayer(id) {
    if (online) {
      const { error } = await db
        .from("players")
        .delete()
        .eq("id", id);

      if (error) throw error;
    }

    players = players.filter(p => p.id !== id);

    if (!online) localSave();
    render();
  }

  function standings() {
    const stats = players.map(p => ({
      player: p,
      wins: 0,
      losses: 0,
      points: 0,
      opponentPoints: 0,
      opponents: [],
      hadBye: false
    }));

    const lookup = new Map(stats.map(s => [s.player.id, s]));

    matches.forEach(m => {
      const a = lookup.get(m.player_one_id);
      const b = lookup.get(m.player_two_id);

      if (m.result_status === "bye" && a) {
        a.wins++;
        a.points += 3;
        a.hadBye = true;
      }

      if (m.result_status === "complete" && a && b) {
        a.opponents.push(b.player.id);
        b.opponents.push(a.player.id);

        const winner = m.winner_id === a.player.id ? a : b;
        const loser = winner === a ? b : a;

        winner.wins++;
        winner.points += 3;
        loser.losses++;
      }
    });

    stats.forEach(s => {
      s.opponentPoints = s.opponents.reduce((total, id) => {
        return total + (lookup.get(id)?.points || 0);
      }, 0);
    });

    return stats.sort((a, b) =>
      b.points - a.points ||
      b.opponentPoints - a.opponentPoints ||
      b.wins - a.wins ||
      a.player.name.localeCompare(b.player.name)
    );
  }

  function renderPlayers() {
    $("playerCount").innerHTML =
      `${players.length}<span>/${MAX_PLAYERS}</span>`;

    $("playerProgress").style.width =
      `${players.length / MAX_PLAYERS * 100}%`;

    $("playerName").disabled =
      players.length >= MAX_PLAYERS ||
      tournament.status !== "setup";

    $("playerForm").querySelector("button").disabled =
      players.length >= MAX_PLAYERS ||
      tournament.status !== "setup";

    $("registeredPlayers").innerHTML = players.length
      ? players.map((p, i) => `
        <span class="player-chip">
          <b>${String(i + 1).padStart(2, "0")}</b>
          ${escapeHTML(p.name)}
          ${tournament.status === "setup"
            ? `<button data-remove="${p.id}" aria-label="Remove player">×</button>`
            : ""}
        </span>
      `).join("")
      : '<p class="empty-state">No players registered yet. Add your first duelist above.</p>';

    $("setupHint").textContent = players.length < 2
      ? "Add at least 2 players to create Round 1."
      : `${players.length} players ready. ${
          players.length % 2
            ? "One player will receive a bye."
            : "All players will be paired."
        }`;

    $("startTournamentBtn").disabled =
      players.length < 2 || tournament.status !== "setup";
  }

  function renderLeaderboard() {
    const rows = standings();

    $("leaderboardBody").innerHTML = rows.length
      ? rows.map((s, i) => `
        <tr>
          <td>${i === 0 ? "♛" : i + 1}</td>
          <td class="player-cell">${escapeHTML(s.player.name)}</td>
          <td>${s.wins}</td>
          <td>${s.losses}</td>
          <td class="points-cell">${s.points}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" class="empty-cell">Standings will appear here.</td></tr>';
  }

  function renderMatches() {
    const list = currentMatches();

    $("matchCount").textContent =
      `${list.length} MATCH${list.length === 1 ? "" : "ES"}`;

    $("matchesList").innerHTML = list.length
      ? list.map(m => {
        const p1 = players.find(p => p.id === m.player_one_id);
        const p2 = players.find(p => p.id === m.player_two_id);
        const winner = players.find(p => p.id === m.winner_id);

        const canEnter =
          tournament.status === "active" &&
          tournament.timer_phase !== "complete";

        return `
          <article class="match-card">
            <span class="match-number">
              ${String(m.table_number).padStart(2, "0")}
            </span>
            <div>
              <div class="match-players">
                <span>${escapeHTML(p1?.name || "Unknown")}</span>
                ${p2
                  ? `<span class="vs">VS</span><span>${escapeHTML(p2.name)}</span>`
                  : '<span class="bye-label">ROUND BYE · 3 PTS</span>'}
              </div>
              <div class="match-meta">
                ${m.result_status === "complete"
                  ? `WINNER: ${escapeHTML(winner?.name || "Unknown")}`
                  : m.result_status === "bye"
                    ? "Automatic bye win"
                    : "Awaiting result"}
              </div>
            </div>
            <div class="match-actions">
              ${m.result_status === "complete" || m.result_status === "bye"
                ? '<span class="result-done">RECORDED ✓</span>'
                : `<button class="result-btn" data-result="${m.id}" ${canEnter ? "" : "disabled"}>ENTER RESULT</button>`}
            </div>
          </article>
        `;
      }).join("")
      : '<p class="empty-state">Create a round to generate pairings.</p>';

    const allDone = list.length > 0 &&
      list.every(m =>
        m.result_status === "complete" ||
        m.result_status === "bye"
      );

    $("nextRoundBtn").disabled =
      !allDone ||
      tournament.status !== "active" ||
      tournament.timer_phase !== "complete";

    $("nextRoundBtn").textContent =
      tournament.timer_phase === "complete"
        ? "COMPLETE ROUND & NEXT →"
        : "WAIT FOR ROUND TIMER TO FINISH";
  }

  function renderHistory() {
    const done = rounds
      .filter(r => r.status === "complete")
      .sort((a, b) => b.round_number - a.round_number);

    $("roundHistory").innerHTML = done.length
      ? done.map(r => {
        const list = matches.filter(m => m.round_id === r.id);
        const count = list.filter(m =>
          m.result_status === "complete" ||
          m.result_status === "bye"
        ).length;

        return `
          <div class="history-item">
            <span>ROUND ${r.round_number}</span>
            <strong>${count}/${list.length} RESULTS</strong>
          </div>
        `;
      }).join("")
      : '<p class="empty-state">No completed rounds yet.</p>';
  }

  async function updateTimerPhase(phase, seconds, deadline = null) {
    await saveTournament({
      timer_phase: phase,
      timer_remaining_seconds: seconds,
      timer_deadline: deadline,
      timer_phase_started_at: new Date().toISOString()
    });
  }

  async function timerTick() {
    if (!tournament || tournament.status !== "active") return;

    const phase = tournament.timer_phase;
    if (phase !== "running" && phase !== "extra") {
      renderTimer();
      return;
    }

    const deadline = tournament.timer_deadline
      ? new Date(tournament.timer_deadline).getTime()
      : 0;

    const remaining = Math.max(
      0,
      Math.ceil((deadline - Date.now()) / 1000)
    );

    if (remaining <= 0 && !timerBusy) {
      timerBusy = true;

      try {
        if (phase === "running") {
          await updateTimerPhase(
            "extra",
            EXTRA_TIME,
            new Date(Date.now() + EXTRA_TIME * 1000).toISOString()
          );
          toast("Match time is up! Five-minute result window started.");
        } else {
          await updateTimerPhase("complete", 0, null);
          toast("Result-entry time has ended.");
        }
      } catch (e) {
        showError(e);
      } finally {
        timerBusy = false;
      }
    } else {
      tournament.timer_remaining_seconds = remaining;
      renderTimer();
    }
  }

  function renderTimer() {
    const phase = tournament.timer_phase || "idle";
    let remaining = Number(
      tournament.timer_remaining_seconds ?? MATCH_TIME
    );

    if ((phase === "running" || phase === "extra") &&
        tournament.timer_deadline) {
      remaining = Math.max(
        0,
        Math.ceil(
          (new Date(tournament.timer_deadline).getTime() - Date.now()) / 1000
        )
      );
    }

    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");

    $("timerDisplay").textContent = `${mm}:${ss}`;

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
      `${Math.max(0, Math.min(100, remaining / total * 100))}%`;

    $("startTimerBtn").disabled =
      ["running", "extra", "complete"].includes(phase) ||
      tournament.status !== "active";

    $("startTimerBtn").textContent =
      phase === "paused" ? "RESUME ROUND ▶" : "START ROUND ▶";

    $("pauseTimerBtn").disabled =
      phase !== "running" && phase !== "extra";

    $("resetTimerBtn").disabled = tournament.status !== "active";

    $("timerNote").textContent =
      phase === "extra"
        ? "Extra time is active. Submit outstanding match results."
        : phase === "complete"
          ? "The 5-minute result-entry window has closed."
          : "The 5-minute result-entry window starts automatically when match time expires.";

    $("roundTitle").textContent =
      `Round ${tournament.current_round || 1}`;
  }

  function render() {
    const active = tournament.status !== "setup";

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

  function previousOpponents(playerId) {
    const seen = new Set();

    matches.forEach(m => {
      if (m.player_one_id === playerId && m.player_two_id) {
        seen.add(m.player_two_id);
      }
      if (m.player_two_id === playerId && m.player_one_id) {
        seen.add(m.player_one_id);
      }
    });

    return seen;
  }

  function makePairings() {
    const ranked = standings().map(s => s.player);
    let bye = null;

    if (ranked.length % 2) {
      for (let i = ranked.length - 1; i >= 0; i--) {
        const hadBye = matches.some(m =>
          m.result_status === "bye" &&
          m.player_one_id === ranked[i].id
        );

        if (!hadBye) {
          bye = ranked.splice(i, 1)[0];
          break;
        }
      }

      if (!bye) bye = ranked.pop();
    }

    const pairs = [];

    while (ranked.length) {
      const first = ranked.shift();
      const previous = previousOpponents(first.id);

      let index = ranked.findIndex(p => !previous.has(p.id));
      if (index < 0) index = 0;

      const second = ranked.splice(index, 1)[0];
      pairs.push([first, second]);
    }

    if (bye) pairs.push([bye, null]);

    return pairs;
  }

  async function createRound(number) {
    const pairs = makePairings();
    let round;

    if (online) {
      const { data, error } = await db
        .from("rounds")
        .insert({
          tournament_id: tournament.id,
          round_number: number,
          status: "active"
        })
        .select()
        .single();

      if (error) throw error;
      round = data;
    } else {
      round = {
        id: crypto.randomUUID(),
        tournament_id: tournament.id,
        round_number: number,
        status: "active"
      };
    }

    rounds.push(round);

    for (let i = 0; i < pairs.length; i++) {
      const [a, b] = pairs[i];

      const row = {
        round_id: round.id,
        table_number: i + 1,
        player_one_id: a.id,
        player_two_id: b?.id || null,
        winner_id: b ? null : a.id,
        result_status: b ? "pending" : "bye"
      };

      let match;

      if (online) {
        const { data, error } = await db
          .from("matches")
          .insert(row)
          .select()
          .single();

        if (error) throw error;
        match = data;
      } else {
        match = { id: crypto.randomUUID(), ...row };
      }

      matches.push(match);
    }

    await saveTournament({
      status: "active",
      current_round: number,
      timer_phase: "idle",
      timer_deadline: null,
      timer_remaining_seconds: MATCH_TIME
    });
  }

  async function startTournament() {
    if (players.length < 2) return;

    if (!confirm(
      `Create Round 1 with ${players.length} players?`
    )) return;

    await createRound(1);
    toast("Round 1 pairings are ready.");
  }

  function openResult(id) {
    const match = matches.find(m => m.id === id);
    if (!match || match.result_status !== "pending") return;

    if (tournament.timer_phase === "complete") {
      return toast("The result-entry window has closed.");
    }

    selectedMatch = match;
    selectedWinner = null;

    const p1 = players.find(p => p.id === match.player_one_id);
    const p2 = players.find(p => p.id === match.player_two_id);

    $("resultMatchTitle").textContent =
      `Table ${match.table_number} · ${p1.name} vs ${p2.name}`;

    $("resultWindowMessage").textContent =
      tournament.timer_phase === "extra"
        ? "Extra time is active. Select the winner."
        : "Select the winner. The other player receives a loss.";

    $("winnerChoices").innerHTML = [p1, p2].map(p => `
      <button class="winner-choice" data-winner="${p.id}">
        ${escapeHTML(p.name)} <span>— WINNER</span>
      </button>
    `).join("");

    $("saveResultBtn").disabled = true;
    $("resultDialog").showModal();
  }

  async function saveResult() {
    if (!selectedMatch || !selectedWinner) return;

    const patch = {
      winner_id: selectedWinner,
      result_status: "complete"
    };

    if (online) {
      const { error } = await db
        .from("matches")
        .update(patch)
        .eq("id", selectedMatch.id);

      if (error) throw error;
    }

    Object.assign(selectedMatch, patch);

    if (!online) localSave();

    $("resultDialog").close();
    selectedMatch = null;
    selectedWinner = null;

    render();
    toast("Match result saved.");
  }

  async function startTimer() {
    const phase = tournament.timer_phase;
    const seconds = phase === "paused"
      ? Number(tournament.timer_remaining_seconds)
      : MATCH_TIME;

    const nextPhase = phase === "paused"
      ? tournament.timer_resume_phase || "running"
      : "running";

    await saveTournament({
      timer_phase: nextPhase,
      timer_resume_phase: null,
      timer_remaining_seconds: seconds,
      timer_deadline: new Date(
        Date.now() + seconds * 1000
      ).toISOString()
    });

    toast(phase === "paused" ? "Timer resumed." : "Round timer started.");
  }

  async function pauseTimer() {
    if (!["running", "extra"].includes(tournament.timer_phase)) return;

    const remaining = Math.max(
      0,
      Math.ceil(
        (new Date(tournament.timer_deadline).getTime() - Date.now()) / 1000
      )
    );

    await saveTournament({
      timer_resume_phase: tournament.timer_phase,
      timer_phase: "paused",
      timer_remaining_seconds: remaining,
      timer_deadline: null
    });

    toast("Timer paused.");
  }

  async function resetTimer() {
    if (!confirm("Reset the timer to 50:00?")) return;

    await saveTournament({
      timer_phase: "idle",
      timer_resume_phase: null,
      timer_remaining_seconds: MATCH_TIME,
      timer_deadline: null
    });

    toast("Timer reset.");
  }

  async function nextRound() {
    const list = currentMatches();

    const allDone = list.length > 0 &&
      list.every(m =>
        m.result_status === "complete" ||
        m.result_status === "bye"
      );

    if (!allDone) return toast("Record every match result first.");

    if (tournament.timer_phase !== "complete") {
      return toast("Wait until the 50 + 5 minute timer has finished.");
    }

    const round = currentRound();

    if (online) {
      const { error } = await db
        .from("rounds")
        .update({ status: "complete" })
        .eq("id", round.id);

      if (error) throw error;
    }

    round.status = "complete";

    const totalRounds = Math.ceil(Math.log2(players.length));

    if (tournament.current_round >= totalRounds) {
      await saveTournament({
        status: "finished",
        timer_phase: "complete",
        timer_deadline: null,
        timer_remaining_seconds: 0
      });

      toast("Tournament complete! Final standings are ready.");
      return;
    }

    await createRound(tournament.current_round + 1);
    toast(`Round ${tournament.current_round} pairings generated.`);
  }

  async function endTournament() {
    if (!confirm("End this tournament now?")) return;

    await saveTournament({
      status: "finished",
      timer_phase: "complete",
      timer_deadline: null,
      timer_remaining_seconds: 0
    });

    toast("Tournament ended.");
  }

  async function loadOnline() {
    if (refreshing) return;
    refreshing = true;

    try {
      const { data: t, error: te } = await db
        .from("tournaments")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (te) throw te;

      if (!t) {
        const { data, error } = await db
          .from("tournaments")
          .insert({
            owner_id: user.id,
            name: "Yu-Gi-Oh! Local Tournament"
          })
          .select()
          .single();

        if (error) throw error;
        tournament = data;
      } else {
        tournament = t;
      }

      const [p, r, m] = await Promise.all([
        db.from("players")
          .select("*")
          .eq("tournament_id", tournament.id)
          .order("created_at"),

        db.from("rounds")
          .select("*")
          .eq("tournament_id", tournament.id)
          .order("round_number"),

        db.from("matches")
          .select("*, rounds!inner(tournament_id)")
          .eq("rounds.tournament_id", tournament.id)
      ]);

      if (p.error) throw p.error;
      if (r.error) throw r.error;
      if (m.error) throw m.error;

      players = p.data || [];
      rounds = r.data || [];
      matches = (m.data || []).map(({ rounds: unused, ...match }) => match);

      online = true;
      connection("Online · synced", true);
      render();
    } finally {
      refreshing = false;
    }
  }

  function subscribeRealtime() {
    if (channel) db.removeChannel(channel);

    channel = db.channel("duelpoint-live")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tournaments"
      }, () => loadOnline().catch(showError))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "players"
      }, () => loadOnline().catch(showError))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "rounds"
      }, () => loadOnline().catch(showError))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "matches"
      }, () => loadOnline().catch(showError))
      .subscribe();
  }

  async function connect() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    if (data.session) {
      user = data.session.user;
      await loadOnline();
      subscribeRealtime();
      $("settingsDialog").close();
      toast("Connected to shared tournament data.");
    } else {
      message("Connection ready. Enter your organiser email and request a sign-in link.");
      connection("Sign-in required");
    }
  }

  async function sendLogin(event) {
    event.preventDefault();

    const email = $("organiserEmail").value.trim();
    if (!email) return;

    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: location.origin + location.pathname
      }
    });

    if (error) throw error;

    message("Sign-in link sent. Check your email and open the link on this device.");
  }

  async function boot() {
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;

      if (data.session) {
        user = data.session.user;
        await loadOnline();
        subscribeRealtime();
      } else {
        localLoad();
        connection("Sign-in required");
        render();
      }
    } catch (e) {
      console.error(e);
      localLoad();
      connection("Local preview");
      render();
      message("Cloud connection could not be loaded: " + e.message);
    }

    db.auth.onAuthStateChange(async (event, session) => {
      if (session && !online) {
        user = session.user;

        try {
          await loadOnline();
          subscribeRealtime();
          $("settingsDialog").close();
          toast("Signed in and synchronised.");
        } catch (e) {
          showError(e);
        }
      }

      if (!session && event === "SIGNED_OUT") {
        online = false;
        user = null;
        if (channel) db.removeChannel(channel);
        localLoad();
        render();
        connection("Signed out");
      }
    });
  }

  function showError(error) {
    console.error(error);
    toast(error?.message || "Something went wrong.");
  }

  // User interface events

  $("playerForm").addEventListener("submit", e => {
    e.preventDefault();
    addPlayer($("playerName").value).catch(showError);
  });

  $("registeredPlayers").addEventListener("click", e => {
    const button = e.target.closest("[data-remove]");
    if (button && confirm("Remove this player?")) {
      removePlayer(button.dataset.remove).catch(showError);
    }
  });

  $("startTournamentBtn").addEventListener("click", () =>
    startTournament().catch(showError)
  );

  $("matchesList").addEventListener("click", e => {
    const button = e.target.closest("[data-result]");
    if (button) openResult(button.dataset.result);
  });

  $("winnerChoices").addEventListener("click", e => {
    const button = e.target.closest("[data-winner]");
    if (!button) return;

    selectedWinner = button.dataset.winner;

    document.querySelectorAll(".winner-choice").forEach(item => {
      item.classList.toggle("selected", item === button);
    });

    $("saveResultBtn").disabled = false;
  });

  $("saveResultBtn").addEventListener("click", () =>
    saveResult().catch(showError)
  );

  $("startTimerBtn").addEventListener("click", () =>
    startTimer().catch(showError)
  );

  $("pauseTimerBtn").addEventListener("click", () =>
    pauseTimer().catch(showError)
  );

  $("resetTimerBtn").addEventListener("click", () =>
    resetTimer().catch(showError)
  );

  $("nextRoundBtn").addEventListener("click", () =>
    nextRound().catch(showError)
  );

  $("endTournamentBtn").addEventListener("click", () =>
    endTournament().catch(showError)
  );

  $("settingsBtn").addEventListener("click", () =>
    $("settingsDialog").showModal()
  );

  $("connectBtn").addEventListener("click", () =>
    connect().catch(showError)
  );

  $("disconnectBtn").addEventListener("click", () => {
    db.auth.signOut().catch(showError);
    online = false;
    user = null;
    if (channel) db.removeChannel(channel);
    localLoad();
    render();
    connection("Local preview");
    message("Signed out. Local browser data is being displayed.");
  });

  $("loginForm").addEventListener("submit", e =>
    sendLogin(e).catch(showError)
  );

  // Start the application.

  boot();

  setInterval(() => {
    if (tournament) {
      timerTick().catch(showError);
    }
  }, 500);

})();
