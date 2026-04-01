const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const champions = JSON.parse(fs.readFileSync(path.join(dataDir, "champions.json"), "utf8"));
const championsFull = JSON.parse(fs.readFileSync(path.join(dataDir, "champions-full.json"), "utf8"));
const merakiChampions = JSON.parse(fs.readFileSync(path.join(dataDir, "meraki-champions.json"), "utf8"));

const roleOrder = ["top", "jungle", "mid", "adc", "support"];
const riotRoleMap = {
  top: "TOP",
  jungle: "JUNGLE",
  mid: "MIDDLE",
  adc: "BOTTOM",
  support: "UTILITY"
};

const crowdControlKeywords = [
  "stun",
  "knock up",
  "knockup",
  "airborne",
  "root",
  "snare",
  "taunt",
  "fear",
  "charm",
  "silence",
  "slow",
  "sleep",
  "suppress",
  "polymorph",
  "immobil"
];

const engageKeywords = [
  "dash",
  "leap",
  "launches",
  "pulls",
  "grabs",
  "charges",
  "blink",
  "unstoppable",
  "dives",
  "knocks all enemies",
  "toward target"
];

const mobilityKeywords = [
  "dash",
  "blink",
  "leap",
  "movement speed",
  "move speed",
  "recast",
  "vault",
  "slides",
  "teleport"
];

const protectKeywords = [
  "shield",
  "heal",
  "restore",
  "allied champion",
  "ally",
  "grant",
  "protect",
  "attach"
];

const selfPeelKeywords = [
  "untargetable",
  "spell shield",
  "becomes invisible",
  "invulnerable",
  "revive",
  "cannot be targeted",
  "cleanse"
];

const burstKeywords = [
  "execute",
  "missing health",
  "bonus damage",
  "detonate",
  "critical strike",
  "burst",
  "finisher"
];

const pokeKeywords = [
  "long range",
  "line missile",
  "artillery",
  "projectile",
  "fires a",
  "launches a",
  "bomb",
  "spear"
];

const sustainKeywords = [
  "heal",
  "restores health",
  "omnivamp",
  "lifesteal",
  "regenerates",
  "regeneration"
];

const teamfightKeywords = [
  "area of effect",
  "nearby enemies",
  "all enemies",
  "around him",
  "around her",
  "explodes",
  "storm",
  "zone",
  "field"
];

const scalingKeywords = [
  "permanently",
  "stacks",
  "bonus attack speed",
  "bonus range",
  "evolves",
  "upgrade",
  "rank"
];

const waveclearKeywords = [
  "hits all enemies",
  "damages all enemies",
  "area damage",
  "area of effect",
  "explodes",
  "detonates",
  "nearby enemies",
  "line missile",
  "cone",
  "sweeps",
  "cleaves"
];

const objectiveKeywords = [
  "attack speed",
  "on-hit",
  "bonus damage",
  "monster",
  "epic monster",
  "turret",
  "structure",
  "siege",
  "pets",
  "summon"
];

const catchKeywords = [
  "charm",
  "hook",
  "pull",
  "grab",
  "sleep",
  "root",
  "stun",
  "snare",
  "suppress"
];

const mageJunglers = new Set([
  "Brand", "Diana", "Elise", "Fiddlesticks", "Gragas", "Karthus",
  "Lillia", "Morgana", "Nidalee", "Taliyah", "Zyra"
]);

const rangedMidMarksmen = new Set([
  "Akshan", "Azir", "Corki", "Lucian", "Smolder", "Tristana", "Varus", "Zeri"
]);

const topOnlyChampions = new Set([
  "Aatrox", "Darius", "DrMundo", "Garen", "Illaoi", "Kled", "Mordekaiser",
  "Nasus", "Olaf", "Renekton", "Sett", "Urgot", "Yorick"
]);

const jungleOnlyChampions = new Set([
  "Amumu", "Belveth", "Briar", "Evelynn", "Hecarim", "Ivern", "Kayn",
  "Kindred", "MasterYi", "Nocturne", "Nunu", "Rammus", "RekSai",
  "Sejuani", "Shyvana", "Vi", "Viego", "Warwick", "Zac"
]);

const supportOnlyChampions = new Set([
  "Alistar", "Blitzcrank", "Braum", "Janna", "Lulu", "Milio", "Nami",
  "Nautilus", "Pyke", "Rakan", "Renata", "Rell", "Sona", "Soraka",
  "Taric", "Thresh", "Yuumi"
]);

