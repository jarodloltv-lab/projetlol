const DATA_DRAGON_VERSION = "16.6.1";
const DATA_DRAGON_URL =
  `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/data/en_US/champion.json`;

const DEFAULT_PLATFORM = process.env.RIOT_PLATFORM || "EUW1";
const DEFAULT_REGION = process.env.RIOT_REGION || "EUROPE";
const SAMPLE_SUMMONERS = Number(process.env.RIOT_META_SUMMONERS || 4);
const MATCHES_PER_SUMMONER = Number(process.env.RIOT_META_MATCHES_PER_SUMMONER || 3);
const CACHE_TTL_MS = 1000 * 60 * 20;
const RIOT_WINDOW_MS = 1000 * 60 * 2;
const RIOT_MAX_REQUESTS_PER_WINDOW = 100;
const RIOT_REQUEST_SAFETY_BUFFER = 8;
const TARGET_MATCH_SAMPLE = Number(process.env.RIOT_META_TARGET_MATCHES || 100);
const MATCH_POOL_RESET_MS = 1000 * 60 * 60 * 8;

let memoryCache = {
  expiresAt: 0,
  value: null
};

let requestHistory = [];
let rollingMatchStore = createEmptyRollingMatchStore();

export async function getMetaSnapshot() {
  if (memoryCache.value && Date.now() < memoryCache.expiresAt) {
    return memoryCache.value;
  }

  const apiKey = process.env.RIOT_API_KEY;
  const patch = await getCurrentPatch();

  if (!apiKey) {
    return cacheSnapshot(
      buildUnavailableSnapshot(
        patch,
        "Riot Data Dragon",
        "Ajoutez RIOT_API_KEY dans .env.local pour activer la meta live."
      )
    );
  }

  try {
    const samplingPlan = getSamplingPlan();
    const rollingState = prepareRollingMatchStore(patch);
    const championMap = await getChampionMap();
    const entries = await riotFetchJson(
      `${platformBaseUrl(DEFAULT_PLATFORM)}/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5`,
      apiKey
    );

    const puuids = (entries.entries || [])
      .slice(0, samplingPlan.summoners)
      .map((entry) => entry.puuid)
      .filter(Boolean);

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
    const matches = await runInBatches(
      missingMatchIds,
      2,
      (matchId) =>
        riotFetchJson(`${regionalBaseUrl(DEFAULT_REGION)}/lol/match/v5/matches/${matchId}`, apiKey)
    );

    mergeRollingMatches(matches, patch);
    updateRollingCursor(rollingState, matchIds, matches);

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
      source: "Riot API Challenger rolling sample",
      generatedAt: new Date().toISOString(),
      region: DEFAULT_PLATFORM,
      sampleMatches: rollingMatches.length,
      samplePlayers: puuids.length,
      requestBudget: {
        ...samplingPlan,
        targetMatches: TARGET_MATCH_SAMPLE,
        currentMatches: rollingMatches.length,
        fetchedThisRefresh: matches.length,
        requestedMatchIds: matchIds.length,
        startOffset: rollingState.start
      },
      topChampions,
      byChampion: aggregated.byChampion
    };

    return cacheSnapshot(snapshot);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      return cacheSnapshot(
        buildUnavailableSnapshot(
          patch,
          "Riot API",
          "La cle Riot API n'est plus valide. Regenez une nouvelle development key puis redemarrez le site."
        )
      );
    }

    if (error?.status === 429) {
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
    (match.info?.participants || []).forEach((participant) => {
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
          positions: {}
        };
      }

      const champion = byChampion[imageId];
      champion.games += 1;
      champion.wins += participant.win ? 1 : 0;

      const position = participant.teamPosition || "UNKNOWN";
      champion.positions[position] = (champion.positions[position] || 0) + 1;
    });
  });

  Object.values(byChampion).forEach((champion) => {
    champion.winRate = champion.games ? champion.wins / champion.games : 0;
    champion.pickRate = totalParticipants ? champion.games / totalParticipants : 0;
    champion.sampleWeight = Math.min(1, champion.games / 8);
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

function getSamplingPlan() {
  const maxRequests = Math.max(1, RIOT_MAX_REQUESTS_PER_WINDOW - RIOT_REQUEST_SAFETY_BUFFER);
  const requestedSummoners = Math.max(1, SAMPLE_SUMMONERS);
  const requestedMatches = Math.max(1, MATCHES_PER_SUMMONER);

  let summoners = requestedSummoners;
  let matchesPerSummoner = requestedMatches;

  while (1 + summoners + summoners * matchesPerSummoner > maxRequests) {
    if (matchesPerSummoner > 1) {
      matchesPerSummoner -= 1;
      continue;
    }

    if (summoners > 1) {
      summoners -= 1;
      continue;
    }

    break;
  }

  return {
    maxRequestsPerWindow: RIOT_MAX_REQUESTS_PER_WINDOW,
    windowMs: RIOT_WINDOW_MS,
    safetyBuffer: RIOT_REQUEST_SAFETY_BUFFER,
    summoners,
    matchesPerSummoner,
    estimatedRequests: 1 + summoners + summoners * matchesPerSummoner
  };
}

function createEmptyRollingMatchStore() {
  return {
    patch: null,
    updatedAt: 0,
    nextCursor: 0,
    matchesById: {},
    matchOrder: []
  };
}

function prepareRollingMatchStore(patch) {
  const now = Date.now();

  if (
    !rollingMatchStore.patch ||
    rollingMatchStore.patch !== patch ||
    now - rollingMatchStore.updatedAt > MATCH_POOL_RESET_MS
  ) {
    rollingMatchStore = createEmptyRollingMatchStore();
    rollingMatchStore.patch = patch;
  }

  return {
    start: rollingMatchStore.matchOrder.length >= TARGET_MATCH_SAMPLE
      ? 0
      : rollingMatchStore.nextCursor * Math.max(1, MATCHES_PER_SUMMONER),
    currentCount: rollingMatchStore.matchOrder.length
  };
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

    rollingMatchStore.matchesById[matchId] = match;
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
    return;
  }

  const hasFreshMatches = fetchedMatches.length > 0;
  const requestedAnything = requestedMatchIds.length > 0;

  if (!requestedAnything || !hasFreshMatches) {
    rollingMatchStore.nextCursor = rollingMatchStore.nextCursor + 1;
    return;
  }

  rollingMatchStore.nextCursor = rollingState.start > 0
    ? rollingMatchStore.nextCursor + 1
    : 1;
}

function getMatchTimestamp(match) {
  return (
    match?.info?.gameEndTimestamp ||
    match?.info?.gameCreation ||
    0
  );
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
    patch,
    source,
    generatedAt: new Date().toISOString(),
    message,
    topChampions: [],
    byChampion: {}
  };
}

function cacheSnapshot(snapshot) {
  memoryCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: snapshot
  };

  return snapshot;
}
