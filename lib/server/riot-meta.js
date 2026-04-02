import { promises as fs } from "fs";
import path from "path";

const DATA_DRAGON_VERSION = "16.6.1";
const DATA_DRAGON_URL =
  `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/data/en_US/champion.json`;

const DEFAULT_PLATFORM = process.env.RIOT_PLATFORM || "EUW1";
const DEFAULT_REGION = process.env.RIOT_REGION || "EUROPE";
const SAMPLE_SUMMONERS = Number(process.env.RIOT_META_SUMMONERS || 4);
const MATCHES_PER_SUMMONER = Number(process.env.RIOT_META_MATCHES_PER_SUMMONER || 3);
const CACHE_TTL_MS = 1000 * 60 * 20;
const WARMUP_CACHE_TTL_MS = 1000 * 60 * 1;
const RIOT_WINDOW_MS = 1000 * 60 * 2;
const RIOT_MAX_REQUESTS_PER_WINDOW = 100;
const RIOT_REQUEST_SAFETY_BUFFER = 8;
const TARGET_MATCH_SAMPLE = Number(process.env.RIOT_META_TARGET_MATCHES || 1000);
const MATCH_POOL_RESET_MS = 1000 * 60 * 60 * 8;
const FULL_SAMPLE_HOLD_MS = 1000 * 60 * 60 * 24 * 7;
const ROLLING_STORE_PATH = path.join(process.cwd(), "data", "riot-rolling-store.json");
const HIGH_ELO_QUEUES = [
  "challengerleagues",
  "grandmasterleagues",
  "masterleagues"
];
const MATCHUP_ROLE_KEYS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

let memoryCache = {
  expiresAt: 0,
  value: null
};

let requestHistory = [];
let rollingMatchStore = createEmptyRollingMatchStore();
let rollingStoreLoaded = false;
let persistenceDisabled = false;

