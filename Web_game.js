const APP_SECTIONS = ["mainMenu", "mapSelection", "teamSelection", "playing"];
const GAME_STATES = ["menu", "mapSelect", "lobby", "playing", "paused"];
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;
let GAME_STATE = "menu";
let currentPlayer = null;
let units = [];
let projectiles = [];
let effects = [];

function updateUIVisibility() {
  const sectionMap = {
    menu: "mainMenu",
    mapSelect: "mapSelection",
    lobby: "teamSelection",
    playing: "playing",
    paused: "playing",
  };

  const activeSectionId = sectionMap[GAME_STATE] || null;
  APP_SECTIONS.forEach((sectionId) => {
    document.getElementById(sectionId)?.classList.toggle("hidden", sectionId !== activeSectionId);
  });

  document.getElementById("sharedMapPanel")?.classList.toggle("hidden", GAME_STATE !== "mapSelect");
  document.getElementById("loggedInDashboard")?.classList.toggle("hidden", GAME_STATE === "playing" || GAME_STATE === "paused");
  document.getElementById("backBtn")?.classList.toggle("hidden", GAME_STATE === "menu" || GAME_STATE === "playing" || GAME_STATE === "paused");
}

function setGameState(state) {
  if (!GAME_STATES.includes(state)) {
    return;
  }

  GAME_STATE = state;
  updateUIVisibility();
}

const GameManager = {
  selectedMode: null,
  selectedMapId: null,
  playerCount: null,
  gameTime: null,
  selectedTeam: null,
  teams: {
    blue: [],
    red: [],
  },
  async startMatch() {
    if (!currentPlayer) {
      showWarningPopup("You must be logged in before starting a match.");
      return;
    }

    await apiPost("/create_match", {
      host: currentPlayer.username,
      map: this.selectedMapId,
      mode: this.selectedMode,
      players: this.playerCount,
      time: this.gameTime,
      team: this.selectedTeam,
      status: "pending",
    });

    units = [];
    projectiles = [];
    effects = [];
    setGameState("playing");
    GameplayMapRenderer.init(getSelectedMap());
    updateDashboard();
  },
  async prepareMatch() {
    await this.startMatch();
  },
};

let currentMapIndex = 0;
const MAP_PREVIEW_SIZE = 300;

const mapBackgroundPalette = {
  grass: "#a4cd8a",
  desert: "#d8bf7b",
  default: "#a4cd8a",
};

const GameplayMapRenderer = {
  canvas: null,
  context: null,
  map: null,
  camera: null,
  keyState: {},
  animationFrame: null,
  speed: 14,
  init(selectedMap) {
    const container = document.getElementById("canvasContainer");
    container.textContent = "";

    const worldViewport = document.getElementById("gameWorld");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(700, Math.min(WORLD_WIDTH, worldViewport?.clientWidth || 1100));
    canvas.height = Math.max(420, Math.min(WORLD_HEIGHT, worldViewport?.clientHeight || 620));
    canvas.className = "gameplay-canvas";
    container.appendChild(canvas);

    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.map = toWorldMap(selectedMap);
    this.camera = {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    };

    this.start();
  },
  start() {
    cancelAnimationFrame(this.animationFrame);
    this.gameLoop();
  },
  gameLoop() {
    this.update();
    this.render();
    this.animationFrame = requestAnimationFrame(() => this.gameLoop());
  },
  update() {
    this.updateCamera();
  },
  updateCamera() {
    if (!this.camera || !this.map) {
      return;
    }

    if (this.keyState.ArrowUp || this.keyState.KeyW) this.camera.y -= this.speed;
    if (this.keyState.ArrowDown || this.keyState.KeyS) this.camera.y += this.speed;
    if (this.keyState.ArrowLeft || this.keyState.KeyA) this.camera.x -= this.speed;
    if (this.keyState.ArrowRight || this.keyState.KeyD) this.camera.x += this.speed;

    const maxX = Math.max(0, this.map.width - this.camera.width);
    const maxY = Math.max(0, this.map.height - this.camera.height);
    this.camera.x = Math.max(0, Math.min(this.camera.x, maxX));
    this.camera.y = Math.max(0, Math.min(this.camera.y, maxY));
  },
  render() {
    if (!this.context || !this.map || !this.camera) {
      return;
    }

    const { context: ctx, map, camera } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    drawMapScene(ctx, map, {
      sourceX: camera.x,
      sourceY: camera.y,
      sourceWidth: camera.width,
      sourceHeight: camera.height,
      destX: 0,
      destY: 0,
      destWidth: this.canvas.width,
      destHeight: this.canvas.height,
      withLabels: true,
    });
  },
  teardown() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  },
};

