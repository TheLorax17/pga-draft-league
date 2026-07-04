import { db } from "./firebase-config.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CORRECT_PIN = "1999";
const RAPIDAPI_KEY = "82ae611ae5msh87caa3b40d17bedp15cd62jsn60ae1312f759";
const RAPIDAPI_HOST = "live-golf-data.p.rapidapi.com";

const auth = getAuth();
const fieldCollection = collection(db, "tournaments", "current", "field");
const draftDocRef = doc(db, "draft", "current");
const tournamentMetaRef = doc(db, "tournaments", "current");

const defaultPar = [4,5,4,3,4,3,4,5,4,4,4,3,5,4,5,3,4,4];

let currentField = [];
let draftState = null;
let scheduleEvents = [];
let pendingPick = null;
let activeScorecardGolfer = null;
let activeScorecardRound = 1;

let fieldSort = { key: "name", direction: "asc" };
let draftSort = { key: "name", direction: "asc" };

const $ = (id) => document.getElementById(id);

$("login-btn").addEventListener("click", login);
$("pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

async function login() {
  if ($("pin-input").value !== CORRECT_PIN) {
    $("login-status").textContent = "Wrong PIN.";
    return;
  }

  try {
    await signInAnonymously(auth);
  } catch (err) {
    $("login-status").textContent = err.message;
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  $("login-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  listenToField();
  listenToDraft();
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");

    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
    $(`${button.dataset.tab}-tab`).classList.remove("hidden");
  });
});

document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const state = th.dataset.table === "field" ? fieldSort : draftSort;
    if (state.key === th.dataset.key) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.key = th.dataset.key;
      state.direction = "asc";
    }
    renderAll();
  });
});

$("field-csv").addEventListener("change", uploadField);
$("import-odds-btn").addEventListener("click", importOdds);
$("clear-odds-btn").addEventListener("click", () => { $("odds-text").value = ""; $("field-status").textContent = ""; });
$("field-search").addEventListener("input", renderFieldTable);
$("scores-search").addEventListener("input", renderScoresTable);
$("breakdown-search").addEventListener("input", renderBreakdownTable);

$("start-draft-btn").addEventListener("click", startDraft);
$("reset-draft-btn").addEventListener("click", resetDraft);
$("cancel-pick-btn").addEventListener("click", closeConfirm);
$("confirm-pick-btn").addEventListener("click", confirmPick);

$("load-schedule-btn").addEventListener("click", loadSchedule);
$("link-tournament-btn").addEventListener("click", linkTournament);
$("refresh-scores-btn").addEventListener("click", refreshScores);
$("refresh-all-btn").addEventListener("click", refreshScores);
$("round-csv").addEventListener("change", uploadRoundScores);

$("close-scorecard-btn").addEventListener("click", closeScorecard);
$("scorecard-modal").addEventListener("click", (e) => { if (e.target.id === "scorecard-modal") closeScorecard(); });
document.querySelectorAll(".round-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".round-tab").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    activeScorecardRound = Number(button.dataset.round);
    renderScorecard();
  });
});

