import { firebaseConfig } from "./firebase-config.js";
import { generateBoard, scoreWord, areAdjacent, makeRoomCode, sanitizeRoomCode } from "./game-core.js";

const $ = (id) => document.getElementById(id);
const els = {
  homeScreen: $("homeScreen"), roomScreen: $("roomScreen"), playerName: $("playerName"),
  practiceButton: $("practiceButton"), roomCodeInput: $("roomCodeInput"),
  createRoomButton: $("createRoomButton"), joinRoomButton: $("joinRoomButton"),
  roomHeading: $("roomHeading"), copyRoomButton: $("copyRoomButton"), phaseLabel: $("phaseLabel"),
  timerCard: $("timerCard"), timerText: $("timerText"), dictionaryStatus: $("dictionaryStatus"),
  lobbyPanel: $("lobbyPanel"), lobbyPlayers: $("lobbyPlayers"), lobbyTitle: $("lobbyTitle"),
  lobbyDescription: $("lobbyDescription"), hostControls: $("hostControls"), waitingCopy: $("waitingCopy"),
  durationSelect: $("durationSelect"), startGameButton: $("startGameButton"),
  gamePanel: $("gamePanel"), board: $("board"), boardWrap: $("boardWrap"), traceLine: $("traceLine"),
  countdownOverlay: $("countdownOverlay"), countdownNumber: $("countdownNumber"), currentWord: $("currentWord"),
  wordHint: $("wordHint"), myScore: $("myScore"), lastWord: $("lastWord"), leaderboard: $("leaderboard"),
  leaderboardEyebrow: $("leaderboardEyebrow"), leaderboardTitle: $("leaderboardTitle"),
  playerCount: $("playerCount"), wordLog: $("wordLog"), resultsPanel: $("resultsPanel"),
  winnerHeading: $("winnerHeading"), resultsList: $("resultsList"), rematchButton: $("rematchButton"),
  leaveRoomButton: $("leaveRoomButton"), toast: $("toast"), homeButton: $("homeButton"),
  helpButton: $("helpButton"), helpDialog: $("helpDialog"), closeHelpButton: $("closeHelpButton")
};

const state = {
  mode: null, // "multiplayer" | "practice" | null
  user: null,
  db: null,
  firebase: null,
  firebaseInitPromise: null,
  roomCode: null,
  roomSessionId: null,
  room: null,
  roomUnsubscribe: null,
  offsetUnsubscribe: null,
  serverOffset: 0,
  dictionary: null,
  dictionaryReady: false,
  selected: [],
  dragging: false,
  roundId: null,
  localWords: [],
  localAccepted: new Set(),
  finishRequested: false,
  tickHandle: null,
  presenceRef: null
};

const YAWL_VERSION = "0.3.2.03";

const WORDLIST_SOURCES = [
  "./wordlist.txt",
  "https://cdn.jsdelivr.net/gh/elasticdog/yawl@master/yawl-0.3.2.03/word.list",
  "https://raw.githubusercontent.com/elasticdog/yawl/master/yawl-0.3.2.03/word.list"
];

const ROOM_CODES = "0123456789".split("");
const ROOM_TTL_MS = 30 * 60 * 1000;
const FINISHED_ROOM_GRACE_MS = 5 * 60 * 1000;
const PRACTICE_UID = "practice";

function configLooksReady() {
  return firebaseConfig?.apiKey &&
    !JSON.stringify(firebaseConfig).includes("PASTE_YOUR");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");

  clearTimeout(showToast.timeout);

  showToast.timeout = setTimeout(
    () => els.toast.classList.remove("show"),
    2600
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[c])
  );
}

function getPlayerName() {
  const value = els.playerName.value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18);

  const name = value || "Player";

  localStorage.setItem("wordgrid-player-name", name);

  return name;
}

function setScreen(screen) {
  els.homeScreen.classList.toggle("active", screen === "home");
  els.roomScreen.classList.toggle("active", screen === "room");
}

function isPractice() {
  return state.mode === "practice";
}

function currentPlayerUid() {
  return isPractice()
    ? PRACTICE_UID
    : state.user?.uid;
}

function nowServer() {
  return Date.now() + state.serverOffset;
}

function nowGame() {
  return isPractice()
    ? Date.now()
    : nowServer();
}

function roomRef(code = state.roomCode) {
  return state.firebase.ref(
    state.db,
    `rooms/${code}`
  );
}

async function ensureFirebase() {
  if (state.db && state.user && state.firebase) {
    return;
  }

  if (state.firebaseInitPromise) {
    return state.firebaseInitPromise;
  }

  if (!configLooksReady()) {
    throw new Error(
      "Firebase is not configured yet. Practice mode still works."
    );
  }

  state.firebaseInitPromise = (async () => {
    const [appMod, authMod, dbMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js")
    ]);

    const app = appMod.initializeApp(firebaseConfig);

    state.db = dbMod.getDatabase(app);
    state.firebase = dbMod;

    const auth = authMod.getAuth(app);

    state.offsetUnsubscribe = dbMod.onValue(
      dbMod.ref(state.db, ".info/serverTimeOffset"),
      snap => {
        state.serverOffset = Number(
          snap.val() || 0
        );
      }
    );

    const credential =
      await authMod.signInAnonymously(auth);

    state.user = credential.user;
  })();

  try {
    await state.firebaseInitPromise;
  } catch (error) {
    state.firebaseInitPromise = null;
    state.db = null;
    state.user = null;
    state.firebase = null;

    throw error;
  }
}

