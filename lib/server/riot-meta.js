import { promises as fs } from "fs";
import path from "path";

const DATA_DRAGON_VERSION = "16.6.1";
const DATA_DRAGON_URL =
  `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/data/en_US/champion.json`;
const ITEM_DATA_DRAGON_URL =
  `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/data/en_US/item.json`;

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
const TARGET_GAMES_PER_CHAMPION = Number(process.env.RIOT_META_TARGET_GAMES_PER_CHAMPION || 30);
const MATCH_POOL_RESET_MS = 1000 * 60 * 60 * 48;
const FULL_SAMPLE_HOLD_MS = 1000 * 60 * 60 * 24 * 7;
const ROLLING_STORE_PATH = path.join(process.cwd(), "data", "riot-rolling-store.json");
const SNAPSHOT_PATH = path.join(process.cwd(), "data", "riot-meta-snapshot.json");
const LOCAL_SNAPSHOT_REFRESH_MS = 1000 * 60 * 5;
const DEPLOYED_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 48;
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
let snapshotRefreshPromise = null;

export async function getMetaSnapshot() {
  if (memoryCache.value && Date.now() < memoryCache.expiresAt) {
    return memoryCache.value;
  }

  const diskSnapshot = await readSnapshotFromDisk();
  const apiKey = process.env.RIOT_API_KEY;

  if (shouldServeSnapshotImmediately(diskSnapshot)) {
    scheduleSnapshotRefreshIfNeeded(diskSnapshot, apiKey);
    return cacheSnapshot(diskSnapshot);
  }

  await ensureRollingStoreLoaded();
  const patch = await getCurrentPatch();
  const samplingPlan = getSamplingPlan();

  if (!apiKey) {
    if (hasStoredRollingSample()) {
      return cacheSnapshot(
        await buildStoredFallbackSnapshot(
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

      const snapshot = await buildSnapshotFromRollingStore(patch);
      await persistSnapshotIfReady(snapshot);
      return cacheSnapshot(snapshot);
    }

    const rollingState = prepareRollingMatchStore(patch);
    const [championMap, itemMap] = await Promise.all([getChampionMap(), getItemMap()]);
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

    const aggregated = aggregateMatches(rollingMatches, championMap, itemMap);
    const championCoverage = summarizeChampionCoverage(aggregated.byChampion);
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
        targetGamesPerChampion: TARGET_GAMES_PER_CHAMPION,
        currentMatches: rollingMatches.length,
        fetchedThisRefresh: matches.length,
        fetchedTimelinesThisRefresh: timelines.length,
        requestedMatchIds: matchIds.length,
        startOffset: rollingState.start,
        uniqueHighEloPlayersSeen: sortedPuuids.length,
        summonerOffset: rollingState.summonerOffset,
        championCoverage
      },
      topChampions,
      byChampion: aggregated.byChampion
    };

    await persistSnapshotIfReady(snapshot);
    return cacheSnapshot(snapshot);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      if (isUsableSnapshot(diskSnapshot, { allowStaleLocal: true })) {
        return cacheSnapshot({
          ...diskSnapshot,
          connected: true,
          liveConnected: false,
          source: "Snapshot ranked local",
          message: "La cle Riot API n'est plus valide. Le site reutilise le dernier snapshot ranked disponible."
        });
      }

      if (hasStoredRollingSample()) {
        return cacheSnapshot(
          await buildStoredFallbackSnapshot(
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
      if (isUsableSnapshot(diskSnapshot, { allowStaleLocal: true })) {
        return cacheSnapshot({
          ...diskSnapshot,
          connected: true,
          liveConnected: false,
          source: "Snapshot ranked local",
          message: "Riot limite temporairement les requetes. Le site reutilise le dernier snapshot ranked disponible."
        });
      }

      if (hasStoredRollingSample()) {
        return cacheSnapshot(
          await buildStoredFallbackSnapshot(
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

function aggregateMatches(matches, championMap, itemMap = {}) {
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
          roleStats: {},
          matchupsByRole: {},
          buildsByRole: {}
        };
      }

      const champion = byChampion[imageId];
      champion.games += 1;
      champion.wins += participant.win ? 1 : 0;

      const position = getParticipantRoleKey(participant);
      champion.positions[position] = (champion.positions[position] || 0) + 1;

      if (!champion.roleStats[position]) {
        champion.roleStats[position] = {
          games: 0,
          wins: 0,
          winRate: 0,
          pickRate: 0,
          sampleWeight: 0
        };
      }

      champion.roleStats[position].games += 1;
      champion.roleStats[position].wins += participant.win ? 1 : 0;
      recordChampionBuild(champion, position, participant, itemMap);
    });

    recordRoleMatchups(participants, championMap, byChampion, match);
  });

  Object.values(byChampion).forEach((champion) => {
    champion.winRate = champion.games ? champion.wins / champion.games : 0;
    champion.pickRate = totalParticipants ? champion.games / totalParticipants : 0;
    champion.sampleWeight = Math.min(1, champion.games / 8);

    Object.keys(champion.roleStats || {}).forEach((roleKey) => {
      const roleSummary = champion.roleStats[roleKey];
      roleSummary.winRate = roleSummary.games ? roleSummary.wins / roleSummary.games : 0;
      roleSummary.pickRate = totalParticipants ? roleSummary.games / totalParticipants : 0;
      roleSummary.sampleWeight = Math.min(1, roleSummary.games / 8);
    });

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

    Object.keys(champion.buildsByRole || {}).forEach((roleKey) => {
      const roleBucket = champion.buildsByRole[roleKey];
      const entries = Object.values(roleBucket.entries || {})
        .map((entry) => ({
          id: entry.id,
          games: entry.games,
          wins: entry.wins,
          winRate: entry.games ? entry.wins / entry.games : 0,
          items: entry.items
        }))
        .sort((first, second) => {
          if (second.games !== first.games) {
            return second.games - first.games;
          }

          return second.winRate - first.winRate;
        });

      champion.buildsByRole[roleKey] = {
        entries,
        topBuilds: entries.slice(0, 3)
      };
    });
  });

  return { byChampion };
}

async function getItemMap() {
  const response = await fetch(ITEM_DATA_DRAGON_URL, {
    next: { revalidate: 60 * 60 * 6 }
  });

  if (!response.ok) {
    return {};
  }

  const payload = await response.json();
  const byId = {};

  Object.entries(payload.data || {}).forEach(([itemId, item]) => {
    byId[Number(itemId)] = {
      id: Number(itemId),
      name: item.name,
      image: `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/img/item/${itemId}.png`,
      consumable: Boolean(item.consumed || item.consumable)
    };
  });

  return byId;
}

function recordChampionBuild(champion, position, participant, itemMap) {
  if (!position || position === "UNKNOWN") {
    return;
  }

  const itemIds = getParticipantCoreItemIds(participant, itemMap);

  if (itemIds.length < 3) {
    return;
  }

  if (!champion.buildsByRole[position]) {
    champion.buildsByRole[position] = { entries: {} };
  }

  const buildId = itemIds.join("-");

  if (!champion.buildsByRole[position].entries[buildId]) {
    champion.buildsByRole[position].entries[buildId] = {
      id: buildId,
      games: 0,
      wins: 0,
      items: itemIds
        .map((itemId) => itemMap[itemId])
        .filter(Boolean)
        .map((item) => ({
          id: item.id,
          name: item.name,
          image: item.image
        }))
    };
  }

  const entry = champion.buildsByRole[position].entries[buildId];
  entry.games += 1;
  entry.wins += participant.win ? 1 : 0;
}

function getParticipantCoreItemIds(participant, itemMap) {
  return [participant.item0, participant.item1, participant.item2, participant.item3, participant.item4, participant.item5]
    .filter((itemId) => Number(itemId) > 0)
    .filter((itemId) => itemMap[itemId] && !itemMap[itemId].consumable);
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

async function buildSnapshotFromRollingStore(patch) {
  const rollingMatches = rollingMatchStore.matchOrder
    .map((matchId) => rollingMatchStore.matchesById[matchId])
    .filter(Boolean);
  const [championMap, itemMap] = await Promise.all([
    Promise.resolve(createChampionMapFromRollingStore(rollingMatches)),
    getItemMap()
  ]);
  const aggregated = aggregateMatches(rollingMatches, championMap, itemMap);
  const championCoverage = summarizeChampionCoverage(aggregated.byChampion);
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
    sampleMatches: rollingMatches.length,
    samplePlayers: 0,
    requestBudget: {
      maxRequestsPerWindow: RIOT_MAX_REQUESTS_PER_WINDOW,
      windowMs: RIOT_WINDOW_MS,
      safetyBuffer: RIOT_REQUEST_SAFETY_BUFFER,
      targetMatches: TARGET_MATCH_SAMPLE,
      targetGamesPerChampion: TARGET_GAMES_PER_CHAMPION,
      currentMatches: rollingMatches.length,
      fetchedThisRefresh: 0,
      fetchedTimelinesThisRefresh: 0,
      requestedMatchIds: 0,
      startOffset: rollingMatchStore.nextCursor * Math.max(1, MATCHES_PER_SUMMONER),
      uniqueHighEloPlayersSeen: 0,
      summonerOffset: rollingMatchStore.summonerCursor || 0,
      holdUntil: new Date(rollingMatchStore.updatedAt + FULL_SAMPLE_HOLD_MS).toISOString(),
      mode: "locked-full-sample",
      championCoverage
    },
    topChampions,
    byChampion: aggregated.byChampion
  };
}

function hasStoredRollingSample() {
  return Boolean(rollingMatchStore.matchOrder?.length);
}

function isUsableSnapshot(snapshot, options = {}) {
  if (!snapshot?.generatedAt) {
    return false;
  }

  const generatedAt = new Date(snapshot.generatedAt).getTime();

  if (!generatedAt) {
    return false;
  }

  const maxAge =
    process.env.VERCEL || options.allowStaleLocal
      ? DEPLOYED_SNAPSHOT_MAX_AGE_MS
      : LOCAL_SNAPSHOT_REFRESH_MS;

  return Date.now() - generatedAt <= maxAge;
}

function shouldServeSnapshotImmediately(snapshot) {
  if (!snapshot?.generatedAt) {
    return false;
  }

  return true;
}

async function readSnapshotFromDisk() {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

async function persistSnapshotIfReady(snapshot) {
  if (!snapshot) {
    return;
  }

  if (process.env.VERCEL) {
    return;
  }

  const existing = await readSnapshotFromDisk();

  if (existing?.generatedAt) {
    const age = Date.now() - new Date(existing.generatedAt).getTime();

    if (age < LOCAL_SNAPSHOT_REFRESH_MS) {
      return;
    }
  }

  try {
    await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot), "utf-8");
  } catch (error) {
    // Best effort only: local snapshot should never block the site.
  }
}

function scheduleSnapshotRefreshIfNeeded(snapshot, apiKey) {
  if (process.env.VERCEL || !apiKey || snapshotRefreshPromise) {
    return;
  }

  const generatedAt = new Date(snapshot?.generatedAt || 0).getTime();

  if (!generatedAt || Date.now() - generatedAt < LOCAL_SNAPSHOT_REFRESH_MS) {
    return;
  }

  snapshotRefreshPromise = refreshSnapshotInBackground(apiKey).finally(() => {
    snapshotRefreshPromise = null;
  });
}

async function refreshSnapshotInBackground(apiKey) {
  try {
    await ensureRollingStoreLoaded();

    const patch = await getCurrentPatch();
    const samplingPlan = getSamplingPlan();

    if (shouldReuseFullSample(patch)) {
      const backfilledTimelines = await backfillStoredTimelines(
        apiKey,
        Math.max(2, Math.min(8, samplingPlan.matchesPerSummoner * 2))
      );

      if (backfilledTimelines > 0) {
        await persistRollingStore();
      }

      const fullSnapshot = await buildSnapshotFromRollingStore(patch);
      await persistSnapshotIfReady(fullSnapshot);
      return;
    }

    const rollingState = prepareRollingMatchStore(patch);
    const [championMap, itemMap] = await Promise.all([getChampionMap(), getItemMap()]);
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

    const aggregated = aggregateMatches(rollingMatches, championMap, itemMap);
    const championCoverage = summarizeChampionCoverage(aggregated.byChampion);
    const topChampions = Object.values(aggregated.byChampion)
      .filter((champion) => champion.games >= 2)
      .sort((first, second) => {
        if (second.pickRate !== first.pickRate) {
          return second.pickRate - first.pickRate;
        }

        return second.winRate - first.winRate;
      })
      .slice(0, 12);

    await persistSnapshotIfReady({
      connected: true,
      liveConnected: true,
      patch,
      source: "Riot API Master+ rolling sample",
      generatedAt: new Date().toISOString(),
      region: DEFAULT_PLATFORM,
      sampleMatches: rollingMatches.length,
      samplePlayers: puuids.length,
      requestBudget: {
        ...samplingPlan,
        targetMatches: TARGET_MATCH_SAMPLE,
        targetGamesPerChampion: TARGET_GAMES_PER_CHAMPION,
        currentMatches: rollingMatches.length,
        fetchedThisRefresh: matches.length,
        fetchedTimelinesThisRefresh: timelines.length,
        requestedMatchIds: matchIds.length,
        startOffset: rollingState.start,
        uniqueHighEloPlayersSeen: sortedPuuids.length,
        summonerOffset: rollingState.summonerOffset,
        championCoverage
      },
      topChampions,
      byChampion: aggregated.byChampion
    });
  } catch (error) {
    // Best effort only: serving the current snapshot stays the priority.
  }
}

async function buildStoredFallbackSnapshot(patch, source, message) {
  const snapshot = await buildSnapshotFromRollingStore(patch);

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

  rollingMatchStore.matchOrder = selectRollingMatchWindow(rollingMatchStore.matchesById);

  Object.keys(rollingMatchStore.matchesById).forEach((matchId) => {
    if (!rollingMatchStore.matchOrder.includes(matchId)) {
      delete rollingMatchStore.matchesById[matchId];
    }
  });

  rollingMatchStore.updatedAt = Date.now();
}

function selectRollingMatchWindow(matchesById) {
  const allMatchIds = Object.keys(matchesById);

  if (allMatchIds.length <= TARGET_MATCH_SAMPLE) {
    return allMatchIds.sort(
      (leftId, rightId) => getMatchTimestamp(matchesById[rightId]) - getMatchTimestamp(matchesById[leftId])
    );
  }

  const championCounts = countChampionAppearances(Object.values(matchesById));
  const timestamps = allMatchIds.map((matchId) => getMatchTimestamp(matchesById[matchId]));
  const newestTimestamp = Math.max(...timestamps);
  const oldestTimestamp = Math.min(...timestamps);
  const timestampSpan = Math.max(1, newestTimestamp - oldestTimestamp);

  return allMatchIds
    .map((matchId) => {
      const match = matchesById[matchId];
      const championIds = getMatchChampionIds(match);
      const scarcityScore = championIds.reduce((sum, championId) => {
        const count = championCounts[championId] || 0;
        return sum + Math.max(0, TARGET_GAMES_PER_CHAMPION - count) / TARGET_GAMES_PER_CHAMPION;
      }, 0);
      const recencyScore = (getMatchTimestamp(match) - oldestTimestamp) / timestampSpan;
      const timelineBonus = match?.timeline ? 0.35 : 0;

      return {
        matchId,
        score: scarcityScore * 4 + recencyScore * 2 + timelineBonus
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return getMatchTimestamp(matchesById[right.matchId]) - getMatchTimestamp(matchesById[left.matchId]);
    })
    .slice(0, TARGET_MATCH_SAMPLE)
    .map((entry) => entry.matchId);
}

function countChampionAppearances(matches) {
  return matches.reduce((accumulator, match) => {
    getMatchChampionIds(match).forEach((championId) => {
      accumulator[championId] = (accumulator[championId] || 0) + 1;
    });

    return accumulator;
  }, {});
}

function getMatchChampionIds(match) {
  return [...new Set(
    (match?.info?.participants || [])
      .map((participant) => participant?.championName || "")
      .filter(Boolean)
  )];
}

function summarizeChampionCoverage(byChampion) {
  const entries = Object.values(byChampion || {});
  const coveredChampions = entries.filter((champion) => champion.games >= TARGET_GAMES_PER_CHAMPION);
  const underTarget = entries
    .filter((champion) => champion.games < TARGET_GAMES_PER_CHAMPION)
    .sort((left, right) => left.games - right.games)
    .slice(0, 12)
    .map((champion) => ({
      id: champion.id,
      name: champion.name,
      games: champion.games
    }));

  return {
    targetPerChampion: TARGET_GAMES_PER_CHAMPION,
    championsSeen: entries.length,
    championsAtTarget: coveredChampions.length,
    underTargetCount: Math.max(0, entries.length - coveredChampions.length),
    coverageRate: entries.length ? Number((coveredChampions.length / entries.length).toFixed(3)) : 0,
    weakestCoverage: underTarget
  };
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
