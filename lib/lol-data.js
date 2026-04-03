import championProfiles from "../data/champion-profiles.json";
import botlaneSynergies from "../data/botlane-synergies.json";
import botlaneProfiles from "../data/botlane-profiles.json";
import proRoleMatchups from "../data/pro-role-matchups.json";

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

const proRoleMatchupBuckets = proRoleMatchups.byRole || {};

export const championPool = buildChampionPool();
export const generatorChampionCount = Object.keys(championPool.uniqueChampions).length;
export const generatorPoolByRoleCount = roleOrder.reduce((accumulator, role) => {
  accumulator[role] = championPool[role].length;
  return accumulator;
}, {});
export const championProfilesById = championProfiles;
export const botlaneSynergySource = `${botlaneSynergies.source} (${botlaneSynergies.tournaments.join(", ")})`;
export const botlaneProfileSource = `${botlaneProfiles.source} (${botlaneProfiles.recentWindowDays} jours)`;

export function getBotlaneChampionOptions(metaByChampion = {}) {
  return {
    adc: getRoleChampionOptions("adc", metaByChampion),
    support: getRoleChampionOptions("support", metaByChampion)
  };
}

export function getTeamChampionOptions(metaByChampion = {}) {
  return roleOrder.reduce((accumulator, role) => {
    accumulator[role] = getRoleChampionOptions(role, metaByChampion);
    return accumulator;
  }, {});
}

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
      metaByChampion,
      lockedSelection
    );

    if (!best || evaluation.score > best.score) {
      best = { composition, profile, ...evaluation };
    }
  }

  return best;
}

export function generateBestBotlane(filters, metaByChampion = {}, lockedSelection = null, enemySelection = null) {
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
      metaByChampion,
      enemySelection
    });
  }

  const candidates = buildBotlaneCandidates(
    profile,
    filters.risk,
    filters.priority,
    metaByChampion,
    [],
    new Set(),
    lockedSelection,
    enemySelection
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
      metaByChampion,
      enemySelection
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
    metaByChampion,
    enemySelection
  });
}

export function evaluateBotlaneDuo(
  filters,
  adcId,
  supportId,
  metaByChampion = {},
  enemySelection = null
) {
  const profile = styleProfiles[filters.style];
  const adcChampion = championPool.lookup.adc[adcId];
  const supportChampion = championPool.lookup.support[supportId];

  if (!adcChampion || !supportChampion) {
    return null;
  }

  const pair = botlanePairLookup[`${adcChampion.imageId}::${supportChampion.imageId}`] || null;

  return buildBotlaneResult({
    adc: pair ? attachBotlaneSynergy(adcChampion, pair, "adc") : adcChampion,
    support: pair ? attachBotlaneSynergy(supportChampion, pair, "support") : supportChampion,
    pair,
    profile,
    risk: filters.risk,
    priority: filters.priority,
    metaByChampion,
    enemySelection
  });
}

export function getBotlaneMatchupAlternatives(
  filters,
  metaByChampion = {},
  currentAdcId,
  currentSupportId,
  enemySelection = null,
  limit = 2
) {
  if (!currentAdcId || !currentSupportId || (!enemySelection?.adc && !enemySelection?.support)) {
    return { adc: [], support: [] };
  }

  const profile = styleProfiles[filters.style];
  const currentAdc = championPool.lookup.adc[currentAdcId];
  const currentSupport = championPool.lookup.support[currentSupportId];
  const enemyAdcId = enemySelection?.adc?.imageId || null;
  const enemySupportId = enemySelection?.support?.imageId || null;
  const enemyAdc = enemyAdcId ? championPool.lookup.adc[enemyAdcId] || null : null;
  const enemySupport = enemySupportId ? championPool.lookup.support[enemySupportId] || null : null;

  if (!currentAdc || !currentSupport) {
    return { adc: [], support: [] };
  }

  const adcAlternatives = championPool.adc
    .filter(
      (champion) =>
        champion.imageId !== currentAdcId &&
        champion.imageId !== enemyAdcId
    )
    .map((adcChampion) => {
      const pair = botlanePairLookup[`${adcChampion.imageId}::${currentSupportId}`] || null;
      const result = buildBotlaneResult({
        adc: pair ? attachBotlaneSynergy(adcChampion, pair, "adc") : adcChampion,
        support: pair ? attachBotlaneSynergy(currentSupport, pair, "support") : currentSupport,
        pair,
        profile,
        risk: filters.risk,
        priority: filters.priority,
        metaByChampion,
        enemySelection
      });

      const directMatchup = enemyAdc
        ? getDirectChampionMatchupData(adcChampion, enemyAdc, metaByChampion)
        : null;

      return {
        ...result,
        counterScore: getBotlaneAlternativeCounterScore(directMatchup)
      };
    })
    .sort((a, b) => {
      if ((b.counterScore || 0) !== (a.counterScore || 0)) {
        return (b.counterScore || 0) - (a.counterScore || 0);
      }

      return b.score - a.score;
    })
    .slice(0, limit);

  const supportAlternatives = championPool.support
    .filter(
      (champion) =>
        champion.imageId !== currentSupportId &&
        champion.imageId !== enemySupportId
    )
    .map((supportChampion) => {
      const pair = botlanePairLookup[`${currentAdcId}::${supportChampion.imageId}`] || null;
      const result = buildBotlaneResult({
        adc: pair ? attachBotlaneSynergy(currentAdc, pair, "adc") : currentAdc,
        support: pair ? attachBotlaneSynergy(supportChampion, pair, "support") : supportChampion,
        pair,
        profile,
        risk: filters.risk,
        priority: filters.priority,
        metaByChampion,
        enemySelection
      });

      const directMatchup = enemySupport
        ? getDirectChampionMatchupData(supportChampion, enemySupport, metaByChampion)
        : null;

      return {
        ...result,
        counterScore: getBotlaneAlternativeCounterScore(directMatchup)
      };
    })
    .sort((a, b) => {
      if ((b.counterScore || 0) !== (a.counterScore || 0)) {
        return (b.counterScore || 0) - (a.counterScore || 0);
      }

      return b.score - a.score;
    })
    .slice(0, limit);

  return {
    adc: adcAlternatives,
    support: supportAlternatives
  };
}

function getBotlaneAlternativeCounterScore(matchup) {
  if (!matchup) {
    return -999;
  }

  let score = matchup.score || 0;

  if (matchup.sample?.games) {
    score += 2.4;
    score += Math.min(3, matchup.sample.games * 0.18);
    score += Math.max(-2.6, Math.min(2.6, ((matchup.sample.winRate || 0.5) - 0.5) * 12));
    score += Math.max(-2.4, Math.min(2.4, (matchup.sample.avgGoldDiffAt10 || 0) / 260));
    score += Math.max(-1.5, Math.min(1.5, (matchup.sample.avgCsDiffAt10 || 0) / 5));
    score += Math.max(-1.5, Math.min(1.5, (matchup.sample.avgXpDiffAt10 || 0) / 190));
  }

  if (matchup.proSample?.games) {
    score += 1.1;
    score += Math.min(1.6, matchup.proSample.games * 0.2);
    score += Math.max(-1.7, Math.min(1.7, ((matchup.proSample.winRate || 0.5) - 0.5) * 8));
  }

  if (matchup.positiveSignal) {
    score += 3.6;
  }

  if (matchup.negativeSignal) {
    score -= 3.6;
  }

  score += (matchup.confidence || 0) * 1.5;

  return score;
}

