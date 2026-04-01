import championProfiles from "../data/champion-profiles.json";
import botlaneSynergies from "../data/botlane-synergies.json";
import botlaneProfiles from "../data/botlane-profiles.json";

export const dataDragonVersion = "16.6.1";

export const styleProfiles = {
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

export const priorityTags = {
  engage: ["engage", "followup"],
  damage: ["damage", "burst"],
  frontline: ["frontline", "safe"],
  cc: ["cc", "pick"],
  scaling: ["scaling", "safe"]
};

export const riskTags = {
  safe: ["safe"],
  balanced: ["balanced", "safe"],
  spicy: ["spicy", "damage", "mobility"]
};

export const roleOrder = ["top", "jungle", "mid", "adc", "support"];

export const roleLabels = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  adc: "ADC",
  support: "Support"
};

const soloRoles = ["top", "jungle", "mid"];

const riotRoleMap = {
  top: "TOP",
  jungle: "JUNGLE",
  mid: "MIDDLE",
  adc: "BOTTOM",
  support: "UTILITY"
};

const rolePositionAliases = {
  top: ["TOP"],
  jungle: ["JUNGLE"],
  mid: ["MIDDLE"],
  adc: ["BOTTOM", "ADC"],
  support: ["SUPPORT", "UTILITY"]
};

const appRoleMap = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "mid",
  BOTTOM: "adc",
  ADC: "adc",
  SUPPORT: "support",
  UTILITY: "support"
};