export async function getMetaSnapshot() {
  await ensureRollingStoreLoaded();

  if (memoryCache.value && Date.now() < memoryCache.expiresAt) {
    return memoryCache.value;
  }

  const apiKey = process.env.RIOT_API_KEY;
  const patch = await getCurrentPatch();
  const samplingPlan = getSamplingPlan();

  if (!apiKey) {
    if (hasStoredRollingSample()) {
      return cacheSnapshot(
        buildStoredFallbackSnapshot(
          patch,
          "Echantillon ranked local",
          "La connexion Riot live n'est pas disponible, le site utilise le dernier echantillon ranked deja enregistre."
        )
      );
    }

    return cacheSnapshot(
      buildUnavailableSnapshot(
        patch,
        "Riot Data Dragon",
        "Ajoutez RIOT_API_KEY dans .env.local pour activer la meta live."
      )
    );
  }

  try {
    if (shouldReuseFullSample(patch)) {
      const backfilledTimelines = await backfillStoredTimelines(
        apiKey,
        Math.max(2, Math.min(8, samplingPlan.matchesPerSummoner * 2))
      );

      if (backfilledTimelines > 0) {
        await persistRollingStore();
      }

      return cacheSnapshot(buildSnapshotFromRollingStore(patch));
    }

    const rollingState = prepareRollingMatchStore(patch);
    const championMap = await getChampionMap();
    const leagueResponses = await runInBatches(
      HIGH_ELO_QUEUES,
      HIGH_ELO_QUEUES.length,
      (queueType) =>
        riotFetchJson(
          `${platformBaseUrl(DEFAULT_PLATFORM)}/lol/league/v4/${queueType}/by-queue/RANKED_SOLO_5x5`,
          apiKey
        )
    );

    const allEntries = leagueResponses.flatMap((league) => league?.entries || []);
    const sortedPuuids = [...new Set(
      allEntries
        .sort((first, second) => (second.leaguePoints || 0) - (first.leaguePoints || 0))
        .map((entry) => entry.puuid)
        .filter(Boolean)
    )];
    const puuids = pickRotatingSummoners(
      sortedPuuids,
      samplingPlan.summoners,
      rollingState.summonerOffset
    );

    const matchIdLists = await runInBatches(
      puuids,
      2,
      (puuid) =>
        riotFetchJson(
          `${regionalBaseUrl(DEFAULT_REGION)}/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=${rollingState.start}&count=${samplingPlan.matchesPerSummoner}`,
          apiKey
        )
    );

    const matchIds = [...new Set(matchIdLists.flat().filter(Boolean))];
    const missingMatchIds = matchIds.filter((matchId) => !rollingMatchStore.matchesById[matchId]);
    const missingTimelineIds = matchIds.filter(
      (matchId) => !rollingMatchStore.matchesById[matchId]?.timeline
    );
    const matches = await runInBatches(
      missingMatchIds,
      2,
      (matchId) =>
        riotFetchJson(`${regionalBaseUrl(DEFAULT_REGION)}/lol/match/v5/matches/${matchId}`, apiKey)
    );
    const timelines = await runInBatches(
      missingTimelineIds,
      2,
      (matchId) =>
        riotFetchJson(`${regionalBaseUrl(DEFAULT_REGION)}/lol/match/v5/matches/${matchId}/timeline`, apiKey)
    );

    attachTimelinesToMatches(matches, timelines);
    mergeTimelineIntoExistingStore(timelines);

    mergeRollingMatches(matches, patch);
    updateRollingCursor(rollingState, matchIds, matches);
    await persistRollingStore();

    const rollingMatches = rollingMatchStore.matchOrder
      .map((matchId) => rollingMatchStore.matchesById[matchId])
      .filter(Boolean);

    const aggregated = aggregateMatches(rollingMatches, championMap);
    const topChampions = Object.values(aggregated.byChampion)
      .filter((champion) => champion.games >= 2)
      .sort((first, second) => {
        if (second.pickRate !== first.pickRate) {
          return second.pickRate - first.pickRate;
        }

        return second.winRate - first.winRate;
      })
      .slice(0, 12);

    const snapshot = {
      connected: true,
      patch,
      source: "Riot API Master+ rolling sample",
      generatedAt: new Date().toISOString(),
      region: DEFAULT_PLATFORM,
      sampleMatches: rollingMatches.length,
      samplePlayers: puuids.length,
      requestBudget: {
        ...samplingPlan,
        targetMatches: TARGET_MATCH_SAMPLE,
        currentMatches: rollingMatches.length,
        fetchedThisRefresh: matches.length,
        fetchedTimelinesThisRefresh: timelines.length,
        requestedMatchIds: matchIds.length,
        startOffset: rollingState.start,
        uniqueHighEloPlayersSeen: sortedPuuids.length,
        summonerOffset: rollingState.summonerOffset
      },
      topChampions,
      byChampion: aggregated.byChampion
    };

    return cacheSnapshot(snapshot);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      if (hasStoredRollingSample()) {
        return cacheSnapshot(
          buildStoredFallbackSnapshot(
            patch,
            "Echantillon ranked local",
            "La cle Riot API n'est plus valide. Le site continue avec le dernier echantillon ranked deja enregistre."
          )
        );
      }

      return cacheSnapshot(
        buildUnavailableSnapshot(
          patch,
          "Riot API",
          "La cle Riot API n'est plus valide. Regenez une nouvelle development key puis redemarrez le site."
        )
      );
    }

    if (error?.status === 429) {
      if (hasStoredRollingSample()) {
        return cacheSnapshot(
          buildStoredFallbackSnapshot(
            patch,
            "Echantillon ranked local",
            "Riot limite temporairement les requetes. Le site reutilise le dernier echantillon ranked deja enregistre."
          )
        );
      }

      return cacheSnapshot(
        buildUnavailableSnapshot(
          patch,
          "Riot API",
          "Riot limite temporairement les requetes. Reessayez dans une minute."
        )
      );
    }

    throw error;
  }
}

async function getCurrentPatch() {
  const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", {
    next: { revalidate: 60 * 60 }
  });

  if (!response.ok) {
    return DATA_DRAGON_VERSION;
  }

  const versions = await response.json();
  return versions[0] || DATA_DRAGON_VERSION;
}

async function getChampionMap() {
  const response = await fetch(DATA_DRAGON_URL, {
    next: { revalidate: 60 * 60 * 6 }
  });

  if (!response.ok) {
    throw new Error("Impossible de charger la map des champions.");
  }

  const payload = await response.json();
  const byKey = {};

  Object.values(payload.data).forEach((champion) => {
    byKey[Number(champion.key)] = champion.id;
  });

  return byKey;
}

