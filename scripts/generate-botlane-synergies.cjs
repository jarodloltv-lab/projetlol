const fs = require("fs");
const path = require("path");

const championProfiles = require("../data/champion-profiles.json");

const TOURNAMENTS = [
  { region: "LEC", name: "LEC 2026 Versus Season" },
  { region: "LEC", name: "LEC 2026 Versus Playoffs" },
  { region: "LCK", name: "LCK Cup 2026" },
  { region: "LCK", name: "LCK 2026 Rounds 1-2" },
  { region: "LPL", name: "LPL 2026 Split 1" },
  { region: "LPL", name: "LPL 2026 Split 1 Playoffs" }
];

const ROLE_ORDER = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const BOT_ROLES = new Set(["ADC", "BOT", "SUPPORT"]);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "botlane-synergies.json");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const championNameMap = buildChampionNameMap();
  const pairEntries = [];

  for (const tournament of TOURNAMENTS) {
    console.log(`Collecte ${tournament.name}...`);
    const teams = await fetchTournamentTeams(tournament.name);

    for (const team of teams) {
      const roster = await fetchTeamRoster(team.id, tournament.name);
      const adc = roster.find((player) => player.role === "ADC");
      const support = roster.find((player) => player.role === "SUPPORT");

      if (!adc || !support) {
        continue;
      }

      const [adcMatches, supportMatches] = await Promise.all([
        fetchPlayerMatchlist(adc.id, tournament.name),
        fetchPlayerMatchlist(support.id, tournament.name)
      ]);

      const supportByKey = new Map(
        supportMatches.map((match) => [match.matchKey, match])
      );

      for (const adcMatch of adcMatches) {
        const supportMatch = supportByKey.get(adcMatch.matchKey);

        if (!supportMatch) {
          continue;
        }

        const adcId = resolveChampionId(adcMatch.championName, championNameMap);
        const supportId = resolveChampionId(supportMatch.championName, championNameMap);

        if (!adcId || !supportId) {
          continue;
        }

        pairEntries.push({
          region: tournament.region,
          tournament: tournament.name,
          teamId: team.id,
          teamName: team.name,
          date: adcMatch.date,
          matchKey: adcMatch.matchKey,
          gameLabel: adcMatch.gameLabel,
          win: adcMatch.result === "Victory" && supportMatch.result === "Victory",
          adcId,
          adcName: championProfiles[adcId]?.name || adcMatch.championName,
          supportId,
          supportName: championProfiles[supportId]?.name || supportMatch.championName
        });
      }
    }
  }

  const payload = buildPayload(pairEntries);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));

  console.log(
    `Synergies botlane generees: ${payload.pairs.length} duos sur ${payload.totalGames} games`
  );
  console.log(`Fichier: ${OUTPUT_PATH}`);
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
  byName.set("nunu", "Nunu");
  byName.set("nunuwillump", "Nunu");
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

async function fetchTournamentTeams(tournamentName) {
  const url = `https://gol.gg/teams/list/season-ALL/split-ALL/tournament-${encodeURIComponent(tournamentName)}/`;
  const html = await fetchHtml(url);
  const matches = [...html.matchAll(/<tr><td><a href='\.\/team-stats\/(\d+)\/split-ALL\/tournament-[^']+' title='([^']+) stats'>([^<]+)<\/a><\/td>/g)];

  return matches.map((match) => ({
    id: match[1],
    name: decodeHtml(match[3])
  }));
}

async function fetchTeamRoster(teamId, tournamentName) {
  const url = `https://gol.gg/teams/team-stats/${teamId}/split-ALL/tournament-${encodeURIComponent(tournamentName)}/`;
  const html = await fetchHtml(url);
  const rosterSection = extractBetween(
    html,
    "Champions played",
    "</tbody></table>"
  );

  if (!rosterSection) {
    return [];
  }

  const rows = [...rosterSection.matchAll(/role\/([A-Z]+)\.png[\s\S]*?player-stats\/(\d+)\/[\s\S]*?'>([^<]+)<\/a>/g)];

  return rows
    .map((row) => ({
      role: row[1] === "BOT" ? "ADC" : row[1],
      id: row[2],
      name: decodeHtml(row[3])
    }))
    .filter((player) => BOT_ROLES.has(player.role) || ROLE_ORDER.includes(player.role));
}

async function fetchPlayerMatchlist(playerId, tournamentName) {
  const url = `https://gol.gg/players/player-matchlist/${playerId}/season-ALL/split-ALL/tournament-${encodeURIComponent(tournamentName)}/`;
  const html = await fetchHtml(url);
  const tbody = extractBetween(html, "<tbody>", "</tbody>");

  if (!tbody) {
    return [];
  }

  const rows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];

  return rows
    .map((row) => parseMatchRow(row[1], tournamentName))
    .filter(Boolean);
}

function parseMatchRow(rowHtml, tournamentName) {
  const championName = capture(
    rowHtml,
    /<img class='champion_icon_light rounded-circle' alt='([^']+)'/
  );
  const result = capture(
    rowHtml,
    /text_(victory|defeat) text-center'>(Victory|Defeat)<\/td>/
  );
  const date = capture(rowHtml, /<td class='text-center'>(\d{4}-\d{2}-\d{2})<\/td>/);
  const gameLinkMatch = rowHtml.match(/<td class='text-center'><a href='\.\.\/game\/stats\/(\d+)\/page-game\/' title='([^']+) stats'>([^<]+)<\/a><\/td>/);

  if (!championName || !result || !date || !gameLinkMatch) {
    return null;
  }

  return {
    championName: decodeHtml(championName),
    result: result.includes("Victory") ? "Victory" : "Defeat",
    date,
    gameId: gameLinkMatch[1],
    gameLabel: decodeHtml(gameLinkMatch[3]),
    matchKey: `${tournamentName}::${date}::${gameLinkMatch[1]}`
  };
}

