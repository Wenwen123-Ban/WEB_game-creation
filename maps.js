const MAPS = [
  {
    id: "waterloo",
    name: "Waterloo",
    width: 2000,
    height: 1200,
    background: "grass",
    spawnPoints: {
      blue: { x: 260, y: 940 },
      red: { x: 1740, y: 250 },
    },
    towns: [
      { name: "Capital", x: 1760, y: 180 },
      { name: "Front Town", x: 940, y: 540 },
      { name: "West Town", x: 520, y: 320 },
    ],
  },
  {
    id: "desert_siege",
    name: "Desert Siege",
    width: 2200,
    height: 1300,
    background: "desert",
    spawnPoints: {
      blue: { x: 280, y: 980 },
      red: { x: 1940, y: 260 },
    },
    towns: [
      { name: "Capital", x: 1960, y: 170 },
      { name: "Dune Town", x: 1140, y: 640 },
      { name: "Oasis", x: 760, y: 360 },
    ],
  },
  {
    id: "flat_land",
    name: "Flat Land",
    width: 2000,
    height: 1200,
    background: "grass",
    spawnPoints: {
      blue: { x: 200, y: 900 },
      red: { x: 1800, y: 200 },
    },
    towns: [
      { name: "Capital", x: 1700, y: 150 },
      { name: "Front Town", x: 900, y: 500 },
      { name: "Riverside", x: 520, y: 720 },
    ],
  },
];

window.MAPS = MAPS;
