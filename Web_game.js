const APP_SECTIONS = ["mainMenu", "mapSelection", "teamSelection", "gameScreen"];
const GAME_STATES = ["menu", "mapSelect", "lobby", "playing", "paused"];
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;
let GAME_STATE = "menu";
let currentPlayer = null;
let units = [];
let isPaused = false;

const UNIT_COST = 10;
const UNIT_SPEED = 120;
const UNIT_COLLISION_DISTANCE = 24;
const FORMATION_MODES = { ATTACK: "attack", DEFENSE: "defense" };

const GAMEPLAY_CONFIG = {
  maxUnitsPerPlayer: 50,
  maxTotalUnits: 100,
  passiveGoldAmount: 2,
  passiveGoldIntervalMs: 3000,
  startingGold: 100,
  baseGoldCap: 100,
  captureGoldCapBonus: 50,
};

const BOT_DIFFICULTY = {
  easy: {
    spawnIntervalMs: 5000,
    behavior: "passive",
  },
  medium: {
    spawnIntervalMs: 3000,
    behavior: "adaptive",
  },
  hard: {
    spawnIntervalMs: 200,
    behavior: "strategic",
  },
};

let currentMode = "vsbot";
let lanLobbies = [];
let activeLobbyId = null;

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.style.display = "none";
  });

  const nextScreen = document.getElementById(screenId);
  if (nextScreen) {
    nextScreen.style.display = "block";
  }
}

function updateUIVisibility() {
  const sectionMap = {
    menu: "mainMenu",
    mapSelect: "mapSelection",
    lobby: "teamSelection",
    playing: "gameScreen",
    paused: "gameScreen",
  };

  const activeSectionId = sectionMap[GAME_STATE] || "mainMenu";
  showScreen(activeSectionId);

  document.getElementById("sharedMapPanel")?.classList.toggle("hidden", GAME_STATE !== "mapSelect");

  const inMatch = GAME_STATE === "playing" || GAME_STATE === "paused";
  document.getElementById("loggedInDashboard")?.classList.toggle("hidden", inMatch);
  document.getElementById("devTools")?.classList.toggle("hidden", inMatch || !currentPlayer?.is_dev);
  document.getElementById("backBtn")?.classList.toggle("hidden", GAME_STATE === "menu" || inMatch);
}