function openWordDb() {
  return new Promise((resolve, reject) => {
    const req =
      indexedDB.open("wordgrid-live-cache", 1);

    req.onupgradeneeded = () =>
      req.result.createObjectStore("assets");

    req.onsuccess = () =>
      resolve(req.result);

    req.onerror = () =>
      reject(req.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openWordDb();

    return await new Promise(
      (resolve, reject) => {
        const tx =
          db.transaction("assets", "readonly");

        const req =
          tx.objectStore("assets").get(key);

        req.onsuccess = () =>
          resolve(req.result || null);

        req.onerror = () =>
          reject(req.error);
      }
    );
  } catch {
    return null;
  }
}

async function cacheSet(key, value) {
  try {
    const db = await openWordDb();

    await new Promise(
      (resolve, reject) => {
        const tx =
          db.transaction("assets", "readwrite");

        tx.objectStore("assets")
          .put(value, key);

        tx.oncomplete = resolve;

        tx.onerror = () =>
          reject(tx.error);
      }
    );
  } catch {
    // Cache is optional.
  }
}

function parseDictionary(text) {
  const words = new Set();

  for (const raw of text.split(/\r?\n/)) {
    const word =
      raw.trim().toLowerCase();

    if (/^[a-z]{3,16}$/.test(word)) {
      words.add(word);
    }
  }

  return words;
}

async function loadDictionary() {
  const cacheKey =
    `yawl-${YAWL_VERSION}`;

  els.dictionaryStatus.innerHTML =
    '<span class="dot"></span>Dictionary loading';

  const cached =
    await cacheGet(cacheKey);

  if (cached?.text) {
    const words =
      parseDictionary(cached.text);

    if (words.size > 200000) {
      state.dictionary = words;
      state.dictionaryReady = true;

      updateDictionaryUi(
        words.size,
        "cached"
      );

      return;
    }
  }

  for (const source of WORDLIST_SOURCES) {
    try {
      const response = await fetch(
        source,
        { cache: "force-cache" }
      );

      if (!response.ok) {
        continue;
      }

      const text =
        await response.text();

      const words =
        parseDictionary(text);

      if (words.size < 200000) {
        continue;
      }

      state.dictionary = words;
      state.dictionaryReady = true;

      updateDictionaryUi(
        words.size,
        source.startsWith("./")
          ? "local"
          : "online"
      );

      cacheSet(
        cacheKey,
        {
          text,
          savedAt: Date.now()
        }
      );

      return;
    } catch (error) {
      console.warn(
        "Dictionary source unavailable:",
        source,
        error
      );
    }
  }

  state.dictionaryReady = false;

  els.dictionaryStatus.classList.add(
    "error"
  );

  els.dictionaryStatus.innerHTML =
    '<span class="dot"></span>Dictionary unavailable';

  showToast(
    "Dictionary failed to load. See the README troubleshooting section."
  );
}

function updateDictionaryUi(count, mode) {
  els.dictionaryStatus.classList.remove(
    "error"
  );

  els.dictionaryStatus.classList.add(
    "ready"
  );

  els.dictionaryStatus.innerHTML =
    `<span class="dot"></span>${Math.round(count / 1000)}k words ready`;

  els.dictionaryStatus.title =
    `YAWL ${YAWL_VERSION}: ${count.toLocaleString()} accepted 3–16 letter entries (${mode}).`;
}

function randomSessionId() {
  const rand =
    Math.random()
      .toString(36)
      .slice(2, 10);

  return `${Date.now().toString(36)}-${rand}`;
}

function shuffledRoomCodes() {
  const codes =
    [...ROOM_CODES];

  const preferred =
    makeRoomCode();

  const preferredIndex =
    codes.indexOf(preferred);

  if (preferredIndex > 0) {
    [
      codes[0],
      codes[preferredIndex]
    ] = [
      codes[preferredIndex],
      codes[0]
    ];
  }

  for (
    let i = codes.length - 1;
    i > 1;
    i--
  ) {
    const j =
      1 + Math.floor(
        Math.random() * i
      );

    [
      codes[i],
      codes[j]
    ] = [
      codes[j],
      codes[i]
    ];
  }

  return codes;
}

function roomCanBeClaimed(room, now) {
  if (!room) {
    return true;
  }

  if (room.status === "closed") {
    return true;
  }

  if (
    Number(room.expiresAt || 0) > 0 &&
    Number(room.expiresAt) <= now
  ) {
    return true;
  }

  if (
    room.status === "finished" &&
    Number(room.finishedAt || 0) > 0 &&
    Number(room.finishedAt) +
      FINISHED_ROOM_GRACE_MS <= now
  ) {
    return true;
  }

  return false;
}

function buildRoom(name, sessionId) {
  const now =
    nowServer();

  return {
    hostUid: state.user.uid,
    sessionId,
    createdAt: now,
    expiresAt:
      now + ROOM_TTL_MS,
    status: "lobby",
    gameId: 0,

    durationMs:
      Number(
        els.durationSelect.value ||
        90000
      ),

    startAt: 0,
    board: [],

    players: {
      [state.user.uid]: {
        name,
        score: 0,
        wordCount: 0,
        joinedAt: now,
        online: true
      }
    }
  };
}

async function createRoom() {
  if (!state.dictionaryReady) {
    return showToast(
      "Wait for the dictionary to finish loading."
    );
  }

  els.createRoomButton.disabled =
    true;

  try {
    await ensureFirebase();

    const name =
      getPlayerName();

    const sessionId =
      randomSessionId();

    let claimedCode =
      null;

    for (
      const code of shuffledRoomCodes()
    ) {
      const result =
        await state.firebase.runTransaction(
          roomRef(code),

          current => {
            if (
              !roomCanBeClaimed(
                current,
                Date.now() +
                  state.serverOffset
              )
            ) {
              return;
            }

            return buildRoom(
              name,
              sessionId
            );
          },

          {
            applyLocally: false
          }
        );

      if (result.committed) {
        claimedCode = code;
        break;
      }
    }

    if (claimedCode === null) {
      throw new Error(
        "All 10 rooms (0–9) are in use. Try again after a game ends."
      );
    }

    await enterRoom(
      claimedCode,
      sessionId
    );
  } catch (error) {
    console.error(error);

    showToast(
      error.message ||
      "Could not create room."
    );
  } finally {
    els.createRoomButton.disabled =
      false;
  }
}

async function joinRoom(
  codeInput =
    els.roomCodeInput.value
) {
  if (!state.dictionaryReady) {
    return showToast(
      "Wait for the dictionary to finish loading."
    );
  }

  const code =
    sanitizeRoomCode(codeInput);

  if (code.length !== 1) {
    return showToast(
      "Enter the 1-digit room code (0–9)."
    );
  }

  els.joinRoomButton.disabled =
    true;

  try {
    await ensureFirebase();

    const snap =
      await state.firebase.get(
        roomRef(code)
      );

    if (!snap.exists()) {
      return showToast(
        "That room does not exist."
      );
    }

    const room =
      snap.val();

    if (
      roomCanBeClaimed(
        room,
        nowServer()
      )
    ) {
      return showToast(
        "That room is no longer active."
      );
    }

    if (
      room.status === "finished"
    ) {
      return showToast(
        "That round has already ended."
      );
    }

    const name =
      getPlayerName();

    const existing =
      room.players?.[
        state.user.uid
      ];

    await state.firebase.update(
      state.firebase.ref(
        state.db,
        `rooms/${code}/players/${state.user.uid}`
      ),
      {
        name,

        score:
          Number(
            existing?.score || 0
          ),

        wordCount:
          Number(
            existing?.wordCount || 0
          ),

        joinedAt:
          existing?.joinedAt ||
          nowServer(),

        online: true
      }
    );

    await enterRoom(
      code,
      room.sessionId
    );
  } catch (error) {
    console.error(error);

    showToast(
      error.message ||
      "Could not join that room."
    );
  } finally {
    els.joinRoomButton.disabled =
      false;
  }
}

async function enterRoom(
  code,
  sessionId
) {
  await cleanupRoomListeners();

  state.mode =
    "multiplayer";

  state.roomCode =
    code;

  state.roomSessionId =
    sessionId;

  state.finishRequested =
    false;

  state.roundId =
    null;

  state.localWords =
    [];

  state.localAccepted =
    new Set();

  els.wordLog.innerHTML =
    "";

  history.replaceState(
    null,
    "",
    `${location.pathname}?room=${code}`
  );

  setScreen("room");

  state.presenceRef =
    state.firebase.ref(
      state.db,
      `rooms/${code}/players/${state.user.uid}/online`
    );

  await state.firebase.set(
    state.presenceRef,
    true
  );

  state.firebase
    .onDisconnect(
      state.presenceRef
    )
    .set(false);

  state.roomUnsubscribe =
    state.firebase.onValue(
      roomRef(code),

      snap => {
        if (!snap.exists()) {
          showToast(
            "The room was closed."
          );

          leaveRoom({
            skipRemote: true
          });

          return;
        }

        const incoming =
          snap.val();

        if (
          state.roomSessionId &&
          incoming.sessionId !==
            state.roomSessionId
        ) {
          showToast(
            "That room code has been reused for a new game."
          );

          leaveRoom({
            skipRemote: true
          });

          return;
        }

        state.room =
          incoming;

        renderRoom();
      }
    );
}

async function startPractice() {
  if (!state.dictionaryReady) {
    return showToast(
      "Wait for the dictionary to finish loading."
    );
  }

  stopTimer();

  await cleanupRoomListeners();

  const name =
    getPlayerName();

  state.mode =
    "practice";

  state.roomCode =
    null;

  state.roomSessionId =
    null;

  state.roundId =
    null;

  state.localWords =
    [];

  state.localAccepted =
    new Set();

  state.finishRequested =
    false;

  state.room = {
    hostUid:
      PRACTICE_UID,

    sessionId:
      "local-practice",

    status:
      "lobby",

    gameId:
      0,

    durationMs:
      Number(
        els.durationSelect.value ||
        90000
      ),

    startAt:
      0,

    board:
      [],

    players: {
      [PRACTICE_UID]: {
        name,
        score: 0,
        wordCount: 0,
        joinedAt: Date.now(),
        online: true
      }
    }
  };

  history.replaceState(
    null,
    "",
    location.pathname
  );

  setScreen("room");

  renderRoom();
}

function renderRoom() {
  const room =
    state.room;

  if (!room) {
    return;
  }

  const uid =
    currentPlayerUid();

  const practice =
    isPractice();

  const players =
    Object.entries(
      room.players || {}
    ).map(
      ([playerUid, player]) => ({
        uid: playerUid,
        ...player
      })
    );

  const isHost =
    practice ||
    room.hostUid === uid;

  els.roomHeading.textContent =
    practice
      ? "PRACTICE"
      : state.roomCode;

  els.copyRoomButton.classList.toggle(
    "hidden",
    practice
  );

  els.hostControls.classList.toggle(
    "hidden",
    !isHost
  );

  els.waitingCopy.classList.toggle(
    "hidden",
    isHost
  );

  els.durationSelect.value =
    String(
      room.durationMs ||
      90000
    );

  els.startGameButton.innerHTML =
    practice
      ? "Start practice <b>→</b>"
      : "Start round <b>→</b>";

  els.leaveRoomButton.textContent =
    practice
      ? "Back home"
      : "Leave room";

  els.leaderboardEyebrow.textContent =
    practice
      ? "SOLO"
      : "LIVE";

  els.leaderboardTitle.textContent =
    practice
      ? "Your run"
      : "Leaderboard";

  if (practice) {
    els.phaseLabel.textContent =
      room.status === "finished"
        ? "PRACTICE RESULTS"
        : room.status === "playing"
          ? "PRACTICE"
          : "PRACTICE MODE";

    els.lobbyTitle.textContent =
      "Warm up on your own.";

    els.lobbyDescription.textContent =
      "Practice runs entirely in this browser. No room code or Firebase connection is used.";
  } else {
    els.phaseLabel.textContent =
      room.status === "playing"
        ? "ROUND IN PROGRESS"
        : room.status === "finished"
          ? "RESULTS"
          : "ROOM";

    els.lobbyTitle.textContent =
      "Ready when everyone is in.";

    els.lobbyDescription.textContent =
      "Share the room code or invite link. The board appears for everyone when the host starts.";
  }

  els.lobbyPlayers.innerHTML =
    players.map(
      p => `
        <span class="player-chip">
          <span class="avatar">
            ${escapeHtml(
              (p.name || "P")
                .slice(0, 1)
                .toUpperCase()
            )}
          </span>

          ${escapeHtml(
            p.name || "Player"
          )}

          ${
            !practice &&
            p.uid === room.hostUid
              ? "<em>HOST</em>"
              : ""
          }
        </span>
      `
    ).join("");

  els.playerCount.textContent =
    practice
      ? "Local only"
      : `${players.length} player${players.length === 1 ? "" : "s"}`;

  renderLeaderboard(players);

  const myPlayer =
    room.players?.[uid];

  els.myScore.textContent =
    Number(
      myPlayer?.score || 0
    ).toLocaleString();

  if (
    state.roundId !==
    room.gameId
  ) {
    state.roundId =
      room.gameId;

    state.localWords =
      [];

    state.localAccepted =
      new Set();

    state.finishRequested =
      false;

    els.wordLog.innerHTML =
      "";

    els.lastWord.textContent =
      "Find a word to start scoring.";

    els.lastWord.className =
      "last-word";

    if (
      room.board?.length === 16
    ) {
      renderBoard(
        room.board
      );
    }
  }

  els.lobbyPanel.classList.toggle(
    "hidden",
    room.status !== "lobby"
  );

  els.gamePanel.classList.toggle(
    "hidden",
    room.status !== "playing"
  );

  els.resultsPanel.classList.toggle(
    "hidden",
    room.status !== "finished"
  );

  els.rematchButton.classList.toggle(
    "hidden",
    !(practice || isHost)
  );

  if (
    room.status === "playing"
  ) {
    if (
      room.board?.length === 16 &&
      els.board.children.length !== 16
    ) {
      renderBoard(
        room.board
      );
    }

    ensureTimer();
  } else {
    stopTimer();

    if (
      room.status === "lobby"
    ) {
      els.timerText.textContent =
        formatTime(
          room.durationMs ||
          90000
        );

      els.timerCard.classList.remove(
        "danger"
      );
    }

    if (
      room.status === "finished"
    ) {
      renderResults(players);
    }
  }
}

function renderLeaderboard(players) {
  const uid =
    currentPlayerUid();

  const sorted =
    [...players].sort(
      (a, b) =>
        Number(b.score || 0) -
          Number(a.score || 0) ||
        Number(b.wordCount || 0) -
          Number(a.wordCount || 0)
    );

  els.leaderboard.innerHTML =
    sorted.map(
      (p, i) => `
        <div class="leader-row">
          <span class="rank">
            ${String(i + 1).padStart(2, "0")}
          </span>

          <span class="leader-name">
            ${escapeHtml(p.name || "Player")}
            ${
              p.uid === uid
                ? " <small>YOU</small>"
                : ""
            }
          </span>

          <strong>
            ${Number(p.score || 0).toLocaleString()}
          </strong>
        </div>
      `
    ).join("");
}

function renderResults(players) {
  const sorted =
    [...players].sort(
      (a, b) =>
        Number(b.score || 0) -
          Number(a.score || 0) ||
        Number(b.wordCount || 0) -
          Number(a.wordCount || 0)
    );

  if (isPractice()) {
    els.winnerHeading.textContent =
      "Practice complete";
  } else {
    const top =
      sorted[0];

    els.winnerHeading.textContent =
      top
        ? `${top.name || "Player"} wins!`
        : "Results";
  }

  const medals =
    ["🥇", "🥈", "🥉"];

  els.resultsList.innerHTML =
    sorted.map(
      (p, i) => `
        <div class="result-row">
          <span class="medal">
            ${
              isPractice()
                ? "✓"
                : (
                    medals[i] ||
                    `${i + 1}.`
                  )
            }
          </span>

          <span>
            ${escapeHtml(
              p.name || "Player"
            )}
          </span>

          <strong>
            ${Number(
              p.score || 0
            ).toLocaleString()} pts
          </strong>
        </div>
      `
    ).join("");
}

async function startRound() {
  if (
    !state.room ||
    !state.dictionaryReady
  ) {
    return;
  }

  if (isPractice()) {
    return startPracticeRound();
  }

  if (
    state.room.hostUid !==
    state.user?.uid
  ) {
    return;
  }

  els.startGameButton.disabled =
    true;

  try {
    const durationMs =
      Number(
        els.durationSelect.value ||
        90000
      );

    const board =
      generateBoard();

    const updates = {
      status: "playing",
      durationMs,

      startAt:
        nowServer() +
        3200,

      expiresAt:
        nowServer() +
        ROOM_TTL_MS,

      board,

      gameId:
        Number(
          state.room.gameId || 0
        ) + 1
    };

    for (
      const uid of
      Object.keys(
        state.room.players || {}
      )
    ) {
      updates[
        `players/${uid}/score`
      ] = 0;

      updates[
        `players/${uid}/wordCount`
      ] = 0;

      updates[
        `accepted/${uid}`
      ] = null;
    }

    await state.firebase.update(
      roomRef(),
      updates
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Could not start the round."
    );
  } finally {
    els.startGameButton.disabled =
      false;
  }
}

function startPracticeRound() {
  const durationMs =
    Number(
      els.durationSelect.value ||
      state.room.durationMs ||
      90000
    );

  state.room.status =
    "playing";

  state.room.durationMs =
    durationMs;

  state.room.startAt =
    Date.now() +
    3200;

  state.room.board =
    generateBoard();

  state.room.gameId =
    Number(
      state.room.gameId || 0
    ) + 1;

  state.room.players[
    PRACTICE_UID
  ].score = 0;

  state.room.players[
    PRACTICE_UID
  ].wordCount = 0;

  state.localWords =
    [];

  state.localAccepted =
    new Set();

  renderRoom();
}

async function rematch() {
  if (!state.room) {
    return;
  }

  if (isPractice()) {
    return startPracticeRound();
  }

  if (
    state.room.hostUid !==
    state.user?.uid
  ) {
    return;
  }

  els.rematchButton.disabled =
    true;

  try {
    const updates = {
      status: "playing",

      startAt:
        nowServer() +
        3200,

      expiresAt:
        nowServer() +
        ROOM_TTL_MS,

      board:
        generateBoard(),

      gameId:
        Number(
          state.room.gameId || 0
        ) + 1
    };

    for (
      const uid of
      Object.keys(
        state.room.players || {}
      )
    ) {
      updates[
        `players/${uid}/score`
      ] = 0;

      updates[
        `players/${uid}/wordCount`
      ] = 0;

      updates[
        `accepted/${uid}`
      ] = null;
    }

    await state.firebase.update(
      roomRef(),
      updates
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Could not start a new board."
    );
  } finally {
    els.rematchButton.disabled =
      false;
  }
}

function renderBoard(board) {
  els.board.innerHTML =
    board.map(
      (letter, i) => `
        <button
          class="tile"
          type="button"
          data-index="${i}"
          aria-label="${letter}"
        >
          ${letter}
          <span class="order"></span>
        </button>
      `
    ).join("");

  clearSelection();
}


// ============================================================
// CROSS-BROWSER DRAG / POINTER HANDLING
// ============================================================
//
// We intentionally do NOT use setPointerCapture().
//
// Instead, pointer movement and release are watched on `window`,
// and the tile beneath the cursor/finger is determined using the
// pointer's actual viewport coordinates.
//
// This is more reliable across:
// - Firefox on macOS
// - Chrome / Chromium
// - Chromebooks
// - Touchscreens
// - Phones and tablets
// - Pen/stylus input
// ============================================================

// How much of each tile edge should be ignored while dragging.
// 0.15 = ignore the outer 15% on every side.
//
// Try:
// 0.10 = fairly forgiving
// 0.15 = recommended
// 0.20 = more precise
// 0.25 = very strict
const TILE_HITBOX_INSET = 0.22;

function pointerIndex(event) {
  const x = event.clientX;
  const y = event.clientY;

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  const tiles = [
    ...els.board.querySelectorAll(".tile")
  ];

  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();

    // Shrink the effective hitbox inward.
    const insetX = rect.width * TILE_HITBOX_INSET;
    const insetY = rect.height * TILE_HITBOX_INSET;

    const left = rect.left + insetX;
    const right = rect.right - insetX;
    const top = rect.top + insetY;
    const bottom = rect.bottom - insetY;

    if (
      x >= left &&
      x <= right &&
      y >= top &&
      y <= bottom
    ) {
      return Number(tile.dataset.index);
    }
  }

  return null;
}
function beginTrace(
  event,
  explicitIndex = null
) {
  if (!canPlayNow()) {
    return;
  }

  // For a mouse, only allow
  // the primary/left button.
  if (
    event.pointerType === "mouse" &&
    event.button !== 0
  ) {
    return;
  }

  const index =
    explicitIndex ??
    pointerIndex(event);

  if (
    !Number.isInteger(index)
  ) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }

  // Important ordering:
  // clearSelection() sets dragging=false,
  // so call it BEFORE setting dragging=true.
  clearSelection();

  state.dragging =
    true;

  addTile(index);

  // DO NOT use:
  //
  // setPointerCapture()
  //
  // Window-level listeners below
  // handle dragging instead.
}