export const championPool = buildChampionPool();
export const generatorChampionCount = Object.keys(championPool.uniqueChampions).length;
export const generatorPoolByRoleCount = roleOrder.reduce((accumulator, role) => {
  accumulator[role] = championPool[role].length;
  return accumulator;
}, {});
export const botlaneChampionOptions = {
  adc: championPool.adc
    .map((champion) => ({ imageId: champion.imageId, name: champion.name }))
    .sort((left, right) => left.name.localeCompare(right.name)),
  support: championPool.support
    .map((champion) => ({ imageId: champion.imageId, name: champion.name }))
    .sort((left, right) => left.name.localeCompare(right.name))
};
export const teamChampionOptions = roleOrder.reduce((accumulator, role) => {
  accumulator[role] = Object.values(championProfiles)
    .filter(
      (profile) =>
        matchesChampionRolePosition(profile, role) ||
        ((!profile.positions || !profile.positions.length) && (profile.roleScores?.[role] || 0) >= 1)
    )
    .map((profile) => ({ imageId: profile.imageId, name: profile.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return accumulator;
}, {});
export const championProfilesById = championProfiles;
export const botlaneSynergySource = `${botlaneSynergies.source} (${botlaneSynergies.tournaments.join(", ")})`;
export const botlaneProfileSource = `${botlaneProfiles.source} (${botlaneProfiles.recentWindowDays} jours)`;

export function generateBestComposition(filters, metaByChampion = {}, lockedSelection = null) {
  const profile = styleProfiles[filters.style];
  let best = null;

  for (let attempt = 0; attempt < 250; attempt += 1) {
    const usedChampionIds = new Set();
    const composition = soloRoles.map((role) => {
      const lockedChampion = resolveLockedChampion(role, lockedSelection);
      if (lockedChampion) {
        usedChampionIds.add(lockedChampion.imageId);
        return lockedChampion;
      }

      return pickChampion(role, profile, filters.risk, filters.priority, metaByChampion, usedChampionIds);
    });
    const botlane = pickBotLane(
      composition,
      profile,
      filters.risk,
      filters.priority,
      metaByChampion,
      usedChampionIds,
      {
        adc: resolveLockedChampion("adc", lockedSelection),
        support: resolveLockedChampion("support", lockedSelection)
      }
    );

    composition.push(botlane.adc, botlane.support);
    const evaluation = evaluateComposition(
      composition,
      profile,
      filters.risk,
      filters.priority,
      metaByChampion
    );

    if (!best || evaluation.score > best.score) {
      best = { composition, profile, ...evaluation };
    }
  }

  return best;
}

export function generateBestBotlane(filters, metaByChampion = {}, lockedSelection = null) {
  const profile = styleProfiles[filters.style];
  const lockedAdc =
    lockedSelection?.adcId ? championPool.lookup.adc[lockedSelection.adcId] || null : null;
  const lockedSupport =
    lockedSelection?.supportId
      ? championPool.lookup.support[lockedSelection.supportId] || null
      : null;

  if (lockedAdc && lockedSupport) {
    const lockedPair = botlanePairLookup[`${lockedAdc.imageId}::${lockedSupport.imageId}`] || null;

    return buildBotlaneResult({
      adc: lockedPair ? attachBotlaneSynergy(lockedAdc, lockedPair, "adc") : lockedAdc,
      support: lockedPair ? attachBotlaneSynergy(lockedSupport, lockedPair, "support") : lockedSupport,
      pair: lockedPair,
      profile,
      risk: filters.risk,
      priority: filters.priority,
      metaByChampion
    });
  }

  const candidates = buildBotlaneCandidates(
    profile,
    filters.risk,
    filters.priority,
    metaByChampion,
    [],
    new Set(),
    lockedSelection
    )
      .filter(Boolean)
      .sort((a, b) => b.weight - a.weight);

  if (!candidates.length) {
    const adc =
      lockedAdc
        ? lockedAdc
        : pickChampion("adc", profile, filters.risk, filters.priority, metaByChampion, new Set());
    const resolvedSupport =
      lockedSupport ||
      pickChampion(
        "support",
        profile,
        filters.risk,
        filters.priority,
        metaByChampion,
        new Set([adc.imageId, ...(lockedSupport ? [lockedSupport.imageId] : [])])
      );

    return buildBotlaneResult({
      adc,
      support: resolvedSupport,
      pair: null,
      profile,
      risk: filters.risk,
      priority: filters.priority,
      metaByChampion
    });
  }

  const topSlice = candidates.slice(0, Math.min(8, candidates.length));
  const picked = topSlice[Math.floor(Math.random() * topSlice.length)];

  return buildBotlaneResult({
    adc: attachBotlaneSynergy(picked.adcChampion, picked.pair, "adc"),
    support: attachBotlaneSynergy(picked.supportChampion, picked.pair, "support"),
    pair: picked.pair,
    profile,
    risk: filters.risk,
    priority: filters.priority,
    metaByChampion
  });
}

export function getBotlaneVariants(
  filters,
  metaByChampion = {},
  lockedSelection = null,
  limit = 3,
  excludeDuoId = null
) {
  if (!lockedSelection || (lockedSelection.adcId && lockedSelection.supportId)) {
    return [];
  }

  const profile = styleProfiles[filters.style];
  const candidates = buildBotlaneCandidates(
    profile,
    filters.risk,
    filters.priority,
    metaByChampion,
    [],
    new Set(),
    lockedSelection
  )
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight);

  const variants = [];
  const seenDuoIds = new Set();

  candidates.forEach((candidate) => {
    const duoId = candidate.pair?.duoId || `${candidate.adcChampion.imageId}::${candidate.supportChampion.imageId}`;

    if (excludeDuoId && duoId === excludeDuoId) {
      return;
    }

    if (seenDuoIds.has(duoId) || variants.length >= limit) {
      return;
    }

    seenDuoIds.add(duoId);
    variants.push(
      buildBotlaneResult({
        adc: attachBotlaneSynergy(candidate.adcChampion, candidate.pair, "adc"),
        support: attachBotlaneSynergy(candidate.supportChampion, candidate.pair, "support"),
        pair: candidate.pair,
        profile,
        risk: filters.risk,
        priority: filters.priority,
        metaByChampion
      })
    );
  });

  if (variants.length < limit) {
    const fallbackChampions = lockedSelection?.supportId
      ? championPool.adc
      : championPool.support;

    fallbackChampions
      .map((champion) => {
        const adcChampion = lockedSelection?.supportId
          ? champion
          : championPool.lookup.adc[lockedSelection?.adcId];
        const supportChampion = lockedSelection?.supportId
          ? championPool.lookup.support[lockedSelection.supportId]
          : champion;

        if (!adcChampion || !supportChampion) {
          return null;
        }

        const pair =
          botlanePairLookup[`${adcChampion.imageId}::${supportChampion.imageId}`] || null;

        return {
          adcChampion,
          supportChampion,
          pair,
          duoId: pair?.duoId || `${adcChampion.imageId}::${supportChampion.imageId}`,
          weight:
            scoreChampionFit(adcChampion, "adc", profile, filters.risk, filters.priority, metaByChampion) +
            scoreChampionFit(
              supportChampion,
              "support",
              profile,
              filters.risk,
              filters.priority,
              metaByChampion
            ) +
            (pair
              ? scoreBotLanePair(
                  pair,
                  adcChampion,
                  supportChampion,
                  [],
                  profile,
                  filters.priority,
                  metaByChampion
                )
              : getFallbackBotlaneVariantScore(adcChampion, supportChampion, metaByChampion))
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.weight - a.weight)
      .forEach((candidate) => {
        if (variants.length >= limit || seenDuoIds.has(candidate.duoId) || candidate.duoId === excludeDuoId) {
          return;
        }

        seenDuoIds.add(candidate.duoId);
        variants.push(
          buildBotlaneResult({
            adc: candidate.pair
              ? attachBotlaneSynergy(candidate.adcChampion, candidate.pair, "adc")
              : candidate.adcChampion,
            support: candidate.pair
              ? attachBotlaneSynergy(candidate.supportChampion, candidate.pair, "support")
              : candidate.supportChampion,
            pair: candidate.pair,
            profile,
            risk: filters.risk,
            priority: filters.priority,
            metaByChampion
          })
        );
      });
  }

  return variants;
}

export function getTopRecentBotlanes(metaByChampion = {}, limit = 8) {
  return botlanePairIndex
    .slice(0, limit)
    .map((pair) => {
      const adcChampion = championPool.lookup.adc[pair.adcId];
      const supportChampion = championPool.lookup.support[pair.supportId];

      if (!adcChampion || !supportChampion) {
        return null;
      }

      return buildBotlaneResult({
        adc: attachBotlaneSynergy(adcChampion, pair, "adc"),
        support: attachBotlaneSynergy(supportChampion, pair, "support"),
        pair,
        profile: styleProfiles.teamfight,
        risk: "balanced",
        priority: "engage",
        metaByChampion,
        scoreOverride: Math.min(99, Math.round(50 + pair.synergyScore * 0.22))
      });
    })
    .filter(Boolean);
}

export function getBotlaneDuoInsights(adc, support, pair = null) {
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adc.imageId}::${support.imageId}`);
  const tags = [...(adc.tags || []), ...(support.tags || [])];
  const insights = [];

  if (pair) {
    insights.push("Duo vu en competition recente sur les grandes ligues.");
  }
  if (performanceProfile?.laneAssessment) {
    insights.push(`Lane ${performanceProfile.laneAssessment} sur l'echantillon pro recent.`);
  }
  if (performanceProfile?.earlyAssessment) {
    insights.push(`${capitalizeFirst(performanceProfile.earlyAssessment)} sur les premiers timings.`);
  }
  if (performanceProfile?.lateAssessment) {
    insights.push(`${capitalizeFirst(performanceProfile.lateAssessment)} quand la partie s'allonge.`);
  }
  const powerWindows = formatBotlanePowerWindows(performanceProfile);
  if (powerWindows) {
    insights.push(`Pic de puissance principal: ${powerWindows}.`);
  }
  if (countTag(tags, "engage") >= 1 && countTag(tags, "followup") >= 1) {
    insights.push("Plan de lane clair en all-in avec un setup facile a connecter.");
  }
  if (countTag(tags, "poke") >= 1 && countTag(tags, "lane") >= 1) {
    insights.push("Lane forte pour prendre la priorite, gratter des PV et preparer le dragon.");
  }
  if (countTag(tags, "protect") >= 1 && countTag(tags, "scaling") >= 1) {
    insights.push("Bonne base pour jouer autour d'un carry qui monte fort avec les objets.");
  }
  if (countTag(tags, "cc") >= 2) {
    insights.push("Beaucoup de controle pour punir un mauvais pas adverse.");
  }
  if (countTag(tags, "safe") >= 1 || countTag(tags, "selfpeel") >= 1) {
    insights.push("Duo plus simple a stabiliser meme quand la lane devient tendue.");
  }
  if (countTag(tags, "damage") >= 1 && countTag(tags, "burst") >= 1) {
    insights.push("Peut convertir rapidement une ouverture en kill ou en flash force.");
  }

  if (!insights.length) {
    insights.push("Duo coherent avec un plan de jeu assez simple a lire en lane.");
  }

  return insights.slice(0, 4);
}

export function getBotlaneDuoSummary(adc, support, pair = null, metaByChampion = {}) {
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adc.imageId}::${support.imageId}`);
  const insights = getBotlaneDuoInsights(adc, support, pair);
  const rankedFallback = getBotlaneRankedFallback(adc, support, metaByChampion);
  const pairLine = pair
    ? `Il a ete joue ${pair.games} fois en competition recente. `
    : "";
  const laneLine = performanceProfile
    ? `La botlane ressort surtout sur ${formatBotlanePowerWindows(performanceProfile)}. `
    : "";
  const fallbackLine = !pair && rankedFallback
    ? `Pas encore vue dans notre echantillon pro recent, mais les deux picks tiennent la meta ranked recente. `
    : !pair
      ? `Pas encore vue dans notre echantillon pro recent. `
      : "";

  return `${adc.name} avec ${support.name} forme une botlane orientee ${inferDuoArchetype(adc, support)}. ${pairLine}${laneLine}${fallbackLine}${insights[0]}`;
}

export function getBotlanePerformanceProfile(duoId) {
  return botlaneProfilesByDuoId[duoId] || null;
}

export function getBotlanePowerWindows(duoIdOrProfile) {
  const profile =
    typeof duoIdOrProfile === "string"
      ? getBotlanePerformanceProfile(duoIdOrProfile)
      : duoIdOrProfile;

  if (!profile) {
    return [];
  }

  const windows = [];

  if (
    profile.earlyAssessment === "fort en early" ||
    profile.laneAssessment === "dominant" ||
    profile.laneAssessment === "forte"
  ) {
    windows.push("early");
  }

  if (
    profile.laneAssessment === "dominant" ||
    profile.laneAssessment === "forte" ||
    profile.lateAssessment === "plus convaincant en mid game rapide"
  ) {
    windows.push("midgame");
  }

  if (
    profile.lateAssessment === "plus convaincant en late game" ||
    profile.lateAssessment === "tient bien les parties longues"
  ) {
    windows.push("lategame");
  }

  if (!windows.length) {
    windows.push("midgame");
  }

  return [...new Set(windows)];
}

export function formatBotlanePowerWindows(duoIdOrProfile) {
  const windows = getBotlanePowerWindows(duoIdOrProfile);
  return windows.join(" + ");
}

function pickChampion(role, profile, risk, priority, metaByChampion, usedChampionIds) {
  const preferredCandidates = championPool[role]
    .filter((champion) => !usedChampionIds.has(champion.imageId))
    .filter((champion) => isEligibleForRole(champion, role, metaByChampion))
    .map((champion) => ({
      champion,
      weight: scoreChampionFit(champion, role, profile, risk, priority, metaByChampion)
    }))
    .sort((a, b) => b.weight - a.weight);

  const candidates = preferredCandidates.length
    ? preferredCandidates
    : championPool[role]
      .filter((champion) => !usedChampionIds.has(champion.imageId))
      .map((champion) => ({
        champion,
        weight: scoreChampionFit(champion, role, profile, risk, priority, metaByChampion)
      }))
      .sort((a, b) => b.weight - a.weight);

  const topSlice = candidates.slice(0, Math.min(5, candidates.length));
  const picked = topSlice[Math.floor(Math.random() * topSlice.length)];
  usedChampionIds.add(picked.champion.imageId);
  return picked.champion;
}

function pickBotLane(
  partialComposition,
  profile,
  risk,
  priority,
  metaByChampion,
  usedChampionIds,
  lockedSelection = null
) {
  return pickBotLaneWithSelection(
    partialComposition,
    profile,
    risk,
    priority,
    metaByChampion,
    usedChampionIds,
    lockedSelection
  );
}

function resolveLockedChampion(role, lockedSelection) {
  const championId = lockedSelection?.[role];
  if (!championId) {
    return null;
  }

  return championPool.lookup[role]?.[championId] || null;
}

function pickBotLaneWithSelection(
  partialComposition,
  profile,
  risk,
  priority,
  metaByChampion,
  usedChampionIds,
  lockedSelection = null
) {
  const partialTags = partialComposition.flatMap((champion) => champion.tags);
  const duoCandidates = buildBotlaneCandidates(
    profile,
    risk,
    priority,
    metaByChampion,
    partialTags,
    usedChampionIds,
    lockedSelection
  )
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight);

  if (duoCandidates.length) {
    const topSlice = duoCandidates.slice(0, Math.min(6, duoCandidates.length));
    const picked = topSlice[Math.floor(Math.random() * topSlice.length)];

    usedChampionIds.add(picked.adcChampion.imageId);
    usedChampionIds.add(picked.supportChampion.imageId);

    return {
      adc: attachBotlaneSynergy(picked.adcChampion, picked.pair, "adc"),
      support: attachBotlaneSynergy(picked.supportChampion, picked.pair, "support")
      };
  }

  const lockedAdc = lockedSelection?.adc ? lockedSelection.adc : null;
  const lockedSupport = lockedSelection?.support ? lockedSelection.support : null;
  const fallbackAdc = lockedAdc || pickChampion("adc", profile, risk, priority, metaByChampion, usedChampionIds);
  if (lockedAdc) {
    usedChampionIds.add(lockedAdc.imageId);
  }
  const resolvedSupport =
    lockedSupport ||
    pickChampion(
      "support",
      profile,
      risk,
      priority,
      metaByChampion,
      usedChampionIds
    );
  if (lockedSupport) {
    usedChampionIds.add(lockedSupport.imageId);
  }

  return { adc: fallbackAdc, support: resolvedSupport };
}

function buildBotlaneCandidates(
  profile,
  risk,
  priority,
  metaByChampion,
  partialTags = [],
  usedChampionIds = new Set(),
  lockedSelection = null
  ) {
  const lockedAdcId = lockedSelection?.adcId || lockedSelection?.adc?.imageId || null;
  const lockedSupportId = lockedSelection?.supportId || lockedSelection?.support?.imageId || null;

  return botlanePairIndex.map((pair) => {
    const adcChampion = championPool.lookup.adc[pair.adcId];
    const supportChampion = championPool.lookup.support[pair.supportId];

    if (!adcChampion || !supportChampion) {
      return null;
    }

    if (usedChampionIds.has(adcChampion.imageId) || usedChampionIds.has(supportChampion.imageId)) {
      return null;
    }

    if (!isEligibleForRole(adcChampion, "adc", metaByChampion)) {
      return null;
    }

    if (!isEligibleForRole(supportChampion, "support", metaByChampion)) {
      return null;
    }

    if (lockedAdcId && lockedAdcId !== adcChampion.imageId) {
      return null;
    }

    if (lockedSupportId && lockedSupportId !== supportChampion.imageId) {
      return null;
    }

    return {
      adcChampion,
      supportChampion,
      pair,
      weight:
        scoreChampionFit(adcChampion, "adc", profile, risk, priority, metaByChampion) +
        scoreChampionFit(supportChampion, "support", profile, risk, priority, metaByChampion) +
        scoreBotLanePair(
          pair,
          adcChampion,
          supportChampion,
          partialTags,
          profile,
          priority,
          metaByChampion
        )
    };
  });
}

function scoreChampionFit(champion, role, profile, risk, priority, metaByChampion) {
  let score = 10 + champion.roleScore * 4;
  const meta = metaByChampion[champion.imageId];
  const knowledge = champion.knowledge;

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

  if (knowledge) {
    score += getKnowledgeBonus(champion, role, profile, risk, priority);
  }

  if (meta) {
    const roleMetaScore = getMetaRoleScore(meta, role);
    const dominantRole = getDominantMetaRole(meta);

    score += Math.min(8, meta.winRate * 20);
    score += Math.min(6, meta.pickRate * 60);
    score += Math.min(4, meta.sampleWeight * 4);
    score += roleMetaScore * 12;

    if (dominantRole === role) {
      score += 6;
    } else if (dominantRole && roleMetaScore === 0 && meta.games >= 3) {
      score -= 18;
    }
  }

  return score + Math.random() * 2;
}

function getKnowledgeBonus(champion, role, profile, risk, priority) {
  const knowledge = champion.knowledge;

  if (!knowledge) {
    return 0;
  }

  const combat = knowledge.combatProfile || {};
  const utility = knowledge.utilityProfile || {};
  const power = knowledge.powerCurve || {};
  let score = 0;

  if (profile.desiredTags.includes("teamfight")) {
    score += (power.mid || 0) * 0.35 + (power.late || 0) * 0.3 + (utility.frontline || 0) * 0.15;
  }
  if (profile.desiredTags.includes("pick")) {
    score += (combat.catch || 0) * 0.5 + (combat.burst || 0) * 0.25;
  }
  if (profile.desiredTags.includes("poke")) {
    score += (combat.poke || 0) * 0.55 + (combat.waveclear || 0) * 0.15;
  }
  if (profile.desiredTags.includes("protect")) {
    score += (combat.peel || 0) * 0.45 + (utility.safety || 0) * 0.25;
  }
  if (profile.desiredTags.includes("wombo")) {
    score += (combat.engage || 0) * 0.45 + (power.mid || 0) * 0.2;
  }

  if (priority === "engage") {
    score += (combat.engage || 0) * 0.45 + (combat.catch || 0) * 0.2;
  }
  if (priority === "damage") {
    score += (combat.burst || 0) * 0.3 + (combat.sustainedDamage || 0) * 0.35;
  }
  if (priority === "frontline") {
    score += (utility.frontline || 0) * 0.55 + (utility.safety || 0) * 0.2;
  }
  if (priority === "cc") {
    score += (combat.catch || 0) * 0.4 + (combat.peel || 0) * 0.2;
  }
  if (priority === "scaling") {
    score += (utility.scaling || 0) * 0.55 + (power.late || 0) * 0.25;
  }

  if (risk === "safe") {
    score += (utility.safety || 0) * 0.45 + (combat.peel || 0) * 0.15;
  }
  if (risk === "spicy") {
    score += (power.early || 0) * 0.25 + (combat.burst || 0) * 0.2 + (combat.engage || 0) * 0.15;
  }

  if (role === "adc") {
    score += (combat.sustainedDamage || 0) * 0.25 + (power.late || 0) * 0.2;
  }
  if (role === "support") {
    score += (combat.peel || 0) * 0.2 + (combat.engage || 0) * 0.2;
  }
  if (role === "jungle") {
    score += (power.early || 0) * 0.2 + (combat.engage || 0) * 0.2;
  }
  if (role === "mid") {
    score += (power.mid || 0) * 0.15 + (combat.waveclear || 0) * 0.15;
  }
  if (role === "top") {
    score += (utility.frontline || 0) * 0.2 + (power.mid || 0) * 0.1;
  }

  return score;
}

function scoreBotLanePair(
  pair,
  adcChampion,
  supportChampion,
  partialTags,
  profile,
  priority,
  metaByChampion
) {
  let score = pair.synergyScore * 0.1;
  const adcKnowledge = adcChampion.knowledge || {};
  const supportKnowledge = supportChampion.knowledge || {};
  const adcCombat = adcKnowledge.combatProfile || {};
  const adcUtility = adcKnowledge.utilityProfile || {};
  const supportCombat = supportKnowledge.combatProfile || {};
  const supportUtility = supportKnowledge.utilityProfile || {};
  const adcDraft = adcKnowledge.draftProfile || {};
  const supportDraft = supportKnowledge.draftProfile || {};

  if (pair.games >= 2) score += 10;
  if (pair.games >= 4) score += 7;
  if (pair.games >= 8) score += 5;
  if (pair.regions?.length >= 2) score += 5;
  if (pair.tournaments?.length >= 2) score += 3;
  if (pair.freshness >= 0.75) score += 3;
  if (pair.winRate >= 0.55) score += 1.5;

  profile.desiredTags.forEach((tag) => {
    if (adcChampion.tags.includes(tag)) score += 1.1;
    if (supportChampion.tags.includes(tag)) score += 1.1;
  });

  if (priority === "engage") {
    score += (supportCombat.engage || 0) * 0.45 + (adcCombat.catch || 0) * 0.18;
  }
  if (priority === "damage") {
    score += (adcCombat.sustainedDamage || 0) * 0.4 + (adcCombat.burst || 0) * 0.2;
  }
  if (priority === "frontline") {
    score += (supportUtility.frontline || 0) * 0.25 + (supportUtility.safety || 0) * 0.15;
  }
  if (priority === "cc") {
    score += (supportCombat.catch || 0) * 0.35 + (adcCombat.catch || 0) * 0.15;
  }
  if (priority === "scaling") {
    score += (adcUtility.scaling || 0) * 0.4 + (supportCombat.peel || 0) * 0.2;
  }

  const lanePressureCombo =
    (adcKnowledge.laneProfile === "forte" ? 2.8 : adcKnowledge.laneProfile === "stable" ? 1.2 : 0) +
    (supportKnowledge.laneProfile === "forte" ? 2.2 : supportKnowledge.laneProfile === "stable" ? 1 : 0);
  score += lanePressureCombo;

  const protectCarryCombo =
    (supportCombat.peel || 0) * 0.35 +
    (supportCombat.engage || 0) * 0.1 +
    (adcUtility.scaling || 0) * 0.3 +
    (adcDraft.needsFrontline || 0) * 0.08;
  score += protectCarryCombo;

  const allInCombo =
    (supportCombat.engage || 0) * 0.35 +
    (adcCombat.burst || 0) * 0.22 +
    (adcKnowledge.powerCurve?.early || 0) * 0.12;
  score += allInCombo;

  const pokeSiegeCombo =
    (adcCombat.poke || 0) * 0.2 +
    (supportCombat.poke || 0) * 0.25 +
    ((adcCombat.waveclear || 0) + (supportCombat.waveclear || 0)) * 0.08;
  score += pokeSiegeCombo;

  const safetyCombo =
    (adcUtility.safety || 0) * 0.15 +
    (supportCombat.peel || 0) * 0.18 +
    (supportDraft.antiDive || 0) * 0.1;
  score += safetyCombo;

  partialTags.forEach((tag) => {
    if (adcChampion.tags.includes(tag)) score += 0.2;
    if (supportChampion.tags.includes(tag)) score += 0.2;
  });

  const adcMeta = metaByChampion[adcChampion.imageId];
  const supportMeta = metaByChampion[supportChampion.imageId];
  if (adcMeta && supportMeta) {
    score += (adcMeta.winRate + supportMeta.winRate) * 2.5;
    score += (adcMeta.pickRate + supportMeta.pickRate) * 3.5;
  }

  return score;
}

function getFallbackBotlaneVariantScore(adcChampion, supportChampion, metaByChampion) {
  const rankedFallback = getBotlaneRankedFallback(adcChampion, supportChampion, metaByChampion);

  if (!rankedFallback) {
    return -8;
  }

  return (
    rankedFallback.averageWinRate * 20 +
    rankedFallback.averagePickRate * 16 +
    Math.min(12, rankedFallback.totalGames / 8)
  );
}

function evaluateComposition(composition, profile, risk, priority, metaByChampion) {
  const allTags = composition.flatMap((champion) => champion.tags);
  const damageTypes = composition.map((champion) => champion.damageType);
  const synergyReport = analyzeInterRoleSynergies(composition);
  const score = computeScore(
    allTags,
    damageTypes,
    profile,
    risk,
    priority,
    composition,
    metaByChampion,
    synergyReport
  );
  const strengths = buildStrengths(allTags, damageTypes, priority, composition, synergyReport);
  const warnings = buildWarnings(allTags, damageTypes, risk, composition, synergyReport);
  const summary = buildSummary(composition, profile, score, strengths, warnings, synergyReport?.primaryAxis || null);

  return { score, strengths, warnings, summary, axis: synergyReport?.primaryAxis || null };
}

function computeScore(
  allTags,
  damageTypes,
  profile,
  risk,
  priority,
  composition,
  metaByChampion,
  synergyReport
) {
  let total = 50;
  const teamKnowledge = summarizeCompositionKnowledge(composition);

  profile.desiredTags.forEach((tag) => {
    total += countTag(allTags, tag) * 2.4;
  });

  priorityTags[priority].forEach((tag) => {
    total += countTag(allTags, tag) * 1.8;
  });

  total += teamKnowledge.frontline * 1.2;
  total += teamKnowledge.engage * 0.8;
  total += teamKnowledge.peel * 0.7;
  total += teamKnowledge.waveclear * 0.45;
  total += teamKnowledge.objective * 0.55;

  if (teamKnowledge.frontline >= 12) total += 6;
  if (teamKnowledge.engage >= 10) total += 5;
  if (teamKnowledge.peel >= 10 && teamKnowledge.scaling >= 11) total += 5;
  if (teamKnowledge.early >= 26) total += 4;
  if (teamKnowledge.late >= 26) total += 4;
  if (damageTypes.includes("ad") && damageTypes.includes("ap")) total += 10;
  if (risk === "spicy" && teamKnowledge.early >= 24 && teamKnowledge.engage >= 9) total += 4;
  if (risk === "safe" && teamKnowledge.peel >= 9 && teamKnowledge.safety >= 24) total += 4;

  const metaBoost = composition.reduce((sum, champion) => {
    const meta = metaByChampion[champion.imageId];
    if (!meta) return sum;
    return sum + meta.winRate * 2.5 + meta.pickRate * 6;
  }, 0);

  total += Math.min(8, metaBoost);

  const adcChampion = composition.find((champion) => champion.role === "adc");
  const supportChampion = composition.find((champion) => champion.role === "support");
  const duoSynergy = getBotlaneSynergy(adcChampion, supportChampion);

  if (duoSynergy) {
    total += Math.min(14, duoSynergy.synergyScore * 0.09);
    if (duoSynergy.games >= 8) total += 4;
    if (duoSynergy.winRate >= 0.55) total += 4;
  }

  total += synergyReport?.scoreDelta || 0;

  return Math.min(99, total);
}

function buildStrengths(allTags, damageTypes, priority, composition, synergyReport) {
  const strengths = [];
  const teamKnowledge = summarizeCompositionKnowledge(composition);

  if (teamKnowledge.frontline >= 12) {
    strengths.push("Deux vraies sources de frontline pour absorber l'entree de fight.");
  }
  if (teamKnowledge.engage >= 10) {
    strengths.push("Engage clair et facile a executer en combat d'equipe.");
  }
  if (teamKnowledge.catch >= 10) {
    strengths.push("Beaucoup de controle pour verrouiller une cible.");
  }
  if (teamKnowledge.scaling >= 11 || teamKnowledge.late >= 26) {
    strengths.push("Bonne montee en puissance pour les fights de milieu et fin de partie.");
  }
  if (teamKnowledge.poke >= 10) {
    strengths.push("Pression a distance utile avant un objectif.");
  }
  if (teamKnowledge.objective >= 14) {
    strengths.push("Bonne valeur autour des objectifs neutres et des tours.");
  }
  if (damageTypes.includes("ad") && damageTypes.includes("ap")) {
    strengths.push("Repartition AD / AP assez saine pour compliquer l'itemisation adverse.");
  }

  const duoSynergy = getBotlaneSynergy(
    composition.find((champion) => champion.role === "adc"),
    composition.find((champion) => champion.role === "support")
  );
  if (duoSynergy) {
    strengths.push(
      `Duo vu en competition recente: ${duoSynergy.adcName} + ${duoSynergy.supportName}.`
    );
  }

  (synergyReport?.strengths || []).forEach((item) => {
    strengths.push(item);
  });

  if (!strengths.length) {
    strengths.push(`Composition coherente avec une priorite marquee sur ${priority}.`);
  }

  return strengths.slice(0, 4);
}

function buildWarnings(allTags, damageTypes, risk, composition, synergyReport) {
  const warnings = [];
  const teamKnowledge = summarizeCompositionKnowledge(composition);

  if (teamKnowledge.peel <= 6) {
    warnings.push("Peu d'outils defensifs pour proteger le carry si la draft adverse dive fort.");
  }
  if (teamKnowledge.frontline < 9) {
    warnings.push("Frontline limitee, les fights longs peuvent etre plus difficiles.");
  }
  if (teamKnowledge.engage < 7 && teamKnowledge.catch < 7) {
    warnings.push("Pas d'engage net, la comp dependra plus des erreurs ennemies.");
  }
  if (damageTypes.filter((type) => type === "ap").length >= 4) {
    warnings.push("Profil de degats trop AP, facile a contrer avec de la resistance magique.");
  }
  if (risk === "spicy" && teamKnowledge.safety < 20) {
    warnings.push("Execution exigeante: il faut prendre le tempo rapidement.");
  }

  (synergyReport?.warnings || []).forEach((item) => {
    warnings.push(item);
  });

  if (!warnings.length) {
    warnings.push("Alerte majeure absente: la comp reste assez stable si les lanes se passent correctement.");
  }

  return warnings.slice(0, 4);
}

function analyzeInterRoleSynergies(composition) {
  const byRole = composition.reduce((accumulator, champion) => {
    accumulator[champion.role] = champion;
    return accumulator;
  }, {});

  const top = byRole.top;
  const jungle = byRole.jungle;
  const mid = byRole.mid;
  const adc = byRole.adc;
  const support = byRole.support;

  const strengths = [];
  const warnings = [];
  let scoreDelta = 0;

  const jungleKnowledge = jungle?.knowledge || {};
  const midKnowledge = mid?.knowledge || {};
  const adcKnowledge = adc?.knowledge || {};
  const supportKnowledge = support?.knowledge || {};
  const topKnowledge = top?.knowledge || {};

  const jungleEngage = getKnowledgeValue(jungleKnowledge, "combatProfile", "engage");
  const jungleEarly = getKnowledgeValue(jungleKnowledge, "powerCurve", "early");
  const jungleCatch = getKnowledgeValue(jungleKnowledge, "combatProfile", "catch");
  const midCatch = getKnowledgeValue(midKnowledge, "combatProfile", "catch");
  const midBurst = getKnowledgeValue(midKnowledge, "combatProfile", "burst");
  const midWaveclear = getKnowledgeValue(midKnowledge, "combatProfile", "waveclear");
  const supportEngage = getKnowledgeValue(supportKnowledge, "combatProfile", "engage");
  const supportPeel = getKnowledgeValue(supportKnowledge, "combatProfile", "peel");
  const adcLane = getKnowledgeValue(adcKnowledge, "laneProfile") === "forte" ? 7.5 : getKnowledgeValue(adcKnowledge, "powerCurve", "early");
  const adcLate = getKnowledgeValue(adcKnowledge, "powerCurve", "late");
  const adcDps = getKnowledgeValue(adcKnowledge, "combatProfile", "sustainedDamage");
  const midLate = getKnowledgeValue(midKnowledge, "powerCurve", "late");
  const midBurstCarry = getKnowledgeValue(midKnowledge, "combatProfile", "burst");
  const topFrontline = getKnowledgeValue(topKnowledge, "utilityProfile", "frontline");
  const jungleFrontline = getKnowledgeValue(jungleKnowledge, "utilityProfile", "frontline");

  if ((jungleEngage >= 5.5 || jungleCatch >= 6) && (midCatch >= 5.5 || midBurst >= 5.5)) {
    strengths.push("Synergie jungle mid tres propre pour trouver des picks et punir vite autour de la map.");
    scoreDelta += 7;
  } else if (jungleEarly >= 6 && midWaveclear >= 5) {
    strengths.push("Jungle et mid peuvent prendre le tempo ensemble sur les premiers timings.");
    scoreDelta += 4;
  } else if (jungleEarly < 4.5 && midCatch < 4.5 && midBurst < 4.5) {
    warnings.push("Peu de synergie jungle mid pour accelerer la partie ou attraper une cible.");
    scoreDelta -= 4;
  }

  if ((supportEngage >= 5.5 && jungleEarly >= 5.5) || (adcLane >= 6.5 && jungleEarly >= 6)) {
    strengths.push("Botlane bien connectee au jungler pour jouer la prio et les premiers objectifs.");
    scoreDelta += 6;
  } else if (supportPeel >= 6 && adcLate >= 6.2 && jungleFrontline >= 4.8) {
    strengths.push("Le jungler couvre bien une botlane orientee carry et teamfight.");
    scoreDelta += 4;
  } else if (supportEngage < 4.5 && jungleEarly < 4.8 && adcLane < 5) {
    warnings.push("Bot et jungle ont moins d'outils pour imposer le tempo tres tot.");
    scoreDelta -= 4;
  }

  const frontlineScore = Math.max(topFrontline, jungleFrontline) + Math.min(topFrontline, jungleFrontline);
  const carryDemand = Math.max(adcLate, adcDps) + Math.max(midLate, midBurstCarry);

  if (frontlineScore >= 10 && carryDemand >= 11) {
    strengths.push("Frontline et backline sont bien equilibrees, la draft a un vrai front to back.");
    scoreDelta += 8;
  } else if (carryDemand >= 11 && frontlineScore < 8) {
    warnings.push("La draft aligne des carries forts mais manque de couverture devant eux.");
    scoreDelta -= 7;
  }

  if (supportPeel >= 6.5 && (adcLate >= 6.2 || adcDps >= 6.5)) {
    strengths.push("Le support valorise bien le carry bot dans les fights de milieu et fin de partie.");
    scoreDelta += 5;
  }

  if (topKnowledge.powerCurve?.early < 4.5 && jungleEarly < 4.5 && adcLane < 4.8) {
    warnings.push("Peu de pression naturelle en early sur les lanes et la jungle.");
    scoreDelta -= 5;
  }

  const topJungleAxisScore =
    jungleEarly * 0.35 +
    jungleEngage * 0.2 +
    topKnowledge.powerCurve?.early * 0.25 +
    topFrontline * 0.2;

  const midJungleAxisScore =
    jungleEarly * 0.25 +
    jungleCatch * 0.2 +
    midCatch * 0.25 +
    midBurst * 0.15 +
    midWaveclear * 0.15;

  const botlaneAxisScore =
    adcLane * 0.25 +
    adcLate * 0.15 +
    supportPeel * 0.2 +
    supportEngage * 0.15 +
    jungleEarly * 0.25;

  const axisCandidates = [
    {
      id: "top-jungle",
      score: topJungleAxisScore,
      label: "Axe top + jungle",
      shortLabel: "Top + Jungle",
      description: "La draft joue surtout autour d'un duo top jungle offensif."
    },
    {
      id: "mid-jungle",
      score: midJungleAxisScore,
      label: "Axe mid + jungle",
      shortLabel: "Mid + Jungle",
      description: "La draft repose surtout sur l'explosivite du duo mid jungle."
    },
    {
      id: supportEngage >= 5.5 || jungleEarly >= 6 ? "jungle-botlane" : "botlane",
      score: botlaneAxisScore,
      label: supportEngage >= 5.5 || jungleEarly >= 6 ? "Axe jungle + botlane" : "Axe botlane",
      shortLabel: supportEngage >= 5.5 || jungleEarly >= 6 ? "Jungle + Botlane" : "Botlane",
      description: supportEngage >= 5.5 || jungleEarly >= 6
        ? "La draft investit surtout dans la botlane, poussee par son jungler."
        : "La draft investit surtout dans la botlane."
    }
  ].sort((left, right) => right.score - left.score);

  const primaryAxis =
    axisCandidates[0].score >= 5.4
      ? {
          ...axisCandidates[0],
          color: getAxisColor(axisCandidates[0].id),
          champions: getAxisChampionNames(axisCandidates[0].id, byRole)
        }
      : null;

  return {
    scoreDelta,
    strengths: uniqueStrings(strengths).slice(0, 4),
    warnings: uniqueStrings(warnings).slice(0, 4),
    primaryAxis
  };
}

function getKnowledgeValue(knowledge, section, key) {
  if (section === "laneProfile") {
    return knowledge?.laneProfile === key ? 1 : knowledge?.laneProfile || "";
  }

  return knowledge?.[section]?.[key] || 0;
}

function uniqueStrings(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function summarizeCompositionKnowledge(composition) {
  return composition.reduce(
    (accumulator, champion) => {
      const knowledge = champion.knowledge || {};
      const combat = knowledge.combatProfile || {};
      const utility = knowledge.utilityProfile || {};
      const draft = knowledge.draftProfile || {};
      const power = knowledge.powerCurve || {};

      accumulator.frontline += utility.frontline || 0;
      accumulator.engage += combat.engage || 0;
      accumulator.peel += combat.peel || 0;
      accumulator.catch += combat.catch || 0;
      accumulator.poke += combat.poke || 0;
      accumulator.waveclear += combat.waveclear || 0;
      accumulator.objective += combat.objectiveControl || draft.objectiveValue || 0;
      accumulator.safety += utility.safety || 0;
      accumulator.scaling += utility.scaling || 0;
      accumulator.early += power.early || 0;
      accumulator.mid += power.mid || 0;
      accumulator.late += power.late || 0;
      return accumulator;
    },
    {
      frontline: 0,
      engage: 0,
      peel: 0,
      catch: 0,
      poke: 0,
      waveclear: 0,
      objective: 0,
      safety: 0,
      scaling: 0,
      early: 0,
      mid: 0,
      late: 0
    }
  );
}


function getAxisColor(axisId) {
  const colorMap = {
    "top-jungle": "#ff8a5b",
    "mid-jungle": "#5bd0ff",
    "jungle-botlane": "#8dff72",
    botlane: "#ffd257"
  };

  return colorMap[axisId] || "#ffd257";
}

function getAxisChampionNames(axisId, byRole) {
  if (axisId === "top-jungle") {
    return [byRole.top?.name, byRole.jungle?.name].filter(Boolean);
  }

  if (axisId === "mid-jungle") {
    return [byRole.mid?.name, byRole.jungle?.name].filter(Boolean);
  }

  if (axisId === "jungle-botlane") {
    return [byRole.jungle?.name, byRole.adc?.name, byRole.support?.name].filter(Boolean);
  }

  return [byRole.adc?.name, byRole.support?.name].filter(Boolean);
}

function buildSummary(composition, profile, score, strengths, warnings, primaryAxis = null) {
  const engageCore = composition
    .filter((champion) => champion.tags.includes("engage") || champion.tags.includes("pick"))
    .map((champion) => champion.name)
    .slice(0, 2)
    .join(" et ");

  const axisLine = primaryAxis
    ? `L'axe principal repose sur ${primaryAxis.champions.join(" et ")}. `
    : "";

  return `Cette draft ${profile.title.toLowerCase()} vise un plan de jeu simple. ` +
    axisLine +
    `Le coeur de l'action repose surtout sur ${engageCore || composition[0].name}. ` +
    `Le score ${score}/99 vient principalement de ${strengths[0].toLowerCase()} ` +
    `Attention surtout a: ${warnings[0].toLowerCase()}`;
}

function buildBotlaneResult({
  adc,
  support,
  pair,
  profile,
  risk,
  priority,
  metaByChampion,
  scoreOverride
}) {
  const duo = [adc, support];
  const tags = duo.flatMap((champion) => champion.tags);
  const rankedFallback = getBotlaneRankedFallback(adc, support, metaByChampion);
  const score =
    scoreOverride ??
    Math.min(
      99,
      Math.round(
        48 +
          scoreChampionFit(adc, "adc", profile, risk, priority, metaByChampion) * 0.45 +
          scoreChampionFit(support, "support", profile, risk, priority, metaByChampion) * 0.45 +
          (pair?.synergyScore || 0) * 0.1 +
          scoreBotlanePerformanceProfile(pair?.duoId)
      )
    );
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adc.imageId}::${support.imageId}`);
  const strengths = buildBotlaneStrengths(duo, pair, profile, metaByChampion);
  const warnings = buildBotlaneWarnings(tags, risk);
  const summary =
    `${getBotlaneDuoSummary(adc, support, pair, metaByChampion)} ` +
    `Attention surtout a ${warnings[0].toLowerCase()}`;

  return {
    duo,
    adc,
    support,
    pair,
    rankedFallback,
    performanceProfile,
    score,
    profile,
    strengths,
    warnings,
    summary
  };
}

function buildBotlaneStrengths(duo, pair, profile, metaByChampion) {
  const [adc, support] = duo;
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adc.imageId}::${support.imageId}`);
  const tags = duo.flatMap((champion) => champion.tags);
  const strengths = [];
  const rankedFallback = getBotlaneRankedFallback(adc, support, metaByChampion);

  if (pair) {
    strengths.push(`un duo vu en competition recente entre ${adc.name} et ${support.name}.`);
  }
  if (performanceProfile?.laneAssessment) {
    strengths.push(`une lane ${performanceProfile.laneAssessment} selon l'echantillon pro recent.`);
  }
  if (performanceProfile?.lateAssessment === "tient bien les parties longues") {
    strengths.push("une bonne tenue quand les fights arrivent plus tard dans la partie.");
  }
  if (countTag(tags, "lane") >= 1 && (countTag(tags, "poke") >= 1 || countTag(tags, "damage") >= 1)) {
    strengths.push("une lane capable de prendre la priorite ou de punir tres tot.");
  }
  if (countTag(tags, "protect") >= 1 && countTag(tags, "scaling") >= 1) {
    strengths.push("une bonne base pour jouer autour du scaling du carry.");
  }
  if (countTag(tags, "engage") >= 1 && countTag(tags, "followup") >= 1) {
    strengths.push("un all-in lisible et facile a connecter en 2v2.");
  }

  const adcMeta = metaByChampion[adc.imageId];
  const supportMeta = metaByChampion[support.imageId];
  if (adcMeta?.games >= 2 && supportMeta?.games >= 2) {
    strengths.push("deux picks qui restent presents dans la meta recente.");
  }
  if (!pair && rankedFallback) {
    strengths.push(
      `viable en ranked recente avec ${rankedFallback.averageWinRateLabel} de winrate moyen sur ${rankedFallback.totalGames} parties cumulees.`
    );
  }

  if (!strengths.length) {
    strengths.push(`un duo coherent avec une direction ${profile.title.toLowerCase()}.`);
  }

  return strengths.slice(0, 4).map(capitalizeFirst);
}