function lastNameKey(name) {
  const suffixes = ["jr", "sr", "ii", "iii", "iv"];
  const parts = String(name || "")
    .replace(/[.,']/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !suffixes.includes(part.toLowerCase()));

  if (!parts.length) return "";
  return `${parts[parts.length - 1].toLowerCase()}-${parts.slice(0, -1).join(" ").toLowerCase()}`;
}

function normalizeName(name) {
  const suffixes = ["jr", "sr", "ii", "iii", "iv"];
  return String(name || "")
    .replace(/[.,']/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !suffixes.includes(part))
    .sort()
    .join("-");
}

function createIdFromName(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[.,']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseOdds(value) {
  const num = Number(String(value || "").replace("+", "").replace(",", "").trim());
  return Number.isNaN(num) ? null : num;
}

function parseScore(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "--") return null;
  if (raw.toUpperCase() === "E") return 0;
  const num = Number(raw.replace("+", ""));
  return Number.isNaN(num) ? null : num;
}

function formatScore(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return "--";
  if (num === 0) return "E";
  return num > 0 ? `+${num}` : String(num);
}

function formatPoints(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return "--";
  return num > 0 ? `+${num}` : String(num);
}

function pointsFromStrokes(totalScore) {
  const strokes = parseScore(totalScore);
  return strokes === null ? null : -strokes;
}

function holePoints(strokes, par) {
  const diff = strokes - par;
  if (diff <= -3) return 13;
  if (diff === -2) return 8;
  if (diff === -1) return 3;
  if (diff === 0) return 0;
  if (diff === 1) return -1;
  return -3;
}

function finishPoints(position) {
  const rank = parseInt(String(position || "").replace("T", "").trim(), 10);
  if (Number.isNaN(rank)) return 0;
  if (rank === 1) return 30;
  if (rank === 2) return 20;
  if (rank === 3) return 18;
  if (rank === 4) return 16;
  if (rank === 5) return 14;
  if (rank === 6) return 12;
  if (rank === 7) return 10;
  if (rank === 8) return 9;
  if (rank === 9) return 8;
  if (rank === 10) return 7;
  if (rank <= 15) return 6;
  if (rank <= 20) return 5;
  if (rank <= 25) return 4;
  if (rank <= 30) return 3;
  if (rank <= 40) return 2;
  if (rank <= 50) return 1;
  return 0;
}

function sortValue(golfer, key) {
  if (key === "name") return lastNameKey(golfer.name);
  if (["winOdds", "top5Odds", "top10Odds"].includes(key)) return parseOdds(golfer[key]);
  if (key === "status") return getPlayerTeam(golfer.id) || "available";
  if (key === "points") return golfer.totalPoints ?? pointsFromStrokes(golfer.totalScore);
  return String(golfer[key] || "").toLowerCase();
}

function sortGolfers(golfers, state) {
  return [...golfers].sort((a, b) => {
    const av = sortValue(a, state.key);
    const bv = sortValue(b, state.key);

    if (av === null && bv === null) return lastNameKey(a.name).localeCompare(lastNameKey(b.name));
    if (av === null) return 1;
    if (bv === null) return -1;

    const result = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv));

    return state.direction === "asc" ? result : -result;
  });
}

function renderSortIndicators() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    const state = th.dataset.table === "field" ? fieldSort : draftSort;
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.key === state.key) th.classList.add(state.direction === "asc" ? "sorted-asc" : "sorted-desc");
  });
}

function isOddsLine(line) {
  return /^[+-]\d+$/.test(line.trim());
}

function isLikelyPlayerName(line) {
  const badWords = ["john deere", "wed ", "outright", "top 5", "top 10", "including ties", "winner"];
  const clean = line.trim().toLowerCase();
  if (!clean || isOddsLine(clean) || /\d/.test(clean)) return false;
  return !badWords.some((word) => clean.includes(word));
}

function parseDraftKingsOddsText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = [];

  for (let i = 0; i < lines.length; i++) {
    const possibleName = lines[i];
    if (!isLikelyPlayerName(possibleName)) continue;

    const odds = [];
    let j = i + 1;

    while (j < lines.length && odds.length < 3) {
      if (isOddsLine(lines[j])) odds.push(lines[j]);
      else if (isLikelyPlayerName(lines[j])) break;
      j++;
    }

    if (odds.length === 3) {
      parsed.push({ name: possibleName, winOdds: odds[0], top5Odds: odds[1], top10Odds: odds[2] });
      i = j - 1;
    }
  }

  return parsed;
}