function continueTrace(event) {
  if (!state.dragging) {
    return;
  }

  // Firefox can occasionally report
  // pointer movement after the mouse
  // button has already been released.
  //
  // In that situation, submit the word
  // instead of leaving the game stuck.
  if (
    event.pointerType === "mouse" &&
    event.buttons === 0
  ) {
    endTrace(event);
    return;
  }

  const index =
    pointerIndex(event);

  if (index === null) {
    return;
  }

  const selected =
    state.selected;

  const last =
    selected.at(-1);

  // Still inside current tile.
  if (index === last) {
    return;
  }

  // Allow dragging backward one tile.
  //
  // Example:
  // C -> A -> T
  //
  // Drag back onto A:
  // C -> A
  if (
    selected.length >= 2 &&
    index === selected.at(-2)
  ) {
    selected.pop();

    paintSelection();

    if (event.cancelable) {
      event.preventDefault();
    }

    return;
  }

  // Add a tile only if:
  // 1. It has not already been used.
  // 2. It touches the previous tile.
  if (
    !selected.includes(index) &&
    areAdjacent(last, index)
  ) {
    addTile(index);
  }

  if (event.cancelable) {
    event.preventDefault();
  }
}

function endTrace(event) {
  if (!state.dragging) {
    return;
  }

  state.dragging =
    false;

  if (
    event?.cancelable
  ) {
    event.preventDefault();
  }

  submitSelection();
}