const adcOnlyChampions = new Set([
  "Aphelios", "Caitlyn", "Draven", "Jinx", "Kalista", "KogMaw",
  "MissFortune", "Sivir", "Twitch", "Vayne", "Xayah"
]);

const midOnlyChampions = new Set([
  "Ahri", "Anivia", "Annie", "AurelionSol", "Cassiopeia", "Hwei", "Leblanc",
  "Lissandra", "Lux", "Malzahar", "Orianna", "Ryze", "Syndra",
  "TwistedFate", "Veigar", "Vex", "Viktor", "Xerath", "Zed", "Ziggs", "Zoe"
]);

const championTagOverrides = {
  Ahri: { pick: 3, mobility: 2 },
  Alistar: { engage: 4, frontline: 3, peel: 2 },
  Amumu: { wombo: 4, teamfight: 4, engage: 3 },
  Ashe: { pick: 3, poke: 2, selfpeel: 1 },
  Azir: { scaling: 4, teamfight: 2, safe: 1 },
  Blitzcrank: { pick: 5, engage: 2 },
  Braum: { peel: 4, protect: 3, frontline: 2 },
  Caitlyn: { lane: 4, siege: 3, poke: 3 },
  Camille: { pick: 4, mobility: 3, burst: 2 },
  Corki: { poke: 4, scaling: 3, siege: 2 },
  Diana: { engage: 3, wombo: 4, burst: 3 },
  Draven: { lane: 4, damage: 3, spicy: 2 },
  Ezreal: { poke: 4, safe: 2, mobility: 2 },
  Fiddlesticks: { engage: 3, teamfight: 4, wombo: 3 },
  Galio: { engage: 3, protect: 2, teamfight: 3 },
  Hwei: { poke: 4, siege: 2, teamfight: 2 },
  Ivern: { protect: 4, peel: 3, safe: 2 },
  Janna: { peel: 5, protect: 4, safe: 2 },
  JarvanIV: { engage: 5, wombo: 4, teamfight: 2 },
  Jinx: { scaling: 5, teamfight: 4 },
  Karma: { poke: 4, protect: 3, siege: 3 },
  Kaisa: { followup: 4, scaling: 3, mobility: 2 },
  Leona: { engage: 5, cc: 4, frontline: 3 },
  Lulu: { protect: 5, peel: 5, scaling: 2 },
  Lux: { pick: 4, poke: 3, burst: 2 },
  Malphite: { engage: 5, wombo: 5, frontline: 3 },
  Maokai: { engage: 4, pick: 3, frontline: 3 },
  Milio: { protect: 5, peel: 4, safe: 2 },
  Morgana: { pick: 4, protect: 2, cc: 3 },
  Nautilus: { engage: 5, pick: 4, frontline: 3 },
  Orianna: { wombo: 5, teamfight: 4, scaling: 3 },
  Ornn: { frontline: 5, engage: 3, scaling: 2 },
  Pyke: { pick: 5, mobility: 3, spicy: 2 },
  Rakan: { engage: 4, protect: 2, mobility: 3 },
  Rell: { engage: 5, wombo: 5, frontline: 3 },
  Sejuani: { engage: 4, frontline: 4, cc: 4 },
  Seraphine: { teamfight: 4, protect: 3, scaling: 3 },
  Sona: { scaling: 4, protect: 4, teamfight: 2 },
  Soraka: { protect: 5, safe: 3, peel: 2 },
  Syndra: { pick: 4, burst: 4, scaling: 2 },
  TahmKench: { protect: 4, peel: 4, frontline: 3 },
  Taric: { protect: 4, peel: 4, teamfight: 3 },
  Thresh: { pick: 5, peel: 4, engage: 3 },
  Varus: { poke: 5, pick: 3, siege: 2 },
  Vayne: { scaling: 4, selfpeel: 2, damage: 3 },
  Velkoz: { poke: 5, siege: 3, damage: 2 },
  Viego: { skirmish: 5, damage: 3, scaling: 2 },
  Xayah: { selfpeel: 5, teamfight: 3, safe: 2 },
  Xerath: { poke: 5, siege: 4 },
  Yuumi: { protect: 5, scaling: 3, safe: 2 },
  Zac: { engage: 5, teamfight: 4, frontline: 3 },
  Ziggs: { siege: 5, poke: 4, scaling: 2 },
  Zilean: { protect: 4, peel: 3, scaling: 2 }
};