function buildBotlaneWarnings(tags, risk) {
  const warnings = [];

  if (countTag(tags, "engage") === 0 && countTag(tags, "poke") === 0) {
    warnings.push("un debut de lane parfois passif si le matchup met la pression.");
  }
  if (countTag(tags, "protect") === 0 && countTag(tags, "selfpeel") === 0) {
    warnings.push("un duo qui peut souffrir si beaucoup de champions plongent sur la backline.");
  }
  if (risk === "spicy" && countTag(tags, "safe") === 0) {
    warnings.push("une execution plus exigeante si vous prenez du retard tres tot.");
  }

  if (!warnings.length) {
    warnings.push("des faiblesses assez limitees si la lane est jouee proprement.");
  }

  return warnings.slice(0, 3).map(capitalizeFirst);
}

function getBotlaneRankedFallback(adc, support, metaByChampion) {
  const adcMeta = metaByChampion[adc.imageId];
  const supportMeta = metaByChampion[support.imageId];

  if (!adcMeta?.games || !supportMeta?.games) {
    return null;
  }

  const totalGames = adcMeta.games + supportMeta.games;
  const averageWinRate = (adcMeta.winRate + supportMeta.winRate) / 2;
  const averagePickRate = (adcMeta.pickRate + supportMeta.pickRate) / 2;

  return {
    adcGames: adcMeta.games,
    supportGames: supportMeta.games,
    totalGames,
    averageWinRate,
    averagePickRate,
    averageWinRateLabel: `${Math.round(averageWinRate * 100)}%`
  };
}