function cancelTrace() {
  if (!state.dragging) {
    return;
  }

  clearSelection();
}


// ============================================================
// SELECTION / WORD DISPLAY
// ============================================================

function addTile(index) {
  state.selected.push(index);

  paintSelection();
}

function paintSelection() {
  const tiles =
    [
      ...els.board
        .querySelectorAll(".tile")
    ];

  tiles.forEach(
    (tile, i) => {
      const pos =
        state.selected.indexOf(i);

      tile.classList.toggle(
        "selected",
        pos >= 0
      );

      tile.querySelector(
        ".order"
      ).textContent =
        pos >= 0
          ? pos + 1
          : "";
    }
  );

  const word =
    currentSelectionWord();

  els.currentWord.textContent =
    word ||
    "\u00a0";

  updateTraceLine();
}

function updateTraceLine() {
  const wrapRect =
    els.boardWrap
      .getBoundingClientRect();

  const points =
    state.selected.map(
      index => {
        const tile =
          els.board.querySelector(
            `[data-index="${index}"]`
          );

        if (!tile) {
          return null;
        }

        const rect =
          tile.getBoundingClientRect();

        return `${
          rect.left +
          rect.width / 2 -
          wrapRect.left
        },${
          rect.top +
          rect.height / 2 -
          wrapRect.top
        }`;
      }
    ).filter(Boolean);

  els.traceLine.setAttribute(
    "points",
    points.join(" ")
  );
}