function addTagScore(scores, tag, value) {
  if (!value) return;
  scores[tag] = (scores[tag] || 0) + value;
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferRoleScores(champion, meraki) {
  const tags = champion.tags || [];
  const range = champion.stats?.attackrange || champion.stats?.attackRange?.flat || 125;
  const isRanged = range >= 425;
  const scores = { top: 0, jungle: 0, mid: 0, adc: 0, support: 0 };

  if (tags.includes("Marksman")) {
    scores.adc += 1;
    scores.mid += isRanged ? 0.25 : 0;
  }
  if (tags.includes("Support")) {
    scores.support += 1;
    scores.mid += tags.includes("Mage") ? 0.2 : 0;
  }
  if (tags.includes("Mage")) {
    scores.mid += 0.9;
    scores.support += isRanged ? 0.2 : 0;
    scores.jungle += mageJunglers.has(champion.id) ? 0.65 : 0;
  }
  if (tags.includes("Assassin")) {
    scores.mid += 0.55;
    scores.jungle += 0.55;
    scores.top += isRanged ? 0.15 : 0.35;
  }
  if (tags.includes("Fighter")) {
    scores.top += 0.85;
    scores.jungle += 0.55;
    scores.mid += isRanged ? 0.15 : 0.25;
  }
  if (tags.includes("Tank")) {
    scores.top += 0.7;
    scores.jungle += 0.55;
    scores.support += tags.includes("Support") ? 0.35 : 0.2;
  }

  if (rangedMidMarksmen.has(champion.id)) scores.mid += 0.55;
  if (topOnlyChampions.has(champion.id)) scores.top += 0.35;
  if (jungleOnlyChampions.has(champion.id)) scores.jungle += 0.45;
  if (supportOnlyChampions.has(champion.id)) scores.support += 0.45;
  if (adcOnlyChampions.has(champion.id)) scores.adc += 0.35;
  if (midOnlyChampions.has(champion.id)) scores.mid += 0.35;
  if (range < 250) scores.support -= 0.08;

  (meraki.positions || []).forEach((position) => {
    const role = Object.entries(riotRoleMap).find(([, value]) => value === position)?.[0];
    if (role) scores[role] += 1.25;
  });

  return scores;
}

function buildTextBlob(champion, meraki) {
  const spells = champion.spells || [];
  const spellText = spells
    .map((spell) => `${spell.name || ""} ${spell.description || ""} ${spell.tooltip || ""}`)
    .join(" ");
  const passiveText = `${champion.passive?.name || ""} ${champion.passive?.description || ""}`;
  const tips = [...(champion.allytips || []), ...(champion.enemytips || [])].join(" ");
  const merakiAbilities = Object.values(meraki.abilities || {})
    .flat()
    .map((ability) =>
      `${ability.name || ""} ${ability.blurb || ""} ${(ability.effects || []).map((e) => e.description || "").join(" ")}`
    )
    .join(" ");

  return `${champion.blurb || ""} ${passiveText} ${spellText} ${tips} ${merakiAbilities}`.toLowerCase();
}

function inferStrategicTags(champion, meraki) {
  const scores = {};
  const classes = champion.tags || [];
  const range = champion.stats?.attackrange || meraki.stats?.attackRange?.flat || 125;
  const isRanged = range >= 425;
  const text = buildTextBlob(champion, meraki);

  if (classes.includes("Tank")) {
    addTagScore(scores, "frontline", 4);
    addTagScore(scores, "engage", 3);
    addTagScore(scores, "cc", 3);
    addTagScore(scores, "teamfight", 3);
    addTagScore(scores, "safe", 2);
    addTagScore(scores, "wombo", 2);
  }
  if (classes.includes("Support")) {
    addTagScore(scores, "protect", 3);
    addTagScore(scores, "peel", 3);
    addTagScore(scores, "pick", 1);
    addTagScore(scores, "cc", 2);
    addTagScore(scores, "safe", 2);
  }
  if (classes.includes("Marksman")) {
    addTagScore(scores, "damage", 4);
    addTagScore(scores, "scaling", 3);
    addTagScore(scores, "teamfight", 2);
    addTagScore(scores, "safe", 2);
    if (isRanged) {
      addTagScore(scores, "poke", 1);
      addTagScore(scores, "siege", 2);
      addTagScore(scores, "lane", 2);
    }
  }
  if (classes.includes("Mage")) {
    addTagScore(scores, "damage", 3);
    addTagScore(scores, "cc", 2);
    addTagScore(scores, "teamfight", 2);
    addTagScore(scores, "pick", 2);
    if (isRanged) {
      addTagScore(scores, "poke", 2);
      addTagScore(scores, "scaling", 2);
    }
  }
  if (classes.includes("Assassin")) {
    addTagScore(scores, "pick", 3);
    addTagScore(scores, "burst", 4);
    addTagScore(scores, "mobility", 3);
    addTagScore(scores, "damage", 2);
    addTagScore(scores, "spicy", 3);
  }
  if (classes.includes("Fighter")) {
    addTagScore(scores, "damage", 3);
    addTagScore(scores, "frontline", 2);
    addTagScore(scores, "teamfight", 2);
    addTagScore(scores, "skirmish", 4);
  }
  if (isRanged && !classes.includes("Tank")) {
    addTagScore(scores, "safe", 1);
  }

  if (containsAny(text, crowdControlKeywords)) addTagScore(scores, "cc", 4);
  if (containsAny(text, engageKeywords)) addTagScore(scores, "engage", 4);
  if (containsAny(text, mobilityKeywords)) addTagScore(scores, "mobility", 3);
  if (containsAny(text, protectKeywords)) {
    addTagScore(scores, "protect", 4);
    addTagScore(scores, "peel", 3);
    addTagScore(scores, "safe", 2);
  }
  if (containsAny(text, selfPeelKeywords)) {
    addTagScore(scores, "selfpeel", 4);
    addTagScore(scores, "safe", 2);
  }
  if (containsAny(text, burstKeywords)) {
    addTagScore(scores, "burst", 3);
    addTagScore(scores, "damage", 2);
  }
  if (containsAny(text, pokeKeywords) || range >= 575) {
    addTagScore(scores, "poke", 3);
    addTagScore(scores, "siege", 2);
  }
  if (containsAny(text, sustainKeywords)) {
    addTagScore(scores, "safe", 2);
    addTagScore(scores, "frontline", classes.includes("Tank") || classes.includes("Fighter") ? 1 : 0);
  }
  if (containsAny(text, teamfightKeywords)) {
    addTagScore(scores, "teamfight", 3);
    addTagScore(scores, "wombo", 2);
  }
  if (containsAny(text, scalingKeywords)) addTagScore(scores, "scaling", 2);
  if (range >= 600) addTagScore(scores, "lane", 1);

  const ratings = meraki.attributeRatings || {};
  addTagScore(scores, "damage", (ratings.damage || 0) * 0.7);
  addTagScore(scores, "mobility", (ratings.mobility || 0) * 0.6);
  addTagScore(scores, "cc", (ratings.control || 0) * 0.7);
  addTagScore(scores, "protect", (ratings.utility || 0) * 0.5);
  addTagScore(scores, "frontline", (ratings.toughness || 0) * 0.6);

  const merakiRoles = meraki.roles || [];
  if (merakiRoles.includes("BURST")) addTagScore(scores, "burst", 3);
  if (merakiRoles.includes("CATCHER")) addTagScore(scores, "pick", 3);
  if (merakiRoles.includes("ENGAGE")) addTagScore(scores, "engage", 3);
  if (merakiRoles.includes("ENCHANTER")) {
    addTagScore(scores, "protect", 4);
    addTagScore(scores, "peel", 3);
  }
  if (merakiRoles.includes("BATTLEMAGE")) addTagScore(scores, "teamfight", 2);
  if (merakiRoles.includes("ARTILLERY")) {
    addTagScore(scores, "poke", 4);
    addTagScore(scores, "siege", 3);
  }
  if (merakiRoles.includes("DIVER")) {
    addTagScore(scores, "engage", 3);
    addTagScore(scores, "followup", 2);
  }
  if (merakiRoles.includes("JUGGERNAUT")) addTagScore(scores, "frontline", 2);
  if (merakiRoles.includes("SKIRMISHER")) addTagScore(scores, "skirmish", 4);

  Object.entries(championTagOverrides[champion.id] || {}).forEach(([tag, value]) => {
    addTagScore(scores, tag, value);
  });

  return Object.entries(scores)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

function clampScore(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, Number(value.toFixed(1))));
}