function scoreBotlanePerformanceProfile(duoId) {
  const profile = getBotlanePerformanceProfile(duoId);
  if (!profile) return 0;

  let score = 0;
  if (profile.laneAssessment === "dominant") score += 7;
  if (profile.laneAssessment === "forte") score += 5;
  if (profile.earlyAssessment === "fort en early") score += 4;
  if (profile.lateAssessment === "tient bien les parties longues") score += 3;
  if (profile.lateAssessment === "plus convaincant en late game") score += 4;
  score += Math.min(4, (profile.sampledGames || 0) * 0.12);

  return score;
}

function buildChampionPool() {
  const pools = {
    top: [],
    jungle: [],
    mid: [],
    adc: [],
    support: [],
    uniqueChampions: {},
    lookup: {
      top: {},
      jungle: {},
      mid: {},
      adc: {},
      support: {}
    }
  };

  Object.values(championProfiles).forEach((profile) => {
    pools.uniqueChampions[profile.id] = profile;

    roleOrder.forEach((role) => {
      const roleScore = profile.roleScores?.[role] || 0;

      if (roleScore < 0.5) {
        return;
      }

      const champion = {
        name: profile.name,
        role,
        tags: profile.strategicTags,
        displayTags: profile.displayTags,
        knowledge: profile.knowledge || null,
        damageType: profile.damageType,
        imageId: profile.imageId,
        roleScore,
        classes: profile.classes,
        positions: profile.positions,
        profileRoles: profile.roles,
        attributeRatings: profile.attributeRatings,
        range: profile.range,
        attackType: profile.attackType
      };

      pools[role].push(champion);
      pools.lookup[role][profile.imageId] = champion;
    });
  });

  roleOrder.forEach((role) => {
    pools[role].sort((a, b) => b.roleScore - a.roleScore);
  });

  return pools;
}

