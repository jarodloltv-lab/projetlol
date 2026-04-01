const championPool = {
  top: [
    createChampion("Ornn", "top", ["frontline", "engage", "cc", "teamfight", "safe"], "ap"),
    createChampion("Malphite", "top", ["engage", "wombo", "frontline", "cc", "safe"], "ap"),
    createChampion("Aatrox", "top", ["skirmish", "damage", "frontline", "spicy"], "ad"),
    createChampion("Gnar", "top", ["teamfight", "cc", "poke", "safe"], "ad"),
    createChampion("Camille", "top", ["pick", "splitpush", "damage", "spicy"], "ad")
  ],
  jungle: [
    createChampion("Jarvan IV", "jungle", ["engage", "wombo", "cc", "teamfight", "safe"], "ad"),
    createChampion("Sejuani", "jungle", ["frontline", "engage", "cc", "teamfight", "safe"], "ap"),
    createChampion("Maokai", "jungle", ["engage", "pick", "cc", "teamfight", "safe"], "ap"),
    createChampion("Lee Sin", "jungle", ["pick", "early", "damage", "spicy"], "ad"),
    createChampion("Viego", "jungle", ["skirmish", "scaling", "damage", "balanced"], "ad")
  ],
  mid: [
    createChampion("Orianna", "mid", ["teamfight", "wombo", "scaling", "safe"], "ap"),
    createChampion("Ahri", "mid", ["pick", "mobility", "cc", "balanced"], "ap"),
    createChampion("Azir", "mid", ["poke", "scaling", "damage", "safe"], "ap"),
    createChampion("Syndra", "mid", ["pick", "burst", "damage", "balanced"], "ap"),
    createChampion("Yone", "mid", ["engage", "wombo", "damage", "spicy"], "ad")
  ],
  adc: [
    createChampion("Jinx", "adc", ["scaling", "teamfight", "damage", "safe"], "ad"),
    createChampion("Kai'Sa", "adc", ["followup", "teamfight", "damage", "balanced"], "ad"),
    createChampion("Caitlyn", "adc", ["poke", "siege", "lane", "safe"], "ad"),
    createChampion("Xayah", "adc", ["teamfight", "selfpeel", "safe", "damage"], "ad"),
    createChampion("Varus", "adc", ["poke", "pick", "damage", "balanced"], "ad")
  ],
  support: [
    createChampion("Rell", "support", ["engage", "wombo", "cc", "frontline", "safe"], "ap"),
    createChampion("Nautilus", "support", ["engage", "pick", "cc", "frontline", "safe"], "ap"),
    createChampion("Lulu", "support", ["protect", "scaling", "safe", "peel"], "ap"),
    createChampion("Thresh", "support", ["pick", "peel", "cc", "balanced"], "ap"),
    createChampion("Karma", "support", ["poke", "siege", "protect", "balanced"], "ap")
  ]
};

const styleProfiles = {
  teamfight: {
    title: "Teamfight stable",
    desiredTags: ["teamfight", "engage", "cc", "frontline", "scaling"],
    avoidTags: ["splitpush"]
  },
  pick: {
    title: "Pick / Catch",
    desiredTags: ["pick", "cc", "mobility", "burst", "followup"],
    avoidTags: ["splitpush"]
  },
  poke: {
    title: "Poke / Siege",
    desiredTags: ["poke", "siege", "lane", "scaling", "protect"],
    avoidTags: ["wombo"]
  },
  wombo: {
    title: "Wombo Combo",
    desiredTags: ["wombo", "engage", "teamfight", "cc", "followup"],
    avoidTags: ["splitpush"]
  },
  protect: {
    title: "Protect the Carry",
    desiredTags: ["protect", "scaling", "frontline", "peel", "teamfight"],
    avoidTags: ["splitpush"]
  }
};

const priorityTags = {
  engage: ["engage", "followup"],
  damage: ["damage", "burst"],
  frontline: ["frontline", "safe"],
  cc: ["cc", "pick"],
  scaling: ["scaling", "safe"]
};

const riskTags = {
  safe: ["safe"],
  balanced: ["balanced", "safe"],
  spicy: ["spicy", "damage", "mobility"]
};