function scoreToLabel(score, bands) {
  for (const [threshold, label] of bands) {
    if (score >= threshold) {
      return label;
    }
  }

  return bands[bands.length - 1][1];
}

function getTopLabels(entries, limit = 4) {
  return entries
    .filter(([, score]) => score >= 4.5)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label]) => label);
}

function derivePowerWindows({ early, mid, late }) {
  const windows = [];
  const highest = Math.max(early, mid, late);

  if (early >= 6.2) windows.push("early");
  if (mid >= 6.2) windows.push("midgame");
  if (late >= 6.2) windows.push("lategame");

  if (!windows.length) {
    if (highest === early) windows.push("early");
    else if (highest === mid) windows.push("midgame");
    else windows.push("lategame");
  }

  if (windows.length === 1) {
    if (windows[0] !== "early" && early >= highest - 0.4 && early >= 6) windows.push("early");
    if (windows[0] !== "midgame" && mid >= highest - 0.4 && mid >= 6) windows.push("midgame");
    if (windows[0] !== "lategame" && late >= highest - 0.4 && late >= 6) windows.push("lategame");
  }

  return windows.slice(0, 2);
}

function inferChampionKnowledge(champion, meraki, strategicTags) {
  const tagSet = new Set(strategicTags);
  const text = buildTextBlob(champion, meraki);
  const ratings = meraki.attributeRatings || {};
  const attackRange = champion.stats?.attackrange || meraki.stats?.attackRange?.flat || 125;
  const isRanged = attackRange >= 425;
  const isLongRange = attackRange >= 575;
  const toughness = ratings.toughness || 0;
  const mobility = ratings.mobility || 0;
  const control = ratings.control || 0;
  const utility = ratings.utility || 0;
  const damage = ratings.damage || 0;
  const classes = champion.tags || [];
  const merakiRoles = meraki.roles || [];

  const lanePressure = clampScore(
    (tagSet.has("lane") ? 2.5 : 0) +
    (tagSet.has("poke") ? 1.8 : 0) +
    (tagSet.has("damage") ? 1.2 : 0) +
    (tagSet.has("pick") ? 0.8 : 0) +
    (tagSet.has("skirmish") ? 1.1 : 0) +
    (tagSet.has("engage") ? 0.8 : 0) +
    (classes.includes("Fighter") ? 1.2 : 0) +
    (classes.includes("Tank") ? 0.9 : 0) +
    (control * 0.45) +
    (isLongRange ? 1.2 : isRanged ? 0.5 : 0) -
    (merakiRoles.includes("ENCHANTER") ? 1.4 : 0)
  );

  const earlyPower = clampScore(
    lanePressure * 0.55 +
    (tagSet.has("burst") ? 1.8 : 0) +
    (tagSet.has("engage") ? 1.2 : 0) +
    (tagSet.has("skirmish") ? 1.4 : 0) +
    (mobility * 0.35)
  );

  const midGamePower = clampScore(
    (tagSet.has("teamfight") ? 2 : 0) +
    (tagSet.has("skirmish") ? 1.7 : 0) +
    (tagSet.has("engage") ? 1.2 : 0) +
    (tagSet.has("pick") ? 1.1 : 0) +
    (damage * 0.6)
  );

  const lateGamePower = clampScore(
    (tagSet.has("scaling") ? 2.8 : 0) +
    (tagSet.has("teamfight") ? 1.4 : 0) +
    (tagSet.has("protect") ? 0.9 : 0) +
    (isLongRange ? 1.2 : 0) +
    (damage * 0.45)
  );

  const engage = clampScore(
    (tagSet.has("engage") ? 3.4 : 0) +
    (tagSet.has("followup") ? 1 : 0) +
    (mobility * 0.5) +
    (control * 0.4)
  ) * (merakiRoles.includes("ENCHANTER") && !merakiRoles.includes("ENGAGE") && !merakiRoles.includes("DIVER") ? 0.45 : 1);

  const peel = clampScore(
    (tagSet.has("peel") ? 3.2 : 0) +
    (tagSet.has("protect") ? 1.8 : 0) +
    (tagSet.has("selfpeel") ? 1 : 0) +
    (control * 0.45) +
    (utility * 0.4)
  );

  const poke = clampScore(
    (tagSet.has("poke") ? 3.2 : 0) +
    (tagSet.has("siege") ? 1.8 : 0) +
    (isLongRange ? 1.8 : isRanged ? 0.5 : 0)
  );

  const burstProfile = clampScore(
    (tagSet.has("burst") ? 3 : 0) +
    (tagSet.has("pick") ? 1 : 0) +
    (damage * 0.55)
  );

  const sustainedDamage = clampScore(
    (tagSet.has("damage") ? 2.4 : 0) +
    (tagSet.has("scaling") ? 1.1 : 0) +
    ((classes.includes("Marksman") || classes.includes("Fighter")) ? 2 : 0) +
    (damage * 0.45)
  );

  const safety = clampScore(
    (tagSet.has("safe") ? 2.6 : 0) +
    (tagSet.has("selfpeel") ? 2 : 0) +
    (tagSet.has("protect") ? 0.8 : 0) +
    (mobility * 0.45) +
    (toughness * 0.35)
  );

  const frontline = clampScore(
    (tagSet.has("frontline") ? 3 : 0) +
    (classes.includes("Tank") ? 2 : 0) +
    (toughness * 0.75)
  );

  const catchPower = clampScore(
    (tagSet.has("pick") ? 2.6 : 0) +
    (tagSet.has("cc") ? 1.2 : 0) +
    (containsAny(text, catchKeywords) ? 1.5 : 0) +
    (control * 0.55)
  );

  const waveclear = clampScore(
    (containsAny(text, waveclearKeywords) ? 2.8 : 0) +
    (tagSet.has("siege") ? 1 : 0) +
    (tagSet.has("poke") ? 0.8 : 0) +
    (damage * 0.35)
  );

  const objectiveControl = clampScore(
    (containsAny(text, objectiveKeywords) ? 2.4 : 0) +
    (tagSet.has("siege") ? 1.5 : 0) +
    (sustainedDamage * 0.35) +
    (frontline * 0.15)
  );

  const scaling = clampScore(
    (tagSet.has("scaling") ? 3.5 : 0) +
    (lateGamePower * 0.45)
  );

  const mobilityProfile = clampScore(
    (tagSet.has("mobility") ? 2.8 : 0) +
    (mobility * 0.8)
  );

  const powerCurve = {
    early: earlyPower,
    mid: midGamePower,
    late: lateGamePower,
    windows: derivePowerWindows({ early: earlyPower, mid: midGamePower, late: lateGamePower })
  };

  const laneProfile = scoreToLabel(lanePressure, [
    [7.5, "forte"],
    [5.2, "stable"],
    [0, "faible"]
  ]);

  const strengths = getTopLabels([
    ["lane priority", lanePressure],
    ["engage", engage],
    ["peel", peel],
    ["poke", poke],
    ["burst", burstProfile],
    ["dps", sustainedDamage],
    ["catch", catchPower],
    ["frontline", frontline],
    ["safety", safety],
    ["mobility", mobilityProfile],
    ["scaling", scaling],
    ["waveclear", waveclear]
  ], 5);

  const weaknesses = [];
  if (!isRanged && safety <= 3.8 && mobilityProfile <= 4.2) weaknesses.push("short range");
  if (mobilityProfile <= 3.2 && !tagSet.has("selfpeel")) weaknesses.push("low mobility");
  if (frontline <= 3.2 && safety <= 3.8) weaknesses.push("fragile");
  if (waveclear <= 3.5) weaknesses.push("weak waveclear");
  if (earlyPower <= 4.2) weaknesses.push("weak early");
  if (lateGamePower <= 4.2) weaknesses.push("limited late scaling");
  if (peel <= 3 && !tagSet.has("protect")) weaknesses.push("limited peel");
  if (containsAny(text, ["skillshot", "missile", "projectile"]) && !tagSet.has("safe")) {
    weaknesses.push("execution sensitive");
  }

  const blindReliability = clampScore(
    safety * 0.4 +
    waveclear * 0.25 +
    ((laneProfile === "forte" || laneProfile === "stable") ? 1.6 : 0.8) +
    (isLongRange ? 0.8 : 0) -
    (weaknesses.includes("execution sensitive") ? 1.2 : 0) -
    (weaknesses.includes("short range") ? 0.8 : 0)
  );

  const resourceDemand = clampScore(
    sustainedDamage * 0.35 +
    burstProfile * 0.2 +
    scaling * 0.25 +
    (classes.includes("Marksman") ? 1.4 : 0) +
    (merakiRoles.includes("ASSASSIN") ? 1.2 : 0) -
    (merakiRoles.includes("ENCHANTER") ? 1.6 : 0)
  );

  const needsSetup = clampScore(
    burstProfile * 0.3 +
    catchPower * 0.2 +
    (tagSet.has("followup") ? 2 : 0) +
    (containsAny(text, ["channel", "windup", "delay"]) ? 1.3 : 0) -
    mobilityProfile * 0.15
  );

  const needsFrontline = clampScore(
    sustainedDamage * 0.35 +
    scaling * 0.2 +
    (isRanged ? 1 : 0) +
    (safety <= 5 ? 2 : 0) -
    peel * 0.15
  );

  const antiDive = clampScore(
    peel * 0.45 +
    safety * 0.2 +
    (tagSet.has("selfpeel") ? 1.6 : 0) +
    frontline * 0.15
  );

  const antiPoke = clampScore(
    (sustainKeywords.some((keyword) => text.includes(keyword)) ? 2 : 0) +
    waveclear * 0.2 +
    safety * 0.2 +
    (tagSet.has("protect") ? 1.2 : 0)
  );

  const roamPower = clampScore(
    mobilityProfile * 0.35 +
    catchPower * 0.25 +
    engage * 0.15 +
    (powerCurve.early * 0.15) +
    (laneProfile === "forte" ? 1 : laneProfile === "stable" ? 0.5 : 0)
  );

  const sideLaneValue = clampScore(
    mobilityProfile * 0.2 +
    sustainedDamage * 0.2 +
    burstProfile * 0.15 +
    safety * 0.15 +
    (classes.includes("Fighter") || merakiRoles.includes("SKIRMISHER") ? 1.8 : 0)
  );

  const objectiveValue = clampScore(
    objectiveControl * 0.55 +
    lanePressure * 0.15 +
    waveclear * 0.15 +
    powerCurve.mid * 0.15
  );

  return {
    laneProfile,
    powerCurve,
    combatProfile: {
      engage,
      peel,
      poke,
      burst: burstProfile,
      sustainedDamage,
      catch: catchPower,
      waveclear,
      objectiveControl
    },
    utilityProfile: {
      safety,
      mobility: mobilityProfile,
      frontline,
      scaling
    },
    draftProfile: {
      blindReliability,
      resourceDemand,
      needsSetup,
      needsFrontline,
      antiDive,
      antiPoke,
      roamPower,
      sideLaneValue,
      objectiveValue
    },
    strengths: strengths.slice(0, 5),
    weaknesses: [...new Set(weaknesses)].slice(0, 5)
  };
}

