const appStates = ["mainMenu", "mapSelection", "teamSelection", "playing"];
let currentPlayer = null;

const GameManager = {
  state: "mainMenu",
  selectedMode: null,
  selectedMap: null,
  playerCount: null,
  gameTime: null,
  selectedTeam: null,
  teams: {
    blue: [],
    red: [],
  },
  async prepareMatch() {
    if (!currentPlayer) {
      showWarningPopup("You must be logged in before starting a match.");
      return;
    }

    await apiPost("/create_match", {
      host: currentPlayer.username,
      map: this.selectedMap,
      mode: this.selectedMode,
      players: this.playerCount,
      time: this.gameTime,
      team: this.selectedTeam,
      status: "pending",
    });

    this.state = "playing";
    setAppState("playing");
    updateDashboard();
  },
};

const maps = ["Waterloo", "Desert Siege", "Flat Land"];
let currentMapIndex = 0;

const AudioManager = {
  masterVolume: 1,
  sfxVolume: 1,
  mouseSensitivity: 1,
};

function setAppState(stateId) {
  appStates.forEach((state) => {
    document.getElementById(state)?.classList.toggle("hidden", state !== stateId);
  });

  GameManager.state = stateId;

  const showMapPanel = stateId === "mapSelection" || stateId === "teamSelection";
  document.getElementById("sharedMapPanel").classList.toggle("hidden", !showMapPanel);

  const showBackBtn = stateId !== "mainMenu";
  document.getElementById("backBtn").classList.toggle("hidden", !showBackBtn);

  document.getElementById("settingsScene").classList.add("hidden");

  if (stateId === "teamSelection") {
    renderTeamSlots();
  }

  if (stateId === "playing") {
    document.getElementById("sharedMapPanel").classList.add("hidden");
  }

  updateActionButtons();
}

function goBack() {
  if (GameManager.state === "teamSelection") {
    setAppState("mapSelection");
    return;
  }

  setAppState("mainMenu");
}

function setSetupChoice(stateKey, domType, value, button) {
  GameManager[stateKey] = stateKey === "playerCount" || stateKey === "gameTime" ? Number(value) : value;

  document.querySelectorAll(`.setup-choice[data-type="${domType}"]`).forEach((node) => {
    node.classList.remove("active");
  });

  button.classList.add("active");

  if (stateKey === "selectedMode") {
    resetTeams();
  }

  updateActionButtons();
}

function openCustomTimePopup(button) {
  createPopup({
    title: "Custom Game Time",
    fields: [{ name: "minutes", placeholder: "Minutes", type: "number" }],
    submitLabel: "Set",
    onSubmit: async ({ minutes }) => {
      const parsed = Number(minutes);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Enter a valid number of minutes.");
      }

      button.textContent = `${parsed} MINUTES`;
      GameManager.gameTime = parsed;
      document.querySelectorAll('.setup-choice[data-type="gameTime"]').forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      updateActionButtons();
      closePopup();
      return { message: "" };
    },
  });
}

function updateMapPreview() {
  const map = maps[currentMapIndex];
  GameManager.selectedMap = map;
  document.getElementById("mapNameLabel").textContent = map.toUpperCase();
  document.getElementById("mapPreview").textContent = map;
  updateActionButtons();
}

function resetTeams() {
  GameManager.selectedTeam = null;
  GameManager.teams = { blue: [], red: [] };
}

function ensureTeamSlots() {
  const slots = GameManager.playerCount === 4 ? 2 : 1;
  ["blue", "red"].forEach((team) => {
    while (GameManager.teams[team].length < slots) {
      GameManager.teams[team].push("");
    }
    GameManager.teams[team] = GameManager.teams[team].slice(0, slots);
  });
}

function autoAssignBotsForVsBot() {
  if (GameManager.selectedMode !== "VS BOT") {
    return;
  }

  ensureTeamSlots();

  if (!GameManager.selectedTeam) {
    return;
  }

  const oppositeTeam = GameManager.selectedTeam === "blue" ? "red" : "blue";
  GameManager.teams[oppositeTeam] = GameManager.teams[oppositeTeam].map((_, index) => `BOT ${index + 1}`);

  GameManager.teams[GameManager.selectedTeam][0] = currentPlayer?.username || "PLAYER";
  if (GameManager.playerCount === 4 && !GameManager.teams[GameManager.selectedTeam][1]) {
    GameManager.teams[GameManager.selectedTeam][1] = "BOT 2";
  }
}

function joinTeam(team) {
  if (!currentPlayer) {
    showWarningPopup("Please login first.");
    return;
  }

  ensureTeamSlots();
  const username = currentPlayer.username;
  const otherTeam = team === "blue" ? "red" : "blue";

  if (GameManager.teams[otherTeam].includes(username)) {
    showWarningPopup("You cannot join both teams.");
    return;
  }

  GameManager.selectedTeam = team;

  const firstOpen = GameManager.teams[team].findIndex((name) => !name || name.startsWith("OPEN"));
  if (firstOpen === -1 && !GameManager.teams[team].includes(username)) {
    showWarningPopup("Team is full for now.");
    return;
  }

  if (!GameManager.teams[team].includes(username)) {
    GameManager.teams[team][Math.max(firstOpen, 0)] = username;
  }

  if (GameManager.selectedMode === "VS BOT") {
    autoAssignBotsForVsBot();
  }

  renderTeamSlots();
  updateActionButtons();
}