const roleOrder = ["top", "jungle", "mid", "adc", "support"];
const roleLabels = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  adc: "ADC",
  support: "Support"
};

const elements = {
  styleSelect: document.getElementById("styleSelect"),
  riskSelect: document.getElementById("riskSelect"),
  prioritySelect: document.getElementById("prioritySelect"),
  generateBtn: document.getElementById("generateBtn"),
  compTitle: document.getElementById("compTitle"),
  scoreValue: document.getElementById("scoreValue"),
  compositionGrid: document.getElementById("compositionGrid"),
  strengthList: document.getElementById("strengthList"),
  warningList: document.getElementById("warningList"),
  summaryText: document.getElementById("summaryText")
};

elements.generateBtn.addEventListener("click", generateComposition);
generateComposition();

function createChampion(name, role, tags, damageType) {
  return { name, role, tags, damageType };
}

function generateComposition() {
  const style = elements.styleSelect.value;
  const risk = elements.riskSelect.value;
  const priority = elements.prioritySelect.value;
  const profile = styleProfiles[style];

  let best = null;

  for (let attempt = 0; attempt < 250; attempt += 1) {
    const composition = roleOrder.map((role) => pickChampion(role, profile, risk, priority));
    const evaluation = evaluateComposition(composition, profile, risk, priority);

    if (!best || evaluation.score > best.score) {
      best = { composition, ...evaluation };
    }
  }

  renderComposition(best, profile);
}

function pickChampion(role, profile, risk, priority) {
  const candidates = championPool[role]
    .map((champion) => ({
      champion,
      weight: scoreChampionFit(champion, profile, risk, priority)
    }))
    .sort((a, b) => b.weight - a.weight);

  const topSlice = candidates.slice(0, 3);
  const picked = topSlice[Math.floor(Math.random() * topSlice.length)];
  return picked.champion;
}

function scoreChampionFit(champion, profile, risk, priority) {
  let score = 10;

  profile.desiredTags.forEach((tag) => {
    if (champion.tags.includes(tag)) {
      score += 5;
    }
  });

  profile.avoidTags.forEach((tag) => {
    if (champion.tags.includes(tag)) {
      score -= 3;
    }
  });

  priorityTags[priority].forEach((tag) => {
    if (champion.tags.includes(tag)) {
      score += 3;
    }
  });

  riskTags[risk].forEach((tag) => {
    if (champion.tags.includes(tag)) {
      score += 2;
    }
  });

  return score + Math.random() * 2;
}

function evaluateComposition(composition, profile, risk, priority) {
  const allTags = composition.flatMap((champion) => champion.tags);
  const damageTypes = composition.map((champion) => champion.damageType);
  const score = computeScore(allTags, damageTypes, profile, risk, priority);
  const strengths = buildStrengths(allTags, damageTypes, profile, priority);
  const warnings = buildWarnings(allTags, damageTypes, risk);
  const summary = buildSummary(composition, profile, score, strengths, warnings);

  return { score, strengths, warnings, summary };
}

function computeScore(allTags, damageTypes, profile, risk, priority) {
  let total = 58;

  profile.desiredTags.forEach((tag) => {
    total += countTag(allTags, tag) * 4;
  });

  priorityTags[priority].forEach((tag) => {
    total += countTag(allTags, tag) * 3;
  });

  if (countTag(allTags, "frontline") >= 2) {
    total += 10;
  }

  if (countTag(allTags, "engage") >= 2) {
    total += 8;
  }

  if (countTag(allTags, "cc") >= 3) {
    total += 8;
  }

  if (countTag(allTags, "protect") >= 1 && countTag(allTags, "scaling") >= 2) {
    total += 6;
  }

  if (damageTypes.includes("ad") && damageTypes.includes("ap")) {
    total += 10;
  }

  if (risk === "spicy" && countTag(allTags, "spicy") >= 2) {
    total += 5;
  }

  if (risk === "safe" && countTag(allTags, "safe") >= 3) {
    total += 5;
  }

  return Math.min(99, total);
}