function buildPayload(pairEntries) {
  const groupedPairs = new Map();

  pairEntries.forEach((entry) => {
    const key = `${entry.adcId}::${entry.supportId}`;

    if (!groupedPairs.has(key)) {
      groupedPairs.set(key, {
        duoId: key,
        adcId: entry.adcId,
        adcName: entry.adcName,
        supportId: entry.supportId,
        supportName: entry.supportName,
        games: 0,
        wins: 0,
        regions: new Set(),
        tournaments: new Set(),
        teams: new Set(),
        lastPlayed: entry.date,
        firstPlayed: entry.date
      });
    }

    const pair = groupedPairs.get(key);
    pair.games += 1;
    pair.wins += entry.win ? 1 : 0;
    pair.regions.add(entry.region);
    pair.tournaments.add(entry.tournament);
    pair.teams.add(entry.teamName);

    if (entry.date > pair.lastPlayed) {
      pair.lastPlayed = entry.date;
    }

    if (entry.date < pair.firstPlayed) {
      pair.firstPlayed = entry.date;
    }
  });

  const today = new Date();
  const pairs = [...groupedPairs.values()]
    .map((pair) => {
      const winRate = pair.games ? pair.wins / pair.games : 0;
      const daysSinceLastPlayed = Math.max(
        0,
        Math.round((today - new Date(pair.lastPlayed)) / (1000 * 60 * 60 * 24))
      );
      const freshness = Math.max(0, 1 - daysSinceLastPlayed / 180);
      const confidence = Math.min(1, pair.games / 8);
      const synergyScore =
        pair.games * 5 +
        Math.max(0, (winRate - 0.5) * 40) +
        pair.tournaments.size * 4 +
        pair.regions.size * 3 +
        freshness * 10;

      return {
        duoId: pair.duoId,
        adcId: pair.adcId,
        adcName: pair.adcName,
        supportId: pair.supportId,
        supportName: pair.supportName,
        games: pair.games,
        wins: pair.wins,
        winRate: Number(winRate.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        freshness: Number(freshness.toFixed(3)),
        synergyScore: Number(synergyScore.toFixed(2)),
        regions: [...pair.regions],
        tournaments: [...pair.tournaments],
        teams: [...pair.teams],
        firstPlayed: pair.firstPlayed,
        lastPlayed: pair.lastPlayed
      };
    })
    .filter((pair) => pair.games >= 2)
    .sort((first, second) => {
      if (second.synergyScore !== first.synergyScore) {
        return second.synergyScore - first.synergyScore;
      }

      return second.games - first.games;
    });

  const byAdc = {};
  const bySupport = {};

  pairs.forEach((pair) => {
    if (!byAdc[pair.adcId]) {
      byAdc[pair.adcId] = [];
    }

    if (!bySupport[pair.supportId]) {
      bySupport[pair.supportId] = [];
    }

    byAdc[pair.adcId].push(pair);
    bySupport[pair.supportId].push(pair);
  });

  return {
    generatedAt: new Date().toISOString(),
    source: "Games of Legends tournament rosters + player matchlists",
    tournaments: TOURNAMENTS.map((tournament) => tournament.name),
    totalGames: pairEntries.length,
    pairCount: pairs.length,
    pairs,
    byAdc,
    bySupport
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; LoLCompBuilderBot/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`Impossible de charger ${url} (${response.status})`);
  }

  return response.text();
}

function resolveChampionId(name, championNameMap) {
  return championNameMap.get(normalizeName(name)) || null;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function extractBetween(value, startToken, endToken) {
  const startIndex = value.indexOf(startToken);

  if (startIndex === -1) {
    return "";
  }

  const slice = value.slice(startIndex);
  const endIndex = slice.indexOf(endToken);

  if (endIndex === -1) {
    return slice;
  }

  return slice.slice(0, endIndex);
}

function capture(value, pattern) {
  const match = value.match(pattern);
  return match?.[2] || match?.[1] || "";
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&uuml;/g, "u");
}