function isEligibleForRole(champion, role, metaByChampion) {
  const meta = metaByChampion[champion.imageId];

  if (!meta || meta.games < 3) {
    return champion.positions.length ? matchesChampionRolePosition(champion, role) : true;
  }

  const roleMetaScore = getMetaRoleScore(meta, role);
  const dominantRole = getDominantMetaRole(meta);

  if (dominantRole === role) return true;

  return roleMetaScore >= 0.2;
}

function getMetaRoleScore(meta, role) {
  const roleKey = riotRoleMap[role];
  const totalKnownRoles = Object.entries(meta.positions || {}).reduce((sum, [position, count]) => {
    if (position === "UNKNOWN") return sum;
    return sum + count;
  }, 0);

  if (!roleKey || !totalKnownRoles) return 0;

  return (meta.positions?.[roleKey] || 0) / totalKnownRoles;
}

function getDominantMetaRole(meta) {
  const entries = Object.entries(meta.positions || {})
    .filter(([position]) => position !== "UNKNOWN")
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) return null;

  return appRoleMap[entries[0][0]] || null;
}

function matchesChampionRolePosition(championOrProfile, role) {
  const knownPositions = championOrProfile?.positions || [];
  const aliases = rolePositionAliases[role] || [];

  if (!knownPositions.length || !aliases.length) {
    return false;
  }

  return knownPositions.some((position) => aliases.includes(position));
}

