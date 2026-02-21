const GameState = {
  player: null,
  selectedMap: null,
  botMode: false,
};

const UI = {
  authScreen: document.getElementById("screen-auth"),
  menuScreen: document.getElementById("screen-main-menu"),
  authMessage: document.getElementById("auth-message"),
  authLoading: document.getElementById("auth-loading"),
  menuMessage: document.getElementById("menu-message"),
  usernameInput: document.getElementById("username-input"),
  mapModal: document.getElementById("map-modal"),
};

async function apiRequest(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || "Request failed" };
    }

    return { success: true, data };
  } catch (error) {
    alert("Server offline");
    return { success: false, message: "Server offline" };
  }
}

function setAuthLoading(isLoading) {
  UI.authLoading.classList.toggle("hidden", !isLoading);
  document.getElementById("btn-register").disabled = isLoading;
  document.getElementById("btn-login").disabled = isLoading;
}

function setAuthMessage(message = "", isError = false) {
  UI.authMessage.textContent = message;
  UI.authMessage.classList.toggle("error", isError);
}

function setMenuMessage(message = "", isError = false) {
  UI.menuMessage.textContent = message;
  UI.menuMessage.classList.toggle("error", isError);
}

function showScreen(screenName) {
  UI.authScreen.classList.remove("active");
  UI.menuScreen.classList.remove("active");
  if (screenName === "menu") {
    UI.menuScreen.classList.add("active");
    return;
  }
  UI.authScreen.classList.add("active");
}

function renderPlayerStats() {
  if (!GameState.player) {
    return;
  }

  document.getElementById("stat-username").textContent = GameState.player.username;
  document.getElementById("stat-level").textContent = GameState.player.level;
  document.getElementById("stat-xp").textContent = GameState.player.xp;
  document.getElementById("stat-gold").textContent = GameState.player.gold;
  document.getElementById("stat-record").textContent = `${GameState.player.wins} / ${GameState.player.losses}`;
}

async function registerPlayer(username) {
  setAuthLoading(true);
  setAuthMessage("");

  const result = await apiRequest("/api/register", { username });
  setAuthLoading(false);

  if (!result.success) {
    setAuthMessage(result.message, true);
    return;
  }

  GameState.player = result.data.player;
  renderPlayerStats();
  showScreen("menu");
}

async function loginPlayer(username) {
  setAuthLoading(true);
  setAuthMessage("");

  const result = await apiRequest("/api/login", { username });
  setAuthLoading(false);

  if (!result.success) {
    setAuthMessage(result.message, true);
    return;
  }

  GameState.player = result.data.player;
  renderPlayerStats();
  showScreen("menu");
}

async function persistPlayer() {
  if (!GameState.player) {
    return false;
  }

  const result = await apiRequest("/api/update-player", { player: GameState.player });
  return result.success;
}

function resetSession() {
  GameState.player = null;
  GameState.selectedMap = null;
  GameState.botMode = false;
  UI.usernameInput.value = "";
  setAuthMessage("");
  setMenuMessage("");
  showScreen("auth");
}

function openMapModal() {
  UI.mapModal.classList.remove("hidden");
}

function closeMapModal() {
  UI.mapModal.classList.add("hidden");
}

function selectMap(card) {
  document.querySelectorAll(".map-card").forEach((entry) => {
    entry.classList.toggle("selected", entry === card);
  });
  GameState.selectedMap = card.dataset.map;
  setMenuMessage(`Selected map: ${GameState.selectedMap}`);
  closeMapModal();
}

async function handlePlay() {
  if (!GameState.selectedMap) {
    setMenuMessage("Select a map before starting Play.", true);
    return;
  }

  GameState.player.xp += 20;
  GameState.player.gold += 50;
  const saved = await persistPlayer();

  if (!saved) {
    setMenuMessage("Could not sync player progress.", true);
    return;
  }

  renderPlayerStats();
  setMenuMessage(`Deployment ready on ${GameState.selectedMap}. Progress saved.`);
}

async function handleBotMode() {
  GameState.botMode = !GameState.botMode;
  GameState.player.wins += 1;
  GameState.player.xp += 10;

  const saved = await persistPlayer();
  if (!saved) {
    setMenuMessage("Bot mode update failed.", true);
    return;
  }

  renderPlayerStats();
  setMenuMessage(`Bot Mode ${GameState.botMode ? "enabled" : "disabled"}.`);
}

function initEventListeners() {
  document.getElementById("btn-register").addEventListener("click", async () => {
    const username = UI.usernameInput.value.trim();
    if (!username) {
      setAuthMessage("Please enter a username.", true);
      return;
    }
    await registerPlayer(username);
  });

  document.getElementById("btn-login").addEventListener("click", async () => {
    const username = UI.usernameInput.value.trim();
    if (!username) {
      setAuthMessage("Please enter a username.", true);
      return;
    }
    await loginPlayer(username);
  });

  document.getElementById("btn-logout").addEventListener("click", resetSession);
  document.getElementById("btn-play").addEventListener("click", handlePlay);
  document.getElementById("btn-select-map").addEventListener("click", openMapModal);
  document.getElementById("btn-close-map").addEventListener("click", closeMapModal);
  document.getElementById("btn-bot-mode").addEventListener("click", handleBotMode);

  document.getElementById("btn-profile").addEventListener("click", () => {
    if (!GameState.player) {
      return;
    }
    setMenuMessage(`Commander ${GameState.player.username} profile loaded.`);
  });

  document.getElementById("map-cards").addEventListener("click", (event) => {
    const button = event.target.closest(".map-select-btn");
    if (!button) {
      return;
    }
    selectMap(button.closest(".map-card"));
  });
}

function initializeApp() {
  initEventListeners();
  showScreen("auth");
}

document.addEventListener("DOMContentLoaded", initializeApp);