function aggregateMatches(matches, championMap) {
  const byChampion = {};
  const totalParticipants = matches.reduce(
    (sum, match) => sum + (match.info?.participants?.length || 0),
    0
  );

  matches.forEach((match) => {
    const participants = match.info?.participants || [];

    participants.forEach((participant) => {
      const imageId = championMap[participant.championId];

      if (!imageId) {
        return;
      }

      if (!byChampion[imageId]) {
        byChampion[imageId] = {
          id: imageId,
          name: participant.championName,
          games: 0,
          wins: 0,
          winRate: 0,
          pickRate: 0,
          sampleWeight: 0,
          positions: {},
          matchupsByRole: {}
        };
      }

      const champion = byChampion[imageId];
      champion.games += 1;
      champion.wins += participant.win ? 1 : 0;

      const position = getParticipantRoleKey(participant);
      champion.positions[position] = (champion.positions[position] || 0) + 1;
    });

    recordRoleMatchups(participants, championMap, byChampion, match);
  });

  Object.values(byChampion).forEach((champion) => {
    champion.winRate = champion.games ? champion.wins / champion.games : 0;
    champion.pickRate = totalParticipants ? champion.games / totalParticipants : 0;
    champion.sampleWeight = Math.min(1, champion.games / 8);

    Object.keys(champion.matchupsByRole || {}).forEach((roleKey) => {
      const roleBucket = champion.matchupsByRole[roleKey];
      const entries = Object.values(roleBucket.entries || {}).map((entry) => ({
        id: entry.id,
        name: entry.name,
        games: entry.games,
        wins: entry.wins,
        winRate: entry.games ? entry.wins / entry.games : 0,
        timelineSamples: entry.timelineSamples || 0,
        avgGoldDiffAt10: entry.timelineSamples ? entry.goldDiffAt10 / entry.timelineSamples : 0,
        avgCsDiffAt10: entry.timelineSamples ? entry.csDiffAt10 / entry.timelineSamples : 0,
        avgXpDiffAt10: entry.timelineSamples ? entry.xpDiffAt10 / entry.timelineSamples : 0,
        score: scoreMatchupSample(entry)
      }));

      entries.sort((first, second) => second.score - first.score);

      champion.matchupsByRole[roleKey] = {
        entries,
        favorable: entries.slice(0, 5),
        difficult: [...entries].sort((first, second) => first.score - second.score).slice(0, 5)
      };
    });
  });

  return { byChampion };
}

async function riotFetchJson(url, apiKey) {
  await waitForRateLimitSlot();

  const response = await fetch(url, {
    headers: {
      "X-Riot-Token": apiKey
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const error = new Error(`Riot API error ${response.status} sur ${url}`);
    error.status = response.status;
    error.url = url;
    throw error;
  }

  return response.json();
}

async function runInBatches(items, batchSize, worker) {
  const results = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await worker(item);
        } catch (error) {
          if (error?.status === 429) {
            return null;
          }

          throw error;
        }
      })
    );
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

function platformBaseUrl(platform) {
  return `https://${platform.toLowerCase()}.api.riotgames.com`;
}

function regionalBaseUrl(region) {
  return `https://${region.toLowerCase()}.api.riotgames.com`;
}

function recordRoleMatchups(participants, championMap, byChampion, match = null) {
  MATCHUP_ROLE_KEYS.forEach((roleKey) => {
    const roleParticipants = participants.filter(
      (participant) => getParticipantRoleKey(participant) === roleKey
    );

    if (roleParticipants.length !== 2) {
      return;
    }

    const [first, second] = roleParticipants;
    const timelineStats = getRoleTimelineStats(match?.timeline, first, second);
    recordSingleMatchup(first, second, roleKey, championMap, byChampion, timelineStats?.first || null);
    recordSingleMatchup(second, first, roleKey, championMap, byChampion, timelineStats?.second || null);
  });
}

