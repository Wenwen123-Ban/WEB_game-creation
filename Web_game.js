let currentPlayer = null;

const AudioManager = {
  masterVolume: 1,
  sfxVolume: 1,
  mouseSensitivity: 1,
};

function applyAudioToElement(audio) {
  audio.volume = AudioManager.masterVolume * AudioManager.sfxVolume;
}

function showScene(sceneId) {
  document.querySelectorAll(".scene").forEach((scene) => {
    scene.style.display = "none";
  });

  const targetScene = document.getElementById(sceneId);
  if (targetScene) {
    targetScene.style.display = "block";
  }
}

function setLoginButtonState(player = null) {
  const loginButton = document.getElementById("loginBtn");

  if (!player) {
    loginButton.textContent = "LOG IN";
    loginButton.disabled = false;
    return;
  }

  loginButton.textContent = `LOGGED IN: ${player.username}`;
  loginButton.disabled = true;
}

function clearDashboard() {
  document.getElementById("playerName").textContent = "Guest";
  document.getElementById("goldValue").textContent = "0";
  document.getElementById("xpValue").textContent = "0";
  document.getElementById("levelValue").textContent = "1";
  document.getElementById("winsValue").textContent = "0";
  document.getElementById("lossValue").textContent = "0";
  document.getElementById("totalMatchesValue").textContent = "0";
  document.getElementById("totalUnitsValue").textContent = "0";
  document.getElementById("devButtonsContainer").style.display = "none";
  setLoginButtonState();
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

  document.getElementById("btn-settings-close").addEventListener("click", () => showScene("mainScene"));
}

async function refreshAccountState() {
  try {
    const response = await fetch("/get_current_user");
    const data = await response.json();

    if (!data.success) {
      currentPlayer = null;
      clearDashboard();
      renderDevButtons();
      return;
    }

    const user = data.user;
    currentPlayer = user;

    document.getElementById("playerName").textContent = `${user.username}${user.is_dev ? " [DEV]" : ""}`;
    document.getElementById("goldValue").textContent = String(user.gold ?? 0);
    document.getElementById("xpValue").textContent = String(user.xp ?? 0);
    document.getElementById("levelValue").textContent = String(user.level ?? 1);
    document.getElementById("winsValue").textContent = String(user.wins ?? 0);
    document.getElementById("lossValue").textContent = String(user.losses ?? 0);
    document.getElementById("totalMatchesValue").textContent = String(user.total_matches ?? 0);
    document.getElementById("totalUnitsValue").textContent = String(user.total_units ?? 0);

    const devButtons = document.getElementById("devButtonsContainer");
    devButtons.style.display = user.is_dev ? "block" : "none";

    setLoginButtonState({ username: user.username });
    renderDevButtons();
  } catch (error) {
    console.error("Failed to refresh account:", error);
  }
}

function closePopup() {
  const existing = document.querySelector(".popup-overlay");
  if (existing) {
    existing.remove();
  }
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
  cancel.className = "menu-btn popup-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePopup);

  actions.appendChild(submit);
  actions.appendChild(cancel);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const payload = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));

    try {
      const result = await onSubmit(payload);
      if (result?.message) {
        message.textContent = result.message;
      }
    } catch (error) {
      message.textContent = error.message || "Action failed.";
    }
  });

  form.appendChild(actions);

  popup.appendChild(heading);
  popup.appendChild(form);
  popup.appendChild(message);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  if (fields.length > 0) {
    inputs[fields[0].name].focus();
  }
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

function renderDevButtons() {
  const container = document.getElementById("devButtonsContainer");
  container.innerHTML = "";

  if (!currentPlayer || !currentPlayer.is_dev) {
    return;
  }

  const controls = document.createElement("div");
  controls.className = "dev-buttons";

  const setGold = document.createElement("button");
  setGold.type = "button";
  setGold.className = "login-btn";
  setGold.textContent = "DEV: Set My Gold";
  setGold.addEventListener("click", openDevSetGoldPopup);

  const sendGold = document.createElement("button");
  sendGold.type = "button";
  sendGold.className = "login-btn";
  sendGold.textContent = "DEV: Send Gold";
  sendGold.addEventListener("click", openDevSendGoldPopup);

  controls.appendChild(setGold);
  controls.appendChild(sendGold);
  container.appendChild(controls);
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

  const popup = document.querySelector(".popup-card");
  const form = popup.querySelector(".popup-form");

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "menu-btn popup-secondary";
  createButton.textContent = "Create Account";
  createButton.addEventListener("click", openCreateAccountPopup);
  form.appendChild(createButton);
}

function openCreateAccountPopup() {
  createPopup({
    title: "Create Account",
    fields: [
      { name: "username", placeholder: "New Username" },
      { name: "password", placeholder: "New Password", type: "password" },
    ],
    submitLabel: "Create Account",
    onSubmit: async ({ username, password }) => {
      await apiPost("/api/create-account", { username, password });
      await refreshAccountState();
      closePopup();
      return { message: "Account created successfully." };
    },
  });
}

function openDevSetGoldPopup() {
  createPopup({
    title: "DEV: Set My Gold",
    fields: [{ name: "amount", placeholder: "New Gold Amount", type: "number" }],
    submitLabel: "Confirm",
    onSubmit: async ({ amount }) => {
      const parsedAmount = Number(amount);
      if (!Number.isInteger(parsedAmount) || parsedAmount < 0) {
        throw new Error("Amount must be a non-negative integer.");
      }

      await apiPost("/api/dev-set-gold", {
        username: currentPlayer.username,
        amount: parsedAmount,
      });

      await refreshAccountState();
      return { message: "Gold updated." };
    },
  });
}

function openDevSendGoldPopup() {
  createPopup({
    title: "DEV: Send Gold",
    fields: [
      { name: "target", placeholder: "Target Username" },
      { name: "amount", placeholder: "Amount", type: "number" },
    ],
    submitLabel: "Confirm",
    onSubmit: async ({ target, amount }) => {
      const parsedAmount = Number(amount);
      if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Amount must be a positive integer.");
      }

      const data = await apiPost("/api/dev-send-gold", {
        from: currentPlayer.username,
        to: target,
        amount: parsedAmount,
      });

      await refreshAccountState();
      return { message: `Sent ${data.amount} gold to ${data.target}.` };
    },
  });
}

async function logout() {
  await fetch("/logout", { method: "POST" });
  location.reload();
}

function setupSceneNavigation() {
  document.getElementById("btn-settings").addEventListener("click", () => showScene("settingsScene"));
  document.getElementById("btn-play").addEventListener("click", () => showScene("playScene"));
  document.getElementById("btn-saved-maps").addEventListener("click", () => showScene("mapsScene"));
  document.getElementById("btn-play-back").addEventListener("click", () => showScene("mainScene"));
  document.getElementById("btn-maps-back").addEventListener("click", () => showScene("mainScene"));
}

document.addEventListener("DOMContentLoaded", () => {
  showScene("mainScene");
  clearDashboard();
  setupSettingsHandlers();
  loadSettings();
  setupSceneNavigation();
  document.getElementById("btn-logout").addEventListener("click", logout);
  document.getElementById("loginBtn").addEventListener("click", openLoginPopup);
});

window.addEventListener("load", async () => {
  const response = await fetch("/check_session");
  const data = await response.json();

  if (data.logged_in) {
    refreshAccountState();
  }
});
