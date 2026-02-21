const placeholderStats = {
  player: "CommanderName",
  wd: "3 / 1",
  gold: "1200",
  totalMatches: "4",
  totalDeployedUnits: "58",
};

function populateStats() {
  document.getElementById("stat-player").textContent = placeholderStats.player;
  document.getElementById("stat-wd").textContent = placeholderStats.wd;
  document.getElementById("stat-gold").textContent = placeholderStats.gold;
  document.getElementById("stat-total-matches").textContent = placeholderStats.totalMatches;
  document.getElementById("stat-total-units").textContent = placeholderStats.totalDeployedUnits;
}

document.addEventListener("DOMContentLoaded", populateStats);