function currentSelectionWord() {
  const board =
    state.room?.board || [];

  return state.selected
    .map(
      i =>
        board[i] || ""
    )
    .join("");
}

function clearSelection() {
  state.selected =
    [];

  state.dragging =
    false;

  els.currentWord.textContent =
    "\u00a0";

  els.traceLine.setAttribute(
    "points",
    ""
  );

  [
    ...els.board
      .querySelectorAll(".tile")
  ].forEach(
    tile => {
      tile.classList.remove(
        "selected"
      );

      const order =
        tile.querySelector(
          ".order"
        );

      if (order) {
        order.textContent =
          "";
      }
    }
  );
}


// ============================================================
// GAMEPLAY
// ============================================================

function canPlayNow() {
  const room =
    state.room;

  if (
    !room ||
    room.status !== "playing" ||
    !room.startAt
  ) {
    return false;
  }

  return (
    nowGame() >=
      room.startAt &&
    nowGame() <
      room.startAt +
      room.durationMs
  );
}

async function submitSelection() {
  const raw =
    currentSelectionWord();

  const word =
    raw.toLowerCase();

  clearSelection();

  if (!canPlayNow()) {
    return;
  }

  if (word.length < 3) {
    return wordFeedback(
      raw,
      "3 letters minimum",
      false
    );
  }

  if (
    !state.dictionary?.has(word)
  ) {
    return wordFeedback(
      raw,
      "Not in dictionary",
      false
    );
  }

  const points =
    scoreWord(word);

  if (isPractice()) {
    if (
      state.localAccepted
        .has(word)
    ) {
      return wordFeedback(
        raw,
        "Already found",
        false
      );
    }

    state.localAccepted.add(
      word
    );

    const player =
      state.room.players[
        PRACTICE_UID
      ];

    player.score =
      Number(
        player.score || 0
      ) + points;

    player.wordCount =
      Number(
        player.wordCount || 0
      ) + 1;

    state.localWords.unshift({
      word:
        raw.toUpperCase(),

      points
    });

    renderWordLog();

    els.myScore.textContent =
      player.score
        .toLocaleString();

    renderLeaderboard([
      {
        uid: PRACTICE_UID,
        ...player
      }
    ]);

    return wordFeedback(
      raw,
      `+${points.toLocaleString()} points`,
      true
    );
  }

  const wordPath =
    `rooms/${state.roomCode}/accepted/${state.user.uid}/${word}`;

  try {
    const result =
      await state.firebase.runTransaction(
        state.firebase.ref(
          state.db,
          wordPath
        ),

        current => {
          if (
            current !== null
          ) {
            return;
          }

          return {
            points,
            at: nowServer(),
            gameId:
              state.room.gameId
          };
        },

        {
          applyLocally: false
        }
      );

    if (!result.committed) {
      return wordFeedback(
        raw,
        "Already found",
        false
      );
    }

    await state.firebase.update(
      state.firebase.ref(
        state.db,
        `rooms/${state.roomCode}/players/${state.user.uid}`
      ),
      {
        score:
          state.firebase.increment(
            points
          ),

        wordCount:
          state.firebase.increment(
            1
          )
      }
    );

    state.localWords.unshift({
      word:
        raw.toUpperCase(),

      points
    });

    renderWordLog();

    wordFeedback(
      raw,
      `+${points.toLocaleString()} points`,
      true
    );
  } catch (error) {
    console.error(error);

    wordFeedback(
      raw,
      "Could not submit",
      false
    );
  }
}