function teamReady() {
  if (!GameManager.selectedTeam) {
    return false;
  }

  if (GameManager.selectedMode === "VS BOT") {
    const oppositeTeam = GameManager.selectedTeam === "blue" ? "red" : "blue";
    return GameManager.teams[oppositeTeam].every((name) => name.startsWith("BOT"));
  }

  return true;
}

function renderTeamSlots() {
  ensureTeamSlots();

  if (GameManager.selectedMode === "VS BOT") {
    autoAssignBotsForVsBot();
  }

  const title = GameManager.selectedMode === "VS BOT" ? "BOT TEAM SELECTION" : "TEAM SELECTION";
  document.getElementById("teamSectionTitle").textContent = title;

  ["blue", "red"].forEach((team) => {
    const container = document.getElementById(`${team}TeamList`);
    container.innerHTML = "";

    GameManager.teams[team].forEach((name, index) => {
      const item = document.createElement("li");
      item.textContent = name || `OPEN SLOT ${index + 1}`;
      container.appendChild(item);
    });
  });

  document.querySelectorAll(".join-btn").forEach((btn) => {
    btn.classList.toggle("active", GameManager.selectedTeam === btn.dataset.team);
  });
}

function setupChoiceBinding() {
  document.querySelectorAll(".setup-choice").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type;
      const value = button.dataset.value;

      if (type === "gameTime" && value === "Custom") {
        openCustomTimePopup(button);
        return;
      }

      if (type === "gameTime" && button.id !== "customTimeBtn") {
        document.getElementById("customTimeBtn").textContent = "CUSTOM TIME";
      }

      const keyMap = {
        mode: "selectedMode",
        playerCount: "playerCount",
        gameTime: "gameTime",
      };
      setSetupChoice(keyMap[type], type, value, button);
    });
  });
}

function updateActionButtons() {
  const confirmReady = Boolean(
    GameManager.selectedMode &&
      GameManager.playerCount &&
      GameManager.gameTime &&
      GameManager.selectedMap,
  );

  document.getElementById("confirmSetupBtn").disabled = !confirmReady;

  const startReady = Boolean(confirmReady && teamReady());
  document.getElementById("startMatchBtn").disabled = !startReady;
}

function updateDashboard() {
  if (!currentPlayer) {
    document.getElementById("playerName").textContent = "Guest";
    document.getElementById("goldValue").textContent = "0";
    document.getElementById("xpValue").textContent = "0";
    document.getElementById("levelValue").textContent = "1";
    document.getElementById("winsValue").textContent = "0";
    document.getElementById("lossValue").textContent = "0";
    document.getElementById("loggedInBadge").textContent = "LOG IN";
    document.getElementById("loggedInBadge").disabled = false;
    return;
  }

  document.getElementById("playerName").textContent = currentPlayer.username;
  document.getElementById("goldValue").textContent = String(currentPlayer.gold ?? 0);
  document.getElementById("xpValue").textContent = String(currentPlayer.xp ?? 0);
  document.getElementById("levelValue").textContent = String(currentPlayer.level ?? 1);
  document.getElementById("winsValue").textContent = String(currentPlayer.wins ?? 0);
  document.getElementById("lossValue").textContent = String(currentPlayer.losses ?? 0);
  document.getElementById("loggedInBadge").textContent = `LOGGED IN: ${currentPlayer.username}`;
  document.getElementById("loggedInBadge").disabled = true;
}


async function logoutPlayer() {
  try {
    await apiPost("/logout", {});
    currentPlayer = null;
    resetTeams();
    updateDashboard();
    setAppState("mainMenu");
  } catch (error) {
    showWarningPopup(error.message || "Logout failed.");
  }
}

async function refreshAccountState() {
  try {
    const response = await fetch("/get_current_user");
    const data = await response.json();

    currentPlayer = data.success ? data.user : null;
    updateDashboard();
    renderTeamSlots();
  } catch (error) {
    console.error("Failed to refresh account", error);
  }
}

function syncSettingsControls() {
  const masterControl = document.getElementById("masterVolume");
  const sfxControl = document.getElementById("sfxVolume");
  const mouseControl = document.getElementById("mouseSensitivity");

  masterControl.value = String(Math.round(AudioManager.masterVolume * 100));
  sfxControl.value = String(Math.round(AudioManager.sfxVolume * 100));
  mouseControl.value = String(AudioManager.mouseSensitivity);

  document.getElementById("masterVolumeValue").textContent = masterControl.value;
  document.getElementById("sfxVolumeValue").textContent = sfxControl.value;
  document.getElementById("mouseSensitivityValue").textContent = Number(mouseControl.value).toFixed(1);
}

function saveSettings() {
  localStorage.setItem("settings", JSON.stringify(AudioManager));
}

