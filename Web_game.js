const GameState = {
  currentScreen: "login",
  player: null,
  selectedMap: null,
  selectedTeam: null,
  teamConfirmed: false,
};

const STORAGE_KEYS = {
  accounts: "rtsAccounts",
  session: "rtsActiveUser",
};

// ====================
// ACCOUNT SYSTEM
// ====================
function getAccounts() {
  const raw = localStorage.getItem(STORAGE_KEYS.accounts);
  return raw ? JSON.parse(raw) : {};
}

function saveAccounts(accounts) {
  localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(accounts));
}

function createAccount(username) {
  const accounts = getAccounts();

  if (accounts[username]) {
    return { success: false, message: "Account already exists." };
  }

  accounts[username] = {
    username,
    level: 1,
    xp: 0,
    gold: 1000,
    wins: 0,
    losses: 0,
    unlockedUnits: ["Riflemen"],
  };

  saveAccounts(accounts);
  return { success: true, player: accounts[username] };
}

function login(username) {
  const accounts = getAccounts();
  const player = accounts[username];

  if (!player) {
    return { success: false, message: "No account found for that username." };
  }

  GameState.player = player;
  localStorage.setItem(STORAGE_KEYS.session, username);
  updateMainMenuStats();
  resetPreMatchSelection();
  showScreen("screen-main-menu");
  return { success: true };
}

function savePlayerData() {
  if (!GameState.player) {
    return;
  }

  const accounts = getAccounts();
  accounts[GameState.player.username] = GameState.player;
  saveAccounts(accounts);
}

function loadPlayerData() {
  const activeUser = localStorage.getItem(STORAGE_KEYS.session);
  if (!activeUser) {
    return false;
  }

  const accounts = getAccounts();
  if (!accounts[activeUser]) {
    localStorage.removeItem(STORAGE_KEYS.session);
    return false;
  }

  GameState.player = accounts[activeUser];
  updateMainMenuStats();
  resetPreMatchSelection();
  showScreen("screen-main-menu");
  return true;
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.session);
  GameState.player = null;
  resetPreMatchSelection();
  showScreen("screen-login");
}

// ====================
// SCREEN MANAGEMENT
// ====================
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add("active");
    GameState.currentScreen = screenId.replace("screen-", "");
  }
}

function updateMainMenuStats() {
  if (!GameState.player) {
    return;
  }

  document.getElementById("stat-username").textContent = GameState.player.username;
  document.getElementById("stat-level").textContent = GameState.player.level;
  document.getElementById("stat-xp").textContent = GameState.player.xp;
  document.getElementById("stat-gold").textContent = GameState.player.gold;
  document.getElementById("stat-record").textContent = `${GameState.player.wins}W / ${GameState.player.losses}L`;
}

function updateSummaryScreen() {
  document.getElementById("summary-player").textContent = GameState.player?.username || "-";
  document.getElementById("summary-map").textContent = GameState.selectedMap || "-";
  document.getElementById("summary-team").textContent = GameState.selectedTeam || "-";
}

function resetPreMatchSelection() {
  GameState.selectedMap = null;
  GameState.selectedTeam = null;
  GameState.teamConfirmed = false;

  document.querySelectorAll("#map-cards .selection-card").forEach((card) => {
    card.classList.remove("selected");
    card.setAttribute("aria-checked", "false");
  });

  document.querySelectorAll("#team-cards .selection-card").forEach((card) => {
    card.classList.remove("selected", "locked");
    card.removeAttribute("disabled");
    card.setAttribute("aria-checked", "false");
  });

  document.getElementById("btn-map-continue").disabled = true;
  document.getElementById("btn-team-confirm").disabled = true;
  document.getElementById("btn-team-continue").disabled = true;
  document.getElementById("team-lock-message").textContent = "";
  document.getElementById("summary-message").textContent = "";
}