function recordSingleMatchup(participant, opponent, roleKey, championMap, byChampion, timelineStats = null) {
  const championId = championMap[participant.championId];
  const opponentId = championMap[opponent.championId];

  if (!championId || !opponentId || championId === opponentId) {
    return;
  }

  const champion = byChampion[championId];

  if (!champion.matchupsByRole[roleKey]) {
    champion.matchupsByRole[roleKey] = {
      entries: {}
    };
  }

  if (!champion.matchupsByRole[roleKey].entries[opponentId]) {
    champion.matchupsByRole[roleKey].entries[opponentId] = {
      id: opponentId,
      name: opponent.championName,
      games: 0,
      wins: 0,
      timelineSamples: 0,
      goldDiffAt10: 0,
      csDiffAt10: 0,
      xpDiffAt10: 0
    };
  }

  const entry = champion.matchupsByRole[roleKey].entries[opponentId];
  entry.games += 1;
  entry.wins += participant.win ? 1 : 0;

  if (timelineStats) {
    entry.timelineSamples += 1;
    entry.goldDiffAt10 += timelineStats.goldDiffAt10;
    entry.csDiffAt10 += timelineStats.csDiffAt10;
    entry.xpDiffAt10 += timelineStats.xpDiffAt10;
  }
}

function getParticipantRoleKey(participant) {
  const rawRole = participant?.teamPosition || participant?.individualPosition || "UNKNOWN";

  if (MATCHUP_ROLE_KEYS.includes(rawRole)) {
    return rawRole;
  }

  return "UNKNOWN";
}

function scoreMatchupSample(entry) {
  const winRate = entry.games ? entry.wins / entry.games : 0.5;
  const sampleWeight = Math.min(1, entry.games / 4);
  const laneSignal =
    normalizeLaneMetric(entry.timelineSamples ? entry.goldDiffAt10 / entry.timelineSamples : 0, 650) * 2.4 +
    normalizeLaneMetric(entry.timelineSamples ? entry.csDiffAt10 / entry.timelineSamples : 0, 14) * 1.8 +
    normalizeLaneMetric(entry.timelineSamples ? entry.xpDiffAt10 / entry.timelineSamples : 0, 500) * 1.6;

  return (winRate - 0.5) * (8 + sampleWeight * 4) + entry.games * 0.08 + laneSignal;
}

function getSamplingPlan() {
  const maxRequests = Math.max(1, RIOT_MAX_REQUESTS_PER_WINDOW - RIOT_REQUEST_SAFETY_BUFFER);
  const fixedRequests = HIGH_ELO_QUEUES.length;
  const budgetForSampling = Math.max(1, maxRequests - fixedRequests);
  const requestedSummoners = Math.max(1, SAMPLE_SUMMONERS);
  const requestedMatches = Math.max(1, MATCHES_PER_SUMMONER);
  const getSamplingCost = (summonerCount, perSummonerMatches) =>
    summonerCount + summonerCount * perSummonerMatches * 2;

  let bestPlan = {
    summoners: 1,
    matchesPerSummoner: 1,
    score: -Infinity
  };

  for (let summoners = 1; summoners <= 16; summoners += 1) {
    for (let matchesPerSummoner = 1; matchesPerSummoner <= 12; matchesPerSummoner += 1) {
      const cost = getSamplingCost(summoners, matchesPerSummoner);

      if (cost > budgetForSampling) {
        continue;
      }

      const breadthWeight = 1.25;
      const depthWeight = 0.7;
      const preferencePenalty =
        Math.abs(summoners - requestedSummoners) * 0.08 +
        Math.abs(matchesPerSummoner - requestedMatches) * 0.05;
      const score =
        summoners * breadthWeight +
        matchesPerSummoner * depthWeight -
        preferencePenalty;

      if (score > bestPlan.score) {
        bestPlan = {
          summoners,
          matchesPerSummoner,
          score
        };
      }
    }
  }

  const { summoners, matchesPerSummoner } = bestPlan;

  return {
    maxRequestsPerWindow: RIOT_MAX_REQUESTS_PER_WINDOW,
    windowMs: RIOT_WINDOW_MS,
    safetyBuffer: RIOT_REQUEST_SAFETY_BUFFER,
    fixedRequests,
    summoners,
    matchesPerSummoner,
    estimatedRequests: fixedRequests + summoners + summoners * matchesPerSummoner * 2
  };
}