function buildStrengths(allTags, damageTypes, profile, priority) {
  const strengths = [];

  if (countTag(allTags, "frontline") >= 2) {
    strengths.push("Deux vraies sources de frontline pour absorber l'entree de fight.");
  }

  if (countTag(allTags, "engage") >= 2) {
    strengths.push("Engage clair et facile a executer en combat d'equipe.");
  }

  if (countTag(allTags, "cc") >= 3) {
    strengths.push("Beaucoup de controle pour verrouiller une cible.");
  }

  if (countTag(allTags, "scaling") >= 2) {
    strengths.push("Bonne montee en puissance pour les fights de milieu et fin de partie.");
  }

  if (countTag(allTags, "poke") >= 2) {
    strengths.push("Pression a distance utile avant un objectif.");
  }

  if (damageTypes.includes("ad") && damageTypes.includes("ap")) {
    strengths.push("Repartition AD / AP assez saine pour compliquer l'itemisation adverse.");
  }

  if (!strengths.length) {
    strengths.push(`Composition coherente avec une priorite marquee sur ${priority}.`);
  }

  return strengths.slice(0, 4);
}

function buildWarnings(allTags, damageTypes, risk) {
  const warnings = [];

  if (countTag(allTags, "protect") === 0 && countTag(allTags, "selfpeel") === 0) {
    warnings.push("Peu d'outils defensifs pour proteger le carry si la draft adverse dive fort.");
  }

  if (countTag(allTags, "frontline") < 2) {
    warnings.push("Frontline limitee, les fights longs peuvent etre plus difficiles.");
  }

  if (countTag(allTags, "engage") === 0) {
    warnings.push("Pas d'engage net, la comp dependra plus des erreurs ennemies.");
  }

  if (damageTypes.filter((type) => type === "ap").length >= 4) {
    warnings.push("Profil de degats trop AP, facile a contrer avec de la resistance magique.");
  }

  if (risk === "spicy" && countTag(allTags, "safe") <= 1) {
    warnings.push("Execution exigeante: il faut prendre le tempo rapidement.");
  }

  if (!warnings.length) {
    warnings.push("Alerte majeure absente: la comp reste assez stable si les lanes se passent correctement.");
  }

  return warnings.slice(0, 4);
}

function buildSummary(composition, profile, score, strengths, warnings) {
  const engageCore = composition
    .filter((champion) => champion.tags.includes("engage") || champion.tags.includes("pick"))
    .map((champion) => champion.name)
    .slice(0, 2)
    .join(" et ");

  return `Cette draft ${profile.title.toLowerCase()} vise un plan de jeu simple. ` +
    `Le coeur de l'action repose surtout sur ${engageCore || composition[0].name}. ` +
    `Le score ${score}/99 vient principalement de ${strengths[0].toLowerCase()} ` +
    `Attention surtout a: ${warnings[0].toLowerCase()}`;
}

function renderComposition(result, profile) {
  elements.compTitle.textContent = profile.title;
  elements.scoreValue.textContent = result.score;
  elements.summaryText.textContent = result.summary;
  elements.compositionGrid.innerHTML = result.composition.map(renderChampionCard).join("");
  elements.strengthList.innerHTML = result.strengths.map((item) => `<li>${item}</li>`).join("");
  elements.warningList.innerHTML = result.warnings.map((item) => `<li class="warning">${item}</li>`).join("");
}

function renderChampionCard(champion) {
  const visibleTags = champion.tags.slice(0, 3);

  return `
    <article class="champion-card">
      <span class="champion-role">${roleLabels[champion.role]}</span>
      <h3 class="champion-name">${champion.name}</h3>
      <div class="champion-tags">
        ${visibleTags.map((tag) => `<span>${formatTag(tag)}</span>`).join("")}
      </div>
    </article>
  `;
}

function countTag(tags, target) {
  return tags.filter((tag) => tag === target).length;
}

function formatTag(tag) {
  const labels = {
    frontline: "Frontline",
    engage: "Engage",
    cc: "CC",
    teamfight: "Teamfight",
    safe: "Safe",
    wombo: "Wombo",
    damage: "Damage",
    pick: "Pick",
    scaling: "Scaling",
    protect: "Protect",
    peel: "Peel",
    poke: "Poke",
    siege: "Siege",
    burst: "Burst",
    mobility: "Mobility",
    followup: "Follow Up"
  };

  return labels[tag] || tag;
}
