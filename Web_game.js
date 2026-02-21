const APP_SECTIONS = ["mainMenu", "mapSelection", "teamSelection", "gameScreen"];
const GAME_STATES = ["menu", "mapSelect", "lobby", "playing", "paused"];
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;
let GAME_STATE = "menu";
let currentPlayer = null;
let units = [];
let projectiles = [];
let effects = [];
let isPaused = false;

const UNIT_STATS = {
  rifleman: {
    cost: 100, hp: 100, damage: 10, range: 120, speed: 1.5, cooldown: 800,
  },
  grenadier: {
    cost: 200, hp: 150, damage: 25, range: 140, speed: 1.2, cooldown: 1200,
  },
  cavalry: {
    cost: 300, hp: 200, damage: 20, range: 60, speed: 2.5, cooldown: 600,
  },
  artillery: {
    cost: 500, hp: 180, damage: 50, range: 300, speed: 0.5, cooldown: 2000,
  },
};

const GAMEPLAY_CONFIG = {
  maxUnitsPerPlayer: 50,
  passiveGoldAmount: 5,
  passiveGoldIntervalMs: 3000,
  botThinkIntervalMs: 2500,
};

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
    EconomyManager.initMatchPlayers();
    enterGame();
    GameplayMapRenderer.init(getSelectedMap());
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
  botPlayer: null,
  incomeAccumulatorMs: 0,
  initMatchPlayers() {
    const humanName = currentPlayer?.username || "Guest";
    this.humanPlayer = {
      id: "human",
      name: humanName,
      team: GameManager.selectedTeam || "blue",
      gold: Number(currentPlayer?.gold ?? 1000),
      units: [],
      totalUnitsCreated: 0,
      totalUnitsLost: 0,
      isBot: false,
    };

    this.botPlayer = {
      id: "bot",
      name: "Marshal Bot",
      team: this.humanPlayer.team === "blue" ? "red" : "blue",
      gold: 1000,
      units: [],
      totalUnitsCreated: 0,
      totalUnitsLost: 0,
      isBot: true,
    };

    this.players = [this.humanPlayer, this.botPlayer];
    this.incomeAccumulatorMs = 0;
    UIManager.syncGoldDisplay();
  },
  canAfford(player, unitType) {
    return player.gold >= UNIT_STATS[unitType].cost;
  },
  addGold(player, amount) {
    player.gold += amount;
    UIManager.syncGoldDisplay();
    UIManager.updateSpawnButtons();
  },
  spendGold(player, unitType) {
    if (!this.canAfford(player, unitType)) {
      UIManager.flashMessage("Not enough gold", "error");
      return false;
    }
    player.gold -= UNIT_STATS[unitType].cost;
    UIManager.syncGoldDisplay();
    return true;
  },
  update(deltaSeconds) {
    this.incomeAccumulatorMs += deltaSeconds * 1000;
    while (this.incomeAccumulatorMs >= GAMEPLAY_CONFIG.passiveGoldIntervalMs) {
      this.incomeAccumulatorMs -= GAMEPLAY_CONFIG.passiveGoldIntervalMs;
      this.players.forEach((player) => this.addGold(player, GAMEPLAY_CONFIG.passiveGoldAmount));
    }
  },
};