function createEmptyRollingMatchStore() {
  return {
    patch: null,
    updatedAt: 0,
    nextCursor: 0,
    summonerCursor: 0,
    matchesById: {},
    matchOrder: []
  };
}

function prepareRollingMatchStore(patch) {
  const now = Date.now();
  const keepCurrentFullSample =
    rollingMatchStore.matchOrder.length >= TARGET_MATCH_SAMPLE &&
    now - rollingMatchStore.updatedAt < FULL_SAMPLE_HOLD_MS;

  if (
    !rollingMatchStore.patch ||
    (rollingMatchStore.patch !== patch && !keepCurrentFullSample) ||
    now - rollingMatchStore.updatedAt > MATCH_POOL_RESET_MS
  ) {
    rollingMatchStore = createEmptyRollingMatchStore();
    rollingMatchStore.patch = patch;
  }

  return {
    start: rollingMatchStore.matchOrder.length >= TARGET_MATCH_SAMPLE
      ? 0
      : rollingMatchStore.nextCursor * Math.max(1, MATCHES_PER_SUMMONER),
    currentCount: rollingMatchStore.matchOrder.length,
    summonerOffset: rollingMatchStore.summonerCursor
  };
}

function shouldReuseFullSample(patch) {
  if (!rollingMatchStore.matchOrder.length || rollingMatchStore.matchOrder.length < TARGET_MATCH_SAMPLE) {
    return false;
  }

  const now = Date.now();
  const withinHoldWindow = now - rollingMatchStore.updatedAt < FULL_SAMPLE_HOLD_MS;

  if (!withinHoldWindow) {
    return false;
  }

  if (!rollingMatchStore.patch) {
    rollingMatchStore.patch = patch;
  }

  return true;
}

function buildSnapshotFromRollingStore(patch) {
  const championMap = rollingMatchStore.matchOrder
    .map((matchId) => rollingMatchStore.matchesById[matchId])
    .filter(Boolean);
  const aggregated = aggregateMatches(championMap, createChampionMapFromRollingStore(championMap));
  const topChampions = Object.values(aggregated.byChampion)
    .filter((champion) => champion.games >= 2)
    .sort((first, second) => {
      if (second.pickRate !== first.pickRate) {
        return second.pickRate - first.pickRate;
      }

      return second.winRate - first.winRate;
    })
    .slice(0, 12);

  return {
    connected: true,
    liveConnected: true,
    patch: rollingMatchStore.patch || patch,
    source: "Riot API Master+ rolling sample",
    generatedAt: new Date().toISOString(),
    region: DEFAULT_PLATFORM,
    sampleMatches: championMap.length,
    samplePlayers: 0,
    requestBudget: {
      maxRequestsPerWindow: RIOT_MAX_REQUESTS_PER_WINDOW,
      windowMs: RIOT_WINDOW_MS,
      safetyBuffer: RIOT_REQUEST_SAFETY_BUFFER,
      targetMatches: TARGET_MATCH_SAMPLE,
      currentMatches: championMap.length,
      fetchedThisRefresh: 0,
      fetchedTimelinesThisRefresh: 0,
      requestedMatchIds: 0,
      startOffset: rollingMatchStore.nextCursor * Math.max(1, MATCHES_PER_SUMMONER),
      uniqueHighEloPlayersSeen: 0,
      summonerOffset: rollingMatchStore.summonerCursor || 0,
      holdUntil: new Date(rollingMatchStore.updatedAt + FULL_SAMPLE_HOLD_MS).toISOString(),
      mode: "locked-full-sample"
    },
    topChampions,
    byChampion: aggregated.byChampion
  };
}

function hasStoredRollingSample() {
  return Boolean(rollingMatchStore.matchOrder?.length);
}

function buildStoredFallbackSnapshot(patch, source, message) {
  const snapshot = buildSnapshotFromRollingStore(patch);

  return {
    ...snapshot,
    connected: true,
    liveConnected: false,
    source,
    message,
    generatedAt: new Date().toISOString(),
    requestBudget: {
      ...(snapshot.requestBudget || {}),
      mode:
        snapshot.requestBudget?.mode === "locked-full-sample"
          ? "locked-full-sample"
          : "stored-fallback"
    }
  };
}