function renderWordLog() {
  els.wordLog.innerHTML =
    state.localWords
      .slice(0, 80)
      .map(
        item =>
          `<span class="word-token">${escapeHtml(item.word)} <b>+${item.points}</b></span>`
      )
      .join("");
}

function wordFeedback(
  word,
  message,
  good
) {
  els.currentWord.textContent =
    word.toUpperCase();

  els.currentWord
    .parentElement
    .classList.toggle(
      "good",
      good
    );

  els.currentWord
    .parentElement
    .classList.toggle(
      "bad",
      !good
    );

  els.lastWord.textContent =
    `${word.toUpperCase()} · ${message}`;

  els.lastWord.className =
    `last-word ${
      good
        ? "success"
        : "error"
    }`;

  clearTimeout(
    wordFeedback.timeout
  );

  wordFeedback.timeout =
    setTimeout(
      () => {
        els.currentWord
          .parentElement
          .classList.remove(
            "good",
            "bad"
          );

        if (!state.dragging) {
          els.currentWord.textContent =
            "\u00a0";
        }
      },
      800
    );
}


// ============================================================
// TIMER
// ============================================================

function ensureTimer() {
  if (state.tickHandle) {
    return;
  }

  const tick = async () => {
    const room =
      state.room;

    if (
      !room ||
      room.status !== "playing"
    ) {
      return stopTimer();
    }

    const untilStart =
      Number(room.startAt || 0) -
      nowGame();

    const remaining =
      Number(room.startAt || 0) +
      Number(room.durationMs || 0) -
      nowGame();

    if (untilStart > 0) {
      els.countdownOverlay
        .classList.remove(
          "hidden"
        );

      els.countdownNumber.textContent =
        String(
          Math.max(
            1,
            Math.ceil(
              untilStart / 1000
            )
          )
        );

      els.timerText.textContent =
        formatTime(
          room.durationMs || 0
        );
    } else {
      els.countdownOverlay
        .classList.add(
          "hidden"
        );

      els.timerText.textContent =
        formatTime(
          Math.max(
            0,
            remaining
          )
        );

      els.timerCard
        .classList.toggle(
          "danger",
          remaining > 0 &&
          remaining <= 10000
        );
    }

    if (
      remaining <= 0 &&
      !state.finishRequested
    ) {
      if (isPractice()) {
        state.finishRequested =
          true;

        room.status =
          "finished";

        room.finishedAt =
          Date.now();

        renderRoom();
      } else if (
        room.hostUid ===
        state.user?.uid
      ) {
        state.finishRequested =
          true;

        try {
          await state.firebase.update(
            roomRef(),
            {
              status:
                "finished",

              finishedAt:
                state.firebase
                  .serverTimestamp()
            }
          );
        } catch (error) {
          console.error(error);

          state.finishRequested =
            false;
        }
      }
    }
  };

  tick();

  state.tickHandle =
    setInterval(
      tick,
      100
    );
}

