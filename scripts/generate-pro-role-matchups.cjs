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

const TRACKED_ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "pro-role-matchups.json");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const championNameMap = buildChampionNameMap();
  const roleEntries = [];

  for (const tournament of TOURNAMENTS) {
    console.log(`Collecte des matchups pros ${tournament.name}...`);
    const teams = await fetchTournamentTeams(tournament.name);

    for (const team of teams) {
      const roster = await fetchTeamRoster(team.id, tournament.name);

      for (const role of TRACKED_ROLES) {
        const player = roster.find((entry) => entry.role === role);

        if (!player) {
          continue;
        }

        const matches = await fetchPlayerMatchlist(player.id, tournament.name);

        matches.forEach((match) => {
          const championId = resolveChampionId(match.championName, championNameMap);

          if (!championId) {
            return;
          }

          roleEntries.push({
            region: tournament.region,
            tournament: tournament.name,
            teamId: team.id,
            teamName: team.name,
            role,
            date: match.date,
            matchKey: match.matchKey,
            gameId: match.gameId,
            gameLabel: match.gameLabel,
            win: match.result === "Victory",
            championId,
            championName: championProfiles[championId]?.name || match.championName
          });
        });
      }
    }
  }

  const payload = buildPayload(roleEntries);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));

  console.log(
    `Matchups pros generes: ${payload.totalGames} entrees sur ${payload.roleCount} roles`
  );
  console.log(`Fichier: ${OUTPUT_PATH}`);
}

function buildPayload(roleEntries) {
  const groupedByRoleAndMatch = new Map();

  roleEntries.forEach((entry) => {
    const key = `${entry.role}::${entry.matchKey}`;

    if (!groupedByRoleAndMatch.has(key)) {
      groupedByRoleAndMatch.set(key, []);
    }

    groupedByRoleAndMatch.get(key).push(entry);
  });

  const matchupEntries = [];

  groupedByRoleAndMatch.forEach((entries, compositeKey) => {
    if (entries.length !== 2) {
      return;
    }

    const [left, right] = entries;

    if (left.teamId === right.teamId) {
      return;
    }

    matchupEntries.push(
      buildSingleMatchupEntry(left, right),
      buildSingleMatchupEntry(right, left)
    );
  });

  const byRole = {};

  TRACKED_ROLES.forEach((role) => {
    const roleEntries = matchupEntries.filter((entry) => entry.role === role);
    byRole[role] = buildRolePayload(role, roleEntries);
  });

  return {
    generatedAt: new Date().toISOString(),
    source: "Games of Legends tournament rosters + player matchlists",
    tournaments: TOURNAMENTS.map((tournament) => tournament.name),
    regions: [...new Set(TOURNAMENTS.map((tournament) => tournament.region))],
    recentWindowMonths: 3,
    totalGames: matchupEntries.length / 2,
    roleCount: TRACKED_ROLES.length,
    byRole
  };
}

function buildRolePayload(role, entries) {
  const matchupPairs = new Map();
  const byChampion = {};

  entries.forEach((entry) => {
    const pairKey = `${entry.championId}::${entry.opponentId}`;

    if (!matchupPairs.has(pairKey)) {
      matchupPairs.set(pairKey, {
        role,
        championId: entry.championId,
        championName: entry.championName,
        opponentId: entry.opponentId,
        opponentName: entry.opponentName,
        games: 0,
        wins: 0,
        firstPlayed: entry.date,
        lastPlayed: entry.date,
        tournaments: new Set(),
        regions: new Set(),
        teams: new Set()
      });
    }

    const matchup = matchupPairs.get(pairKey);
    matchup.games += 1;
    matchup.wins += entry.win ? 1 : 0;
    matchup.tournaments.add(entry.tournament);
    matchup.regions.add(entry.region);
    matchup.teams.add(entry.teamName);

    if (entry.date < matchup.firstPlayed) {
      matchup.firstPlayed = entry.date;
    }

    if (entry.date > matchup.lastPlayed) {
      matchup.lastPlayed = entry.date;
    }
  });

  const today = new Date();
  const matchupList = [...matchupPairs.values()]
    .map((matchup) => {
      const winRate = matchup.games ? matchup.wins / matchup.games : 0;
      const confidence = Math.min(1, matchup.games / 5);
      const freshness = Math.max(
        0,
        1 - Math.round((today - new Date(matchup.lastPlayed)) / (1000 * 60 * 60 * 24)) / 180
      );
      const matchupScore =
        ((winRate - 0.5) * 12) +
        matchup.games * 0.8 +
        matchup.regions.size * 1.8 +
        matchup.tournaments.size * 1.5 +
        freshness * 3;

      return {
        role,
        championId: matchup.championId,
        championName: matchup.championName,
        opponentId: matchup.opponentId,
        opponentName: matchup.opponentName,
        games: matchup.games,
        wins: matchup.wins,
        winRate: Number(winRate.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        freshness: Number(freshness.toFixed(3)),
        matchupScore: Number(matchupScore.toFixed(2)),
        regions: [...matchup.regions],
        tournaments: [...matchup.tournaments],
        teams: [...matchup.teams],
        firstPlayed: matchup.firstPlayed,
        lastPlayed: matchup.lastPlayed
      };
    })
    .filter((matchup) => matchup.games >= 2)
    .sort((left, right) => right.matchupScore - left.matchupScore);

  matchupList.forEach((matchup) => {
    if (!byChampion[matchup.championId]) {
      byChampion[matchup.championId] = {
        championId: matchup.championId,
        championName: matchup.championName,
        entries: []
      };
    }

    byChampion[matchup.championId].entries.push(matchup);
  });

  Object.values(byChampion).forEach((champion) => {
    champion.entries.sort((left, right) => right.matchupScore - left.matchupScore);
    champion.favorable = champion.entries.slice(0, 6);
    champion.difficult = [...champion.entries]
      .sort((left, right) => left.matchupScore - right.matchupScore)
      .slice(0, 6);
    champion.matchupRobustness = Number(
      computeChampionRobustness(champion.entries).toFixed(3)
    );
  });

  return {
    role,
    totalGames: entries.length / 2,
    matchupCount: matchupList.length,
    matchups: matchupList,
    byChampion
  };
}

function computeChampionRobustness(entries) {
  if (!entries.length) {
    return 0;
  }

  const sample = entries.slice(0, 8);
  const weighted = sample.reduce((sum, entry) => {
    const edge = (entry.winRate - 0.5) * 10;
    const confidence = Math.min(1, entry.games / 4);
    return sum + edge * (0.6 + confidence * 0.4);
  }, 0);

  return weighted / sample.length;
}

function buildSingleMatchupEntry(self, opponent) {
  return {
    role: self.role,
    region: self.region,
    tournament: self.tournament,
    teamId: self.teamId,
    teamName: self.teamName,
    date: self.date,
    matchKey: self.matchKey,
    gameId: self.gameId,
    gameLabel: self.gameLabel,
    win: self.win,
    championId: self.championId,
    championName: self.championName,
    opponentId: opponent.championId,
    opponentName: opponent.championName
  };
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
      role: normalizeRosterRole(row[1]),
      id: row[2],
      name: decodeHtml(row[3])
    }))
    .filter((player) => TRACKED_ROLES.includes(player.role));
}

function normalizeRosterRole(role) {
  if (role === "BOT") {
    return "ADC";
  }

  if (role === "SUP") {
    return "SUPPORT";
  }

  return role;
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