function enterGame() {
  isPaused = false;
  setGameState("playing");
  document.getElementById("devTools")?.classList.add("hidden");
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
  selectedDifficulty: null,
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

    if (currentMode === "vsbot") {
      await apiPost("/create_match", {
        host: currentPlayer.username,
        map: this.selectedMapId,
        mode: this.selectedMode,
        players: this.playerCount,
        time: this.gameTime,
        team: this.selectedTeam,
        status: "pending",
      });
    }

    units = [];
    EconomyManager.initMatchPlayers();
    enterGame();
    GameplayMapRenderer.init(getSelectedMap());
    MatchFlowManager.init();
    UIManager.initGameplayUI();
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

const EconomyManager = {
  players: [],
  humanPlayer: null,
  botPlayers: [],
  incomeAccumulatorMs: 0,
  initMatchPlayers() {
    const humanName = currentPlayer?.username || "Guest";
    this.humanPlayer = {
      id: "human",
      name: humanName,
      team: GameManager.selectedTeam || "blue",
      gold: GAMEPLAY_CONFIG.startingGold,
      goldCap: GAMEPLAY_CONFIG.baseGoldCap,
      formationMode: FORMATION_MODES.DEFENSE,
      units: [],
      totalUnitsCreated: 0,
      totalUnitsLost: 0,
      isBot: false,
    };

    const addBot = (name, team, index) => ({
      id: `bot-${team}-${index}`,
      name,
      team,
      gold: GAMEPLAY_CONFIG.startingGold,
      goldCap: GAMEPLAY_CONFIG.baseGoldCap,
      formationMode: FORMATION_MODES.DEFENSE,
      units: [],
      totalUnitsCreated: 0,
      totalUnitsLost: 0,
      isBot: true,
    });

    const normalizedTeams = {
      blue: [...(GameManager.teams.blue || [])],
      red: [...(GameManager.teams.red || [])],
    };
    const slotsPerTeam = GameManager.playerCount === 4 ? 2 : 1;
    ["blue", "red"].forEach((team) => {
      while (normalizedTeams[team].length < slotsPerTeam) {
        normalizedTeams[team].push("");
      }
    });

    const hasOtherHuman = ["blue", "red"].some((team) => normalizedTeams[team].some((name) => name && !name.startsWith("BOT") && name !== humanName));
    if (GameManager.selectedMode !== "LAN" || !hasOtherHuman) {
      ["blue", "red"].forEach((team) => {
        normalizedTeams[team] = normalizedTeams[team].map((name, idx) => {
          if (!name || name.startsWith("OPEN")) {
            return `BOT ${team.toUpperCase()} ${idx + 1}`;
          }
          return name;
        });
      });
    }

    this.botPlayers = [];
    ["blue", "red"].forEach((team) => {
      normalizedTeams[team].forEach((name, index) => {
        if (!name || name === humanName || !name.startsWith("BOT")) {
          return;
        }
        const bot = addBot(name, team, index + 1);
        bot.teammateHuman = team === this.humanPlayer.team && GameManager.playerCount === 4;
        this.botPlayers.push(bot);
      });
    });

    if (this.botPlayers.length === 0) {
      const fallbackTeam = this.humanPlayer.team === "blue" ? "red" : "blue";
      this.botPlayers.push(addBot("Marshal Bot", fallbackTeam, 1));
    }

    this.players = [this.humanPlayer, ...this.botPlayers];
    this.incomeAccumulatorMs = 0;
    UIManager.syncGoldDisplay();
  },
  canAfford(player, amount = UNIT_COST) {
    return player.gold >= amount;
  },
  addGold(player, amount) {
    player.gold = Math.min(player.goldCap, player.gold + amount);
    UIManager.syncGoldDisplay();
    UIManager.updateSpawnButtons();
  },
  spendGold(player, amount = UNIT_COST) {
    if (!this.canAfford(player, amount)) {
      UIManager.flashMessage("Not enough gold", "error");
      return false;
    }
    player.gold -= amount;
    UIManager.syncGoldDisplay();
    return true;
  },
  increaseTeamGoldCap(team, amount) {
    this.players.filter((player) => player.team === team).forEach((player) => {
      player.goldCap += amount;
      player.gold = Math.min(player.gold, player.goldCap);
    });
    UIManager.flashMessage(`${team.toUpperCase()} captured area (+${amount} gold cap)`);
  },
  update(deltaSeconds) {
    this.incomeAccumulatorMs += deltaSeconds * 1000;
    while (this.incomeAccumulatorMs >= GAMEPLAY_CONFIG.passiveGoldIntervalMs) {
      this.incomeAccumulatorMs -= GAMEPLAY_CONFIG.passiveGoldIntervalMs;
      this.players.forEach((player) => this.addGold(player, GAMEPLAY_CONFIG.passiveGoldAmount));
    }
  },
};

class Unit {
  constructor(x, y, owner) {
    this.id = `${owner.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.owner = owner;
    this.team = owner.team;
    this.strength = Math.floor(Math.random() * 99) + 1;
    this.state = "idle";
    this.formationRole = "infantry";
    this.isSelected = false;
  }

  update(deltaSeconds) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.01) return;
    const step = UNIT_SPEED * deltaSeconds;
    if (distance <= step) {
      this.x = this.targetX;
      this.y = this.targetY;
      return;
    }
    const ratio = step / distance;
    this.x += dx * ratio;
    this.y += dy * ratio;
  }

  moveTo(x, y, state = "moving") {
    this.targetX = x;
    this.targetY = y;
    this.state = state;
  }

  draw(ctx, camera) {
    const screenX = (this.x - camera.x) * camera.zoom;
    const screenY = (this.y - camera.y) * camera.zoom;
    const fillColor = this.team === "blue" ? "#1f57d6" : "#d83131";

    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 10 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.max(10, 10 * camera.zoom)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(this.strength)), screenX, screenY);

    if (this.isSelected) {
      ctx.strokeStyle = "#ffe066";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 13 * camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  containsPoint(worldX, worldY) {
    return Math.hypot(worldX - this.x, worldY - this.y) <= 14;
  }
}

const SpawnManager = {
  getSpawnPoint(player) {
    return GameplayMapRenderer.map?.spawnPoints?.[player.team] || { x: 300, y: 300 };
  },
  spawnUnit(player, options = {}) {
    if (units.length >= GAMEPLAY_CONFIG.maxTotalUnits) {
      return null;
    }
    if (player.units.length >= GAMEPLAY_CONFIG.maxUnitsPerPlayer) {
      UIManager.flashMessage(`${player.name} reached max units`, "error");
      return null;
    }
    if (!options.skipCost && !EconomyManager.spendGold(player, UNIT_COST)) {
      UIManager.updateSpawnButtons();
      return null;
    }

    const origin = this.getSpawnPoint(player);
    const jitterX = (Math.random() - 0.5) * 50;
    const jitterY = (Math.random() - 0.5) * 50;
    const unit = new Unit(origin.x + jitterX, origin.y + jitterY, player);
    units.push(unit);
    player.units.push(unit);
    player.totalUnitsCreated += 1;
    UIManager.updateSpawnButtons();
    UIManager.updateStrengthDisplay();
    return unit;
  },
  spawnInitialArmies() {
    units = [];
    EconomyManager.players.forEach((player) => {
      player.units = [];
      player.formationMode = FORMATION_MODES.DEFENSE;
    });
  },
};

const UnitManager = {
  update(deltaSeconds) {
    units.forEach((unit) => unit.update(deltaSeconds));
  },
  draw(ctx, camera) {
    units.forEach((unit) => unit.draw(ctx, camera));
  },
  clearSelection() {
    units.forEach((unit) => {
      unit.isSelected = false;
    });
  },
  getSelectedUnits() {
    return units.filter((unit) => unit.isSelected);
  },
  selectUnitAt(worldX, worldY, keepExisting = false) {
    if (!keepExisting) {
      this.clearSelection();
    }

    for (let i = units.length - 1; i >= 0; i -= 1) {
      if (units[i].team !== EconomyManager.humanPlayer?.team) {
        continue;
      }
      if (units[i].containsPoint(worldX, worldY)) {
        units[i].isSelected = true;
        return true;
      }
    }

    return false;
  },
  selectInRectangle(rect, keepExisting = false) {
    if (!keepExisting) {
      this.clearSelection();
    }

    units.forEach((unit) => {
      if (unit.team !== EconomyManager.humanPlayer?.team) {
        return;
      }
      if (unit.x >= rect.minX && unit.x <= rect.maxX && unit.y >= rect.minY && unit.y <= rect.maxY) {
        unit.isSelected = true;
      }
    });
  },
  moveSelectedTo() {},
  removeUnit(unit) {
    const idx = units.indexOf(unit);
    if (idx >= 0) {
      units.splice(idx, 1);
    }
    const ownerIdx = unit.owner.units.indexOf(unit);
    if (ownerIdx >= 0) {
      unit.owner.units.splice(ownerIdx, 1);
    }
    unit.owner.totalUnitsLost += 1;
    UIManager.updateStrengthDisplay();
  },
};

const CombatManager = {
  update() {
    const toRemove = new Set();
    for (let i = 0; i < units.length; i += 1) {
      const unitA = units[i];
      if (toRemove.has(unitA)) continue;
      for (let j = i + 1; j < units.length; j += 1) {
        const unitB = units[j];
        if (toRemove.has(unitB) || unitA.team === unitB.team) continue;
        const distance = Math.hypot(unitA.x - unitB.x, unitA.y - unitB.y);
        if (distance > UNIT_COLLISION_DISTANCE) continue;
        if (unitA.strength > unitB.strength) {
          unitA.strength -= unitB.strength;
          toRemove.add(unitB);
          unitA.state = "attacking";
        } else if (unitB.strength > unitA.strength) {
          unitB.strength -= unitA.strength;
          toRemove.add(unitA);
          unitB.state = "attacking";
        } else {
          toRemove.add(unitA);
          toRemove.add(unitB);
        }
        break;
      }
    }
    toRemove.forEach((unit) => UnitManager.removeUnit(unit));
  },
};

const AIManager = {
  spawnAccumulatorMs: 0,
  formationAccumulatorMs: 0,
  update(deltaSeconds) {
    const difficulty = BOT_DIFFICULTY[GameManager.selectedDifficulty] || BOT_DIFFICULTY.medium;
    this.spawnAccumulatorMs += deltaSeconds * 1000;
    this.formationAccumulatorMs += deltaSeconds * 1000;

    EconomyManager.botPlayers.forEach((bot) => {
      if (this.spawnAccumulatorMs >= difficulty.spawnIntervalMs && EconomyManager.canAfford(bot, UNIT_COST)) {
        SpawnManager.spawnUnit(bot);
      }

      if (difficulty.behavior === "passive") {
        if (Math.random() < 0.03) bot.formationMode = Math.random() > 0.5 ? FORMATION_MODES.ATTACK : FORMATION_MODES.DEFENSE;
      } else if (difficulty.behavior === "adaptive") {
        bot.formationMode = this.getTeamStrength(bot.team) > this.getTeamStrength(EconomyManager.humanPlayer.team) ? FORMATION_MODES.ATTACK : FORMATION_MODES.DEFENSE;
      } else {
        const enemyTeam = bot.team === "blue" ? "red" : "blue";
        bot.formationMode = this.getTeamStrength(bot.team) > this.getTeamStrength(enemyTeam) ? FORMATION_MODES.ATTACK : FORMATION_MODES.DEFENSE;
      }

      if (bot.teammateHuman) {
        bot.formationMode = EconomyManager.humanPlayer.formationMode;
      }
    });

    if (this.spawnAccumulatorMs >= difficulty.spawnIntervalMs) this.spawnAccumulatorMs = 0;
    if (this.formationAccumulatorMs >= 500) {
      EconomyManager.players.forEach((player) => this.applyFormation(player));
      this.formationAccumulatorMs = 0;
    }
  },
  getTeamStrength(team) {
    return units.filter((u) => u.team === team).reduce((sum, u) => sum + u.strength, 0);
  },
  applyFormation(player) {
    if (!player.units.length) return;
    const center = player.units.reduce((acc, unit) => ({ x: acc.x + unit.x / player.units.length, y: acc.y + unit.y / player.units.length }), { x: 0, y: 0 });
    const enemyUnits = units.filter((u) => u.team !== player.team);
    player.units.forEach((unit, index) => {
      if (player.formationMode === FORMATION_MODES.DEFENSE) {
        const angle = (Math.PI * 2 * index) / Math.max(1, player.units.length);
        unit.moveTo(center.x + Math.cos(angle) * 30, center.y + Math.sin(angle) * 30, "defending");
      } else if (enemyUnits.length) {
        const target = enemyUnits.reduce((best, enemy) => (Math.hypot(enemy.x - unit.x, enemy.y - unit.y) < Math.hypot(best.x - unit.x, best.y - unit.y) ? enemy : best), enemyUnits[0]);
        unit.moveTo(target.x, target.y, "attacking");
      }
    });
  },
};

const MatchFlowManager = {
  remainingMs: 0,
  ended: false,
  init() {
    this.remainingMs = Number(GameManager.gameTime || 10) * 60 * 1000;
    this.ended = false;
  },
  update(deltaSeconds) {
    if (this.ended || isPaused) {
      return;
    }
    this.remainingMs = Math.max(0, this.remainingMs - deltaSeconds * 1000);
    UIManager.updateTimer(this.remainingMs);
    if (this.remainingMs === 0) {
      this.resolveTimeout();
    }

    const aliveByTeam = { blue: 0, red: 0 };
    units.forEach((u) => { aliveByTeam[u.team] += 1; });
    ["blue", "red"].forEach((team) => {
      const teamPlayers = EconomyManager.players.filter((p) => p.team === team);
      const noGold = teamPlayers.every((p) => p.gold < UNIT_COST);
      if (aliveByTeam[team] === 0 && noGold) {
        this.finish(team === "blue" ? "red" : "blue", `${team.toUpperCase()} ran out of units and gold.`);
      }
    });
  },
  resolveTimeout() {
    const blueStrength = units.filter((u) => u.team === "blue").reduce((sum, u) => sum + u.strength, 0);
    const redStrength = units.filter((u) => u.team === "red").reduce((sum, u) => sum + u.strength, 0);
    this.finish(blueStrength >= redStrength ? "blue" : "red", "Time expired.");
  },
  finish(winnerTeam, reason) {
    if (this.ended) {
      return;
    }
    this.ended = true;
    isPaused = true;
    UIManager.flashMessage(`${winnerTeam.toUpperCase()} wins! ${reason}`);
    UIManager.updateSpawnButtons();
  },
};

const ObjectiveManager = {
  objectives: [],
  init(map) {
    this.objectives = (map?.towns || []).map((town, idx) => ({
      id: `${town.name}-${idx}`,
      x: town.x,
      y: town.y,
      radius: 80,
      owner: null,
      capAwardedTo: new Set(),
      name: town.name,
    }));
  },
  update() {
    this.objectives.forEach((objective) => {
      const inRadius = units.filter((unit) => Math.hypot(unit.x - objective.x, unit.y - objective.y) <= objective.radius);
      const blueCount = inRadius.filter((u) => u.team === "blue").length;
      const redCount = inRadius.filter((u) => u.team === "red").length;
      const newOwner = blueCount > redCount ? "blue" : redCount > blueCount ? "red" : objective.owner;
      if (newOwner && newOwner !== objective.owner) {
        objective.owner = newOwner;
        const captureKey = `${newOwner}-${objective.id}`;
        if (!objective.capAwardedTo.has(captureKey)) {
          objective.capAwardedTo.add(captureKey);
          EconomyManager.increaseTeamGoldCap(newOwner, GAMEPLAY_CONFIG.captureGoldCapBonus);
        }
      }
    });
  },
};

const UIManager = {
  flashTimeout: null,
  initGameplayUI() {
    const spawnButton = document.getElementById("spawnInfantryBtn");
    if (spawnButton) {
      spawnButton.textContent = `Spawn Infantry (${UNIT_COST}g)`;
      spawnButton.onclick = () => SpawnManager.spawnUnit(EconomyManager.humanPlayer);
    }
    document.getElementById("defenseModeBtn")?.addEventListener("click", () => {
      EconomyManager.humanPlayer.formationMode = FORMATION_MODES.DEFENSE;
      UIManager.flashMessage("Formation set to DEFENSE");
    });
    document.getElementById("attackModeBtn")?.addEventListener("click", () => {
      EconomyManager.humanPlayer.formationMode = FORMATION_MODES.ATTACK;
      UIManager.flashMessage("Formation set to ATTACK");
    });
    this.updateSpawnButtons();
    this.syncGoldDisplay();
    this.updateTimer(MatchFlowManager.remainingMs);
    this.updateStrengthDisplay();
  },
  updateSpawnButtons() {
    const player = EconomyManager.humanPlayer;
    if (!player) {
      return;
    }
    const spawnButton = document.getElementById("spawnInfantryBtn");
    if (spawnButton) {
      const isFull = player.units.length >= GAMEPLAY_CONFIG.maxUnitsPerPlayer || units.length >= GAMEPLAY_CONFIG.maxTotalUnits;
      spawnButton.disabled = player.gold < UNIT_COST || isFull || isPaused;
    }
    const unitCountLabel = document.getElementById("unitCountValue");
    if (unitCountLabel) {
      unitCountLabel.textContent = `${player.units.length}/${GAMEPLAY_CONFIG.maxUnitsPerPlayer}`;
    }
  },
  syncGoldDisplay() {
    if (EconomyManager.humanPlayer) {
      document.getElementById("gameplayGoldValue").textContent = String(EconomyManager.humanPlayer.gold);
    }
  },
  updateStrengthDisplay() {
    const team = EconomyManager.humanPlayer?.team;
    if (!team) return;
    const total = units.filter((u) => u.team === team).reduce((sum, unit) => sum + unit.strength, 0);
    const el = document.getElementById("teamStrengthValue");
    if (el) el.textContent = String(Math.round(total));
  },
  flashMessage(message, mode = "info") {
    const messageBox = document.getElementById("gameMessage");
    if (!messageBox) {
      return;
    }
    messageBox.textContent = message;
    messageBox.classList.toggle("error", mode === "error");
    messageBox.classList.remove("hidden");
    clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => messageBox.classList.add("hidden"), 1200);
  },
  openStatusModal() {
    isPaused = true;
    setGameState("paused");
    this.updateSpawnButtons();
    const body = document.getElementById("statusRows");
    body.innerHTML = "";
    EconomyManager.players.forEach((player) => {
      const row = document.createElement("div");
      row.className = "status-row";
      row.innerHTML = `<strong>${player.name}</strong><span>Gold: ${Math.round(player.gold)}</span><span>Units Alive: ${player.units.length}</span><span>Created: ${player.totalUnitsCreated}</span><span>Lost: ${player.totalUnitsLost}</span>`;
      body.appendChild(row);
    });
    document.getElementById("statusModal").classList.remove("hidden");
  },
  resumeFromPause() {
    document.getElementById("statusModal").classList.add("hidden");
    isPaused = false;
    enterGame();
    this.updateSpawnButtons();
  },
  updateTimer(remainingMs) {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const bar = document.querySelector(".playing-bar");
    if (bar) {
      bar.textContent = `MATCH IN PROGRESS • ${mins}:${secs}`;
    }
  },
};

const GameplayMapRenderer = {
  canvas: null,
  context: null,
  map: null,
  cameraX: 0,
  cameraY: 0,
  zoomLevel: 1,
  minZoom: 0.5,
  maxZoom: 2,
  animationFrame: null,
  lastFrameTime: 0,
  speed: 520,
  pointerPosition: { x: 0, y: 0 },
  isDragPanning: false,
  lastDragPosition: null,
  onPointerMove: null,
  onPointerDown: null,
  onPointerUp: null,
  onPointerEnter: null,
  onPointerLeave: null,
  onContextMenu: null,
  onWheel: null,
  onTouchStart: null,
  onTouchMove: null,
  onTouchEnd: null,
  init(selectedMap) {
    this.detachPointerControls();

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
    this.cameraX = Math.max(0, this.map.spawnPoints.blue.x - canvas.width / 2);
    this.cameraY = Math.max(0, this.map.spawnPoints.blue.y - canvas.height / 2);
    this.zoomLevel = 1;
    this.lastFrameTime = performance.now();
    SpawnManager.spawnInitialArmies();
    ObjectiveManager.init(this.map);

    this.attachPointerControls();

    this.start();
  },
  start() {
    cancelAnimationFrame(this.animationFrame);
    this.gameLoop();
  },
  gameLoop() {
    const now = performance.now();
    const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (!isPaused) {
      this.update(deltaSeconds);
    }
    this.render();
    this.animationFrame = requestAnimationFrame(() => this.gameLoop());
  },
  update(deltaSeconds) {
    this.updateCamera(deltaSeconds);
    EconomyManager.update(deltaSeconds);
    AIManager.update(deltaSeconds);
    UnitManager.update(deltaSeconds);
    CombatManager.update(deltaSeconds);
    ObjectiveManager.update();
    MatchFlowManager.update(deltaSeconds);
    UIManager.updateSpawnButtons();
  },
  getViewportWidth() {
    return this.canvas.width / this.zoomLevel;
  },
  getViewportHeight() {
    return this.canvas.height / this.zoomLevel;
  },
  clampCamera() {
    const maxX = Math.max(0, this.map.width - this.getViewportWidth());
    const maxY = Math.max(0, this.map.height - this.getViewportHeight());
    this.cameraX = Math.max(0, Math.min(this.cameraX, maxX));
    this.cameraY = Math.max(0, Math.min(this.cameraY, maxY));
  },
  updateCamera(deltaSeconds) {
    if (!this.canvas || !this.map) {
      return;
    }

    this.clampCamera();
  },
  getCanvasPointerPosition(event) {
    if (!this.canvas) {
      return { x: 0, y: 0 };
    }

    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  },
  attachPointerControls() {
    if (!this.canvas) {
      return;
    }

    this.onPointerMove = (event) => {
      const position = this.getCanvasPointerPosition(event);
      this.pointerPosition = position;

      if (this.isDragPanning && this.lastDragPosition) {
        const deltaX = (position.x - this.lastDragPosition.x) / this.zoomLevel;
        const deltaY = (position.y - this.lastDragPosition.y) / this.zoomLevel;
        this.cameraX -= deltaX;
        this.cameraY -= deltaY;
        this.lastDragPosition = position;
        this.clampCamera();
      }

    };

    this.onPointerDown = (event) => {
      const position = this.getCanvasPointerPosition(event);
      this.pointerPosition = position;

      if (event.button === 0) {
        this.isDragPanning = true;
        this.lastDragPosition = position;
        event.preventDefault();
        return;
      }


    };

    this.onPointerUp = (event) => {
      if (event.button === 0 && this.isDragPanning) {
        this.isDragPanning = false;
        this.lastDragPosition = null;
        return;
      }

    };

    this.onPointerEnter = (event) => {
      this.isPointerInsideCanvas = true;
      this.pointerPosition = this.getCanvasPointerPosition(event);
    };

    this.onPointerLeave = () => {
      this.isPointerInsideCanvas = false;
      this.isDragPanning = false;
      this.lastDragPosition = null;
    };

    this.onContextMenu = (event) => {
      event.preventDefault();
    };

    this.onWheel = (event) => {
      event.preventDefault();

      const position = this.getCanvasPointerPosition(event);
      const beforeZoom = this.screenToWorld(position.x, position.y);
      const zoomDirection = event.deltaY < 0 ? 1.1 : 0.9;
      this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel * zoomDirection));

      this.cameraX = beforeZoom.x - position.x / this.zoomLevel;
      this.cameraY = beforeZoom.y - position.y / this.zoomLevel;
      this.clampCamera();
    };

    this.canvas.addEventListener("mousemove", this.onPointerMove);
    this.canvas.addEventListener("mousedown", this.onPointerDown);
    this.canvas.addEventListener("mouseup", this.onPointerUp);
    this.canvas.addEventListener("mouseenter", this.onPointerEnter);
    this.canvas.addEventListener("mouseleave", this.onPointerLeave);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });

    let pinchDistance = null;
    this.onTouchStart = (event) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        const position = this.getCanvasPointerPosition(touch);
        this.isDragPanning = true;
        this.lastDragPosition = position;
      } else if (event.touches.length === 2) {
        const [a, b] = event.touches;
        pinchDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      }
      event.preventDefault();
    };
    this.onTouchMove = (event) => {
      if (event.touches.length === 1 && this.isDragPanning && this.lastDragPosition) {
        const position = this.getCanvasPointerPosition(event.touches[0]);
        const deltaX = (position.x - this.lastDragPosition.x) / this.zoomLevel;
        const deltaY = (position.y - this.lastDragPosition.y) / this.zoomLevel;
        this.cameraX -= deltaX;
        this.cameraY -= deltaY;
        this.lastDragPosition = position;
        this.clampCamera();
      } else if (event.touches.length === 2 && pinchDistance) {
        // Pinch placeholder logic
        const [a, b] = event.touches;
        const currentDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const factor = currentDistance > pinchDistance ? 1.01 : 0.99;
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel * factor));
        pinchDistance = currentDistance;
        this.clampCamera();
      }
      event.preventDefault();
    };
    this.onTouchEnd = () => {
      this.isDragPanning = false;
      this.lastDragPosition = null;
      pinchDistance = null;
    };
    this.canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this.onTouchEnd);
  },
  detachPointerControls() {
    if (!this.canvas) {
      return;
    }

    if (this.onPointerMove) this.canvas.removeEventListener("mousemove", this.onPointerMove);
    if (this.onPointerDown) this.canvas.removeEventListener("mousedown", this.onPointerDown);
    if (this.onPointerUp) this.canvas.removeEventListener("mouseup", this.onPointerUp);
    if (this.onPointerEnter) this.canvas.removeEventListener("mouseenter", this.onPointerEnter);
    if (this.onPointerLeave) this.canvas.removeEventListener("mouseleave", this.onPointerLeave);
    if (this.onContextMenu) this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    if (this.onWheel) this.canvas.removeEventListener("wheel", this.onWheel);
    if (this.onTouchStart) this.canvas.removeEventListener("touchstart", this.onTouchStart);
    if (this.onTouchMove) this.canvas.removeEventListener("touchmove", this.onTouchMove);
    if (this.onTouchEnd) this.canvas.removeEventListener("touchend", this.onTouchEnd);
  },
  screenToWorld(screenX, screenY) {
    return {
      x: this.cameraX + screenX / this.zoomLevel,
      y: this.cameraY + screenY / this.zoomLevel,
    };
  },
  render() {
    if (!this.context || !this.map) {
      return;
    }

    const { context: ctx, map } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    drawMapSceneWithCamera(ctx, map, {
      x: this.cameraX,
      y: this.cameraY,
      width: this.canvas.width,
      height: this.canvas.height,
      zoom: this.zoomLevel,
    }, true);
    UnitManager.draw(ctx, {
      x: this.cameraX,
      y: this.cameraY,
      zoom: this.zoomLevel,
    });

  },
  teardown() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.detachPointerControls();
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
    gameScreen: "playing",
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
    if (currentMode === "lan") {
      const lobby = getActiveLobby();
      const username = currentPlayer?.username;
      if (lobby && username) {
        if (lobby.hostName === username) {
          lanLobbies = lanLobbies.filter((entry) => entry.id !== lobby.id);
        } else {
          lobby.players = lobby.players.filter((player) => player.name !== username);
        }
      }
      activeLobbyId = null;
      setSetupControlsDisabled(false);
      renderLanServerList();
    }
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
    currentMode = normalizeModeLabel(value);
    if (currentMode === "vsbot") {
      GameManager.selectedDifficulty = GameManager.selectedDifficulty || "medium";
    } else {
      GameManager.selectedDifficulty = null;
      GameManager.playerCount = GameManager.playerCount || 2;
      GameManager.gameTime = GameManager.gameTime || 15;
    }
    resetTeams();
    updateModeUI();
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

function drawMapSceneWithCamera(ctx, map, camera, withLabels) {
  ctx.fillStyle = mapBackgroundPalette[map.background] || mapBackgroundPalette.default;
  ctx.fillRect(0, 0, camera.width, camera.height);

  const toDrawX = (worldX) => (worldX - camera.x) * camera.zoom;
  const toDrawY = (worldY) => (worldY - camera.y) * camera.zoom;

  const blueSpawn = map.spawnPoints.blue;
  const redSpawn = map.spawnPoints.red;
  drawStar(ctx, toDrawX(blueSpawn.x), toDrawY(blueSpawn.y), 10 * camera.zoom, "#1f57d6");
  drawStar(ctx, toDrawX(redSpawn.x), toDrawY(redSpawn.y), 10 * camera.zoom, "#d83131");

  map.towns.forEach((town) => {
    const drawX = toDrawX(town.x);
    const drawY = toDrawY(town.y);
    const objective = ObjectiveManager.objectives.find((point) => point.name === town.name);
    const objectiveColor = objective?.owner === "blue" ? "#1f57d6" : objective?.owner === "red" ? "#d83131" : "#b69458";
    drawStar(ctx, drawX, drawY, 9 * camera.zoom, objectiveColor);
    if (objective) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(drawX, drawY, objective.radius * 0.3 * camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (withLabels) {
      ctx.fillStyle = "#1b2a1a";
      ctx.font = `${Math.max(10, 14 * camera.zoom)}px Arial`;
      ctx.fillText(town.name, drawX + 10 * camera.zoom, drawY - 10 * camera.zoom);
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

function normalizeModeLabel(modeLabel) {
  return modeLabel === "LAN" ? "lan" : "vsbot";
}

function getActiveLobby() {
  return lanLobbies.find((lobby) => lobby.id === activeLobbyId) || null;
}

function getLobbyMaxPlayers(lobbyMode) {
  return lobbyMode === "2v2" ? 4 : 2;
}

function isLobbyFull(lobby) {
  return lobby.players.length >= lobby.maxPlayers;
}

function renderLanServerList() {
  const list = document.getElementById("lanServerList");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  const waitingLobbies = lanLobbies.filter((lobby) => lobby.status === "waiting");

  if (waitingLobbies.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No active lobbies yet.";
    list.appendChild(empty);
    return;
  }

  waitingLobbies.forEach((lobby) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "menu-btn lan-lobby-card";
    card.innerHTML = `<strong>${lobby.hostName} at ${lobby.mapName}</strong><span>${lobby.players.length}/${lobby.maxPlayers} | ${lobby.gameTime} Minutes | ${lobby.status}</span>`;
    card.disabled = isLobbyFull(lobby);
    card.addEventListener("click", () => joinLanLobby(lobby.id));
    list.appendChild(card);
  });
}

function updateModeUI() {
  const isLan = currentMode === "lan";
  document.getElementById("difficultySection")?.classList.toggle("hidden", isLan);
  document.getElementById("gameTimeSection")?.classList.toggle("hidden", isLan);
  document.getElementById("playerCountSection")?.classList.toggle("hidden", isLan);
  document.getElementById("lanLobbySection")?.classList.toggle("hidden", !isLan);
  document.getElementById("confirmSetupBtn")?.classList.toggle("hidden", isLan);

  renderLanServerList();
  updateActionButtons();
}

function setSetupControlsDisabled(disabled) {
  document.querySelectorAll('.setup-choice').forEach((btn) => {
    if (btn.dataset.type !== "mode") {
      btn.disabled = disabled;
    }
  });
  const createLobbyBtn = document.getElementById("createLobbyBtn");
  if (createLobbyBtn) {
    createLobbyBtn.disabled = disabled;
  }
}

function createLanLobby() {
  if (!currentPlayer) {
    showWarningPopup("Please login first.");
    return;
  }

  if (!GameManager.selectedMapId || !GameManager.playerCount || !GameManager.gameTime) {
    showWarningPopup("Select map, mode size, and game time before creating a lobby.");
    return;
  }

  const lobbyMode = GameManager.playerCount === 4 ? "2v2" : "1v1";
  const mapName = getSelectedMap()?.name || "Unknown Map";
  const hostName = currentPlayer.username;
  const duplicate = lanLobbies.some((lobby) => lobby.status === "waiting" && lobby.players.some((player) => player.name === hostName));
  if (duplicate) {
    showWarningPopup("You are already in an active LAN lobby.");
    return;
  }

  const lobby = {
    id: `lan-${Date.now()}`,
    hostName,
    mapName,
    mapId: GameManager.selectedMapId,
    mode: lobbyMode,
    gameTime: GameManager.gameTime,
    players: [{ name: hostName, team: null }],
    maxPlayers: getLobbyMaxPlayers(lobbyMode),
    status: "waiting",
  };

  lanLobbies.push(lobby);
  activeLobbyId = lobby.id;
  GameManager.selectedMode = "LAN";
  GameManager.playerCount = lobby.maxPlayers;
  GameManager.teams = { blue: [], red: [] };
  GameManager.selectedTeam = null;
  GameManager.selectedMapId = lobby.mapId;
  setSetupControlsDisabled(true);
  renderLanServerList();
  setAppState("teamSelection");
}

function joinLanLobby(lobbyId) {
  if (!currentPlayer) {
    showWarningPopup("Please login first.");
    return;
  }

  const lobby = lanLobbies.find((entry) => entry.id === lobbyId);
  if (!lobby || lobby.status !== "waiting") {
    showWarningPopup("Lobby is unavailable.");
    return;
  }

  if (isLobbyFull(lobby)) {
    showWarningPopup("Lobby is full.");
    return;
  }

  if (lobby.players.some((player) => player.name === currentPlayer.username)) {
    showWarningPopup("Duplicate player names are not allowed in the same lobby.");
    return;
  }

  lobby.players.push({ name: currentPlayer.username, team: null });
  activeLobbyId = lobby.id;
  GameManager.selectedMode = "LAN";
  GameManager.playerCount = lobby.maxPlayers;
  GameManager.gameTime = lobby.gameTime;
  GameManager.selectedMapId = lobby.mapId;
  GameManager.selectedTeam = null;
  setSetupControlsDisabled(true);
  setAppState("teamSelection");
}

function resetTeams() {
  GameManager.selectedTeam = null;
  GameManager.teams = { blue: [], red: [] };
  activeLobbyId = null;
  setSetupControlsDisabled(false);
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

  if (currentMode === "lan") {
    const lobby = getActiveLobby();
    if (!lobby || lobby.status !== "waiting") {
      showWarningPopup("Join a valid LAN lobby first.");
      return;
    }

    const slotsPerTeam = lobby.mode === "2v2" ? 2 : 1;
    const teamCount = lobby.players.filter((player) => player.team === team).length;
    if (teamCount >= slotsPerTeam) {
      showWarningPopup("Team is full for now.");
      return;
    }

    const playerRow = lobby.players.find((player) => player.name === currentPlayer.username);
    if (!playerRow) {
      showWarningPopup("You are not a member of this lobby.");
      return;
    }

    playerRow.team = team;
    GameManager.selectedTeam = team;
    renderTeamSlots();
    updateActionButtons();
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

  if (currentMode === "lan") {
    const lobby = getActiveLobby();
    if (!lobby) {
      return false;
    }
    return lobby.players.length === lobby.maxPlayers && lobby.players.every((player) => player.team === "blue" || player.team === "red");
  }

  if (GameManager.selectedMode === "VS BOT") {
    const oppositeTeam = GameManager.selectedTeam === "blue" ? "red" : "blue";
    return GameManager.teams[oppositeTeam].every((name) => name.startsWith("BOT"));
  }

  return true;
}

function renderTeamSlots() {
  const lobbyMeta = document.getElementById("lobbyMeta");

  if (currentMode === "lan") {
    const lobby = getActiveLobby();
    if (!lobby) {
      return;
    }

    const slots = lobby.mode === "2v2" ? 2 : 1;
    const title = lobby.hostName === currentPlayer?.username ? "LOBBY WAITING ROOM" : "TEAM SELECTION";
    document.getElementById("teamSectionTitle").textContent = title;
    if (lobbyMeta) {
      lobbyMeta.classList.remove("hidden");
      lobbyMeta.textContent = `${lobby.hostName} at ${lobby.mapName} | ${lobby.players.length}/${lobby.maxPlayers} | ${lobby.gameTime} Minutes | ${lobby.status}`;
    }

    const teams = { blue: [], red: [] };
    lobby.players.forEach((player) => {
      if (player.team === "blue" || player.team === "red") {
        teams[player.team].push(player.name);
      }
    });
    GameManager.teams = {
      blue: [...teams.blue],
      red: [...teams.red],
    };

    ["blue", "red"].forEach((team) => {
      const container = document.getElementById(`${team}TeamList`);
      container.innerHTML = "";
      for (let i = 0; i < slots; i += 1) {
        const item = document.createElement("li");
        item.textContent = teams[team][i] || `OPEN SLOT ${i + 1}`;
        container.appendChild(item);
      }

      const btn = document.querySelector(`.join-btn[data-team="${team}"]`);
      const teamFull = teams[team].length >= slots;
      btn.disabled = teamFull;
      btn.classList.toggle("active", GameManager.selectedTeam === team);
    });

    const isHost = lobby.hostName === currentPlayer?.username;
    const startBtn = document.getElementById("startMatchBtn");
    startBtn.classList.toggle("hidden", !isHost);
    startBtn.disabled = !teamReady() || lobby.status !== "waiting";
    return;
  }

  ensureTeamSlots();
  if (lobbyMeta) {
    lobbyMeta.classList.add("hidden");
  }

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

    const btn = document.querySelector(`.join-btn[data-team="${team}"]`);
    btn.disabled = false;
    btn.classList.toggle("active", GameManager.selectedTeam === team);
  });

  document.getElementById("startMatchBtn").classList.remove("hidden");
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
        difficulty: "selectedDifficulty",
      };
      setSetupChoice(keyMap[type], type, value, button);
    });
  });
}

function updateActionButtons() {
  const confirmButton = document.getElementById("confirmSetupBtn");
  const startButton = document.getElementById("startMatchBtn");

  if (currentMode === "lan") {
    if (confirmButton) {
      confirmButton.disabled = true;
    }
    const createLobbyBtn = document.getElementById("createLobbyBtn");
    const canCreateLobby = Boolean(GameManager.selectedMapId && GameManager.playerCount && GameManager.gameTime);
    if (createLobbyBtn) {
      createLobbyBtn.disabled = !canCreateLobby;
    }
    const lobby = getActiveLobby();
    const isHost = lobby?.hostName === currentPlayer?.username;
    if (startButton) {
      startButton.classList.toggle("hidden", !isHost && GAME_STATE === "lobby");
      startButton.disabled = !(isHost && teamReady() && lobby?.status === "waiting");
    }
    return;
  }

  const confirmReady = Boolean(
    GameManager.selectedMode
    && GameManager.playerCount
    && GameManager.gameTime
    && GameManager.selectedDifficulty
    && GameManager.selectedMapId,
  );

  confirmButton.disabled = !confirmReady;

  const startReady = Boolean(confirmReady && teamReady());
  startButton.disabled = !startReady;
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
  gameplayName.textContent = EconomyManager.humanPlayer?.name || currentPlayer.username;
  gameplayGold.textContent = String(EconomyManager.humanPlayer?.gold ?? currentPlayer.gold ?? 0);
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
  updateModeUI();

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
    updateModeUI();
  });
  addListenerById("btn-map-next", "click", () => {
    const maps = getMapsOrLogError();
    if (!maps) {
      return;
    }

    currentMapIndex = (currentMapIndex + 1) % maps.length;
    updateMapPreview();
    updateModeUI();
  });

  addListenerById("confirmSetupBtn", "click", () => {
    if (GameManager.selectedMode && GameManager.playerCount && GameManager.gameTime && GameManager.selectedDifficulty && GameManager.selectedMapId) {
      resetTeams();
      setAppState("teamSelection");
      return;
    }

    showWarningPopup("Complete mode, player number, game time, difficulty, and map before continuing.");
  });

  addListenerById("createLobbyBtn", "click", createLanLobby);

  document.querySelectorAll(".join-btn").forEach((btn) => {
    btn.addEventListener("click", () => joinTeam(btn.dataset.team));
  });

  addListenerById("startMatchBtn", "click", async () => {
    if (!teamReady()) {
      showWarningPopup("Please complete a valid team assignment.");
      return;
    }

    if (currentMode === "lan") {
      const lobby = getActiveLobby();
      if (!lobby || lobby.hostName !== currentPlayer?.username) {
        showWarningPopup("Only the host can start this match.");
        return;
      }
      if (lobby.players.length < lobby.maxPlayers) {
        showWarningPopup("All player slots must be filled before starting.");
        return;
      }
      lobby.status = "started";
      renderLanServerList();
      renderTeamSlots();
      enterGame();
      GameplayMapRenderer.init(getSelectedMap());
      MatchFlowManager.init();
      UIManager.initGameplayUI();
      updateDashboard();
      return;
    }

    await GameManager.startMatch();
  });

  addListenerById("loggedInBadge", "click", openLoginPopup);
  addListenerById("devSetGoldBtn", "click", openSetDeveloperGoldPopup);
  addListenerById("devSendGoldBtn", "click", openSendGoldPopup);
  addListenerById("statusBtn", "click", () => {
    if (GAME_STATE === "playing") {
      UIManager.openStatusModal();
    }
  });
  addListenerById("resumeBtn", "click", () => UIManager.resumeFromPause());

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