function createChampionMapFromRollingStore(matches) {
  const byKey = {};

  matches.forEach((match) => {
    (match.info?.participants || []).forEach((participant) => {
      if (!participant?.championId || !participant?.championName) {
        return;
      }

      byKey[Number(participant.championId)] = participant.championName;
    });
  });

  return byKey;
}

async function ensureRollingStoreLoaded() {
  if (rollingStoreLoaded) {
    return;
  }

  try {
    const raw = await fs.readFile(ROLLING_STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object") {
      rollingMatchStore = {
        patch: parsed.patch || null,
        updatedAt: parsed.updatedAt || 0,
        nextCursor: parsed.nextCursor || 0,
        summonerCursor: parsed.summonerCursor || 0,
        matchesById: parsed.matchesById || {},
        matchOrder: parsed.matchOrder || []
      };
    }
  } catch (error) {
    rollingMatchStore = createEmptyRollingMatchStore();
  } finally {
    rollingStoreLoaded = true;
  }
}

async function persistRollingStore() {
  if (persistenceDisabled) {
    return;
  }

  const serialized = JSON.stringify(rollingMatchStore);

  try {
    await fs.writeFile(ROLLING_STORE_PATH, serialized, "utf-8");
  } catch (error) {
    persistenceDisabled = true;
  }
}

function mergeRollingMatches(matches, patch) {
  if (!matches.length) {
    rollingMatchStore.updatedAt = Date.now();
    if (!rollingMatchStore.patch) {
      rollingMatchStore.patch = patch;
    }
    return;
  }

  rollingMatchStore.patch = patch;

  matches.forEach((match) => {
    const matchId = match?.metadata?.matchId;

    if (!matchId) {
      return;
    }

    const existing = rollingMatchStore.matchesById[matchId] || null;
    rollingMatchStore.matchesById[matchId] = existing?.timeline
      ? { ...match, timeline: existing.timeline }
      : match;
  });

  rollingMatchStore.matchOrder = Object.keys(rollingMatchStore.matchesById)
    .sort((leftId, rightId) => getMatchTimestamp(rollingMatchStore.matchesById[rightId]) - getMatchTimestamp(rollingMatchStore.matchesById[leftId]))
    .slice(0, TARGET_MATCH_SAMPLE);

  Object.keys(rollingMatchStore.matchesById).forEach((matchId) => {
    if (!rollingMatchStore.matchOrder.includes(matchId)) {
      delete rollingMatchStore.matchesById[matchId];
    }
  });

  rollingMatchStore.updatedAt = Date.now();
}

function updateRollingCursor(rollingState, requestedMatchIds, fetchedMatches) {
  if (rollingMatchStore.matchOrder.length >= TARGET_MATCH_SAMPLE) {
    rollingMatchStore.nextCursor = 0;
    rollingMatchStore.summonerCursor = rollingMatchStore.summonerCursor + 1;
    return;
  }

  const hasFreshMatches = fetchedMatches.length > 0;
  const requestedAnything = requestedMatchIds.length > 0;

  if (!requestedAnything || !hasFreshMatches) {
    rollingMatchStore.nextCursor = rollingMatchStore.nextCursor + 1;
    rollingMatchStore.summonerCursor = rollingMatchStore.summonerCursor + 1;
    return;
  }

  rollingMatchStore.nextCursor = rollingState.start > 0
    ? rollingMatchStore.nextCursor + 1
    : 1;
  rollingMatchStore.summonerCursor = rollingMatchStore.summonerCursor + 1;
}

function getMatchTimestamp(match) {
  return (
    match?.info?.gameEndTimestamp ||
    match?.info?.gameCreation ||
    0
  );
}

function attachTimelinesToMatches(matches, timelines) {
  if (!matches.length || !timelines.length) {
    return;
  }

  const timelineById = Object.fromEntries(
    timelines
      .map((timeline) => [timeline?.metadata?.matchId, timeline])
      .filter(([matchId]) => Boolean(matchId))
  );

  matches.forEach((match) => {
    const matchId = match?.metadata?.matchId;

    if (matchId && timelineById[matchId]) {
      match.timeline = timelineById[matchId];
    }
  });
}