function inferDamageType(champion, meraki) {
  if (meraki.adaptiveType === "MAGIC_DAMAGE") return "ap";
  if (meraki.adaptiveType === "PHYSICAL_DAMAGE") return "ad";
  const magic = champion.info?.magic || 0;
  const attack = champion.info?.attack || 0;
  return magic > attack ? "ap" : "ad";
}

const profiles = {};

Object.values(champions.data).forEach((champion) => {
  const full = championsFull.data[champion.id] || champion;
  const meraki = merakiChampions[champion.id] || {};
  const roleScores = inferRoleScores(full, meraki);
  const strategicTags = inferStrategicTags(full, meraki);
  const knowledge = inferChampionKnowledge(full, meraki, strategicTags);
  const sortedRoles = roleOrder
    .map((role) => [role, roleScores[role] || 0])
    .filter(([, score]) => score >= 0.5)
    .sort((a, b) => b[1] - a[1]);

  profiles[champion.id] = {
    id: champion.id,
    name: champion.name,
    imageId: champion.id,
    damageType: inferDamageType(full, meraki),
    classes: champion.tags || [],
    attackType: meraki.attackType || (full.stats?.attackrange >= 425 ? "RANGED" : "MELEE"),
    positions: meraki.positions || [],
    roles: meraki.roles || [],
    attributeRatings: meraki.attributeRatings || {},
    range: full.stats?.attackrange || meraki.stats?.attackRange?.flat || 125,
    roleScores,
    eligibleRoles: sortedRoles.map(([role]) => role),
    strategicTags,
    displayTags: strategicTags.slice(0, 6),
    knowledge
  };
});

fs.writeFileSync(
  path.join(dataDir, "champion-profiles.json"),
  JSON.stringify(profiles, null, 2) + "\n",
  "utf8"
);

console.log(`Generated ${Object.keys(profiles).length} champion profiles.`);