function countTag(tags, target) {
  return tags.filter((tag) => tag === target).length;
}

function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function inferDuoArchetype(adc, support) {
  const tags = [...(adc.tags || []), ...(support.tags || [])];

  if (countTag(tags, "engage") >= 1 && countTag(tags, "followup") >= 1) {
    return "engage";
  }
  if (countTag(tags, "poke") >= 1 && countTag(tags, "lane") >= 1) {
    return "poke";
  }
  if (countTag(tags, "protect") >= 1 && countTag(tags, "scaling") >= 1) {
    return "protect carry";
  }
  if (countTag(tags, "damage") >= 1 && countTag(tags, "burst") >= 1) {
    return "agressive";
  }

  return "equilibree";
}

export function formatTag(tag) {
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
    followup: "Follow Up",
    lane: "Lane",
    selfpeel: "Self Peel",
    dps: "DPS",
    antiDive: "Anti Dive",
    antiDash: "Anti Dash",
    zone: "Zone Control",
    skirmish: "Skirmish",
    spicy: "High Risk"
  };

  return labels[tag] || tag;
}

export function getChampionPortrait(imageId) {
  return `https://ddragon.leagueoflegends.com/cdn/${dataDragonVersion}/img/champion/${imageId}.png`;
}

export function getChampionProfile(imageId) {
  return championProfilesById[imageId] || null;
}