// ====================
// MAP SELECTION
// ====================
function handleMapSelection(event) {
  const selectedCard = event.target.closest(".selection-card");
  if (!selectedCard) {
    return;
  }

  document.querySelectorAll("#map-cards .selection-card").forEach((card) => {
    card.classList.toggle("selected", card === selectedCard);
    card.setAttribute("aria-checked", String(card === selectedCard));
  });

  GameState.selectedMap = selectedCard.dataset.map;
  document.getElementById("btn-map-continue").disabled = false;
}

// ====================
// TEAM SELECTION
// ====================
function handleTeamSelection(event) {
  const selectedCard = event.target.closest(".selection-card");
  if (!selectedCard || GameState.teamConfirmed) {
    return;
  }

  document.querySelectorAll("#team-cards .selection-card").forEach((card) => {
    card.classList.toggle("selected", card === selectedCard);
    card.setAttribute("aria-checked", String(card === selectedCard));
  });

  GameState.selectedTeam = selectedCard.dataset.team;
  document.getElementById("btn-team-confirm").disabled = false;
}

function confirmTeamSelection() {
  if (!GameState.selectedTeam) {
    return;
  }

  GameState.teamConfirmed = true;
  const cards = document.querySelectorAll("#team-cards .selection-card");
  cards.forEach((card) => {
    card.classList.add("locked");
    card.setAttribute("disabled", "true");
  });

  document.getElementById("team-lock-message").textContent = `Team locked: ${GameState.selectedTeam}`;
  document.getElementById("btn-team-confirm").disabled = true;
  document.getElementById("btn-team-continue").disabled = false;
}

// ====================
// EVENT WIRING
// ====================
function setLoginError(message = "") {
  document.getElementById("login-error").textContent = message;
}

function initEventListeners() {
  const usernameInput = document.getElementById("username-input");

  document.getElementById("btn-create-account").addEventListener("click", () => {
    const username = usernameInput.value.trim();
    if (!username) {
      setLoginError("Please enter a username.");
      return;
    }

    const result = createAccount(username);
    if (!result.success) {
      setLoginError(result.message);
      return;
    }

    setLoginError("Account created. Logging in...");
    login(username);
  });

  document.getElementById("btn-login").addEventListener("click", () => {
    const username = usernameInput.value.trim();
    if (!username) {
      setLoginError("Please enter a username.");
      return;
    }

    const result = login(username);
    if (!result.success) {
      setLoginError(result.message);
      return;
    }

    setLoginError("");
  });

  document.getElementById("btn-play").addEventListener("click", () => {
    showScreen("screen-map-select");
  });

  document.getElementById("btn-logout").addEventListener("click", () => {
    logout();
  });

  document.getElementById("btn-map-back").addEventListener("click", () => {
    showScreen("screen-main-menu");
  });

  document.getElementById("btn-map-continue").addEventListener("click", () => {
    if (!GameState.selectedMap) {
      return;
    }
    showScreen("screen-team-select");
  });

  document.getElementById("map-cards").addEventListener("click", handleMapSelection);
  document.getElementById("team-cards").addEventListener("click", handleTeamSelection);

  document.getElementById("btn-team-back").addEventListener("click", () => {
    showScreen("screen-map-select");
  });

  document.getElementById("btn-team-confirm").addEventListener("click", confirmTeamSelection);

  document.getElementById("btn-team-continue").addEventListener("click", () => {
    if (!GameState.teamConfirmed) {
      return;
    }

    updateSummaryScreen();
    showScreen("screen-summary");
  });

  document.getElementById("btn-summary-main").addEventListener("click", () => {
    resetPreMatchSelection();
    showScreen("screen-main-menu");
  });

  document.getElementById("btn-start-match").addEventListener("click", () => {
    document.getElementById("summary-message").textContent = "Gameplay engine not implemented yet.";
    savePlayerData();
  });
}

function initializeApp() {
  initEventListeners();
  const loaded = loadPlayerData();

  if (!loaded) {
    showScreen("screen-login");
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
