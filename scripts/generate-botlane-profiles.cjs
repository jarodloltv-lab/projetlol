const fs = require("fs");
const path = require("path");

const championProfiles = require("../data/champion-profiles.json");
const botlaneSynergies = require("../data/botlane-synergies.json");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "botlane-profiles.json");
const OE_API = "https://oe.datalisk.io";
const OE_API_KEY = "f561197a-82ea-4e54-acd2-386979018a7a";
const RECENT_DAYS = 180;
const TARGET_PAIR_LIMIT = 40;
const TEAM_FETCH_CONCURRENCY = 4;
const GAME_FETCH_CONCURRENCY = 10;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const championNameMap = buildChampionNameMap();
  const targetPairs = botlaneSynergies.pairs
    .slice(0, TARGET_PAIR_LIMIT)
    .map((pair) => pair.duoId);
  const targetPairSet = new Set(targetPairs);
  const targetTeams = [...new Set(botlaneSynergies.pairs.slice(0, TARGET_PAIR_LIMIT).flatMap((pair) => pair.teams))];

  console.log(`Recherche des equipes Oracle's Elixir (${targetTeams.length})...`);
  const teamRecords = await mapWithConcurrency(targetTeams, TEAM_FETCH_CONCURRENCY, async (teamName) => {
    const teamId = await resolveTeamId(teamName);
    if (!teamId) {
      return null;
    }

    const games = await fetchJson(`/teams/gameDetails/${encodeURIComponent(teamId)}`);
    return {
      sourceTeam: teamName,
      teamId,
      games: Array.isArray(games) ? games : []
    };
  });

  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const relevantGames = [];

  teamRecords.filter(Boolean).forEach((record) => {
    record.games.forEach((game) => {
      if (!game.oeGameId || !game.gameCreation) {
        return;
      }

      if (new Date(game.gameCreation).getTime() < cutoff) {
        return;
      }

      if (!/^LEC|^LCK|^LPL/.test(game.tournament || "")) {
        return;
      }

      const duoId = buildOwnDuoId(game, championNameMap);
      if (!duoId || !targetPairSet.has(duoId)) {
        return;
      }

      relevantGames.push({
        teamId: record.teamId,
        sourceTeam: record.sourceTeam,
        duoId,
        game
      });
    });
  });

  const uniqueGameIds = [...new Set(relevantGames.map((entry) => entry.game.oeGameId))];
  console.log(`Collecte des details Oracle's Elixir (${uniqueGameIds.length} games)...`);

  const gameCache = new Map();
  const fetchedGames = await mapWithConcurrency(uniqueGameIds, GAME_FETCH_CONCURRENCY, async (gameId) => {
    const payload = await fetchJson(`/games/singleGame/${encodeURIComponent(gameId)}`);
    return {
      gameId,
      payload: Array.isArray(payload) ? payload[0] : null
    };
  });

  fetchedGames.forEach((entry) => {
    if (entry?.payload) {
      gameCache.set(entry.gameId, entry.payload);
    }
  });

  const aggregates = new Map();

  relevantGames.forEach((entry) => {
    const details = gameCache.get(entry.game.oeGameId);
    if (!details) {
      return;
    }

    const teamData = entry.game.side === "blue" ? details.blueTeam : details.redTeam;
    const bot = teamData?.players?.bot;
    const sup = teamData?.players?.sup;
    if (!bot || !sup) {
      return;
    }

    const pairMeta = botlaneSynergies.pairs.find((pair) => pair.duoId === entry.duoId);
    if (!pairMeta) {
      return;
    }

    if (!aggregates.has(entry.duoId)) {
      aggregates.set(entry.duoId, {
        duoId: entry.duoId,
        adcId: pairMeta.adcId,
        adcName: pairMeta.adcName,
        supportId: pairMeta.supportId,
        supportName: pairMeta.supportName,
        sampledGames: 0,
        wins: 0,
        laneGoldDiff10Total: 0,
        botGoldDiff10Total: 0,
        supportGoldDiff10Total: 0,
        botCspmTotal: 0,
        botDpmTotal: 0,
        supportWpmTotal: 0,
        firstBloodParticipation: 0,
        shortGames: 0,
        shortWins: 0,
        longGames: 0,
        longWins: 0,
        averageDurationTotal: 0,
        patches: new Set(),
        tournaments: new Set(),
        teams: new Set(),
        firstPlayed: entry.game.gameCreation,
        lastPlayed: entry.game.gameCreation
      });
    }

    const aggregate = aggregates.get(entry.duoId);
    const laneGxd10 = averageNumber([bot.gxd10, sup.gxd10]);
    const durationMinutes = (details.metadata?.gameDuration || 0) / 60;

    aggregate.sampledGames += 1;
    aggregate.wins += entry.game.result ? 1 : 0;
    aggregate.laneGoldDiff10Total += laneGxd10;
    aggregate.botGoldDiff10Total += numberOrZero(bot.gxd10);
    aggregate.supportGoldDiff10Total += numberOrZero(sup.gxd10);
    aggregate.botCspmTotal += numberOrZero(bot.cspm);
    aggregate.botDpmTotal += numberOrZero(bot.dpm);
    aggregate.supportWpmTotal += numberOrZero(sup.wpm);
    aggregate.averageDurationTotal += durationMinutes;
    aggregate.patches.add(String(details.metadata?.patch || ""));
    aggregate.tournaments.add(entry.game.tournament);
    aggregate.teams.add(entry.game.ownId || entry.sourceTeam);

    if (bot.firstBloodKill || bot.firstBloodAssist || sup.firstBloodKill || sup.firstBloodAssist) {
      aggregate.firstBloodParticipation += 1;
    }

    if (durationMinutes <= 30) {
      aggregate.shortGames += 1;
      aggregate.shortWins += entry.game.result ? 1 : 0;
    }

    if (durationMinutes >= 35) {
      aggregate.longGames += 1;
      aggregate.longWins += entry.game.result ? 1 : 0;
    }

    if (entry.game.gameCreation < aggregate.firstPlayed) {
      aggregate.firstPlayed = entry.game.gameCreation;
    }

    if (entry.game.gameCreation > aggregate.lastPlayed) {
      aggregate.lastPlayed = entry.game.gameCreation;
    }
  });

  const profiles = [...aggregates.values()]
    .map((aggregate) => finalizeProfile(aggregate))
    .sort((a, b) => b.sampledGames - a.sampledGames || b.laneGoldDiff10 - a.laneGoldDiff10);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "Oracle's Elixir public API + Games of Legends duo set",
    recentWindowDays: RECENT_DAYS,
    targetPairCount: targetPairs.length,
    profileCount: profiles.length,
    profiles,
    byDuoId: Object.fromEntries(profiles.map((profile) => [profile.duoId, profile]))
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Profils botlane generes: ${profiles.length}`);
  console.log(`Fichier: ${OUTPUT_PATH}`);
}

function finalizeProfile(aggregate) {
  const sampledGames = aggregate.sampledGames || 1;
  const laneGoldDiff10 = round(aggregate.laneGoldDiff10Total / sampledGames, 1);
  const botGoldDiff10 = round(aggregate.botGoldDiff10Total / sampledGames, 1);
  const supportGoldDiff10 = round(aggregate.supportGoldDiff10Total / sampledGames, 1);
  const firstBloodRate = round(aggregate.firstBloodParticipation / sampledGames, 3);
  const shortWinRate = aggregate.shortGames ? round(aggregate.shortWins / aggregate.shortGames, 3) : null;
  const longWinRate = aggregate.longGames ? round(aggregate.longWins / aggregate.longGames, 3) : null;

  return {
    duoId: aggregate.duoId,
    adcId: aggregate.adcId,
    adcName: aggregate.adcName,
    supportId: aggregate.supportId,
    supportName: aggregate.supportName,
    sampledGames: aggregate.sampledGames,
    winRate: round(aggregate.wins / sampledGames, 3),
    laneGoldDiff10,
    botGoldDiff10,
    supportGoldDiff10,
    botCspm: round(aggregate.botCspmTotal / sampledGames, 2),
    botDpm: round(aggregate.botDpmTotal / sampledGames, 1),
    supportWpm: round(aggregate.supportWpmTotal / sampledGames, 2),
    firstBloodRate,
    averageDurationMinutes: round(aggregate.averageDurationTotal / sampledGames, 1),
    shortGames: aggregate.shortGames,
    shortWinRate,
    longGames: aggregate.longGames,
    longWinRate,
    laneAssessment: classifyLaneStrength(laneGoldDiff10),
    earlyAssessment: classifyEarlyProfile(laneGoldDiff10, firstBloodRate, shortWinRate),
    lateAssessment: classifyLateProfile(longWinRate, shortWinRate),
    patches: [...aggregate.patches].filter(Boolean),
    tournaments: [...aggregate.tournaments],
    teams: [...aggregate.teams],
    firstPlayed: aggregate.firstPlayed,
    lastPlayed: aggregate.lastPlayed
  };
}

function classifyLaneStrength(laneGoldDiff10) {
  if (laneGoldDiff10 >= 400) return "dominant";
  if (laneGoldDiff10 >= 150) return "forte";
  if (laneGoldDiff10 > -150) return "stable";
  if (laneGoldDiff10 > -350) return "fragile";
  return "faible";
}

function classifyEarlyProfile(laneGoldDiff10, firstBloodRate, shortWinRate) {
  if (laneGoldDiff10 >= 150) return "fort en early";
  if (laneGoldDiff10 >= 75 && firstBloodRate >= 0.3) return "fort en early";
  if (laneGoldDiff10 >= 0 && shortWinRate !== null && shortWinRate >= 0.65) {
    return "fort en early";
  }
  if (laneGoldDiff10 <= -150 && firstBloodRate < 0.2) return "demarrage lent";
  return "early equilibre";
}

function classifyLateProfile(longWinRate, shortWinRate) {
  if (longWinRate !== null && shortWinRate !== null) {
    if (longWinRate - shortWinRate >= 0.08) return "plus convaincant en late game";
    if (shortWinRate - longWinRate >= 0.08) return "plus convaincant en mid game rapide";
  }

  if (longWinRate !== null && longWinRate >= 0.55) {
    return "tient bien les parties longues";
  }

  return "profil de scaling encore a confirmer";
}

async function resolveTeamId(teamName) {
  const searchResults = await fetchJson(`/teams/search?search=${encodeURIComponent(teamName)}`);
  if (!Array.isArray(searchResults) || !searchResults.length) {
    return teamName;
  }

  const normalizedTarget = normalizeName(teamName);
  const exact = searchResults.find((team) => normalizeName(team.name) === normalizedTarget);
  if (exact) {
    return exact.teamId;
  }

  const active = searchResults.find((team) => team.active === "Yes");
  return active?.teamId || searchResults[0].teamId || teamName;
}

async function fetchJson(pathname) {
  const response = await fetch(`${OE_API}${pathname}`, {
    headers: {
      "X-Api-Key": OE_API_KEY,
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Oracle's Elixir request failed (${response.status}) for ${pathname}`);
  }

  return response.json();
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function buildChampionNameMap() {
  const byName = new Map();

  Object.values(championProfiles).forEach((profile) => {
    const variants = new Set([
      profile.id,
      profile.imageId,
      profile.name,
      profile.name.replace(/'/g, ""),
      profile.name.replace(/\./g, ""),
      profile.name.replace(/\s+/g, "")
    ]);

    variants.forEach((variant) => {
      byName.set(normalizeName(variant), profile.imageId);
    });
  });

  byName.set("wukong", "MonkeyKing");
  byName.set("monkeyking", "MonkeyKing");
  byName.set("renataglasc", "Renata");
  byName.set("belveth", "Belveth");
  byName.set("velkoz", "Velkoz");
  byName.set("chogath", "Chogath");
  byName.set("drmundo", "DrMundo");
  byName.set("jarvaniv", "JarvanIV");
  byName.set("kaisa", "Kaisa");
  byName.set("ksante", "KSante");
  byName.set("kogmaw", "KogMaw");
  byName.set("khazix", "Khazix");
  byName.set("leesin", "LeeSin");
  byName.set("masteryi", "MasterYi");
  byName.set("missfortune", "MissFortune");
  byName.set("twistedfate", "TwistedFate");
  byName.set("tahmkench", "TahmKench");
  byName.set("xinzhao", "XinZhao");
  byName.set("reksai", "RekSai");
  byName.set("leblanc", "Leblanc");

  return byName;
}

function buildOwnDuoId(game, championNameMap) {
  const ownBotName = game.side === "blue" ? game.bluebot : game.redbot;
  const ownSupName = game.side === "blue" ? game.bluesup : game.redsup;

  const adcId = resolveChampionId(ownBotName, championNameMap);
  const supportId = resolveChampionId(ownSupName, championNameMap);

  if (!adcId || !supportId) {
    return null;
  }

  return `${adcId}::${supportId}`;
}

function resolveChampionId(name, championNameMap) {
  if (!name) return null;
  return championNameMap.get(normalizeName(name)) || null;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function averageNumber(values) {
  const validValues = values.filter((value) => typeof value === "number");
  if (!validValues.length) return 0;
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
