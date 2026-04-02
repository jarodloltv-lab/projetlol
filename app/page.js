"use client";

import { useEffect, useState } from "react";
import {
  roleOrder,
  roleLabels,
  styleProfiles,
  generatorChampionCount,
  generatorPoolByRoleCount,
  priorityTags,
  riskTags,
  generateBestComposition,
  getTeamChampionOptions,
  formatTag,
  getChampionPortrait,
  getChampionPickReasons,
  getChampionProfile,
  getChampionMatchupInsights,
  botlaneSynergySource
} from "../lib/lol-data";

const defaultFilters = {
  style: "teamfight",
  risk: "balanced",
  priority: "engage"
};

const styleKeys = Object.keys(styleProfiles);
const riskKeys = ["safe", "balanced", "spicy"];
const priorityKeys = Object.keys(priorityTags);

export default function HomePage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [customizeDraft, setCustomizeDraft] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [result, setResult] = useState(null);
  const [selectedByRole, setSelectedByRole] = useState({
    top: "",
    jungle: "",
    mid: "",
    adc: "",
    support: ""
  });
  const [appliedSelection, setAppliedSelection] = useState({
    top: "",
    jungle: "",
    mid: "",
    adc: "",
    support: ""
  });
  const [openPickerRole, setOpenPickerRole] = useState(null);
  const [metaSnapshot, setMetaSnapshot] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [selectedChampion, setSelectedChampion] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadMeta() {
      try {
        setLoadingMeta(true);
        setMetaError("");

        const response = await fetch("/api/meta");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.message || "Erreur meta.");
        }

        if (active) {
          setMetaSnapshot(payload);
          regenerateWithMode(payload.byChampion || {}, customizeDraft, filters, appliedSelection);
        }
      } catch (error) {
        if (active) {
          setMetaError("La meta live n'a pas pu etre chargee.");
        }
      } finally {
        if (active) {
          setLoadingMeta(false);
        }
      }
    }

    loadMeta();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const liveConnected = metaSnapshot?.liveConnected ?? metaSnapshot?.connected;

    if (!liveConnected) {
      return undefined;
    }

    const currentMatches = metaSnapshot.sampleMatches || 0;
    const targetMatches = metaSnapshot.requestBudget?.targetMatches || 0;

    if (!targetMatches || currentMatches >= targetMatches) {
      return undefined;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch("/api/meta");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.message || "Erreur meta.");
        }

        setMetaSnapshot(payload);
        regenerateWithMode(payload.byChampion || {}, customizeDraft, filters, appliedSelection);
      } catch (error) {
        setMetaError("La meta live n'a pas pu etre chargee.");
      }
    }, 65000);

    return () => clearTimeout(timeoutId);
  }, [metaSnapshot, customizeDraft, filters, appliedSelection]);

  function updateFilter(key, value) {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);

    if (customizeDraft) {
      regenerateWithMode(metaSnapshot?.byChampion || {}, true, nextFilters, appliedSelection);
    }
  }

  function regenerate() {
    regenerateWithMode(metaSnapshot?.byChampion || {}, customizeDraft, filters, appliedSelection);
  }

  function toggleCustomization() {
    const nextCustomizeDraft = !customizeDraft;
    setCustomizeDraft(nextCustomizeDraft);
    regenerateWithMode(metaSnapshot?.byChampion || {}, nextCustomizeDraft, filters, appliedSelection);
  }

  function regenerateWithMode(metaByChampion, useCustomFilters, selectedFilters, lockedSelection = appliedSelection) {
    const nextFilters = useCustomFilters ? selectedFilters : getRandomFilters();
    setAppliedFilters(nextFilters);
    setResult(generateBestComposition(nextFilters, metaByChampion, getLockedSelection(lockedSelection)));
  }

  function updateSelectedRole(role, championId) {
    const nextSelection = { ...selectedByRole, [role]: championId };
    setSelectedByRole(nextSelection);
    setAppliedSelection(nextSelection);
    setOpenPickerRole(null);
    regenerateWithMode(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      nextSelection
    );
  }

  function applySelection() {
    setAppliedSelection(selectedByRole);
    regenerateWithMode(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      selectedByRole
    );
  }

  function openChampionDetails(champion) {
    const profile = getChampionProfile(champion.imageId);
    const meta = metaSnapshot?.byChampion?.[champion.imageId] || null;
    const matchupInsights = getChampionMatchupInsights(champion, metaSnapshot?.byChampion || {});

    setSelectedChampion({
      champion,
      profile,
      meta,
      reasons: getChampionPickReasons(champion, metaSnapshot?.byChampion || {}),
      matchupInsights
    });
  }

  const groupedMetaChampions = getMetaChampionsByRole(metaSnapshot);
  const riotLiveConnected = metaSnapshot?.liveConnected ?? metaSnapshot?.connected ?? false;
  const teamOptionsByRole = getTeamChampionOptions(metaSnapshot?.byChampion || {});

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">League of Legends Team Generator</p>
          <h1>Genere les meilleures compositions selon ton plan de jeu</h1>
          <p className="hero-text">
            Ce prototype React / Next.js propose une draft complete Top, Jungle, Mid,
            ADC et Support, avec analyse de synergies, score global et lecture rapide.
          </p>
        </div>

        <aside className="hero-card">
          <p className="card-label">Mode par defaut</p>
          <strong>Le generateur tire une compo libre automatiquement</strong>
          <span>Vous pouvez ensuite activer un menu d'options pour imposer un style, un risque ou une priorite.</span>
        </aside>
      </section>

      <section className="dashboard">
        <aside className="panel controls-panel">
          <h2>Generation</h2>

          <div className="generator-mode-card">
            <p className="generator-mode-label">
              {customizeDraft ? "Mode personnalise" : "Mode libre"}
            </p>
            <strong>
              {customizeDraft
                ? "Vos preferences influencent directement la draft"
                : "Le site choisit une composition aleatoire par defaut"}
            </strong>
            <p>
              {customizeDraft
                ? "Vous pouvez forcer une direction de draft precise depuis le menu ci-dessous."
                : "Activez les options seulement si vous voulez orienter la draft vers un plan de jeu particulier."}
            </p>
            <button
              type="button"
              className="preferences-toggle"
              onClick={toggleCustomization}
            >
              {customizeDraft ? "Revenir au mode libre" : "Ajouter des options de style"}
            </button>
          </div>

          {customizeDraft ? (
            <div className="controls-grid">
              <label>
                <span>Style d'equipe</span>
                <select
                  value={filters.style}
                  onChange={(event) => updateFilter("style", event.target.value)}
                >
                  {Object.entries(styleProfiles).map(([key, profile]) => (
                    <option key={key} value={key}>
                      {profile.title}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Niveau de risque</span>
                <select
                  value={filters.risk}
                  onChange={(event) => updateFilter("risk", event.target.value)}
                >
                  <option value="safe">Safe</option>
                  <option value="balanced">Equilibre</option>
                  <option value="spicy">Agressif</option>
                </select>
              </label>

              <label>
                <span>Priorite</span>
                <select
                  value={filters.priority}
                  onChange={(event) => updateFilter("priority", event.target.value)}
                >
                  <option value="engage">Engage</option>
                  <option value="damage">Degats</option>
                  <option value="frontline">Frontline</option>
                  <option value="cc">Crowd control</option>
                  <option value="scaling">Scaling</option>
                </select>
              </label>
            </div>
          ) : null}

          <button className="generate-btn" onClick={regenerate}>
            {getLockedSelection(appliedSelection)
              ? "Generer autour de ces picks"
              : customizeDraft
                ? "Regenerer avec ces options"
                : "Lancer une compo aleatoire"}
          </button>

          <button
            type="button"
            className="generate-btn secondary-btn"
            onClick={applySelection}
            disabled={!hasSelectionChanges(selectedByRole, appliedSelection)}
          >
            Actualiser l'analyse
          </button>

          <div className="tips">
            <h3>Logique actuelle</h3>
            <ul>
              <li>Recherche d'un noyau engage / controle / front line</li>
              <li>Equilibre entre degats physiques et magiques</li>
              <li>Poids plus fort sur le style choisi par le joueur</li>
              <li>Respect des postes recents via les positions Riot quand la meta est disponible</li>
              <li>Choix ADC + support comme duo coherent vu en competition recente</li>
            </ul>
          </div>

          <div className="meta-box">
            <h3>Pool disponible</h3>
            <p>{generatorChampionCount} champions eligibles dans le generateur</p>
            <p>
              {roleOrder
                .map((role) => `${roleLabels[role]}: ${generatorPoolByRoleCount[role]}`)
                .join(" / ")}
            </p>
          </div>

          <div className="meta-box">
            <h3>Etat de la meta live</h3>
            {loadingMeta ? <p>Chargement des donnees Riot...</p> : null}
            {metaError ? <p className="warning-text">{metaError}</p> : null}
            {metaSnapshot ? (
              <>
                <p>Source: {metaSnapshot.source}</p>
                <p>Patch: {metaSnapshot.patch}</p>
                <p>
                  Connexion Riot: {riotLiveConnected ? "active" : metaSnapshot.connected ? "hors ligne, echantillon local actif" : "a configurer"}
                </p>
                {metaSnapshot.message ? <p>{metaSnapshot.message}</p> : null}
              </>
            ) : null}
          </div>
        </aside>

        <section className="panel results-panel">
          {result ? (
            <>
            <div className="result-header">
              <div>
                <p className="card-label">Composition proposee</p>
              <h2>{result.profile.title}</h2>
              {result.axis ? (
                <div
                  className="composition-axis-badge"
                  style={{ "--axis-color": result.axis.color }}
                >
                  <span className="axis-icon" aria-hidden="true">⚡</span>
                  <div>
                    <strong>{result.axis.label}</strong>
                    <small>{getAxisChampionLine(result.axis)}</small>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="score-badge">
              <span>Score</span>
              <strong>{result.score}</strong>
            </div>
          </div>

          <div className={`composition-grid ${getAxisGridClass(result.axis)}`}>
            {result.composition.map((champion) => (
              <article
                className={`champion-card ${getAxisCardClass(champion.role, result.axis)}`}
                key={`${champion.role}-${champion.name}`}
              >
                <div className="botlane-inline-select team-inline-select">
                  <span>Choisir un {roleLabels[champion.role]}</span>
                  <button
                    type="button"
                    className="botlane-picker-trigger"
                    onClick={() =>
                      setOpenPickerRole((current) => (current === champion.role ? null : champion.role))
                    }
                  >
                    <div className="botlane-picker-trigger-main">
                      <img
                        src={getChampionPortrait(getDisplayedChampionImageId(champion.role, selectedByRole, champion))}
                        alt={getDisplayedChampionName(champion.role, selectedByRole, champion)}
                        className="botlane-picker-trigger-image"
                      />
                      <strong>{getDisplayedChampionName(champion.role, selectedByRole, champion)}</strong>
                    </div>
                    <span>{roleLabels[champion.role]} ou Auto</span>
                  </button>
                  {openPickerRole === champion.role ? (
                    <div className="botlane-picker-panel">
                      <button
                        type="button"
                        className="botlane-picker-option auto"
                        onClick={() => updateSelectedRole(champion.role, "")}
                      >
                        <span className="botlane-picker-auto-badge">Auto</span>
                        <strong>{roleLabels[champion.role]} automatique</strong>
                        <small>Le générateur choisit le meilleur pick selon la compo.</small>
                      </button>
                      <div className="botlane-picker-grid">
                        {teamOptionsByRole[champion.role].map((option) => (
                          <button
                            type="button"
                            key={`${champion.role}-${option.imageId}`}
                            className={`botlane-picker-option ${
                              selectedByRole[champion.role] === option.imageId ? "active" : ""
                            }`}
                            onClick={() => updateSelectedRole(champion.role, option.imageId)}
                          >
                            <img src={getChampionPortrait(option.imageId)} alt={option.name} />
                            <strong>{option.name}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="portrait-button"
                  onClick={() => openChampionDetails(champion)}
                  >
                    <img
                      className="champion-portrait"
                      src={getChampionPortrait(champion.imageId)}
                      alt={champion.name}
                    />
                  </button>
                  <span className="champion-role">
                    <RoleIcon role={champion.role} />
                    {roleLabels[champion.role]}
                  </span>
                  <h3 className="champion-name">{champion.name}</h3>
                </article>
              ))}
            </div>

          <div className="analysis-grid">
            <article className="mini-panel">
              <h3>Forces</h3>
              <ul>
                {result.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="mini-panel">
              <h3>Points d'attention</h3>
              <ul>
                {result.warnings.map((item) => (
                  <li key={item} className="warning">
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <article className="summary-panel">
            <h3>Lecture rapide</h3>
            <p>{result.summary}</p>
          </article>

            <article className="details-panel">
              <div>
                <h3>Poids strategiques</h3>
              <p>Style: {styleProfiles[filters.style].desiredTags.join(", ")}</p>
            </div>
            <div>
              <h3>Priorite active</h3>
              <p>{priorityTags[filters.priority].join(", ")}</p>
            </div>
            <div>
              <h3>Risque</h3>
              <p>{riskTags[filters.risk].join(", ")}</p>
            </div>
            <div>
              <h3>Meta</h3>
              <p>
                {riotLiveConnected
                  ? "Le score tient compte de la popularite, du winrate et des postes reels recents."
                  : metaSnapshot?.connected
                  ? "Le score continue d'utiliser l'echantillon ranked local deja enregistre."
                  : "Mode prototype tant que RIOT_API_KEY n'est pas configuree."}
              </p>
            </div>
              <div>
                <h3>Synergie botlane</h3>
                <p>Source: {botlaneSynergySource}</p>
              </div>
            </article>
            </>
          ) : (
            <article className="summary-panel">
              <h3>Chargement</h3>
              <p>Preparation de la composition...</p>
            </article>
          )}
        </section>
      </section>

      <section className="panel meta-panel">
        <div className="gallery-header">
          <div>
            <p className="card-label">Meta live</p>
            <h2>Top picks par poste sur Riot API</h2>
            <p className="hero-text compact">
              {metaSnapshot?.connected
                ? `Echantillon ${metaSnapshot.sampleMatches} matchs, ${metaSnapshot.samplePlayers} joueurs, region ${metaSnapshot.region}.`
                : "Ajoutez une cle Riot API pour activer cette section avec de vraies donnees."}
            </p>
            {metaSnapshot?.connected && !riotLiveConnected ? (
              <p className="hero-text compact">
                Connexion live indisponible, affichage du dernier echantillon ranked enregistre.
              </p>
            ) : null}
            {metaSnapshot?.connected && metaSnapshot?.requestBudget?.targetMatches ? (
              <p className="hero-text compact">
                Progression auto: {metaSnapshot.sampleMatches} / {metaSnapshot.requestBudget.targetMatches} matchs accumules.
              </p>
            ) : null}
          </div>
        </div>

        {groupedMetaChampions.length ? (
          <div className="meta-role-sections">
            {groupedMetaChampions.map(({ role, champions }) => (
              <section className="meta-role-row" key={role}>
                <div className="meta-role-heading">
                  <span className="champion-role">
                    <RoleIcon role={role} />
                    {roleLabels[role]}
                  </span>
                  <p>{champions.length} top picks suivis sur ce poste</p>
                </div>

                <div className="meta-champion-grid">
                  {champions.map((champion) => (
                    <article className="meta-champion-card" key={`${role}-${champion.id}`}>
                      <img
                        className="meta-champion-image"
                        src={getChampionPortrait(champion.id)}
                        alt={champion.name}
                      />
                      <div className="meta-champion-body">
                        <h3>{champion.name}</h3>
                        <p>Win rate: {formatPercent(champion.winRate)}</p>
                        <p>Pick rate: {formatPercent(champion.pickRate)}</p>
                        <p>Parties: {champion.games}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="gallery-state">
            {loadingMeta
              ? "Preparation des stats..."
              : "Pas encore de stats live affichables."}
          </p>
        )}
      </section>

      {selectedChampion ? (
        <div className="modal-backdrop" onClick={() => setSelectedChampion(null)}>
          <article
            className="champion-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setSelectedChampion(null)}
            >
              Fermer
            </button>

            <div className="modal-hero">
              <img
                className="modal-portrait"
                src={getChampionPortrait(selectedChampion.champion.imageId)}
                alt={selectedChampion.champion.name}
              />
              <div>
                <p className="card-label">Fiche champion</p>
                <h2>{selectedChampion.champion.name}</h2>
                <p className="hero-text compact">
                  Role dans la comp: <InlineRoleLabel role={selectedChampion.champion.role} label={roleLabels[selectedChampion.champion.role]} />
                </p>
                <div className="champion-tags">
                  {(selectedChampion.profile?.displayTags || selectedChampion.champion.displayTags || []).slice(0, 6).map((tag) => (
                    <span key={`${selectedChampion.champion.name}-modal-${tag}`}>{formatTag(tag)}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-grid">
              <section className="mini-panel">
                <h3>3 vraies raisons de pick</h3>
                <ul>
                  {selectedChampion.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Profil</h3>
                <ul>
                  <li>Classes Riot: {(selectedChampion.profile?.classes || []).join(" / ") || "N/A"}</li>
                  <li>Type d'attaque: {selectedChampion.profile?.attackType || "N/A"}</li>
                  <li>Portee: {selectedChampion.profile?.range || "N/A"}</li>
                  <li>Postes sources: {(selectedChampion.profile?.positions || []).join(" / ") || "N/A"}</li>
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Meta recente</h3>
                <ul>
                  <li>Win rate: {selectedChampion.meta ? formatPercent(selectedChampion.meta.winRate) : "N/A"}</li>
                  <li>Pick rate: {selectedChampion.meta ? formatPercent(selectedChampion.meta.pickRate) : "N/A"}</li>
                  <li>Parties echantillonnees: {selectedChampion.meta?.games || 0}</li>
                  <li>
                    Poste principal recent: {selectedChampion.meta ? formatRecentRole(selectedChampion.meta) : "N/A"}
                  </li>
                </ul>
              </section>

              {["adc", "support"].includes(selectedChampion.champion.role) ? (
                <section className="mini-panel">
                  <h3>Synergie botlane</h3>
                  {selectedChampion.champion.botlaneSynergy ? (
                    <ul>
                      <li>Duo vu en competition recente avec {selectedChampion.champion.botlaneSynergy.partnerName}</li>
                      <li>Win rate recent: {formatPercent(selectedChampion.champion.botlaneSynergy.winRate)}</li>
                      <li>Games PRO analysees: {selectedChampion.champion.botlaneSynergy.games}</li>
                      <li>Source: LEC / LCK / LPL sur les 3 a 6 derniers mois</li>
                    </ul>
                  ) : (
                    <ul>
                      <li>Pas de duo botlane pro recent remonte pour cette draft.</li>
                    </ul>
                  )}
                </section>
              ) : null}

              <section className="mini-panel">
                <h3>Ratings champion</h3>
                <ul>
                  <li>Damage: {selectedChampion.profile?.attributeRatings?.damage ?? "N/A"}</li>
                  <li>Toughness: {selectedChampion.profile?.attributeRatings?.toughness ?? "N/A"}</li>
                  <li>Control: {selectedChampion.profile?.attributeRatings?.control ?? "N/A"}</li>
                  <li>Mobility: {selectedChampion.profile?.attributeRatings?.mobility ?? "N/A"}</li>
                  <li>Utility: {selectedChampion.profile?.attributeRatings?.utility ?? "N/A"}</li>
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Ce champion est fort contre</h3>
                <ul className="matchup-list">
                  {(selectedChampion.matchupInsights?.favorable || []).map((entry) => (
                    <li key={`fav-${entry.id}`} className="matchup-item">
                      <img
                        className="matchup-item-image"
                        src={getChampionPortrait(entry.id)}
                        alt={entry.name}
                      />
                      <span>{entry.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Ce champion souffre contre</h3>
                <ul className="matchup-list">
                  {(selectedChampion.matchupInsights?.difficult || []).map((entry) => (
                    <li key={`weak-${entry.id}`} className="matchup-item">
                      <img
                        className="matchup-item-image"
                        src={getChampionPortrait(entry.id)}
                        alt={entry.name}
                      />
                      <span>{entry.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </article>
        </div>
      ) : null}
    </main>
  );
}

function getRandomFilters() {
  return {
    style: randomFrom(styleKeys),
    risk: randomFrom(riskKeys),
    priority: randomFrom(priorityKeys)
  };
}

function randomFrom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function prettyLabel(value) {
  const labels = {
    engage: "Engage",
    damage: "Degats",
    frontline: "Frontline",
    cc: "Crowd control",
    scaling: "Scaling",
    safe: "Safe",
    balanced: "Equilibre",
    spicy: "Agressif"
  };

  return labels[value] || value;
}

function getLockedSelection(selection) {
  const entries = Object.entries(selection || {}).filter(([, value]) => Boolean(value));

  if (!entries.length) {
    return null;
  }

  return Object.fromEntries(entries);
}

function hasSelectionChanges(selectedByRole, appliedSelection) {
  return roleOrder.some((role) => (selectedByRole?.[role] || "") !== (appliedSelection?.[role] || ""));
}

function getDisplayedChampionName(role, selection, fallbackChampion) {
  const selectedId = selection?.[role];
  if (!selectedId) {
    return fallbackChampion.name;
  }

  const options = getTeamChampionOptions();
  return options[role].find((champion) => champion.imageId === selectedId)?.name || fallbackChampion.name;
}

function getDisplayedChampionImageId(role, selection, fallbackChampion) {
  return selection?.[role] || fallbackChampion.imageId;
}

function getAxisGridClass(axis) {
  if (!axis?.id) {
    return "";
  }

  return `axis-${axis.id}`;
}

function getAxisCardClass(role, axis) {
  if (!axis?.id) {
    return "";
  }

  if (axis.id === "top-jungle" && (role === "top" || role === "jungle")) {
    return "axis-card-active";
  }

  if (axis.id === "mid-jungle" && (role === "mid" || role === "jungle")) {
    return "axis-card-active";
  }

  if (axis.id === "botlane" && (role === "adc" || role === "support")) {
    return "axis-card-active axis-card-botlane";
  }

  if (axis.id === "jungle-botlane" && (role === "jungle" || role === "adc" || role === "support")) {
    return role === "adc" || role === "support"
      ? "axis-card-active axis-card-botlane"
      : "axis-card-active";
  }

  return "";
}

function getAxisChampionLine(axis) {
  if (!axis?.champions?.length) {
    return "";
  }

  if (axis.id === "jungle-botlane") {
    const [jungle, adc, support] = axis.champions;
    return `${jungle} vers ${adc} + ${support}`;
  }

  return axis.champions.join(" + ");
}

function InlineRoleLabel({ role, label }) {
  return (
    <span className="inline-role-label">
      <RoleIcon role={role} />
      {label}
    </span>
  );
}

function RoleIcon({ role }) {
  return (
    <span className={`lane-icon lane-icon-${role}`} aria-hidden="true">
      <img src={getLaneIconSrc(role)} alt="" />
    </span>
  );
}

function getLaneIconSrc(role) {
  const iconMap = {
    top: "/roles/top.png",
    jungle: "/roles/jungle.png",
    mid: "/roles/mid.png",
    adc: "/roles/adc.png",
    support: "/roles/support.png"
  };

  return iconMap[role] || iconMap.support;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatRecentRole(meta) {
  const entries = Object.entries(meta.positions || {})
    .filter(([position]) => position !== "UNKNOWN")
    .sort((first, second) => second[1] - first[1]);

  const best = entries[0]?.[0];
  const labels = {
    TOP: "Top",
    JUNGLE: "Jungle",
    MIDDLE: "Mid",
    BOTTOM: "ADC",
    UTILITY: "Support"
  };

  return labels[best] || "N/A";
}

function getMetaChampionsByRole(metaSnapshot) {
  const champions = Object.values(metaSnapshot?.byChampion || {});

  if (!champions.length) {
    return [];
  }

  return roleOrder
    .map((role) => ({
      role,
      champions: champions
        .filter((champion) => formatRecentRole(champion).toLowerCase() === roleLabels[role].toLowerCase())
        .sort((first, second) => {
          if (second.pickRate !== first.pickRate) {
            return second.pickRate - first.pickRate;
          }

          return second.winRate - first.winRate;
        })
        .slice(0, 5)
    }))
    .filter((group) => group.champions.length);
}