async function uploadField(e) {
  const file = e.target.files[0];
  if (!file) return;

  Papa.parse(file, {
    complete: async (results) => {
      const names = results.data
        .map((row) => (row[0] || "").trim())
        .filter((name) => name && !["name", "golfer", "player"].includes(name.toLowerCase()));

      $("field-status").textContent = `Uploading ${names.length} golfers...`;

      const existing = await getDocs(fieldCollection);
      for (const d of existing.docs) await deleteDoc(d.ref);

      for (const name of names) {
        await setDoc(doc(fieldCollection, createIdFromName(name)), {
          name,
          normalizedName: normalizeName(name),
          winOdds: "",
          top5Odds: "",
          top10Odds: "",
          position: "",
          thru: "",
          r1: "",
          r2: "",
          r3: "",
          r4: "",
          totalScore: "",
          totalPoints: null,
          playerId: "",
          holesByRound: {}
        });
      }

      $("field-status").textContent = `Uploaded ${names.length} golfers.`;
    }
  });
}

async function importOdds() {
  const odds = parseDraftKingsOddsText($("odds-text").value);

  if (!odds.length) {
    $("field-status").textContent = "No odds found in that text.";
    return;
  }

  const byName = new Map(currentField.map((g) => [normalizeName(g.name), g]));
  let matched = 0;
  let missed = 0;

  for (const item of odds) {
    const golfer = byName.get(normalizeName(item.name));
    if (!golfer) {
      missed++;
      continue;
    }

    await updateDoc(doc(fieldCollection, golfer.id), {
      winOdds: item.winOdds,
      top5Odds: item.top5Odds,
      top10Odds: item.top10Odds
    });

    matched++;
  }

  $("field-status").textContent = `Imported odds. Matched ${matched}. Missed ${missed}.`;
}