const EffectsManager = {
  createFlash(x, y) {
    effects.push({ type: "flash", x, y, age: 0, duration: 200, radius: 10 });
  },
  createHitSpark(x, y) {
    effects.push({ type: "hit", x, y, age: 0, duration: 240, radius: 8 });
  },
  createDeathFade(unit) {
    effects.push({
      type: "death", x: unit.x, y: unit.y, age: 0, duration: 600, radius: 12, team: unit.team,
    });
  },
  update(deltaSeconds) {
    effects = effects.filter((effect) => {
      effect.age += deltaSeconds * 1000;
      return effect.age < effect.duration;
    });
  },
  draw(ctx, camera) {
    effects.forEach((effect) => {
      const progress = effect.age / effect.duration;
      const screenX = (effect.x - camera.x) * camera.zoom;
      const screenY = (effect.y - camera.y) * camera.zoom;
      ctx.save();
      if (effect.type === "flash") {
        ctx.strokeStyle = `rgba(255, 236, 133, ${1 - progress})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screenX, screenY, (effect.radius + progress * 14) * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === "hit") {
        ctx.fillStyle = `rgba(220, 36, 36, ${1 - progress})`;
        ctx.beginPath();
        ctx.arc(screenX, screenY, (effect.radius * (1 + progress)) * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.type === "death") {
        const color = effect.team === "blue" ? "31,87,214" : "216,49,49";
        ctx.fillStyle = `rgba(${color}, ${0.5 * (1 - progress)})`;
        ctx.beginPath();
        ctx.arc(screenX, screenY, (effect.radius + progress * 24) * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  },
};

class Unit {
  constructor(x, y, owner, type = "rifleman") {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.owner = owner;
    this.team = owner.team;
    this.type = type;
    this.stats = UNIT_STATS[type];
    this.speed = this.stats.speed * 80;
    this.maxHp = this.stats.hp;
    this.hp = this.maxHp;
    this.damage = this.stats.damage;
    this.range = this.stats.range;
    this.cooldown = this.stats.cooldown;
    this.lastAttackAt = 0;
    this.isSelected = false;
  }

  update(deltaSeconds) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.01) {
      this.x = this.targetX;
      this.y = this.targetY;
      return;
    }

    const step = this.speed * deltaSeconds;
    if (distance <= step) {
      this.x = this.targetX;
      this.y = this.targetY;
      return;
    }

    const ratio = step / distance;
    this.x += dx * ratio;
    this.y += dy * ratio;
  }

  moveTo(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  draw(ctx, camera) {
    const screenX = (this.x - camera.x) * camera.zoom;
    const screenY = (this.y - camera.y) * camera.zoom;
    const fillColor = this.team === "blue" ? "#1f57d6" : "#d83131";

    ctx.save();
    ctx.fillStyle = fillColor;

    switch (this.type) {
      case "grenadier": {
        const size = 14 * camera.zoom;
        ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
        break;
      }
      case "cavalry": {
        const radius = 8 * camera.zoom;
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "artillery": {
        const width = 20 * camera.zoom;
        const height = 12 * camera.zoom;
        ctx.fillRect(screenX - width / 2, screenY - height / 2, width, height);
        break;
      }
      case "rifleman":
      default: {
        const width = 12 * camera.zoom;
        const height = 8 * camera.zoom;
        ctx.fillRect(screenX - width / 2, screenY - height / 2, width, height);
      }
    }

    const hpRatio = Math.max(0, this.hp / this.maxHp);
    const barWidth = 20 * camera.zoom;
    const barHeight = 3 * camera.zoom;
    const barX = screenX - barWidth / 2;
    const barY = screenY - 16 * camera.zoom;
    ctx.fillStyle = "#8d1d1d";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = "#3db63d";
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

    if (this.isSelected) {
      ctx.strokeStyle = "#ffe066";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#ffe066";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 12 * camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  containsPoint(worldX, worldY) {
    const hitRadius = 14;
    return Math.hypot(worldX - this.x, worldY - this.y) <= hitRadius;
  }
}

const SpawnManager = {
  getSpawnPoint(player) {
    return GameplayMapRenderer.map?.spawnPoints?.[player.team] || { x: 300, y: 300 };
  },
  spawnUnit(player, type, options = {}) {
    if (!UNIT_STATS[type]) {
      return null;
    }

    if (player.units.length >= GAMEPLAY_CONFIG.maxUnitsPerPlayer) {
      UIManager.flashMessage(`${player.name} reached max units`, "error");
      return null;
    }

    if (!options.skipCost && !EconomyManager.spendGold(player, type)) {
      UIManager.updateSpawnButtons();
      return null;
    }

    const origin = this.getSpawnPoint(player);
    const jitterX = (Math.random() - 0.5) * 60;
    const jitterY = (Math.random() - 0.5) * 60;
    const unit = new Unit(origin.x + jitterX, origin.y + jitterY, player, type);
    units.push(unit);
    player.units.push(unit);
    player.totalUnitsCreated += 1;
    UIManager.updateSpawnButtons();
    return unit;
  },
  spawnInitialArmies() {
    units = [];
    EconomyManager.players.forEach((player) => {
      player.units = [];
    });
  },
};

const UnitManager = {
  update(deltaSeconds) {
    units.forEach((unit) => unit.update(deltaSeconds));
  },
  draw(ctx, camera) {
    units.forEach((unit) => unit.draw(ctx, camera));
    EffectsManager.draw(ctx, camera);
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
  moveSelectedTo(targetX, targetY) {
    const selectedUnits = this.getSelectedUnits();
    if (selectedUnits.length === 0) {
      return;
    }

    const spacing = 24;
    const columns = Math.max(1, Math.ceil(Math.sqrt(selectedUnits.length)));

    selectedUnits.forEach((unit, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const offsetX = (col - (columns - 1) / 2) * spacing;
      const offsetY = (row - (Math.ceil(selectedUnits.length / columns) - 1) / 2) * spacing;
      unit.moveTo(targetX + offsetX, targetY + offsetY);
    });
  },
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
    EffectsManager.createDeathFade(unit);
  },
};

const CombatManager = {
  update(deltaSeconds) {
    const now = performance.now();
    units.forEach((unit) => {
      const enemy = this.findNearestEnemyInRange(unit);
      if (!enemy) {
        return;
      }
      unit.moveTo(unit.x, unit.y);
      if (now - unit.lastAttackAt < unit.cooldown) {
        return;
      }
      unit.lastAttackAt = now;
      enemy.hp -= unit.damage;
      EffectsManager.createFlash(unit.x, unit.y);
      EffectsManager.createHitSpark(enemy.x, enemy.y);
      if (enemy.hp <= 0) {
        UnitManager.removeUnit(enemy);
      }
    });
    EffectsManager.update(deltaSeconds);
  },
  findNearestEnemyInRange(unit) {
    let nearest = null;
    let nearestDistance = Infinity;
    units.forEach((candidate) => {
      if (candidate === unit || candidate.team === unit.team) {
        return;
      }
      const distance = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
      if (distance <= unit.range && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    });
    return nearest;
  },
  findNearestEnemy(unit) {
    let nearest = null;
    let nearestDistance = Infinity;
    units.forEach((candidate) => {
      if (candidate.team === unit.team) {
        return;
      }
      const distance = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    });
    return nearest;
  },
};

const AIManager = {
  thinkAccumulatorMs: 0,
  update(deltaSeconds) {
    this.thinkAccumulatorMs += deltaSeconds * 1000;
    if (this.thinkAccumulatorMs < GAMEPLAY_CONFIG.botThinkIntervalMs) {
      return;
    }
    this.thinkAccumulatorMs = 0;

    const bot = EconomyManager.botPlayer;
    if (!bot) {
      return;
    }

    const unitTypes = Object.keys(UNIT_STATS).sort((a, b) => UNIT_STATS[a].cost - UNIT_STATS[b].cost);
    const cheapest = unitTypes[0];
    if (EconomyManager.canAfford(bot, cheapest)) {
      const affordable = unitTypes.filter((type) => EconomyManager.canAfford(bot, type));
      const spawnType = affordable[Math.floor(Math.random() * affordable.length)] || cheapest;
      SpawnManager.spawnUnit(bot, spawnType);
    }

    bot.units.forEach((unit) => {
      const target = CombatManager.findNearestEnemy(unit);
      if (target) {
        unit.moveTo(target.x, target.y);
      }
    });
  },
};

const UIManager = {
  flashTimeout: null,
  initGameplayUI() {
    document.querySelectorAll(".spawn-btn").forEach((button) => {
      button.textContent = `${button.dataset.unit} (${UNIT_STATS[button.dataset.unit].cost}g)`;
      button.onclick = () => {
        SpawnManager.spawnUnit(EconomyManager.humanPlayer, button.dataset.unit);
      };
    });
    this.updateSpawnButtons();
    this.syncGoldDisplay();
  },
  updateSpawnButtons() {
    const player = EconomyManager.humanPlayer;
    if (!player) {
      return;
    }
    document.querySelectorAll(".spawn-btn").forEach((button) => {
      const cost = UNIT_STATS[button.dataset.unit].cost;
      const isFull = player.units.length >= GAMEPLAY_CONFIG.maxUnitsPerPlayer;
      button.disabled = player.gold < cost || isFull || isPaused;
    });
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
      row.innerHTML = `<strong>${player.name}</strong><span>Gold: ${player.gold}</span><span>Units Alive: ${player.units.length}</span><span>Created: ${player.totalUnitsCreated}</span><span>Lost: ${player.totalUnitsLost}</span>`;
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
  edgeScrollZone: 20,
  pointerPosition: { x: 0, y: 0 },
  isPointerInsideCanvas: false,
  isDragPanning: false,
  lastDragPosition: null,
  isSelecting: false,
  selectionStart: null,
  selectionCurrent: null,
  onPointerMove: null,
  onPointerDown: null,
  onPointerUp: null,
  onPointerEnter: null,
  onPointerLeave: null,
  onContextMenu: null,
  onWheel: null,
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

    const moveDistance = this.speed * deltaSeconds;

    if (this.isPointerInsideCanvas && !this.isDragPanning) {
      const { x, y } = this.pointerPosition;
      if (x <= this.edgeScrollZone) this.cameraX -= moveDistance;
      if (x >= this.canvas.width - this.edgeScrollZone) this.cameraX += moveDistance;
      if (y <= this.edgeScrollZone) this.cameraY -= moveDistance;
      if (y >= this.canvas.height - this.edgeScrollZone) this.cameraY += moveDistance;
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

      if (this.isSelecting) {
        this.selectionCurrent = this.screenToWorld(position.x, position.y);
      }
    };

    this.onPointerDown = (event) => {
      const position = this.getCanvasPointerPosition(event);
      this.pointerPosition = position;

      if (event.button === 1) {
        this.isDragPanning = true;
        this.lastDragPosition = position;
        event.preventDefault();
        return;
      }

      if (event.button === 0) {
        this.isSelecting = true;
        this.selectionStart = this.screenToWorld(position.x, position.y);
        this.selectionCurrent = this.selectionStart;
      }
    };

    this.onPointerUp = (event) => {
      if (event.button === 1 && this.isDragPanning) {
        this.isDragPanning = false;
        this.lastDragPosition = null;
        return;
      }

      if (event.button === 0 && this.isSelecting && this.selectionStart && this.selectionCurrent) {
        const keepExisting = event.shiftKey;
        const width = Math.abs(this.selectionCurrent.x - this.selectionStart.x);
        const height = Math.abs(this.selectionCurrent.y - this.selectionStart.y);

        if (width < 8 && height < 8) {
          UnitManager.selectUnitAt(this.selectionStart.x, this.selectionStart.y, keepExisting);
        } else {
          UnitManager.selectInRectangle({
            minX: Math.min(this.selectionStart.x, this.selectionCurrent.x),
            maxX: Math.max(this.selectionStart.x, this.selectionCurrent.x),
            minY: Math.min(this.selectionStart.y, this.selectionCurrent.y),
            maxY: Math.max(this.selectionStart.y, this.selectionCurrent.y),
          }, keepExisting);
        }

        this.isSelecting = false;
        this.selectionStart = null;
        this.selectionCurrent = null;
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
      this.isSelecting = false;
      this.selectionStart = null;
      this.selectionCurrent = null;
    };

    this.onContextMenu = (event) => {
      const position = this.getCanvasPointerPosition(event);
      const worldPosition = this.screenToWorld(position.x, position.y);
      UnitManager.moveSelectedTo(worldPosition.x, worldPosition.y);
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

    if (this.isSelecting && this.selectionStart && this.selectionCurrent) {
      const startX = (this.selectionStart.x - this.cameraX) * this.zoomLevel;
      const startY = (this.selectionStart.y - this.cameraY) * this.zoomLevel;
      const currentX = (this.selectionCurrent.x - this.cameraX) * this.zoomLevel;
      const currentY = (this.selectionCurrent.y - this.cameraY) * this.zoomLevel;
      ctx.save();
      ctx.fillStyle = "rgba(255, 224, 102, 0.2)";
      ctx.strokeStyle = "rgba(255, 224, 102, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(startX, startY, currentX - startX, currentY - startY);
      ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
      ctx.restore();
    }
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
    drawStar(ctx, drawX, drawY, 9 * camera.zoom, "#d83131");
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