function loadSettings() {
  const saved = localStorage.getItem("settings");
  if (saved) {
    Object.assign(AudioManager, JSON.parse(saved));
  }
  syncSettingsControls();
}

function setupSettingsHandlers() {
  const masterControl = document.getElementById("masterVolume");
  const sfxControl = document.getElementById("sfxVolume");
  const mouseControl = document.getElementById("mouseSensitivity");

  masterControl.addEventListener("input", () => {
    AudioManager.masterVolume = Number(masterControl.value) / 100;
    document.getElementById("masterVolumeValue").textContent = masterControl.value;
    saveSettings();
  });

  sfxControl.addEventListener("input", () => {
    AudioManager.sfxVolume = Number(sfxControl.value) / 100;
    document.getElementById("sfxVolumeValue").textContent = sfxControl.value;
    saveSettings();
  });

  mouseControl.addEventListener("input", () => {
    AudioManager.mouseSensitivity = Number(mouseControl.value);
    document.getElementById("mouseSensitivityValue").textContent = Number(mouseControl.value).toFixed(1);
    saveSettings();
  });
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function closePopup() {
  document.querySelector(".popup-overlay")?.remove();
}

function createPopup({ title, fields, onSubmit, submitLabel = "Confirm" }) {
  closePopup();

  const overlay = document.createElement("div");
  overlay.className = "popup-overlay";

  const popup = document.createElement("div");
  popup.className = "popup-card";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const form = document.createElement("form");
  form.className = "popup-form";

  const message = document.createElement("p");
  message.className = "popup-message";

  const inputs = {};
  fields.forEach((field) => {
    const input = document.createElement("input");
    input.type = field.type || "text";
    input.placeholder = field.placeholder || "";
    input.required = field.required !== false;
    input.name = field.name;
    form.appendChild(input);
    inputs[field.name] = input;
  });

  const actions = document.createElement("div");
  actions.className = "popup-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "menu-btn";
  submit.textContent = submitLabel;

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "menu-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePopup);

  actions.appendChild(submit);
  actions.appendChild(cancel);
  form.appendChild(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const payload = Object.fromEntries(
      Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]),
    );

    try {
      const result = await onSubmit(payload);
      if (result?.message) {
        message.textContent = result.message;
      }
    } catch (error) {
      message.textContent = error.message || "Action failed.";
    }
  });

  popup.appendChild(heading);
  popup.appendChild(form);
  popup.appendChild(message);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

function showWarningPopup(message) {
  createPopup({
    title: "Notice",
    fields: [],
    submitLabel: "OK",
    onSubmit: async () => {
      closePopup();
      return { message: "" };
    },
  });

  const warning = document.querySelector(".popup-message");
  if (warning) {
    warning.textContent = message;
  }
}

function openLoginPopup() {
  createPopup({
    title: "Login",
    fields: [
      { name: "username", placeholder: "Username" },
      { name: "password", placeholder: "Password", type: "password" },
    ],
    submitLabel: "Login",
    onSubmit: async ({ username, password }) => {
      await apiPost("/api/login", { username, password });
      await refreshAccountState();
      closePopup();
      return { message: "Login successful." };
    },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setAppState("mainMenu");
  updateDashboard();
  setupChoiceBinding();
  setupSettingsHandlers();
  loadSettings();
  updateMapPreview();

  document.getElementById("backBtn").addEventListener("click", goBack);
  document.getElementById("btn-play").addEventListener("click", () => setAppState("mapSelection"));
  document.getElementById("btn-maps").addEventListener("click", () => setAppState("mapSelection"));
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settingsScene").classList.remove("hidden");
  });
  document.getElementById("btn-logout").addEventListener("click", logoutPlayer);
  document.getElementById("btn-settings-close").addEventListener("click", () => {
    document.getElementById("settingsScene").classList.add("hidden");
  });

  document.getElementById("btn-map-prev").addEventListener("click", () => {
    currentMapIndex = (currentMapIndex - 1 + maps.length) % maps.length;
    updateMapPreview();
  });
  document.getElementById("btn-map-next").addEventListener("click", () => {
    currentMapIndex = (currentMapIndex + 1) % maps.length;
    updateMapPreview();
  });

  document.getElementById("confirmSetupBtn").addEventListener("click", () => {
    if (GameManager.selectedMode && GameManager.playerCount && GameManager.gameTime && GameManager.selectedMap) {
      resetTeams();
      setAppState("teamSelection");
      return;
    }

    showWarningPopup("Complete mode, player number, game time, and map before continuing.");
  });

  document.querySelectorAll(".join-btn").forEach((btn) => {
    btn.addEventListener("click", () => joinTeam(btn.dataset.team));
  });

  document.getElementById("startMatchBtn").addEventListener("click", async () => {
    if (!teamReady()) {
      showWarningPopup("Please complete a valid team assignment.");
      return;
    }

    await GameManager.prepareMatch();
  });

  document.getElementById("loggedInBadge").addEventListener("click", openLoginPopup);
});

window.addEventListener("load", async () => {
  const response = await fetch("/check_session");
  const data = await response.json();
  if (data.logged_in) {
    await refreshAccountState();
  }
});