function stopTimer() {
  if (state.tickHandle) {
    clearInterval(
      state.tickHandle
    );
  }

  state.tickHandle =
    null;

  els.countdownOverlay
    .classList.add(
      "hidden"
    );

  els.timerCard
    .classList.remove(
      "danger"
    );
}

function formatTime(ms) {
  const seconds =
    Math.max(
      0,
      Math.ceil(ms / 1000)
    );

  const min =
    Math.floor(
      seconds / 60
    );

  const sec =
    seconds % 60;

  return `${min}:${String(sec).padStart(2, "0")}`;
}


// ============================================================
// ROOM / UI ACTIONS
// ============================================================

async function copyInvite() {
  if (
    isPractice() ||
    state.roomCode === null
  ) {
    return;
  }

  const url =
    new URL(
      location.href
    );

  url.searchParams.set(
    "room",
    state.roomCode
  );

  try {
    await navigator.clipboard
      .writeText(
        url.toString()
      );

    showToast(
      "Invite link copied."
    );
  } catch {
    showToast(
      `Room code: ${state.roomCode}`
    );
  }
}

async function cleanupRoomListeners() {
  if (
    state.roomUnsubscribe
  ) {
    state.roomUnsubscribe();
  }

  state.roomUnsubscribe =
    null;

  if (
    state.presenceRef &&
    state.firebase
  ) {
    try {
      await state.firebase
        .onDisconnect(
          state.presenceRef
        )
        .cancel();
    } catch {
      // Best effort.
    }
  }

  state.presenceRef =
    null;
}