export function getBotlaneVariants(
  filters,
  metaByChampion = {},
  lockedSelection = null,
  enemySelection = null,
  limit = 3,
  excludeDuoId = null
) {
  if (!lockedSelection || (lockedSelection.adcId && lockedSelection.supportId)) {
    return [];
  }

  const enemyAdcId = enemySelection?.adc?.imageId || null;
  const enemySupportId = enemySelection?.support?.imageId || null;
  const profile = styleProfiles[filters.style];
  const candidates = buildBotlaneCandidates(
    profile,
    filters.risk,
    filters.priority,
    metaByChampion,
    [],
    new Set(),
    lockedSelection,
    enemySelection
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
        metaByChampion,
        enemySelection
      })
    );
  });

  if (variants.length < limit) {
    const fallbackChampions = lockedSelection?.supportId
      ? championPool.adc.filter((champion) => champion.imageId !== enemyAdcId)
      : championPool.support.filter((champion) => champion.imageId !== enemySupportId);

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
                  metaByChampion,
                  enemySelection
                )
              : getFallbackBotlaneVariantScore(adcChampion, supportChampion, metaByChampion, enemySelection))
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
            metaByChampion,
            enemySelection
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

export function getBotlaneDuoSummary(adc, support, pair = null, metaByChampion = {}, enemyMatchup = null) {
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adc.imageId}::${support.imageId}`);
  const insights = getBotlaneDuoInsights(adc, support, pair);
  const rankedFallback = getBotlaneRankedFallback(adc, support, metaByChampion);
  const pairLine = pair
    ? `Ce duo exact a ete joue ${pair.games} fois en competition recente. `
    : "";
  const laneLine = performanceProfile
    ? `La botlane ressort surtout sur ${formatBotlanePowerWindows(performanceProfile)}. `
    : "";
  const fallbackLine = !pair && rankedFallback
    ? `Ce duo exact n'a pas encore ete vu dans notre echantillon pro recent, mais les deux picks tiennent la meta ranked recente. `
    : !pair
      ? `Ce duo exact n'a pas encore ete vu dans notre echantillon pro recent. `
      : "";
  const enemyLine = enemyMatchup?.summary ? `${enemyMatchup.summary} ` : "";

  return `${adc.name} avec ${support.name} forme une botlane orientee ${inferDuoArchetype(adc, support)}. ${pairLine}${laneLine}${fallbackLine}${enemyLine}${insights[0]}`;
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

function scoreBotlaneEnemyMatchup(adcChampion, supportChampion, enemySelection, metaByChampion, pair = null) {
  if (!enemySelection?.adc && !enemySelection?.support) {
    return 0;
  }

  const context = getBotlaneEnemyMatchupContext(
    adcChampion,
    supportChampion,
    enemySelection,
    metaByChampion,
    pair
  );
  return context.score;
}