function mergeTimelineIntoExistingStore(timelines) {
  timelines.forEach((timeline) => {
    const matchId = timeline?.metadata?.matchId;

    if (!matchId || !rollingMatchStore.matchesById[matchId]) {
      return;
    }

    rollingMatchStore.matchesById[matchId].timeline = timeline;
  });
}

async function backfillStoredTimelines(apiKey, limit = 4) {
  const targetIds = rollingMatchStore.matchOrder
    .filter((matchId) => !rollingMatchStore.matchesById[matchId]?.timeline)
    .slice(0, limit);

  if (!targetIds.length) {
    return 0;
  }

  const timelines = await runInBatches(
    targetIds,
    2,
    (matchId) =>
      riotFetchJson(`${regionalBaseUrl(DEFAULT_REGION)}/lol/match/v5/matches/${matchId}/timeline`, apiKey)
  );

  mergeTimelineIntoExistingStore(timelines);
  return timelines.length;
}

function pickRotatingSummoners(sortedPuuids, count, offset = 0) {
  if (!sortedPuuids.length || count <= 0) {
    return [];
  }

  const picked = [];

  for (let index = 0; index < Math.min(count, sortedPuuids.length); index += 1) {
    const position = (offset * count + index) % sortedPuuids.length;
    picked.push(sortedPuuids[position]);
  }

  return picked;
}

function getRoleTimelineStats(timeline, firstParticipant, secondParticipant) {
  const firstId = firstParticipant?.participantId;
  const secondId = secondParticipant?.participantId;

  if (!timeline?.info?.frames?.length || !firstId || !secondId) {
    return null;
  }

  const frameIndex = Math.min(10, timeline.info.frames.length - 1);
  const frame = timeline.info.frames[frameIndex];
  const firstFrame = frame?.participantFrames?.[String(firstId)] || frame?.participantFrames?.[firstId];
  const secondFrame = frame?.participantFrames?.[String(secondId)] || frame?.participantFrames?.[secondId];

  if (!firstFrame || !secondFrame) {
    return null;
  }

  const firstCs = (firstFrame.minionsKilled || 0) + (firstFrame.jungleMinionsKilled || 0);
  const secondCs = (secondFrame.minionsKilled || 0) + (secondFrame.jungleMinionsKilled || 0);

  return {
    first: {
      goldDiffAt10: (firstFrame.totalGold || 0) - (secondFrame.totalGold || 0),
      csDiffAt10: firstCs - secondCs,
      xpDiffAt10: (firstFrame.xp || 0) - (secondFrame.xp || 0)
    },
    second: {
      goldDiffAt10: (secondFrame.totalGold || 0) - (firstFrame.totalGold || 0),
      csDiffAt10: secondCs - firstCs,
      xpDiffAt10: (secondFrame.xp || 0) - (firstFrame.xp || 0)
    }
  };
}

function normalizeLaneMetric(value, baseline) {
  if (!baseline) {
    return 0;
  }

  return Math.max(-1.5, Math.min(1.5, value / baseline));
}

async function waitForRateLimitSlot() {
  while (true) {
    const now = Date.now();
    requestHistory = requestHistory.filter((timestamp) => now - timestamp < RIOT_WINDOW_MS);

    if (requestHistory.length < RIOT_MAX_REQUESTS_PER_WINDOW - RIOT_REQUEST_SAFETY_BUFFER) {
      requestHistory.push(now);
      return;
    }

    const oldestTimestamp = requestHistory[0];
    const waitMs = Math.max(250, RIOT_WINDOW_MS - (now - oldestTimestamp) + 50);
    await sleep(waitMs);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildUnavailableSnapshot(patch, source, message) {
  return {
    connected: false,
    liveConnected: false,
    patch,
    source,
    generatedAt: new Date().toISOString(),
    message,
    topChampions: [],
    byChampion: {}
  };
}

function cacheSnapshot(snapshot) {
  const cacheTtl =
    snapshot?.requestBudget?.mode === "locked-full-sample"
      ? FULL_SAMPLE_HOLD_MS
      : snapshot?.connected && (snapshot?.sampleMatches || 0) < TARGET_MATCH_SAMPLE
      ? WARMUP_CACHE_TTL_MS
      : CACHE_TTL_MS;

  memoryCache = {
    expiresAt: Date.now() + cacheTtl,
    value: snapshot
  };

  return snapshot;
}