function listenToField() {
  onSnapshot(fieldCollection, (snapshot) => {
    currentField = [];
    snapshot.forEach((docSnap) => {
      currentField.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderAll();
  });
}

function listenToDraft() {
  onSnapshot(draftDocRef, (docSnap) => {
    draftState = docSnap.exists() ? docSnap.data() : { status: "setup" };
    renderAll();
  });
}

function renderAll() {
  renderSortIndicators();
  renderMetrics();
  renderFieldTable();
  renderDraftBoard();
  renderScoresTable();
  renderBreakdownTable();
}

function getPickedIds() {
  return new Set(draftState?.picks?.map((p) => p.playerId) || []);
}

function getPlayerTeam(playerId) {
  return draftState?.picks?.find((p) => p.playerId === playerId)?.team || "";
}

function renderMetrics() {
  const picked = getPickedIds();
  $("metric-field").textContent = currentField.length;
  $("metric-drafted").textContent = currentField.filter((g) => picked.has(g.id)).length;

  const teamPoints = {};
  (draftState?.picks || []).forEach((pick) => {
    const golfer = currentField.find((g) => g.id === pick.playerId);
    const points = golfer?.totalPoints ?? pointsFromStrokes(golfer?.totalScore);
    if (!teamPoints[pick.team]) teamPoints[pick.team] = 0;
    if (points !== null) teamPoints[pick.team] += points;
  });

  const teamA = draftState?.teamA || "Chenny";
  const teamB = draftState?.teamB || "Juice";
  $("metric-team-a").textContent = formatPoints(teamPoints[teamA]);
  $("metric-team-b").textContent = formatPoints(teamPoints[teamB]);
  $("team-a-title").textContent = teamA;
  $("team-b-title").textContent = teamB;
}

function renderFieldTable() {
  const q = $("field-search").value.toLowerCase();
  const picked = getPickedIds();
  const rows = sortGolfers(currentField.filter((g) => g.name.toLowerCase().includes(q)), fieldSort);

  $("field-body").innerHTML = rows.map((g) => {
    const points = g.totalPoints ?? pointsFromStrokes(g.totalScore);
    return `
      <tr>
        <td class="golfer-name">${g.name}</td>
        <td class="${g.winOdds ? "good" : "muted"}">${g.winOdds || "--"}</td>
        <td class="${g.top5Odds ? "good" : "muted"}">${g.top5Odds || "--"}</td>
        <td class="${g.top10Odds ? "good" : "muted"}">${g.top10Odds || "--"}</td>
        <td>${picked.has(g.id) ? `<span class="status-chip">${getPlayerTeam(g.id)}</span>` : `<span class="pill">Available</span>`}</td>
        <td class="${points > 0 ? "good" : points < 0 ? "bad" : "amber"}">${formatPoints(points)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6" class="muted">No golfers found.</td></tr>`;
}

async function startDraft() {
  const teamA = "Chenny";
  const teamB = "Juice";
  const rosterSize = parseInt($("roster-size").value, 10) || 5;
  const firstPick = Math.random() < 0.5 ? teamA : teamB;
  const order = firstPick === teamA ? [teamA, teamB] : [teamB, teamA];

  await setDoc(draftDocRef, { status: "drafting", rosterSize, teamA, teamB, order, picks: [] });
}

async function resetDraft() {
  if (!confirm("Reset the draft? This clears all picks.")) return;
  await setDoc(draftDocRef, { status: "setup" });
}

function currentPicker() {
  if (!draftState || draftState.status !== "drafting") return null;
  const { order, picks, rosterSize } = draftState;
  if (picks.length >= rosterSize * 2) return null;
  const round = Math.floor(picks.length / 2);
  const pos = picks.length % 2;
  return round % 2 === 0 ? order[pos] : order[1 - pos];
}

function renderDraftBoard() {
  const setup = $("draft-setup");
  const board = $("draft-board");

  if (!draftState || draftState.status !== "drafting") {
    setup.classList.remove("hidden");
    board.classList.add("hidden");
    return;
  }

  setup.classList.add("hidden");
  board.classList.remove("hidden");

  const picker = currentPicker();
  $("turn-label").textContent = picker ? `${picker}'s turn` : "Draft complete";

  const picked = getPickedIds();
  const available = sortGolfers(currentField.filter((g) => !picked.has(g.id)), draftSort);

  $("draft-body").innerHTML = available.map((g) => `
    <tr>
      <td class="golfer-name">${g.name}</td>
      <td><button class="select-btn" data-id="${g.id}" ${!picker ? "disabled" : ""}>Select</button></td>
    </tr>
  `).join("") || `<tr><td colspan="2" class="muted">No available golfers.</td></tr>`;

  document.querySelectorAll(".select-btn").forEach((btn) => {
    btn.addEventListener("click", () => openConfirm(currentField.find((g) => g.id === btn.dataset.id)));
  });

  renderRosters();
}

function renderRosters() {
  const teamA = draftState?.teamA || "Chenny";
  const teamB = draftState?.teamB || "Juice";
  const picks = draftState?.picks || [];

  const a = picks.filter((p) => p.team === teamA).map((p) => p.playerName).sort((x, y) => lastNameKey(x).localeCompare(lastNameKey(y)));
  const b = picks.filter((p) => p.team === teamB).map((p) => p.playerName).sort((x, y) => lastNameKey(x).localeCompare(lastNameKey(y)));

  $("team-a-list").innerHTML = a.map((name) => `<li>${name}</li>`).join("");
  $("team-b-list").innerHTML = b.map((name) => `<li>${name}</li>`).join("");
}

function openConfirm(golfer) {
  const picker = currentPicker();
  if (!golfer || !picker) return;
  pendingPick = golfer;
  $("confirm-title").textContent = `Draft ${golfer.name}?`;
  $("confirm-copy").textContent = `${golfer.name} will be added to ${picker}.`;
  $("confirm-modal").classList.remove("hidden");
}

function closeConfirm() {
  pendingPick = null;
  $("confirm-modal").classList.add("hidden");
}

async function confirmPick() {
  const golfer = pendingPick;
  const picker = currentPicker();
  if (!golfer || !picker) return;

  const freshSnap = await getDoc(draftDocRef);
  const fresh = freshSnap.data();

  if (fresh.picks.some((p) => p.playerId === golfer.id)) {
    alert("That golfer was already picked.");
    closeConfirm();
    return;
  }

  await updateDoc(draftDocRef, {
    picks: [...fresh.picks, { team: picker, playerId: golfer.id, playerName: golfer.name }]
  });

  closeConfirm();
}

function unwrapMongoJSON(value) {
  if (Array.isArray(value)) return value.map(unwrapMongoJSON);

  if (value && typeof value === "object") {
    if ("$numberInt" in value) return parseInt(value.$numberInt, 10);
    if ("$numberLong" in value) return parseInt(value.$numberLong, 10);
    if ("$numberDouble" in value) return parseFloat(value.$numberDouble);
    if ("$date" in value) return unwrapMongoJSON(value.$date);
    if ("$oid" in value) return value.$oid;

    const out = {};
    for (const key of Object.keys(value)) out[key] = unwrapMongoJSON(value[key]);
    return out;
  }

  return value;
}

async function golfApiFetch(path, params) {
  if (!RAPIDAPI_KEY || RAPIDAPI_KEY.includes("PASTE_")) {
    throw new Error("Add your RapidAPI key in app.js first.");
  }

  const url = `https://${RAPIDAPI_HOST}/${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { "x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": RAPIDAPI_HOST }
  });

  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  const json = await res.json();
  return unwrapMongoJSON(json);
}

function eventName(event) {
  return event.name || event.tournName || event.tournamentName || event.officialName || "Unnamed tournament";
}

function eventTournId(event) {
  return event.tournId || event.tournamentId || event.id || "";
}

function eventStartDate(event) {
  const raw = event.date || event.startDate || event.tournStartDate || event.tournamentStartDate || "";

  if (!raw) return "";
  if (typeof raw === "string") return raw;

  if (typeof raw === "object") {
    return raw.display || raw.date || raw.value || raw.iso || raw.shortDate || "";
  }

  return String(raw);
}

function flattenSchedule(data) {
  if (Array.isArray(data)) return data;
  return data.schedule || data.events || data.tournaments || data.data || [];
}

async function loadSchedule() {
  const year = $("schedule-year").value.trim();
  $("scores-status").textContent = "Loading schedule...";

  try {
    const data = await golfApiFetch("schedule", { orgId: "1", year });
    scheduleEvents = flattenSchedule(data).filter(eventTournId);

    $("tournament-select").innerHTML = scheduleEvents.map((event, i) => (
      `<option value="${i}">${eventName(event)} | tournId ${eventTournId(event)} | ${eventStartDate(event)}</option>`
    )).join("") || `<option value="">No tournaments found</option>`;

    $("scores-status").textContent = `Loaded ${scheduleEvents.length} tournaments.`;
  } catch (err) {
    $("scores-status").textContent = `❌ ${err.message}`;
  }
}

async function linkTournament() {
  const year = $("schedule-year").value.trim();
  const selected = scheduleEvents[Number($("tournament-select").value)];
  const tournId = selected ? eventTournId(selected) : "";

  if (!tournId) {
    $("scores-status").textContent = "Load schedule and select a tournament first.";
    return;
  }

  $("scores-status").textContent = "Linking tournament...";

  try {
    const data = await golfApiFetch("tournament", { orgId: "1", tournId, year });
    const course = data.courses?.[0];
    const coursePar = course?.holes?.map((h) => parseInt(h.par, 10)) || defaultPar;

    await setDoc(tournamentMetaRef, {
      orgId: "1",
      tournId,
      year,
      tournamentName: data.name || eventName(selected),
      courseName: course?.courseName || "",
      coursePar,
      lastFetched: new Date().toISOString()
    }, { merge: true });

    const byName = new Map(currentField.map((g) => [normalizeName(g.name), g]));
    let matched = 0;

    for (const p of data.players || []) {
      const golfer = byName.get(normalizeName(`${p.firstName} ${p.lastName}`));
      if (!golfer) continue;
      await updateDoc(doc(fieldCollection, golfer.id), { playerId: p.playerId });
      matched++;
    }

    $("linked-tournament").classList.remove("hidden");
    $("linked-tournament").textContent = `Linked: ${data.name || eventName(selected)} | ${course?.courseName || "Course pending"} | matched ${matched}`;
    $("tournament-label").textContent = data.name || eventName(selected);
    $("scores-status").textContent = "Tournament linked.";
  } catch (err) {
    $("scores-status").textContent = `❌ ${err.message}`;
  }
}

async function refreshScores() {
  const btns = [$("refresh-scores-btn"), $("refresh-all-btn")];
  if (btns[0]?.disabled) return; // already refreshing / on cooldown

  if (!draftState?.picks?.length) {
    $("scores-status").textContent = "Draft golfers first.";
    return;
  }

  const metaSnap = await getDoc(tournamentMetaRef);
  if (!metaSnap.exists() || !metaSnap.data().tournId) {
    $("scores-status").textContent = "Link a tournament first.";
    return;
  }

  const { orgId, tournId, year } = metaSnap.data();
  $("scores-status").textContent = "Refreshing drafted golfers...";
  btns.forEach((b) => { if (b) b.disabled = true; });

  try {
    // Only the leaderboard call — this is cheap (1 call total) and gives us
    // position, thru, and overall score. Hole-by-hole scoring comes from the
    // CSV uploads instead, so we never touch the per-golfer scorecard endpoint.
    const leaderboard = await golfApiFetch("leaderboard", { orgId, tournId, year });
    const rows = leaderboard.leaderboardRows || leaderboard.rows || [];
    const drafted = currentField.filter((g) => getPickedIds().has(g.id) && g.playerId);

    let refreshed = 0;

    for (const golfer of drafted) {
      const row = rows.find((r) => String(r.playerId) === String(golfer.playerId));
      if (!row) continue;

      // Don't touch holesByRound here — that's owned by the CSV upload now.
      const holesByRound = golfer.holesByRound || {};
      const totalHolePoints = Object.values(holesByRound).reduce(
        (sum, round) => sum + (round.roundPoints || 0),
        0
      );

      const finPts = finishPoints(row.position);
      const totalPoints = totalHolePoints + finPts;

      await updateDoc(doc(fieldCollection, golfer.id), {
        position: row.position || "",
        thru: row.thru || "",
        totalScore: row.total || row.totalScore || row.scoreToPar || "",
        totalHolePoints,
        finishPoints: finPts,
        totalPoints
      });

      refreshed++;
    }

    $("scores-status").textContent = `Refreshed ${refreshed} drafted golfers.`;
  } catch (err) {
    $("scores-status").textContent = `❌ ${err.message}`;
  } finally {
    setTimeout(() => { btns.forEach((b) => { if (b) b.disabled = false; }); }, 30000);
  }
}

async function uploadRoundScores(e) {
  const file = e.target.files[0];
  if (!file) return;

  const roundId = Number($("round-csv-select").value);
  const statusEl = $("round-csv-status");
  statusEl.textContent = "Reading CSV...";

  const metaSnap = await getDoc(tournamentMetaRef);
  const coursePar = metaSnap.exists() ? (metaSnap.data().coursePar || defaultPar) : defaultPar;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const byName = new Map(currentField.map((g) => [normalizeName(g.name), g]));
      let matched = 0;
      let missed = 0;

      for (const row of results.data) {
        const rawName = row.Golfer || row.golfer || row.Name || row.name || "";
        const golfer = byName.get(normalizeName(rawName));
        if (!golfer) {
          if (rawName.trim()) missed++;
          continue;
        }

        const holes = [];
        let roundPoints = 0;
        let holesPlayed = 0;

        for (let h = 1; h <= 18; h++) {
          const raw = row[String(h)];
          const par = Number(coursePar[h - 1] ?? defaultPar[h - 1]);
          const strokes = raw === undefined || raw === null || String(raw).trim() === "" ? null : Number(raw);
          const pts = strokes != null && !Number.isNaN(strokes) ? holePoints(strokes, par) : 0;

          if (strokes != null && !Number.isNaN(strokes)) holesPlayed++;
          roundPoints += pts;
          holes.push({ holeScore: Number.isNaN(strokes) ? null : strokes, par });
        }

        const holesByRound = golfer.holesByRound || {};
        holesByRound[roundId] = { holes, roundPoints, complete: holesPlayed === 18 };

        const totalHolePoints = Object.values(holesByRound).reduce(
          (sum, round) => sum + (round.roundPoints || 0),
          0
        );

        const finPts = finishPoints(golfer.position);
        const totalPoints = totalHolePoints + finPts;

        const scoreToPar = holesPlayed
          ? holes.reduce((sum, h) => sum + (h.holeScore != null ? h.holeScore - h.par : 0), 0)
          : null;

        await updateDoc(doc(fieldCollection, golfer.id), {
          holesByRound,
          totalHolePoints,
          finishPoints: finPts,
          totalPoints,
          [`r${roundId}`]: scoreToPar != null ? formatScore(scoreToPar) : ""
        });

        matched++;
      }

      statusEl.textContent = `Round ${roundId}: updated ${matched} golfers. ${missed ? `${missed} names didn't match.` : ""}`;
      $("round-csv").value = "";
    },
    error: (err) => {
      statusEl.textContent = `❌ ${err.message}`;
    }
  });
}

function renderScoresTable() {
  const q = $("scores-search").value.toLowerCase();

  const rows = currentField
    .filter((g) => g.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.totalPoints ?? pointsFromStrokes(a.totalScore);
      const bp = b.totalPoints ?? pointsFromStrokes(b.totalScore);
      if (ap === null && bp === null) return lastNameKey(a.name).localeCompare(lastNameKey(b.name));
      if (ap === null) return 1;
      if (bp === null) return -1;
      return bp - ap;
    });

  $("scores-body").innerHTML = rows.map((g) => {
    const points = g.totalPoints ?? pointsFromStrokes(g.totalScore);
    const team = getPlayerTeam(g.id);
    return `
      <tr>
        <td class="golfer-name clickable" data-scorecard="${g.id}">${g.name}</td>
        <td>${g.position || `<span class="muted">--</span>`}</td>
        <td>${g.thru || `<span class="muted">--</span>`}</td>
        <td>${g.r1 || `<span class="muted">--</span>`}</td>
        <td>${g.r2 || `<span class="muted">--</span>`}</td>
        <td>${g.r3 || `<span class="muted">--</span>`}</td>
        <td>${g.r4 || `<span class="muted">--</span>`}</td>
        <td class="${parseScore(g.totalScore) < 0 ? "good" : parseScore(g.totalScore) > 0 ? "bad" : "amber"}">${g.totalScore || "--"}</td>
        <td class="${points > 0 ? "good" : points < 0 ? "bad" : "amber"}">${formatPoints(points)}</td>
        <td>${team ? `<span class="status-chip">${team}</span>` : `<span class="muted">Undrafted</span>`}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="10" class="muted">No scores found.</td></tr>`;

  document.querySelectorAll("[data-scorecard]").forEach((cell) => {
    cell.addEventListener("click", () => openScorecard(currentField.find((g) => g.id === cell.dataset.scorecard)));
  });
}

function renderBreakdownTable() {
  const q = $("breakdown-search")?.value.toLowerCase() || "";
  const picked = getPickedIds();

  const rows = currentField
    .filter((g) => picked.has(g.id) && g.name.toLowerCase().includes(q))
    .map((g) => {
      const holesByRound = g.holesByRound || {};
      const roundPts = [1, 2, 3, 4].map((r) => holesByRound[r]?.roundPoints ?? null);
      const holePts = g.totalHolePoints ?? roundPts.reduce((sum, p) => sum + (p || 0), 0);
      const finPts = g.finishPoints ?? finishPoints(g.position);
      const total = g.totalPoints ?? (holePts + finPts);
      return { golfer: g, roundPts, holePts, finPts, total };
    })
    .sort((a, b) => b.total - a.total);

  $("breakdown-body").innerHTML = rows.map(({ golfer, roundPts, holePts, finPts, total }) => `
    <div class="breakdown-card">
      <div class="breakdown-card-head">
        <div>
          <div class="golfer-name">${golfer.name}</div>
          <span class="status-chip">${getPlayerTeam(golfer.id)}</span>
        </div>
        <div class="breakdown-total ${total > 0 ? "good" : total < 0 ? "bad" : "amber"}">${formatPoints(total)}</div>
      </div>
      <div class="breakdown-rounds">
        ${roundPts.map((p, i) => `
          <div class="breakdown-round">
            <span class="breakdown-round-label">R${i + 1}</span>
            <span class="${p == null ? "muted" : p > 0 ? "good" : p < 0 ? "bad" : "amber"}">${p == null ? "--" : formatPoints(p)}</span>
          </div>
        `).join("")}
      </div>
      <div class="breakdown-foot">
        <span>Hole pts <strong class="${holePts > 0 ? "good" : holePts < 0 ? "bad" : "amber"}">${formatPoints(holePts)}</strong></span>
        <span>Finish bonus <strong class="${finPts > 0 ? "good" : "muted"}">${finPts ? formatPoints(finPts) : "--"}</strong></span>
      </div>
    </div>
  `).join("") || `<p class="muted">No drafted golfers yet.</p>`;
}

function openScorecard(golfer) {
  activeScorecardGolfer = golfer;
  activeScorecardRound = 1;
  document.querySelectorAll(".round-tab").forEach((b) => b.classList.toggle("active", b.dataset.round === "1"));
  $("scorecard-modal").classList.remove("hidden");
  renderScorecard();
}

function closeScorecard() {
  activeScorecardGolfer = null;
  $("scorecard-modal").classList.add("hidden");
}

function renderScorecard() {
  if (!activeScorecardGolfer) return;

  const golfer = activeScorecardGolfer;
  const roundData = golfer.holesByRound?.[activeScorecardRound];
  const holes = roundData?.holes || defaultPar.map((par) => ({ par, holeScore: null }));
  const points = golfer.totalPoints ?? pointsFromStrokes(golfer.totalScore);

  $("scorecard-title").textContent = golfer.name;
  $("scorecard-summary").textContent = `Position: ${golfer.position || "--"} | Strokes: ${golfer.totalScore || "--"} | Points: ${formatPoints(points)}`;
  $("scorecard-content").innerHTML = renderNine(1, 9, holes) + renderNine(10, 18, holes);
}

function shapeClassFor(score, par) {
  if (score == null || par == null) return "";
  const diff = Number(score) - Number(par);
  if (diff <= -2) return "shape-eagle";
  if (diff === -1) return "shape-birdie";
  if (diff === 1) return "shape-bogey";
  if (diff >= 2) return "shape-dbogey";
  return "";
}

function renderNine(start, end, holes) {
  const range = [];
  for (let h = start; h <= end; h++) range.push(h);

  const parTotal = range.reduce((sum, h) => sum + Number(holes[h - 1]?.par || 0), 0);
  const scoreTotal = range.reduce((sum, h) => sum + Number(holes[h - 1]?.holeScore || 0), 0);
  const hasScores = range.some((h) => holes[h - 1]?.holeScore != null);

  return `
    <div class="scorecard-nine">
      <table class="scorecard-table">
        <colgroup>
          <col style="width:82px">
          ${range.map(() => `<col>`).join("")}
          <col style="width:82px">
        </colgroup>
        <thead>
          <tr><th>Hole</th>${range.map((h) => `<th>${h}</th>`).join("")}<th>Total</th></tr>
        </thead>
        <tbody>
          <tr><td>Par</td>${range.map((h) => `<td>${holes[h - 1]?.par ?? "--"}</td>`).join("")}<td>${parTotal || "--"}</td></tr>
          <tr>
            <td>R${activeScorecardRound}</td>
            ${range.map((h) => {
              const hole = holes[h - 1] || {};
              const score = hole.holeScore;
              const par = hole.par;
              const cls = score == null ? "muted" : Number(score) < Number(par) ? "good" : Number(score) > Number(par) ? "bad" : "amber";
              const shape = shapeClassFor(score, par);
              const inner = score ?? "--";
              return `<td class="${cls}">${shape ? `<span class="score-shape ${shape}">${inner}</span>` : inner}</td>`;
            }).join("")}
            <td>${hasScores ? scoreTotal : "--"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}