function toWorldMap(map) {
  if (!map) {
    return null;
  }

  const scaleX = WORLD_WIDTH / map.width;
  const scaleY = WORLD_HEIGHT / map.height;
  const toWorldPoint = (point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  });

  return {
    ...map,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawnPoints: {
      blue: toWorldPoint(map.spawnPoints.blue),
      red: toWorldPoint(map.spawnPoints.red),
    },
    towns: map.towns.map((town) => ({
      ...town,
      ...toWorldPoint(town),
    })),
  };
}

const AudioManager = {
  masterVolume: 1,
  sfxVolume: 1,
  mouseSensitivity: 1,
};

function getElementOrLog(elementId) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error("Missing element:", elementId);
    return null;
  }
  return element;
}

function addListenerById(elementId, eventName, handler) {
  const element = getElementOrLog(elementId);
  if (!element) {
    return;
  }
  element.addEventListener(eventName, handler);
}

function getMapsOrLogError() {
  if (!Array.isArray(window.MAPS) || window.MAPS.length === 0) {
    console.error("MAPS is undefined or empty; skipping map preview rendering.");
    return null;
  }

  return window.MAPS;
}

function setAppState(stateId) {
  const stateMap = {
    mainMenu: "menu",
    mapSelection: "mapSelect",
    teamSelection: "lobby",
    playing: "playing",
  };

  const nextState = stateMap[stateId];
  if (!nextState) {
    return;
  }

  if (nextState !== "playing" && nextState !== "paused") {
    GameplayMapRenderer.teardown();
  }

  setGameState(nextState);
  document.getElementById("settingsScene").classList.add("hidden");

  if (nextState === "lobby") {
    renderTeamSlots();
  }

  updateActionButtons();
}

