let currentPlayer = null;

const statsElements = {
  player: document.getElementById("stat-player"),
  wd: document.getElementById("stat-wd"),
  gold: document.getElementById("stat-gold"),
  totalMatches: document.getElementById("stat-total-matches"),
  totalUnits: document.getElementById("stat-total-units"),
};

function updateStats(player = null) {
  if (!player) {
    statsElements.player.textContent = "-";
    statsElements.wd.textContent = "0 / 0";
    statsElements.gold.textContent = "-";
    statsElements.totalMatches.textContent = "0";
    statsElements.totalUnits.textContent = "0";
    return;
  }

  statsElements.player.textContent = player.username;
  statsElements.wd.textContent = `${player.wins ?? 0} / ${player.losses ?? 0}`;
  statsElements.gold.textContent = String(player.gold ?? 0);
  statsElements.totalMatches.textContent = String(player.total_matches ?? 0);
  statsElements.totalUnits.textContent = "0";
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

  popup.appendChild(heading);
  popup.appendChild(form);
  popup.appendChild(actions);
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
  const loginButton = document.getElementById("btn-login");
  let container = document.getElementById("dev-buttons");

  if (container) {
    container.remove();
  }

  if (!currentPlayer || currentPlayer.role !== "developer") {
    return;
  }

  container = document.createElement("div");
  container.id = "dev-buttons";
  container.className = "dev-buttons";

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

  container.appendChild(setGold);
  container.appendChild(sendGold);

  loginButton.insertAdjacentElement("beforebegin", container);
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
      const data = await apiPost("/api/login", { username, password });
      currentPlayer = data.player;
      updateStats(currentPlayer);
      renderDevButtons();
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
      const data = await apiPost("/api/create-account", { username, password });
      closePopup();
      alert("Account created successfully. Please log in.");
      return data;
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

      const data = await apiPost("/api/dev-set-gold", {
        username: currentPlayer.username,
        amount: parsedAmount,
      });

      currentPlayer.gold = data.gold;
      updateStats(currentPlayer);
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

      return { message: `Sent ${data.amount} gold to ${data.target}.` };
    },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  updateStats();
  document.getElementById("btn-login").addEventListener("click", openLoginPopup);
});