export function getChampionPickReasons(champion, metaByChampion = {}) {
  const profile = getChampionProfile(champion.imageId);
  const meta = metaByChampion[champion.imageId];
  const reasons = [];
  const knowledge = profile?.knowledge;
  const draftProfile = knowledge?.draftProfile || {};

  if (champion.botlaneSynergy) {
    reasons.push(
      `Duo vu en competition recente avec ${champion.botlaneSynergy.partnerName}.`
    );
  }

  if (knowledge?.powerCurve?.windows?.length) {
    reasons.push(`Pic de puissance surtout sur ${knowledge.powerCurve.windows.join(" + ")}.`);
  }

  if (knowledge?.laneProfile === "forte") {
    reasons.push("Bon profil pour prendre la lane ou imposer la pression tres tot.");
  } else if (knowledge?.laneProfile === "stable") {
    reasons.push("Profil de lane stable qui laisse plus de marge dans la draft.");
  }

  if (draftProfile.blindReliability >= 6.5) {
    reasons.push("Blind pick plutot fiable pour ouvrir une draft sans trop s'exposer.");
  }

  if (draftProfile.roamPower >= 6.2) {
    reasons.push("Apporte de vraies options de roam et de tempo sur la map.");
  }

  if (draftProfile.objectiveValue >= 6.2) {
    reasons.push("Tres utile pour jouer autour des dragons, du Herald ou des tours.");
  }

  if (draftProfile.antiDive >= 6.2) {
    reasons.push("Bonne reponse quand il faut tenir face a une draft qui dive.");
  }

  if (draftProfile.antiPoke >= 6) {
    reasons.push("Aide bien l'equipe a ne pas subir une draft poke ou siege.");
  }

  if (draftProfile.needsSetup >= 6.2) {
    reasons.push("Devient bien meilleur avec du setup ou du follow-up autour de lui.");
  }

  if (draftProfile.needsFrontline >= 6.2) {
    reasons.push("Se valorise surtout quand la draft lui donne une vraie frontline.");
  }

  if (draftProfile.resourceDemand <= 4 && knowledge?.strengths?.length) {
    reasons.push(`Bon pick de soutien de draft, surtout pour ${knowledge.strengths[0]}.`);
  }

  const topTags = (profile?.displayTags || champion.displayTags || champion.tags || []).slice(0, 3);
  topTags.forEach((tag) => {
    const text = pickReasonLabels[tag];
    if (text) {
      reasons.push(text);
    }
  });

  if (meta?.games >= 2) {
    reasons.push(`Meta recente solide: ${Math.round(meta.winRate * 100)}% de winrate sur ${meta.games} parties.`);
  } else if (profile?.positions?.length) {
    const readablePositions = profile.positions
      .map((position) => appRoleMap[position])
      .filter(Boolean)
      .map((role) => roleLabels[role])
      .slice(0, 2)
      .join(" / ");

    if (readablePositions) {
      reasons.unshift(`Profil coherent sur ${readablePositions}.`);
    }
  }

  return [...new Set(reasons)].slice(0, 3);
}