async function leaveRoom({
  skipRemote = false
} = {}) {
  stopTimer();

  const wasPractice =
    isPractice();

  const code =
    state.roomCode;

  const wasHost =
    !wasPractice &&
    state.room?.hostUid ===
      state.user?.uid;

  const presenceRef =
    state.presenceRef;

  await cleanupRoomListeners();

  if (
    !skipRemote &&
    !wasPractice &&
    state.firebase &&
    state.db &&
    code !== null
  ) {
    try {
      if (wasHost) {
        await state.firebase.remove(
          roomRef(code)
        );
      } else if (
        presenceRef
      ) {
        await state.firebase.set(
          presenceRef,
          false
        );
      }
    } catch (error) {
      console.warn(
        "Room cleanup was not completed:",
        error
      );
    }
  }

  state.mode =
    null;

  state.roomCode =
    null;

  state.roomSessionId =
    null;

  state.room =
    null;

  state.roundId =
    null;

  state.localWords =
    [];

  state.localAccepted =
    new Set();

  history.replaceState(
    null,
    "",
    location.pathname
  );

  setScreen("home");
}


// ============================================================
// EVENT LISTENERS
// ============================================================

function wireEvents() {
  els.playerName.value =
    localStorage.getItem(
      "wordgrid-player-name"
    ) || "";

  els.roomCodeInput
    .addEventListener(
      "input",
      () => {
        els.roomCodeInput.value =
          sanitizeRoomCode(
            els.roomCodeInput.value
          );
      }
    );

  els.roomCodeInput
    .addEventListener(
      "keydown",
      e => {
        if (
          e.key === "Enter"
        ) {
          joinRoom();
        }
      }
    );

  els.practiceButton
    .addEventListener(
      "click",
      startPractice
    );

  els.createRoomButton
    .addEventListener(
      "click",
      createRoom
    );

  els.joinRoomButton
    .addEventListener(
      "click",
      () => joinRoom()
    );

  els.startGameButton
    .addEventListener(
      "click",
      startRound
    );

  els.rematchButton
    .addEventListener(
      "click",
      rematch
    );

  els.copyRoomButton
    .addEventListener(
      "click",
      copyInvite
    );

  els.leaveRoomButton
    .addEventListener(
      "click",
      () => leaveRoom()
    );

  els.homeButton
    .addEventListener(
      "click",
      () =>
        state.mode
          ? leaveRoom()
          : setScreen("home")
    );

  els.helpButton
    .addEventListener(
      "click",
      () =>
        els.helpDialog.showModal()
    );

  els.closeHelpButton
    .addEventListener(
      "click",
      () =>
        els.helpDialog.close()
    );


  // ----------------------------------------------------------
  // START DRAG
  // ----------------------------------------------------------

  els.board.addEventListener(
    "pointerdown",
    e => {
      const tile =
        e.target.closest(
          ".tile"
        );

      if (!tile) {
        return;
      }

      beginTrace(
        e,
        Number(
          tile.dataset.index
        )
      );
    }
  );


  // ----------------------------------------------------------
  // CONTINUE / END DRAG
  //
  // These listeners intentionally live on WINDOW instead of
  // boardWrap. This avoids pointer-capture inconsistencies in
  // Firefox/macOS and ensures pointerup is received even if the
  // cursor leaves the board before release.
  // ----------------------------------------------------------

  window.addEventListener(
    "pointermove",
    continueTrace,
    {
      passive: false
    }
  );

  window.addEventListener(
    "pointerup",
    endTrace,
    {
      passive: false
    }
  );

  window.addEventListener(
    "pointercancel",
    cancelTrace,
    {
      passive: false
    }
  );


  // If the browser/window loses focus in the middle of a drag,
  // cancel the selection so it cannot remain stuck.
  window.addEventListener(
    "blur",
    cancelTrace
  );


  window.addEventListener(
    "resize",
    () => {
      if (
        state.selected.length
      ) {
        updateTraceLine();
      }
    }
  );


  // ----------------------------------------------------------
  // ROUND DURATION
  // ----------------------------------------------------------

  els.durationSelect
    .addEventListener(
      "change",
      async () => {
        const durationMs =
          Number(
            els.durationSelect.value
          );

        if (isPractice()) {
          if (
            state.room?.status ===
            "lobby"
          ) {
            state.room.durationMs =
              durationMs;

            els.timerText.textContent =
              formatTime(
                durationMs
              );
          }

          return;
        }

        if (
          state.room?.hostUid !==
            state.user?.uid ||
          state.room.status !==
            "lobby"
        ) {
          return;
        }

        try {
          await state.firebase.update(
            roomRef(),
            {
              durationMs
            }
          );
        } catch (error) {
          console.error(error);
        }
      }
    );
}


// ============================================================
// AUTO-JOIN FROM INVITE URL
// ============================================================

async function maybeJoinFromUrl() {
  const requested =
    sanitizeRoomCode(
      new URLSearchParams(
        location.search
      ).get("room")
    );

  if (
    !requested ||
    requested.length !== 1
  ) {
    return;
  }

  els.roomCodeInput.value =
    requested;

  // Wait for dictionary initialization.
  for (
    let i = 0;
    i < 120;
    i++
  ) {
    if (
      state.dictionaryReady
    ) {
      break;
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          100
        )
    );
  }

  if (
    !state.dictionaryReady
  ) {
    return;
  }

  joinRoom(requested);
}


// ============================================================
// START APP
// ============================================================

wireEvents();

loadDictionary()
  .then(
    maybeJoinFromUrl
  );