function getBotlaneEnemyMatchupContext(
  adcChampion,
  supportChampion,
  enemySelection,
  metaByChampion,
  pair = null
) {
  const enemyAdc = enemySelection?.adc || null;
  const enemySupport = enemySelection?.support || null;

  if (
    (enemyAdc && enemyAdc.imageId === adcChampion.imageId) ||
    (enemySupport && enemySupport.imageId === supportChampion.imageId)
  ) {
    return {
      score: 0,
      summary: "",
      line: "",
      warning: "",
      matrixLabel: "",
      label: "",
      adcMatchup: null,
      supportMatchup: null
    };
  }

  if (!enemyAdc && !enemySupport) {
    return {
      score: 0,
      summary: "",
      line: "",
      warning: "",
      label: "",
      adcMatchup: null,
      supportMatchup: null
    };
  }

  const adcMatchup = enemyAdc ? getDirectChampionMatchupData(adcChampion, enemyAdc, metaByChampion) : null;
  const supportMatchup = enemySupport
    ? getDirectChampionMatchupData(supportChampion, enemySupport, metaByChampion)
    : null;
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adcChampion.imageId}::${supportChampion.imageId}`);
  const adcState = classifyBotlaneLaneMatchup(adcMatchup);
  const supportState = classifyBotlaneLaneMatchup(supportMatchup);
  const matrix = getBotlaneMatchupMatrix(adcState, supportState);
  const duoReadiness = getBotlaneDuoReadinessBonus(pair, performanceProfile);
  const directScore =
    (adcMatchup?.score || 0) * 0.42 +
    (supportMatchup?.score || 0) * 0.42;
  const combinedScore = directScore + matrix.score + duoReadiness.score;

  const enemyParts = [enemyAdc?.name, enemySupport?.name].filter(Boolean).join(" + ");
  const label = enemyParts ? `contre ${enemyParts}` : "";

  if (combinedScore >= 8.5) {
    return {
      score: 14,
      summary: `Le duo a un matchup tres favorable ${label}.`,
      line: `Tres bon matchup ${label}${duoReadiness.lineSuffix}.`,
      warning: "",
      matrixLabel: `${matrix.label}${duoReadiness.matrixSuffix}`,
      label,
      adcMatchup,
      supportMatchup
    };
  }

  if (combinedScore >= 4.5) {
    return {
      score: 8,
      summary: `Le duo semble tenir correctement ${label}.`,
      line: `Matchup favorable ${label}${duoReadiness.lineSuffix}.`,
      warning: "",
      matrixLabel: `${matrix.label}${duoReadiness.matrixSuffix}`,
      label,
      adcMatchup,
      supportMatchup
    };
  }

  if (combinedScore <= -8.5) {
    return {
      score: -14,
      summary: `Le matchup demande beaucoup de prudence ${label}.`,
      line: "",
      warning: `le 2v2 est vraiment difficile ${label}.`,
      matrixLabel: `${matrix.label}${duoReadiness.matrixSuffix}`,
      label,
      adcMatchup,
      supportMatchup
    };
  }

  if (combinedScore <= -4.5) {
    return {
      score: -8,
      summary: `Le matchup est plutot tendu ${label}.`,
      line: "",
      warning: `une lane compliquee ${label}.`,
      matrixLabel: `${matrix.label}${duoReadiness.matrixSuffix}`,
      label,
      adcMatchup,
      supportMatchup
    };
  }

  return {
    score: 0,
    summary: enemyParts ? `Le matchup reste assez neutre contre ${enemyParts}.` : "",
    line: enemyParts ? `Lecture assez neutre contre ${enemyParts}${duoReadiness.lineSuffix}.` : "",
    warning: "",
    matrixLabel: `${matrix.label}${duoReadiness.matrixSuffix}`,
    label,
    adcMatchup,
    supportMatchup
  };
}

function getBotlaneDuoReadinessBonus(pair, performanceProfile) {
  let score = 0;
  let matrixSuffix = "";
  let lineSuffix = "";

  if (pair?.games >= 3) {
    score += 1.8;
    matrixSuffix = " avec un duo deja confirme ensemble";
    lineSuffix = " avec un duo deja vu ensemble";
  }

  if (pair?.games >= 8) {
    score += 1.8;
  }

  if (pair?.regions?.length >= 2) {
    score += 0.8;
  }

  if (performanceProfile?.laneAssessment === "dominant") {
    score += 2.2;
    matrixSuffix = matrixSuffix || " avec une lane pro tres solide";
    lineSuffix = lineSuffix || " avec une lane pro tres solide";
  } else if (performanceProfile?.laneAssessment === "forte") {
    score += 1.4;
    matrixSuffix = matrixSuffix || " avec une lane pro solide";
    lineSuffix = lineSuffix || " avec une lane pro solide";
  } else if (performanceProfile?.laneAssessment === "fragile" || performanceProfile?.laneAssessment === "faible") {
    score -= 1.4;
    matrixSuffix = matrixSuffix || " mais une lane pro plus fragile";
    lineSuffix = lineSuffix || " mais une lane pro plus fragile";
  }

  if (performanceProfile?.earlyAssessment === "fort en early") {
    score += 1.2;
  }

  return { score, matrixSuffix, lineSuffix };
}

function classifyBotlaneLaneMatchup(matchup) {
  if (!matchup) {
    return "neutral";
  }

  if (matchup.positiveSignal && matchup.score >= 2.6) {
    return "strong";
  }

  if (matchup.negativeSignal && matchup.score <= -2.6) {
    return "weak";
  }

  if (matchup.score >= 1.1) {
    return "lean-good";
  }

  if (matchup.score <= -1.1) {
    return "lean-bad";
  }

  return "neutral";
}

function getBotlaneMatchupMatrix(adcState, supportState) {
  const key = `${adcState}|${supportState}`;
  const matrix = {
    "strong|strong": { score: 7.5, label: "double avantage sur la lane" },
    "strong|lean-good": { score: 5.5, label: "ADC tres bien arme avec un support qui suit" },
    "lean-good|strong": { score: 5.5, label: "support tres bien arme avec un ADC qui tient la lane" },
    "strong|neutral": { score: 4, label: "fort avantage sur un des deux matchups" },
    "neutral|strong": { score: 4, label: "fort avantage sur un des deux matchups" },
    "lean-good|lean-good": { score: 3.8, label: "lane plutot favorable sur les deux postes" },
    "lean-good|neutral": { score: 2.1, label: "leger avantage global en lane" },
    "neutral|lean-good": { score: 2.1, label: "leger avantage global en lane" },
    "weak|weak": { score: -7.8, label: "double matchup difficile" },
    "weak|lean-bad": { score: -5.8, label: "lane globalement en difficulte" },
    "lean-bad|weak": { score: -5.8, label: "lane globalement en difficulte" },
    "weak|neutral": { score: -4.2, label: "un matchup tres dur a absorber" },
    "neutral|weak": { score: -4.2, label: "un matchup tres dur a absorber" },
    "lean-bad|lean-bad": { score: -3.9, label: "lane plutot defavorable sur les deux postes" },
    "lean-bad|neutral": { score: -2.1, label: "leger desavantage global en lane" },
    "neutral|lean-bad": { score: -2.1, label: "leger desavantage global en lane" },
    "strong|weak": { score: 0, label: "lane partagee avec un cote fort et un cote fragile" },
    "weak|strong": { score: 0, label: "lane partagee avec un cote fort et un cote fragile" },
    "lean-good|lean-bad": { score: 0, label: "lane plutot equilibree" },
    "lean-bad|lean-good": { score: 0, label: "lane plutot equilibree" },
    "strong|lean-bad": { score: 1.2, label: "forte pression d'un cote, vigilance de l'autre" },
    "lean-bad|strong": { score: 1.2, label: "forte pression d'un cote, vigilance de l'autre" },
    "weak|lean-good": { score: -1.2, label: "un bon matchup ne suffit pas a rassurer toute la lane" },
    "lean-good|weak": { score: -1.2, label: "un bon matchup ne suffit pas a rassurer toute la lane" }
  };

  return matrix[key] || { score: 0, label: "lane plutot neutre" };
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
  lockedSelection = null,
  enemySelection = null
  ) {
  const lockedAdcId = lockedSelection?.adcId || lockedSelection?.adc?.imageId || null;
  const lockedSupportId = lockedSelection?.supportId || lockedSelection?.support?.imageId || null;
  const enemyAdcId = enemySelection?.adc?.imageId || null;
  const enemySupportId = enemySelection?.support?.imageId || null;

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

    if (enemyAdcId && adcChampion.imageId === enemyAdcId) {
      return null;
    }

    if (enemySupportId && supportChampion.imageId === enemySupportId) {
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
          metaByChampion,
          enemySelection
        )
    };
  });
}

function scoreChampionFit(champion, role, profile, risk, priority, metaByChampion) {
  let score = 10 + champion.roleScore * 4;
  const meta = metaByChampion[champion.imageId];
  const knowledge = champion.knowledge;
  const proMatchupRobustness = getProChampionRoleRobustness(champion.imageId, role);

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

  if (proMatchupRobustness !== null) {
    score += Math.max(-3.5, Math.min(3.5, proMatchupRobustness * 0.75));
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
  metaByChampion,
  enemySelection = null
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

  score += scoreBotlaneEnemyMatchup(adcChampion, supportChampion, enemySelection, metaByChampion, pair);

  return score;
}

function getFallbackBotlaneVariantScore(adcChampion, supportChampion, metaByChampion, enemySelection = null) {
  const rankedFallback = getBotlaneRankedFallback(adcChampion, supportChampion, metaByChampion);
  const enemyScore = scoreBotlaneEnemyMatchup(adcChampion, supportChampion, enemySelection, metaByChampion, null);

  if (!rankedFallback) {
    return -8 + enemyScore;
  }

  return (
    rankedFallback.averageWinRate * 20 +
    rankedFallback.averagePickRate * 16 +
    Math.min(12, rankedFallback.totalGames / 8) +
    enemyScore
  );
}

function evaluateComposition(composition, profile, risk, priority, metaByChampion, lockedSelection = null) {
  const allTags = composition.flatMap((champion) => champion.tags);
  const damageTypes = composition.map((champion) => champion.damageType);
  const synergyReport = analyzeInterRoleSynergies(composition);
  const draftBalanceReport = analyzeDraftBalance(composition, metaByChampion);
  const score = computeScore(
    allTags,
    damageTypes,
    profile,
    risk,
    priority,
    composition,
    metaByChampion,
    synergyReport,
    draftBalanceReport,
    lockedSelection
  );
  const strengths = buildStrengths(allTags, damageTypes, priority, composition, synergyReport, draftBalanceReport);
  const warnings = buildWarnings(allTags, damageTypes, risk, composition, synergyReport, draftBalanceReport);
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
  synergyReport,
  draftBalanceReport,
  lockedSelection = null
) {
  let total = 18;
  const teamKnowledge = summarizeCompositionKnowledge(composition);
  const lockedSelectionReport = analyzeLockedSelectionImpact(
    composition,
    lockedSelection,
    profile,
    risk,
    priority,
    metaByChampion
  );

  profile.desiredTags.forEach((tag) => {
    total += countTag(allTags, tag) * 1.2;
  });

  priorityTags[priority].forEach((tag) => {
    total += countTag(allTags, tag) * 0.8;
  });

  total += teamKnowledge.frontline * 0.35;
  total += teamKnowledge.engage * 0.22;
  total += teamKnowledge.peel * 0.2;
  total += teamKnowledge.waveclear * 0.12;
  total += teamKnowledge.objective * 0.16;

  if (teamKnowledge.frontline >= 12) total += 3;
  if (teamKnowledge.engage >= 10) total += 2.5;
  if (teamKnowledge.peel >= 10 && teamKnowledge.scaling >= 11) total += 2.5;
  if (teamKnowledge.early >= 26) total += 2;
  if (teamKnowledge.late >= 26) total += 2;
  if (damageTypes.includes("ad") && damageTypes.includes("ap")) total += 4;
  if (risk === "spicy" && teamKnowledge.early >= 24 && teamKnowledge.engage >= 9) total += 2;
  if (risk === "safe" && teamKnowledge.peel >= 9 && teamKnowledge.safety >= 24) total += 2;

  const metaBoost = composition.reduce((sum, champion) => {
    const meta = metaByChampion[champion.imageId];
    if (!meta) return sum;
    return sum + meta.winRate * 1.1 + meta.pickRate * 2.2;
  }, 0);

  total += Math.min(5, metaBoost);

  const adcChampion = composition.find((champion) => champion.role === "adc");
  const supportChampion = composition.find((champion) => champion.role === "support");
  const duoSynergy = getBotlaneSynergy(adcChampion, supportChampion);

  if (duoSynergy) {
    total += Math.min(6, duoSynergy.synergyScore * 0.035);
    if (duoSynergy.games >= 8) total += 1.5;
    if (duoSynergy.winRate >= 0.55) total += 1.5;
  }

  total += synergyReport?.scoreDelta || 0;
  total += draftBalanceReport?.scoreDelta || 0;
  total += lockedSelectionReport?.scoreDelta || 0;

  return Math.max(35, Math.min(99, Math.round(total)));
}

function analyzeLockedSelectionImpact(
  composition,
  lockedSelection,
  profile,
  risk,
  priority,
  metaByChampion
) {
  if (!lockedSelection) {
    return { scoreDelta: 0 };
  }

  const lockedRoles = roleOrder.filter((role) => Boolean(lockedSelection?.[role]));

  if (!lockedRoles.length) {
    return { scoreDelta: 0 };
  }

  let scoreDelta = 0;

  lockedRoles.forEach((role) => {
    const champion = composition.find((entry) => entry.role === role);

    if (!champion) {
      return;
    }

    const meta = metaByChampion?.[champion.imageId] || null;
    const knowledge = champion.knowledge || {};
    const roleMetaScore = getMetaRoleScore(meta || {}, role);
    const dominantRole = getDominantMetaRole(meta || {});
    const blindReliability = knowledge.draftProfile?.blindReliability || 5;
    const laneProfile = knowledge.laneProfile || "";
    const frontline = knowledge.utilityProfile?.frontline || 0;
    const peel = knowledge.combatProfile?.peel || 0;
    const engage = knowledge.combatProfile?.engage || 0;
    const late = knowledge.powerCurve?.late || 0;
    const early = knowledge.powerCurve?.early || 0;

    let lockScore = 0;

    if (meta) {
      lockScore += ((meta.winRate || 0.5) - 0.5) * 14;
      lockScore += ((roleMetaScore || 0.5) - 0.5) * 18;

      if (dominantRole === role) {
        lockScore += 1.5;
      } else if (dominantRole && roleMetaScore < 0.25) {
        lockScore -= 5;
      }
    }

    if (laneProfile === "forte") lockScore += 1.8;
    if (laneProfile === "stable") lockScore += 0.9;
    if (laneProfile === "faible") lockScore -= 1.8;
    if (laneProfile === "fragile") lockScore -= 1.1;

    lockScore += (blindReliability - 5) * 0.55;

    if (role === "top" || role === "jungle") {
      lockScore += frontline * 0.12;
    }

    if (role === "support") {
      lockScore += peel * 0.14 + engage * 0.08;
    }

    if (role === "adc") {
      lockScore += late * 0.1 + early * 0.06;
    }

    if (priority === "engage") {
      lockScore += engage * 0.08;
    }

    if (priority === "scaling") {
      lockScore += late * 0.08;
    }

    if (risk === "safe") {
      lockScore += peel * 0.05 + (knowledge.utilityProfile?.safety || 0) * 0.08;
    }

    if (risk === "spicy") {
      lockScore += early * 0.08 + engage * 0.05;
    }

    const profileTagMatches = profile.desiredTags.reduce(
      (sum, tag) => sum + (champion.tags.includes(tag) ? 1 : 0),
      0
    );
    lockScore += profileTagMatches * 0.35;

    scoreDelta += Math.max(-6, Math.min(6, lockScore));
  });

  return {
    scoreDelta
  };
}

function buildStrengths(allTags, damageTypes, priority, composition, synergyReport, draftBalanceReport) {
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
  (draftBalanceReport?.strengths || []).forEach((item) => {
    strengths.push(item);
  });

  if (!strengths.length) {
    strengths.push(`Composition coherente avec une priorite marquee sur ${priority}.`);
  }

  return strengths.slice(0, 4);
}

function buildWarnings(allTags, damageTypes, risk, composition, synergyReport, draftBalanceReport) {
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
  (draftBalanceReport?.warnings || []).forEach((item) => {
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

function analyzeDraftBalance(composition, metaByChampion) {
  const strengths = [];
  const warnings = [];
  let scoreDelta = 0;

  const byRole = composition.reduce((accumulator, champion) => {
    accumulator[champion.role] = champion;
    return accumulator;
  }, {});

  const soloLaneRoles = ["top", "mid"];
  const stableSoloLanes = soloLaneRoles.filter((role) =>
    isRoleLaneStable(byRole[role], role, metaByChampion)
  );
  const weakSoloLanes = soloLaneRoles.filter((role) =>
    isRoleLaneWeak(byRole[role], role, metaByChampion)
  );

  const jungleStable = isRoleLaneStable(byRole.jungle, "jungle", metaByChampion);
  const jungleWeak = isRoleLaneWeak(byRole.jungle, "jungle", metaByChampion);
  const botlaneStable = isBotlaneStable(byRole.adc, byRole.support, metaByChampion);
  const botlaneWeak = isBotlaneWeak(byRole.adc, byRole.support, metaByChampion);

  const stableSlots = stableSoloLanes.length + (jungleStable ? 1 : 0) + (botlaneStable ? 1 : 0);
  const weakSlots = weakSoloLanes.length + (jungleWeak ? 1 : 0) + (botlaneWeak ? 1 : 0);

  if (stableSlots >= 3) {
    strengths.push("Base de lanes assez stable, la draft a moins de risques de s'effondrer trop tot.");
    scoreDelta += 6;
  }

  if (weakSlots >= 3) {
    warnings.push("Trop de zones fragiles en meme temps, la draft peut subir tres tot si les lanes se passent mal.");
    scoreDelta -= 8;
  } else if (weakSlots === 2) {
    warnings.push("Deux zones de draft paraissent plus fragiles, il faudra bien gerer les premiers timings.");
    scoreDelta -= 4;
  }

  const earlyPressureCount = composition.filter((champion) => getEarlyPressureScore(champion) >= 6.2).length;
  const lateScalingCount = composition.filter((champion) => getLateScalingScore(champion) >= 6.4).length;

  if (earlyPressureCount >= 2 && lateScalingCount >= 2) {
    strengths.push("Bon equilibre entre pression en debut de partie et scaling pour la suite.");
    scoreDelta += 5;
  } else if (earlyPressureCount <= 1 && lateScalingCount >= 3) {
    warnings.push("Draft tres orientee scaling avec peu d'appuis naturels pour tenir le debut de partie.");
    scoreDelta -= 5;
  } else if (earlyPressureCount >= 3 && lateScalingCount <= 1) {
    warnings.push("Draft tres poussee sur l'early, elle demandera de concretiser vite son avance.");
    scoreDelta -= 3;
  }

  const resourceDemandCount = composition.filter((champion) => getResourceDemand(champion) >= 6.2).length;
  const lowResourceCount = composition.filter((champion) => getResourceDemand(champion) <= 4.3).length;

  if (resourceDemandCount >= 3 && lowResourceCount === 0) {
    warnings.push("Beaucoup de picks gourmands en ressources, la draft peut se marcher dessus.");
    scoreDelta -= 6;
  } else if (resourceDemandCount <= 2 && lowResourceCount >= 1) {
    strengths.push("Repartition des ressources saine, tous les picks n'ont pas besoin d'etre nourris.");
    scoreDelta += 4;
  }

  return {
    scoreDelta,
    strengths: uniqueStrings(strengths).slice(0, 4),
    warnings: uniqueStrings(warnings).slice(0, 4)
  };
}

function getKnowledgeValue(knowledge, section, key) {
  if (section === "laneProfile") {
    return knowledge?.laneProfile === key ? 1 : knowledge?.laneProfile || "";
  }

  return knowledge?.[section]?.[key] || 0;
}

function getEarlyPressureScore(champion) {
  const knowledge = champion?.knowledge || {};
  const power = knowledge.powerCurve || {};
  const combat = knowledge.combatProfile || {};
  const laneBonus = knowledge.laneProfile === "forte" ? 1.1 : knowledge.laneProfile === "stable" ? 0.4 : -0.3;

  return (power.early || 0) + (combat.engage || 0) * 0.12 + (combat.poke || 0) * 0.08 + laneBonus;
}

function getLateScalingScore(champion) {
  const knowledge = champion?.knowledge || {};
  const power = knowledge.powerCurve || {};
  const utility = knowledge.utilityProfile || {};
  const combat = knowledge.combatProfile || {};

  return (power.late || 0) + (utility.scaling || 0) * 0.15 + (combat.sustainedDamage || 0) * 0.08;
}

function getResourceDemand(champion) {
  return champion?.knowledge?.draftProfile?.resourceDemand || 0;
}

function isRoleLaneStable(champion, role, metaByChampion) {
  if (!champion) {
    return false;
  }

  const knowledge = champion.knowledge || {};
  const meta = metaByChampion?.[champion.imageId] || null;
  const roleKey = riotRoleMap[role];
  const topSample = meta?.matchupsByRole?.[roleKey]?.favorable?.[0] || null;
  const laneProfile = knowledge.laneProfile || "";
  const blindReliability = knowledge.draftProfile?.blindReliability || 0;

  if (topSample?.timelineSamples >= 2) {
    return (
      (topSample.avgGoldDiffAt10 || 0) >= -120 &&
      (topSample.avgCsDiffAt10 || 0) >= -3 &&
      (topSample.avgXpDiffAt10 || 0) >= -120
    );
  }

  return laneProfile === "forte" || laneProfile === "stable" || blindReliability >= 6;
}

function isRoleLaneWeak(champion, role, metaByChampion) {
  if (!champion) {
    return false;
  }

  const knowledge = champion.knowledge || {};
  const meta = metaByChampion?.[champion.imageId] || null;
  const roleKey = riotRoleMap[role];
  const worstSample = meta?.matchupsByRole?.[roleKey]?.difficult?.[0] || null;
  const laneProfile = knowledge.laneProfile || "";
  const blindReliability = knowledge.draftProfile?.blindReliability || 0;

  if (worstSample?.timelineSamples >= 2) {
    return (
      (worstSample.avgGoldDiffAt10 || 0) <= -400 ||
      (worstSample.avgCsDiffAt10 || 0) <= -7 ||
      (worstSample.avgXpDiffAt10 || 0) <= -260
    );
  }

  return laneProfile === "faible" || blindReliability <= 4.4;
}

function isBotlaneStable(adc, support, metaByChampion) {
  if (!adc || !support) {
    return false;
  }

  const adcKnowledge = adc.knowledge || {};
  const supportKnowledge = support.knowledge || {};
  const supportPeel = supportKnowledge.combatProfile?.peel || 0;
  const laneScore =
    (adcKnowledge.laneProfile === "forte" ? 1.4 : adcKnowledge.laneProfile === "stable" ? 0.8 : 0) +
    (supportKnowledge.laneProfile === "forte" ? 1.2 : supportKnowledge.laneProfile === "stable" ? 0.8 : 0);

  const adcMeta = metaByChampion?.[adc.imageId] || null;
  const supportMeta = metaByChampion?.[support.imageId] || null;
  const adcBottom = getMetaRoleScore(adcMeta || {}, "adc");
  const supportUtility = getMetaRoleScore(supportMeta || {}, "support");

  return laneScore >= 1.6 || supportPeel >= 6 || (adcBottom >= 0.55 && supportUtility >= 0.55);
}

function isBotlaneWeak(adc, support, metaByChampion) {
  if (!adc || !support) {
    return false;
  }

  const adcKnowledge = adc.knowledge || {};
  const supportKnowledge = support.knowledge || {};
  const lanePenalty =
    (adcKnowledge.laneProfile === "faible" ? 1.2 : 0) +
    (supportKnowledge.laneProfile === "faible" ? 1.2 : 0);

  const selfPeel = (adcKnowledge.combatProfile?.peel || 0) + (supportKnowledge.combatProfile?.peel || 0);
  const antiDive = (adcKnowledge.draftProfile?.antiDive || 0) + (supportKnowledge.draftProfile?.antiDive || 0);

  return lanePenalty >= 1.2 && selfPeel + antiDive < 10.5;
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
  enemySelection,
  scoreOverride
}) {
  const duo = [adc, support];
  const tags = duo.flatMap((champion) => champion.tags);
  const rankedFallback = getBotlaneRankedFallback(adc, support, metaByChampion);
  const enemyMatchup = getBotlaneEnemyMatchupContext(adc, support, enemySelection, metaByChampion, pair);
  const score =
    scoreOverride ??
    Math.max(
      35,
      Math.min(
        99,
        Math.round(
          26 +
            scoreChampionFit(adc, "adc", profile, risk, priority, metaByChampion) * 0.26 +
            scoreChampionFit(support, "support", profile, risk, priority, metaByChampion) * 0.26 +
            (pair?.synergyScore || 0) * 0.05 +
            scoreBotlanePerformanceProfile(pair?.duoId) * 0.8 +
            enemyMatchup.score * 1.35
        )
      )
    );
  const performanceProfile = getBotlanePerformanceProfile(pair?.duoId || `${adc.imageId}::${support.imageId}`);
  const strengths = buildBotlaneStrengths(duo, pair, profile, metaByChampion, enemyMatchup);
  const warnings = buildBotlaneWarnings(tags, risk, enemyMatchup);
  const summary =
    `${getBotlaneDuoSummary(adc, support, pair, metaByChampion, enemyMatchup)} ` +
    `Attention surtout a ${warnings[0].toLowerCase()}`;

  return {
    duo,
    adc,
    support,
    pair,
    rankedFallback,
    performanceProfile,
    enemyMatchup,
    score,
    profile,
    strengths,
    warnings,
    summary
  };
}

function buildBotlaneStrengths(duo, pair, profile, metaByChampion, enemyMatchup = null) {
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
  if (enemyMatchup?.line) {
    strengths.push(enemyMatchup.line);
  }

  if (!strengths.length) {
    strengths.push(`un duo coherent avec une direction ${profile.title.toLowerCase()}.`);
  }

  return strengths.slice(0, 4).map(capitalizeFirst);
}

function buildBotlaneWarnings(tags, risk, enemyMatchup = null) {
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
  if (enemyMatchup?.warning) {
    warnings.push(enemyMatchup.warning);
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

      if (roleScore < 0.5 || !isSelectableRoleProfile(profile, role)) {
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

function isStrictRoleProfile(profile, role) {
  const knownPositions = profile?.positions || [];

  if (knownPositions.length) {
    return matchesChampionRolePosition(profile, role);
  }

  return (profile?.roleScores?.[role] || 0) >= 1;
}

function isSelectableRoleProfile(profile, role, metaByChampion = {}) {
  const meta = metaByChampion?.[profile.imageId] || null;

  if (meta?.games >= 3) {
    const dominantRole = getDominantMetaRole(meta);
    const roleScore = getMetaRoleScore(meta, role);

    if (dominantRole === role) {
      return true;
    }

    if (roleScore >= 0.18) {
      return true;
    }
  }

  const proEntries = getProChampionRoleEntries(profile.imageId, role);

  if (proEntries.length >= 2) {
    return true;
  }

  return isStrictRoleProfile(profile, role);
}

function isStrictRoleChampion(champion, role, metaByChampion = {}) {
  const meta = metaByChampion[champion.imageId] || null;

  if (meta?.games >= 4) {
    const dominantRole = getDominantMetaRole(meta);
    const roleScore = getMetaRoleScore(meta, role);

    if (dominantRole === role) {
      return true;
    }

    return roleScore >= 0.45;
  }

  return matchesChampionRolePosition(champion, role);
}

function getRoleChampionOptions(role, metaByChampion = {}) {
  return Object.values(championProfiles)
    .filter((profile) => isSelectableRoleProfile(profile, role, metaByChampion))
    .map((profile) => ({ imageId: profile.imageId, name: profile.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getMetaRoleScore(meta, role) {
  const roleMeta = getChampionMetaForRole(meta, role);
  const totalKnownRoles = Object.entries(meta.roleStats || meta.positions || {}).reduce((sum, [position, countOrEntry]) => {
    if (position === "UNKNOWN") return sum;
    const count = typeof countOrEntry === "number" ? countOrEntry : countOrEntry?.games || 0;
    return sum + count;
  }, 0);

  if (!roleMeta?.roleKey || !totalKnownRoles) return 0;

  return (roleMeta.games || 0) / totalKnownRoles;
}

function getDominantMetaRole(meta) {
  const entries = Object.entries(meta.roleStats || meta.positions || {})
    .filter(([position]) => position !== "UNKNOWN")
    .sort((a, b) => {
      const left = typeof a[1] === "number" ? a[1] : a[1]?.games || 0;
      const right = typeof b[1] === "number" ? b[1] : b[1]?.games || 0;
      return right - left;
    });

  if (!entries.length) return null;

  return appRoleMap[entries[0][0]] || null;
}

function getProRoleBucket(role) {
  const roleKey = riotRoleMap[role];

  if (!roleKey) {
    return null;
  }

  return (
    proRoleMatchupBuckets[roleKey] ||
    proRoleMatchupBuckets[roleKey === "BOTTOM" ? "ADC" : roleKey === "UTILITY" ? "SUPPORT" : roleKey] ||
    null
  );
}

function getProChampionRoleEntries(championId, role) {
  const bucket = getProRoleBucket(role);
  return bucket?.byChampion?.[championId]?.entries || [];
}

function getProChampionRoleRobustness(championId, role) {
  const bucket = getProRoleBucket(role);
  const champion = bucket?.byChampion?.[championId] || null;

  if (!champion || !champion.entries?.length) {
    return null;
  }

  return champion.matchupRobustness || 0;
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

export function getChampionMetaForRole(meta, role) {
  if (!meta || !role) {
    return null;
  }

  const roleKey = riotRoleMap[role];

  if (!roleKey) {
    return null;
  }

  const roleSummary = meta.roleStats?.[roleKey];

  if (roleSummary?.games) {
    return {
      ...roleSummary,
      roleKey
    };
  }

  const roleGames = meta.positions?.[roleKey] || 0;

  if (!roleGames) {
    return null;
  }

  return {
    games: roleGames,
    wins: null,
    winRate: null,
    pickRate: null,
    sampleWeight: Math.min(1, roleGames / 8),
    roleKey
  };
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

export function getDirectChampionMatchupData(champion, opponent, metaByChampion = {}) {
  if (!champion?.role || !opponent?.imageId) {
    return null;
  }

  const meta = metaByChampion[champion.imageId] || null;
  const roleKey = riotRoleMap[champion.role];
  const sample =
    meta?.matchupsByRole?.[roleKey]?.entries?.find((entry) => entry.id === opponent.imageId) || null;
  const proSample =
    getProChampionRoleEntries(champion.imageId, champion.role).find(
      (entry) => entry.opponentId === opponent.imageId
    ) || null;
  const heuristicScore = scoreChampionMatchupHeuristic(champion, opponent);
  const sampleScore = sample ? scoreChampionMatchupSample(sample) : 0;
  const proScore = proSample ? scoreChampionProMatchupSample(proSample) : 0;
  const score = getCombinedMatchupScore(
    sampleScore,
    proScore,
    heuristicScore,
    Boolean(sample),
    Boolean(proSample)
  );

  return {
    score,
    confidence: getMatchupConfidence(sample, proSample),
    negativeSignal: getNegativeMatchupSignal(sample, proSample, heuristicScore, score),
    positiveSignal: getPositiveMatchupSignal(sample, proSample, heuristicScore, score),
    sample,
    proSample
  };
}

export function getChampionMatchupInsights(champion, metaByChampion = {}) {
  if (!champion?.role) {
    return { favorable: [], difficult: [] };
  }

  const meta = metaByChampion[champion.imageId] || null;
  const roleKey = riotRoleMap[champion.role];
  const sampledEntries = meta?.matchupsByRole?.[roleKey]?.entries || [];
  const sampledById = Object.fromEntries(sampledEntries.map((entry) => [entry.id, entry]));
  const proEntries = getProChampionRoleEntries(champion.imageId, champion.role);
  const proById = Object.fromEntries(proEntries.map((entry) => [entry.opponentId, entry]));
  const roleCandidates = (championPool[champion.role] || []).filter((candidate) => {
    if (candidate.imageId === champion.imageId) {
      return false;
    }

    return isStrictRoleChampion(candidate, champion.role, metaByChampion);
  });

  const combined = roleCandidates.map((opponent) => {
    const sample = sampledById[opponent.imageId] || null;
    const proSample = proById[opponent.imageId] || null;
    const heuristicScore = scoreChampionMatchupHeuristic(champion, opponent);
    const directData =
      getDirectChampionMatchupData(champion, opponent, metaByChampion) || {};
    const totalScore = directData.score ?? heuristicScore;
    const negativeSignal = directData.negativeSignal ?? false;
    const positiveSignal = directData.positiveSignal ?? false;
    const confidence = directData.confidence ?? 0;

    return {
      id: opponent.imageId,
      name: opponent.name,
      score: totalScore,
      confidence,
      negativeSignal,
      positiveSignal,
      source: sample || proSample ? "Ranked + pro + profil" : "Profil champion",
      reason: describeChampionMatchup(champion, opponent, champion.role, sample, proSample, heuristicScore),
      sample,
      proSample
    };
  });

  const favorable = combined
    .filter((entry) => entry.positiveSignal || entry.score >= 0.15)
    .sort((first, second) => {
      const firstPriority = getMatchupPriorityScore(first, "positive");
      const secondPriority = getMatchupPriorityScore(second, "positive");

      if (secondPriority !== firstPriority) {
        return secondPriority - firstPriority;
      }

      if (second.score !== first.score) {
        return second.score - first.score;
      }

      return second.confidence - first.confidence;
    })
    .slice(0, 3);

  let difficult = combined
    .filter((entry) => entry.negativeSignal || entry.score <= -0.15)
    .sort((first, second) => {
      const firstPriority = getMatchupPriorityScore(first, "negative");
      const secondPriority = getMatchupPriorityScore(second, "negative");

      if (secondPriority !== firstPriority) {
        return secondPriority - firstPriority;
      }

      if (first.score !== second.score) {
        return first.score - second.score;
      }

      return second.confidence - first.confidence;
    })
    .slice(0, 3);

  if (difficult.length < 3) {
    const fillerIds = new Set(difficult.map((entry) => entry.id));
    const fallback = combined
      .filter((entry) => !fillerIds.has(entry.id))
      .sort((first, second) => {
        const firstPriority = getMatchupPriorityScore(first, "negative");
        const secondPriority = getMatchupPriorityScore(second, "negative");

        if (secondPriority !== firstPriority) {
          return secondPriority - firstPriority;
        }

        if (first.score !== second.score) {
          return first.score - second.score;
        }

        return second.confidence - first.confidence;
      })
      .slice(0, 3 - difficult.length);

    difficult = [...difficult, ...fallback];
  }

  return { favorable, difficult };
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

function scoreChampionMatchupSample(sample) {
  const games = sample.games || 0;
  const winRate = sample.winRate || 0.5;
  const sampleStrength = Math.min(1, games / 8);
  const edge = winRate - 0.5;
  const laneSignal =
    normalizeMatchupMetric(sample.avgGoldDiffAt10 || 0, 650) * 2.2 +
    normalizeMatchupMetric(sample.avgCsDiffAt10 || 0, 14) * 1.6 +
    normalizeMatchupMetric(sample.avgXpDiffAt10 || 0, 500) * 1.4;

  return edge * (9 + sampleStrength * 5) + Math.min(2.4, games * 0.22) + laneSignal;
}

function scoreChampionProMatchupSample(sample) {
  const games = sample.games || 0;
  const winRate = sample.winRate || 0.5;
  const confidence = sample.confidence || Math.min(1, games / 5);
  const freshness = sample.freshness || 0;
  const edge = winRate - 0.5;

  return edge * (9 + confidence * 5) + games * 0.35 + freshness * 1.4;
}

function getCombinedMatchupScore(rankedScore, proScore, heuristicScore, hasRanked, hasPro) {
  if (hasRanked && hasPro) {
    return rankedScore * 0.55 + proScore * 0.3 + heuristicScore * 0.15;
  }

  if (hasRanked) {
    return rankedScore * 0.8 + heuristicScore * 0.2;
  }

  if (hasPro) {
    return proScore * 0.72 + heuristicScore * 0.28;
  }

  return heuristicScore;
}

function getMatchupConfidence(sample, proSample) {
  const rankedGames = sample?.games || 0;
  const proGames = proSample?.games || 0;

  return Math.min(1, rankedGames / 6) + Math.min(0.8, proGames / 5) * 0.7;
}

function getMatchupPriorityScore(entry, direction) {
  const sign = direction === "negative" ? -1 : 1;
  let score = (entry.score || 0) * sign;
  const sample = entry.sample || null;
  const proSample = entry.proSample || null;

  if (sample?.games) {
    score += 2.4;
    score += Math.min(3.2, sample.games * 0.18);
    score += ((sample.winRate || 0.5) - 0.5) * sign * 13;
    score += normalizeMatchupMetric(sample.avgGoldDiffAt10 || 0, 650) * sign * 2.3;
    score += normalizeMatchupMetric(sample.avgCsDiffAt10 || 0, 14) * sign * 1.7;
    score += normalizeMatchupMetric(sample.avgXpDiffAt10 || 0, 500) * sign * 1.5;
  }

  if (proSample?.games) {
    score += 1.1;
    score += Math.min(1.8, proSample.games * 0.22);
    score += ((proSample.winRate || 0.5) - 0.5) * sign * 9;
    score += (proSample.confidence || 0) * 1.1;
  }

  if (direction === "positive") {
    if (entry.positiveSignal) score += 3.6;
    if (entry.negativeSignal) score -= 3.6;
  } else {
    if (entry.negativeSignal) score += 3.6;
    if (entry.positiveSignal) score -= 3.6;
  }

  score += (entry.confidence || 0) * 1.5;

  return score;
}

function getNegativeMatchupSignal(sample, proSample, heuristicScore, totalScore) {
  if (sample?.games >= 3 && (sample.winRate || 0.5) <= 0.44) {
    return true;
  }

  if (
    (sample?.timelineSamples || 0) >= 2 &&
    ((sample.avgGoldDiffAt10 || 0) <= -450 ||
      (sample.avgCsDiffAt10 || 0) <= -8 ||
      (sample.avgXpDiffAt10 || 0) <= -320)
  ) {
    return true;
  }

  if (proSample?.games >= 2 && (proSample.winRate || 0.5) <= 0.42) {
    return true;
  }

  if (heuristicScore <= -1.1 && totalScore <= -0.1) {
    return true;
  }

  return totalScore <= -0.55;
}

function getPositiveMatchupSignal(sample, proSample, heuristicScore, totalScore) {
  if (sample?.games >= 3 && (sample.winRate || 0.5) >= 0.56) {
    return true;
  }

  if (
    (sample?.timelineSamples || 0) >= 2 &&
    ((sample.avgGoldDiffAt10 || 0) >= 450 ||
      (sample.avgCsDiffAt10 || 0) >= 8 ||
      (sample.avgXpDiffAt10 || 0) >= 320)
  ) {
    return true;
  }

  if (proSample?.games >= 2 && (proSample.winRate || 0.5) >= 0.58) {
    return true;
  }

  if (heuristicScore >= 1.1 && totalScore >= 0.1) {
    return true;
  }

  return totalScore >= 0.55;
}

function normalizeMatchupMetric(value, baseline) {
  if (!baseline) {
    return 0;
  }

  return Math.max(-1.5, Math.min(1.5, value / baseline));
}

function scoreChampionMatchupHeuristic(champion, opponent) {
  const selfKnowledge = champion.knowledge || {};
  const opponentKnowledge = opponent.knowledge || {};
  const selfCombat = selfKnowledge.combatProfile || {};
  const opponentCombat = opponentKnowledge.combatProfile || {};
  const selfUtility = selfKnowledge.utilityProfile || {};
  const opponentUtility = opponentKnowledge.utilityProfile || {};
  const selfPower = selfKnowledge.powerCurve || {};
  const opponentPower = opponentKnowledge.powerCurve || {};
  const selfDraft = selfKnowledge.draftProfile || {};
  const opponentDraft = opponentKnowledge.draftProfile || {};

  let score = 0;

  const rangeDelta = (champion.range || 0) - (opponent.range || 0);
  if (rangeDelta >= 175) score += 1.1;
  if (rangeDelta <= -175) score -= 1.1;

  if (selfKnowledge.laneProfile === "forte" && (opponentKnowledge.laneProfile === "faible" || (opponentPower.early || 0) < 4.8)) {
    score += 1.4;
  }
  if (opponentKnowledge.laneProfile === "forte" && (selfKnowledge.laneProfile === "faible" || (selfPower.early || 0) < 4.8)) {
    score -= 1.4;
  }

  if ((selfCombat.poke || 0) >= 6 && rangeDelta >= 125 && (opponentDraft.antiPoke || 0) < 5.5) {
    score += 1;
  }
  if ((opponentCombat.poke || 0) >= 6 && rangeDelta <= -125 && (selfDraft.antiPoke || 0) < 5.5) {
    score -= 1;
  }

  if ((selfCombat.engage || 0) >= 6 && ((opponentCombat.peel || 0) + (opponentDraft.antiDive || 0)) < 10) {
    score += 0.9;
  }
  if ((opponentCombat.engage || 0) >= 6 && ((selfCombat.peel || 0) + (selfDraft.antiDive || 0)) < 10) {
    score -= 0.9;
  }

  if ((selfCombat.burst || 0) >= 6 && (opponentUtility.safety || 0) < 5) {
    score += 0.7;
  }
  if ((opponentCombat.burst || 0) >= 6 && (selfUtility.safety || 0) < 5) {
    score -= 0.7;
  }

  if (champion.role === "jungle") {
    score += ((selfPower.early || 0) - (opponentPower.early || 0)) * 0.18;
    score += ((selfDraft.objectiveValue || 0) - (opponentDraft.objectiveValue || 0)) * 0.14;
    score += ((selfDraft.roamPower || 0) - (opponentDraft.roamPower || 0)) * 0.12;
  } else {
    score += ((selfCombat.waveclear || 0) - (opponentCombat.waveclear || 0)) * 0.08;
    score += ((selfPower.early || 0) - (opponentPower.early || 0)) * 0.12;
  }

  return score;
}

function describeChampionMatchup(champion, opponent, role, sample, proSample, heuristicScore) {
  if (sample?.games >= 2) {
    if ((sample.winRate || 0) >= 0.6) {
      return `Avantage vu sur ${sample.games} matchs ranked sur ce poste.`;
    }
    if ((sample.winRate || 0) <= 0.4) {
      return `Matchup plus dur sur ${sample.games} matchs ranked sur ce poste.`;
    }
    if (sample.games >= 4) {
      return `Lecture surtout basee sur ${sample.games} matchs ranked du meme poste.`;
    }
  }

  if (proSample?.games >= 2) {
    if ((proSample.winRate || 0) >= 0.6) {
      return `Avantage confirme en competition recente sur ${proSample.games} drafts pros.`;
    }
    if ((proSample.winRate || 0) <= 0.4) {
      return `Matchup plus dur en competition recente sur ${proSample.games} drafts pros.`;
    }

    return `Lecture aussi confirmee par ${proSample.games} drafts pros recentes.`;
  }

  const selfKnowledge = champion.knowledge || {};
  const opponentKnowledge = opponent.knowledge || {};
  const selfCombat = selfKnowledge.combatProfile || {};
  const opponentCombat = opponentKnowledge.combatProfile || {};

  const rangeDelta = (champion.range || 0) - (opponent.range || 0);
  if (heuristicScore >= 0.6) {
    if (rangeDelta >= 175) return "Profil de lane avantageux grace a la portee.";
    if ((selfCombat.poke || 0) >= 6) return "Peut prendre le dessus par la pression a distance.";
    if ((selfCombat.engage || 0) >= 6) return "Peut forcer des trades ou des engages favorables.";
    if (role === "jungle") return "Profil plus fort pour le tempo et les premiers objectifs.";
    return "Profil de kit plutot favorable sur ce matchup.";
  }

  if (heuristicScore <= -0.6) {
    if (rangeDelta <= -175) return "Peut subir la portee et perdre l'initiative de lane.";
    if ((opponentCombat.poke || 0) >= 6) return "Risque de subir la pression ou le harass en lane.";
    if ((opponentCombat.engage || 0) >= 6) return "Peut etre mis sous pression par les engages adverses.";
    if (role === "jungle") return "Matchup plus complique pour les premiers tempos de jungle.";
    return "Profil de kit plutot inconfortable sur ce matchup.";
  }

  return "Lecture surtout heuristique, avec un matchup assez neutre pour l'instant.";
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