export function getBotlaneSynergy(championOrAdc, supportChampion) {
  if (!championOrAdc || !supportChampion) return null;

  if (championOrAdc.botlaneSynergy?.partnerId === supportChampion.imageId) {
    return championOrAdc.botlaneSynergy;
  }

  const duoId = `${championOrAdc.imageId}::${supportChampion.imageId}`;
  return botlanePairLookup[duoId] || null;
}

function attachBotlaneSynergy(champion, pair, side) {
  const partnerId = side === "adc" ? pair.supportId : pair.adcId;
  const partnerName = side === "adc" ? pair.supportName : pair.adcName;

  return {
    ...champion,
    botlaneSynergy: {
      duoId: pair.duoId,
      partnerId,
      partnerName,
      games: pair.games,
      wins: pair.wins,
      winRate: pair.winRate,
      confidence: pair.confidence,
      freshness: pair.freshness,
      synergyScore: pair.synergyScore,
      regions: pair.regions,
      tournaments: pair.tournaments,
      teams: pair.teams,
      firstPlayed: pair.firstPlayed,
      lastPlayed: pair.lastPlayed,
      adcName: pair.adcName,
      supportName: pair.supportName
    }
  };
}

const botlanePairIndex = botlaneSynergies.pairs || [];
const botlanePairLookup = botlanePairIndex.reduce((accumulator, pair) => {
  accumulator[pair.duoId] = pair;
  return accumulator;
}, {});
const botlaneProfilesByDuoId = botlaneProfiles.byDuoId || {};

const pickReasonLabels = {
  frontline: "Apporte une vraie frontline pour tenir les combats.",
  engage: "Peut demarrer le fight de maniere fiable.",
  cc: "Ajoute beaucoup de controle pour verrouiller une cible.",
  teamfight: "Tres utile quand le combat se joue en 5v5.",
  safe: "Pick globalement stable et plus simple a jouer proprement.",
  wombo: "Fonctionne tres bien avec des combinaisons d'ultimes.",
  damage: "Apporte une source de degats importante dans la draft.",
  pick: "Fort pour attraper une cible isolee.",
  scaling: "Devient tres fort avec le temps et les objets.",
  protect: "Peut vraiment proteger le carry principal.",
  peel: "Repousse bien les menaces qui foncent sur l'arriere ligne.",
  poke: "Met de la pression avant meme que le fight commence.",
  siege: "Tres utile pour prendre tours et objectifs a distance.",
  burst: "Peut eliminer rapidement une cible fragile.",
  mobility: "Peut se replacer ou trouver des angles plus facilement.",
  followup: "Excellent pour suivre un engage deja lance.",
  lane: "Offre une phase de lane solide ou dominante.",
  selfpeel: "A des outils pour survivre sans aide immediate.",
  dps: "Maintient des degats reguliers sur toute la duree du fight.",
  antiDive: "Aide a casser les compositions qui foncent dans la backline.",
  antiDash: "Peut punir ou limiter les champions tres mobiles.",
  zone: "Controle bien l'espace autour des objectifs.",
  skirmish: "Tres fort dans les petits combats et escarmouches.",
  spicy: "Fort impact offensif, mais demande plus d'execution."
};