function goBack() {
  if (GAME_STATE === "lobby") {
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
  const maps = getMapsOrLogError();
  if (!maps) {
    return;
  }

  const map = maps[currentMapIndex % maps.length];
  GameManager.selectedMapId = map.id;
  const mapNameLabel = getElementOrLog("mapNameLabel");
  if (!mapNameLabel) {
    return;
  }

  mapNameLabel.textContent = map.name.toUpperCase();
  renderMapPreview(map);
  updateActionButtons();
}

function getSelectedMap() {
  const maps = getMapsOrLogError();
  if (!maps) {
    return null;
  }

  return maps.find((map) => map.id === GameManager.selectedMapId) || maps[0];
}

function drawStar(ctx, x, y, radius, color) {
  const spikes = 5;
  const innerRadius = radius * 0.45;
  let rotation = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(x, y - radius);

  for (let i = 0; i < spikes; i += 1) {
    ctx.lineTo(x + Math.cos(rotation) * radius, y + Math.sin(rotation) * radius);
    rotation += step;
    ctx.lineTo(x + Math.cos(rotation) * innerRadius, y + Math.sin(rotation) * innerRadius);
    rotation += step;
  }

  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawMapScene(ctx, map, viewport) {
  const {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destX,
    destY,
    destWidth,
    destHeight,
    withLabels,
  } = viewport;

  const scaleX = destWidth / sourceWidth;
  const scaleY = destHeight / sourceHeight;

  const toCanvasX = (realX) => destX + (realX - sourceX) * scaleX;
  const toCanvasY = (realY) => destY + (realY - sourceY) * scaleY;

  ctx.fillStyle = mapBackgroundPalette[map.background] || mapBackgroundPalette.default;
  ctx.fillRect(destX, destY, destWidth, destHeight);

  const blueSpawn = map.spawnPoints.blue;
  const redSpawn = map.spawnPoints.red;
  drawStar(ctx, toCanvasX(blueSpawn.x), toCanvasY(blueSpawn.y), 10, "#1f57d6");
  drawStar(ctx, toCanvasX(redSpawn.x), toCanvasY(redSpawn.y), 10, "#d83131");

  map.towns.forEach((town) => {
    drawStar(ctx, toCanvasX(town.x), toCanvasY(town.y), 9, "#d83131");
    if (withLabels) {
      ctx.fillStyle = "#1b2a1a";
      ctx.font = "14px Arial";
      ctx.fillText(town.name, toCanvasX(town.x) + 10, toCanvasY(town.y) - 10);
    }
  });
}

function renderMapPreview(map) {
  const previewContainer = getElementOrLog("mapPreview");
  if (!previewContainer) {
    return;
  }

  previewContainer.textContent = "";

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = MAP_PREVIEW_SIZE;
  previewCanvas.height = MAP_PREVIEW_SIZE;
  previewCanvas.className = "map-preview-canvas";
  previewContainer.appendChild(previewCanvas);

  const ctx = previewCanvas.getContext("2d");
  drawMapScene(ctx, map, {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: map.width,
    sourceHeight: map.height,
    destX: 0,
    destY: 0,
    destWidth: MAP_PREVIEW_SIZE,
    destHeight: MAP_PREVIEW_SIZE,
    withLabels: false,
  });
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
      GameManager.selectedMapId,
  );

  document.getElementById("confirmSetupBtn").disabled = !confirmReady;

  const startReady = Boolean(confirmReady && teamReady());
  document.getElementById("startMatchBtn").disabled = !startReady;
}

function updateDeveloperControls() {
  const developerTools = document.getElementById("devTools");
  const isDev = Boolean(currentPlayer?.is_dev);

  developerTools.classList.toggle("hidden", !isDev);
}

function updateDashboard() {
  const menuName = document.getElementById("playerName");
  const menuGold = document.getElementById("goldValue");
  const gameplayName = document.getElementById("gameplayPlayerName");
  const gameplayGold = document.getElementById("gameplayGoldValue");

  if (!currentPlayer) {
    menuName.textContent = "Guest";
    menuGold.textContent = "0";
    document.getElementById("xpValue").textContent = "0";
    document.getElementById("levelValue").textContent = "1";
    document.getElementById("winsValue").textContent = "0";
    document.getElementById("lossValue").textContent = "0";
    document.getElementById("loggedInBadge").textContent = "LOG IN";
    document.getElementById("loggedInBadge").disabled = false;
    gameplayName.textContent = "Guest";
    gameplayGold.textContent = "0";
    updateDeveloperControls();
    return;
  }

  menuName.textContent = currentPlayer.username;
  menuGold.textContent = String(currentPlayer.gold ?? 0);
  document.getElementById("xpValue").textContent = String(currentPlayer.xp ?? 0);
  document.getElementById("levelValue").textContent = String(currentPlayer.level ?? 1);
  document.getElementById("winsValue").textContent = String(currentPlayer.wins ?? 0);
  document.getElementById("lossValue").textContent = String(currentPlayer.losses ?? 0);
  document.getElementById("loggedInBadge").textContent = `LOGGED IN: ${currentPlayer.username}`;
  document.getElementById("loggedInBadge").disabled = true;
  gameplayName.textContent = currentPlayer.username;
  gameplayGold.textContent = String(currentPlayer.gold ?? 0);
  updateDeveloperControls();
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
    const data = await parseApiResponse(response);

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

  const data = await parseApiResponse(response);
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function parseApiResponse(response) {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error("Server returned an invalid response. Please try again.");
  }
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

  return { overlay, popup, form, message, actions };
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
  const popupControls = createPopup({
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

  const createAccountBtn = document.createElement("button");
  createAccountBtn.type = "button";
  createAccountBtn.className = "menu-btn";
  createAccountBtn.textContent = "Create Account";
  createAccountBtn.addEventListener("click", openCreateAccountPopup);
  popupControls.actions.prepend(createAccountBtn);
}

function openSetDeveloperGoldPopup() {
  if (!currentPlayer?.is_dev) {
    showWarningPopup("Developer login required.");
    return;
  }

  createPopup({
    title: "Set Developer Gold",
    fields: [{ name: "amount", placeholder: "Gold amount", type: "number" }],
    submitLabel: "Update",
    onSubmit: async ({ amount }) => {
      await apiPost("/api/dev-set-gold", {
        amount: Number(amount),
      });
      await refreshAccountState();
      closePopup();
      return { message: "Developer gold updated." };
    },
  });
}

function openSendGoldPopup() {
  if (!currentPlayer?.is_dev) {
    showWarningPopup("Developer login required.");
    return;
  }

  createPopup({
    title: "Send Gold",
    fields: [
      { name: "to", placeholder: "Target username" },
      { name: "amount", placeholder: "Gold amount", type: "number" },
    ],
    submitLabel: "Send",
    onSubmit: async ({ to, amount }) => {
      await apiPost("/api/dev-send-gold", {
        to,
        amount: Number(amount),
      });
      await refreshAccountState();
      closePopup();
      return { message: "Gold sent." };
    },
  });
}

function openCreateAccountPopup() {
  createPopup({
    title: "Create Account",
    fields: [
      { name: "username", placeholder: "Username (3-24 chars, no spaces)" },
      { name: "password", placeholder: "Password (min 6 chars)", type: "password" },
    ],
    submitLabel: "Create",
    onSubmit: async ({ username, password }) => {
      await apiPost("/api/create-account", { username, password });
      await refreshAccountState();
      closePopup();
      return { message: "Account created." };
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

  addListenerById("backBtn", "click", goBack);
  addListenerById("btn-play", "click", () => setAppState("mapSelection"));
  addListenerById("btn-maps", "click", () => setAppState("mapSelection"));
  addListenerById("btn-settings", "click", () => {
    const settingsScene = getElementOrLog("settingsScene");
    settingsScene?.classList.remove("hidden");
  });
  addListenerById("btn-logout", "click", logoutPlayer);
  addListenerById("btn-settings-close", "click", () => {
    const settingsScene = getElementOrLog("settingsScene");
    settingsScene?.classList.add("hidden");
  });

  addListenerById("btn-map-prev", "click", () => {
    const maps = getMapsOrLogError();
    if (!maps) {
      return;
    }

    currentMapIndex = (currentMapIndex - 1 + maps.length) % maps.length;
    updateMapPreview();
  });
  addListenerById("btn-map-next", "click", () => {
    const maps = getMapsOrLogError();
    if (!maps) {
      return;
    }

    currentMapIndex = (currentMapIndex + 1) % maps.length;
    updateMapPreview();
  });

  addListenerById("confirmSetupBtn", "click", () => {
    if (GameManager.selectedMode && GameManager.playerCount && GameManager.gameTime && GameManager.selectedMapId) {
      resetTeams();
      setAppState("teamSelection");
      return;
    }

    showWarningPopup("Complete mode, player number, game time, and map before continuing.");
  });

  document.querySelectorAll(".join-btn").forEach((btn) => {
    btn.addEventListener("click", () => joinTeam(btn.dataset.team));
  });

  addListenerById("startMatchBtn", "click", async () => {
    if (!teamReady()) {
      showWarningPopup("Please complete a valid team assignment.");
      return;
    }

    await GameManager.startMatch();
  });

  addListenerById("loggedInBadge", "click", openLoginPopup);
  addListenerById("devSetGoldBtn", "click", openSetDeveloperGoldPopup);
  addListenerById("devSendGoldBtn", "click", openSendGoldPopup);
  addListenerById("pauseBtn", "click", () => {
    if (GAME_STATE === "playing") {
      setGameState("paused");
      return;
    }

    if (GAME_STATE === "paused") {
      setGameState("playing");
    }
  });

  document.addEventListener("keydown", (event) => {
    GameplayMapRenderer.keyState[event.code] = true;
  });
  document.addEventListener("keyup", (event) => {
    GameplayMapRenderer.keyState[event.code] = false;
  });
});

window.addEventListener("load", async () => {
  try {
    const response = await fetch("/check_session");
    const data = await parseApiResponse(response);
    if (data.logged_in) {
      await refreshAccountState();
    }
  } catch (error) {
    console.error("Failed to restore session", error);
  }
});
