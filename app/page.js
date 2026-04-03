"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  getDirectChampionMatchupData,
  getChampionMetaForRole,
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
const defaultTeamOptions = getTeamChampionOptions();

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
  const [selectedEnemyByRole, setSelectedEnemyByRole] = useState({
    top: "",
    jungle: "",
    mid: "",
    adc: "",
    support: ""
  });
  const [openPickerRole, setOpenPickerRole] = useState(null);
  const [pickerSearch, setPickerSearch] = useState({});
  const [metaSnapshot, setMetaSnapshot] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [selectedChampion, setSelectedChampion] = useState(null);
  const [expandedMetaRole, setExpandedMetaRole] = useState(null);
  const metaPanelRef = useRef(null);

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

  useEffect(() => {
    function handlePointerDown(event) {
      if (!metaPanelRef.current?.contains(event.target)) {
        setExpandedMetaRole(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

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
    setPickerSearch((current) => ({ ...current, [role]: "" }));
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

  function updateEnemyRole(role, championId) {
    setSelectedEnemyByRole((current) => ({ ...current, [role]: championId }));
    setOpenPickerRole(null);
    setPickerSearch((current) => ({ ...current, [`enemy-${role}`]: "" }));
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

  function openMetaChampionDetails(metaChampion, role) {
    openChampionDetails({
      imageId: metaChampion.id,
      name: metaChampion.name,
      role
    });
  }

  const groupedMetaChampions = useMemo(
    () => getMetaChampionsByRole(metaSnapshot),
    [metaSnapshot]
  );
  const riotLiveConnected = metaSnapshot?.liveConnected ?? metaSnapshot?.connected ?? false;
  const teamOptionsByRole = useMemo(
    () => getTeamChampionOptions(metaSnapshot?.byChampion || {}),
    [metaSnapshot?.byChampion]
  );
  const laneSuggestionMap = useMemo(
    () =>
      buildLaneSuggestionMap(
        result,
        selectedByRole,
        selectedEnemyByRole,
        metaSnapshot?.byChampion || {},
        teamOptionsByRole
      ),
    [result, selectedByRole, selectedEnemyByRole, metaSnapshot?.byChampion, teamOptionsByRole]
  );
  const laneVerdictMap = useMemo(
    () =>
      buildLaneVerdictMap(
        result,
        selectedByRole,
        selectedEnemyByRole,
        metaSnapshot?.byChampion || {},
        teamOptionsByRole
      ),
    [result, selectedByRole, selectedEnemyByRole, metaSnapshot?.byChampion, teamOptionsByRole]
  );

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

          <div className={`draft-board ${getAxisGridClass(result.axis)}`}>
              {result.composition.map((champion) => (
                <div className="draft-row" key={`${champion.role}-${champion.name}`}>
                  <article
                    className={`champion-card draft-side-card ally ${
                      openPickerRole === champion.role ? "picker-open" : ""
                    } ${getAxisCardClass(champion.role, result.axis)}`}
                  >
                  <div className="botlane-inline-select team-inline-select">
                    <span>Notre {roleLabels[champion.role]}</span>
                    <button
                      type="button"
                      className="botlane-picker-trigger"
                      onClick={() =>
                        setOpenPickerRole((current) => {
                          const nextRole = current === champion.role ? null : champion.role;
                          if (nextRole) {
                            setPickerSearch((search) => ({ ...search, [champion.role]: "" }));
                          }
                          return nextRole;
                        })
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
                      <span>
                        {selectedByRole[champion.role]
                          ? `${roleLabels[champion.role]} valide`
                          : `${roleLabels[champion.role]} ou Auto`}
                        </span>
                      </button>
                    <button
                      type="button"
                      className="draft-info-trigger"
                      onClick={() =>
                        openChampionDetails({
                          imageId: getDisplayedChampionImageId(champion.role, selectedByRole, champion),
                          name: getDisplayedChampionName(champion.role, selectedByRole, champion),
                          role: champion.role
                        })
                      }
                    >
                      Voir la fiche
                    </button>
                    {openPickerRole === champion.role ? (
                      <div className="botlane-picker-panel">
                        <label className="botlane-picker-search">
                          <input
                            type="text"
                            value={pickerSearch[champion.role] || ""}
                            onChange={(event) =>
                              setPickerSearch((current) => ({
                                ...current,
                                [champion.role]: event.target.value
                              }))
                            }
                            placeholder="Rechercher un champion"
                          />
                        </label>
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
                          {filterPickerOptions(
                            teamOptionsByRole[champion.role],
                            pickerSearch[champion.role]
                          ).map((option) => (
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
                  {laneSuggestionMap[champion.role]?.counterPicks?.length ? (
                    <div className="lane-suggestion-strip">
                      <span>3 bons contres</span>
                      <div className="lane-suggestion-icons">
                        {laneSuggestionMap[champion.role].counterPicks.map((entry) => (
                          <button
                            type="button"
                            key={`ally-suggestion-${champion.role}-${entry.id}`}
                            className="lane-suggestion-icon"
                            title={entry.name}
                            onClick={() => updateSelectedRole(champion.role, entry.id)}
                          >
                            <img src={getChampionPortrait(entry.id)} alt={entry.name} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>

                <div className="draft-versus-lane">
                  <span className="draft-versus-role">
                    <RoleIcon role={champion.role} />
                    {roleLabels[champion.role]}
                  </span>
                  {laneVerdictMap[champion.role] ? (
                    <div className={`lane-verdict ${laneVerdictMap[champion.role].tone}`}>
                      <strong>{laneVerdictMap[champion.role].label}</strong>
                      <small>{laneVerdictMap[champion.role].detail}</small>
                    </div>
                  ) : null}
                  <strong>VS</strong>
                </div>

                  <article
                    className={`champion-card draft-side-card enemy ${
                      openPickerRole === `enemy-${champion.role}` ? "picker-open" : ""
                    }`}
                  >
                  <div className="botlane-inline-select team-inline-select">
                    <span>{roleLabels[champion.role]} adverse</span>
                    <button
                      type="button"
                      className="botlane-picker-trigger"
                      onClick={() =>
                        setOpenPickerRole((current) => {
                          const nextRole =
                            current === `enemy-${champion.role}` ? null : `enemy-${champion.role}`;
                          if (nextRole) {
                            setPickerSearch((search) => ({
                              ...search,
                              [`enemy-${champion.role}`]: ""
                            }));
                          }
                          return nextRole;
                        })
                      }
                    >
                      <div className="botlane-picker-trigger-main">
                        {getEnemyDisplayedChampionImageId(champion.role, selectedEnemyByRole) ? (
                          <img
                            src={getChampionPortrait(getEnemyDisplayedChampionImageId(champion.role, selectedEnemyByRole))}
                            alt={getEnemyDisplayedChampionName(champion.role, selectedEnemyByRole)}
                            className="botlane-picker-trigger-image"
                          />
                        ) : (
                          <div className="botlane-picker-trigger-placeholder" aria-hidden="true">
                            ?
                          </div>
                        )}
                        <strong>{getEnemyDisplayedChampionName(champion.role, selectedEnemyByRole)}</strong>
                      </div>
                      <span>
                        {selectedEnemyByRole[champion.role]
                          ? "Pick adverse valide"
                          : "Selectionner le vis-a-vis"}
                      </span>
                    </button>
                    {selectedEnemyByRole[champion.role] ? (
                      <button
                        type="button"
                        className="draft-info-trigger enemy"
                        onClick={() =>
                          openChampionDetails({
                            imageId: selectedEnemyByRole[champion.role],
                            name: getEnemyDisplayedChampionName(champion.role, selectedEnemyByRole),
                            role: champion.role
                          })
                        }
                      >
                        Voir la fiche
                      </button>
                    ) : null}
                    {openPickerRole === `enemy-${champion.role}` ? (
                      <div className="botlane-picker-panel">
                        <label className="botlane-picker-search">
                          <input
                            type="text"
                            value={pickerSearch[`enemy-${champion.role}`] || ""}
                            onChange={(event) =>
                              setPickerSearch((current) => ({
                                ...current,
                                [`enemy-${champion.role}`]: event.target.value
                              }))
                            }
                            placeholder="Rechercher un champion"
                          />
                        </label>
                        <button
                          type="button"
                          className="botlane-picker-option auto"
                          onClick={() => updateEnemyRole(champion.role, "")}
                        >
                          <span className="botlane-picker-auto-badge">Vide</span>
                          <strong>Aucun pick adverse</strong>
                          <small>Preparation visuelle de la lane adverse.</small>
                        </button>
                        <div className="botlane-picker-grid">
                          {filterPickerOptions(
                            teamOptionsByRole[champion.role].filter(
                              (option) =>
                                option.imageId !==
                                getDisplayedChampionImageId(champion.role, selectedByRole, champion)
                            ),
                            pickerSearch[`enemy-${champion.role}`]
                          )
                            .map((option) => (
                              <button
                                type="button"
                                key={`enemy-${champion.role}-${option.imageId}`}
                                className={`botlane-picker-option ${
                                  selectedEnemyByRole[champion.role] === option.imageId ? "active" : ""
                                }`}
                                onClick={() => updateEnemyRole(champion.role, option.imageId)}
                              >
                                <img src={getChampionPortrait(option.imageId)} alt={option.name} />
                                <strong>{option.name}</strong>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </article>
              </div>
            ))}
            </div>

            </>
          ) : (
            <article className="summary-panel">
              <h3>Chargement</h3>
              <p>Preparation de la composition...</p>
            </article>
          )}
        </section>
      </section>

      <section className="panel meta-panel" ref={metaPanelRef}>
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
                    <Link href={`/meta/${role}`} className="champion-role meta-role-link">
                      <RoleIcon role={role} />
                      {roleLabels[role]}
                    </Link>
                    <p>{champions.length} top picks suivis sur ce poste</p>
                  {champions.length > 5 ? (
                    <button
                      type="button"
                      className={`meta-expand-trigger ${expandedMetaRole === role ? "active" : ""}`}
                      onClick={() =>
                        setExpandedMetaRole((current) => (current === role ? null : role))
                      }
                      aria-expanded={expandedMetaRole === role}
                      aria-label={expandedMetaRole === role ? `Replier ${roleLabels[role]}` : `Voir plus de picks ${roleLabels[role]}`}
                      title={expandedMetaRole === role ? "Voir moins" : "Voir plus"}
                    >
                      <span className="meta-expand-icon" aria-hidden="true">
                        {expandedMetaRole === role ? "‹" : "›"}
                      </span>
                    </button>
                  ) : null}
                </div>

                <div className="meta-champion-grid">
                  {champions.slice(0, 5).map((champion) => (
                    <button
                      type="button"
                      className="meta-champion-card"
                      key={`${role}-${champion.id}`}
                      onClick={() => openMetaChampionDetails(champion, role)}
                    >
                      <img
                        className="meta-champion-image"
                        src={getChampionPortrait(champion.id)}
                        alt={champion.name}
                      />
                      <div className="meta-champion-body">
                          <h3>{champion.name}</h3>
                         <p>
                           Win rate: {getChampionMetaForRole(champion, role)?.winRate != null
                             ? formatPercent(getChampionMetaForRole(champion, role).winRate)
                             : "N/A"}
                         </p>
                         <p>Parties sur ce poste: {getChampionMetaForRole(champion, role)?.games || 0}</p>
                        </div>
                      </button>
                    ))}
                </div>

                {expandedMetaRole === role && champions.length > 5 ? (
                  <div className={`meta-champion-flyout ${role === "support" ? "align-left" : ""}`}>
                    <div className="meta-champion-flyout-grid">
                      {champions.slice(5, 10).map((champion) => (
                        <button
                          type="button"
                          className="meta-champion-card"
                          key={`${role}-extra-${champion.id}`}
                          onClick={() => openMetaChampionDetails(champion, role)}
                        >
                          <img
                            className="meta-champion-image"
                            src={getChampionPortrait(champion.id)}
                            alt={champion.name}
                          />
                            <div className="meta-champion-body">
                              <h3>{champion.name}</h3>
                             <p>
                               Win rate: {getChampionMetaForRole(champion, role)?.winRate != null
                                 ? formatPercent(getChampionMetaForRole(champion, role).winRate)
                                 : "N/A"}
                             </p>
                             <p>Parties sur ce poste: {getChampionMetaForRole(champion, role)?.games || 0}</p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}
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
                    <li>
                      Win rate: {getSelectedChampionRoleMeta(selectedChampion)?.winRate != null
                        ? formatPercent(getSelectedChampionRoleMeta(selectedChampion).winRate)
                        : "N/A"}
                    </li>
                    <li>
                      Pick rate: {getSelectedChampionRoleMeta(selectedChampion)?.pickRate != null
                        ? formatPercent(getSelectedChampionRoleMeta(selectedChampion).pickRate)
                        : "N/A"}
                    </li>
                    <li>Parties echantillonnees sur ce poste: {getSelectedChampionRoleMeta(selectedChampion)?.games || 0}</li>
                    <li>
                      Poste principal recent: {selectedChampion.meta ? formatRecentRole(selectedChampion.meta) : "N/A"}
                    </li>
                  </ul>
                </section>

              <section className="mini-panel">
                <h3>3 stuffs ranked les plus joues sur ce champion</h3>
                {getChampionTopBuilds(selectedChampion).length ? (
                  <div className="build-list">
                    {getChampionTopBuilds(selectedChampion).map((build, buildIndex) => (
                        <article className="build-card" key={`${selectedChampion.champion.imageId}-${build.id}-${buildIndex}`}>
                          <div className="build-items">
                          {build.items.map((item, itemIndex) => (
                            <img
                              key={`${build.id}-${item.id}-${itemIndex}`}
                              className="build-item-image"
                              src={item.image}
                              alt={item.name}
                              title={item.name}
                            />
                          ))}
                        </div>
                        <strong>{roleLabels[selectedChampion.champion.role]}</strong>
                        <p>{build.games} parties ranked</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="build-empty">Pas encore assez de data ranked sur ce champion et ce poste pour sortir 3 stuffs fiables.</p>
                )}
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

function filterPickerOptions(options, searchValue) {
  const normalizedSearch = normalizePickerSearch(searchValue);

  if (!normalizedSearch) {
    return options;
  }

  return options.filter((option) => normalizePickerSearch(option.name).includes(normalizedSearch));
}

function normalizePickerSearch(value) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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

  const options = defaultTeamOptions;
  return options[role].find((champion) => champion.imageId === selectedId)?.name || fallbackChampion.name;
}

function getDisplayedChampionImageId(role, selection, fallbackChampion) {
  return selection?.[role] || fallbackChampion.imageId;
}

function getEnemyDisplayedChampionName(role, selection) {
  const selectedId = selection?.[role];

  if (!selectedId) {
    return "Pick adverse";
  }

  const options = defaultTeamOptions;
  return options[role].find((champion) => champion.imageId === selectedId)?.name || selectedId;
}

function getEnemyDisplayedChampionImageId(role, selection) {
  return selection?.[role] || null;
}

function buildLaneSuggestionMap(result, selectedByRole, selectedEnemyByRole, metaByChampion, teamOptionsByRole) {
  return roleOrder.reduce((accumulator, role) => {
    const allyFallback = result?.composition?.find((champion) => champion.role === role) || null;
    const allyId = selectedByRole?.[role] || allyFallback?.imageId || null;
    const enemyId = selectedEnemyByRole?.[role] || null;

    const allyName = allyId
      ? teamOptionsByRole?.[role]?.find((champion) => champion.imageId === allyId)?.name || allyFallback?.name || allyId
      : null;
    const enemyName = enemyId
      ? teamOptionsByRole?.[role]?.find((champion) => champion.imageId === enemyId)?.name || enemyId
      : null;

    const counterPicks = enemyId
      ? getBestCounterPicksForRole(
          { imageId: enemyId, name: enemyName, role },
          teamOptionsByRole?.[role] || [],
          metaByChampion
        )
      : [];

    accumulator[role] = {
      counterPicks
    };
    return accumulator;
  }, {});
}

function getBestCounterPicksForRole(enemyChampion, roleCandidates, metaByChampion) {
  if (!enemyChampion?.imageId || !roleCandidates?.length) {
    return [];
  }

  return roleCandidates
    .filter((candidate) => candidate.imageId !== enemyChampion.imageId)
    .map((candidate) => {
      const direct = getDirectChampionMatchupData(
        { imageId: candidate.imageId, name: candidate.name, role: enemyChampion.role },
        enemyChampion,
        metaByChampion
      );

      return {
        id: candidate.imageId,
        name: candidate.name,
        direct,
        sortScore: getCounterSuggestionScore(direct)
      };
    })
    .filter((entry) => entry.direct)
    .sort((first, second) => {
      if (second.sortScore !== first.sortScore) {
        return second.sortScore - first.sortScore;
      }

      return (second.direct?.confidence || 0) - (first.direct?.confidence || 0);
    })
    .slice(0, 3)
    .map((entry) => ({
      id: entry.id,
      name: entry.name
    }));
}

function getCounterSuggestionScore(matchup) {
  if (!matchup) {
    return -999;
  }

  let score = matchup.score || 0;

  if (matchup.sample?.games) {
    score += 2.4;
    score += Math.min(2.6, matchup.sample.games * 0.18);
    score += Math.max(-2.4, Math.min(2.4, (matchup.sample.winRate - 0.5) * 12));
  }

  if (matchup.proSample?.games) {
    score += 1;
    score += Math.min(1.2, matchup.proSample.games * 0.16);
  }

  if (matchup.positiveSignal) {
    score += 3.2;
  }

  if (matchup.negativeSignal) {
    score -= 3.2;
  }

  score += (matchup.confidence || 0) * 1.4;

  return score;
}

function buildLaneVerdictMap(result, selectedByRole, selectedEnemyByRole, metaByChampion, teamOptionsByRole) {
  return roleOrder.reduce((accumulator, role) => {
    const allyFallback = result?.composition?.find((champion) => champion.role === role) || null;
    const allyId = selectedByRole?.[role] || allyFallback?.imageId || null;
    const enemyId = selectedEnemyByRole?.[role] || null;

    if (!allyId || !enemyId) {
      accumulator[role] = null;
      return accumulator;
    }

    const allyChampion = {
      imageId: allyId,
      name:
        teamOptionsByRole?.[role]?.find((champion) => champion.imageId === allyId)?.name ||
        allyFallback?.name ||
        allyId,
      role
    };
    const enemyChampion = {
      imageId: enemyId,
      name:
        teamOptionsByRole?.[role]?.find((champion) => champion.imageId === enemyId)?.name ||
        enemyId,
      role
    };
    const matchup = getDirectChampionMatchupData(allyChampion, enemyChampion, metaByChampion);

    accumulator[role] = classifyLaneVerdict(matchup);
    return accumulator;
  }, {});
}

function classifyLaneVerdict(matchup) {
  if (!matchup) {
    return {
      tone: "neutral",
      label: "Lecture neutre",
      detail: "Pas assez de data directe"
    };
  }

  const verdictScore = getLaneVerdictPriority(matchup);

  if (verdictScore >= 4.2 || (matchup.positiveSignal && verdictScore >= 2.4)) {
    return {
      tone: "good",
      label: "Lane favorable",
      detail: "Notre pick tient bien le vis-a-vis"
    };
  }

  if (verdictScore <= -4.2 || (matchup.negativeSignal && verdictScore <= -2.4)) {
    return {
      tone: "bad",
      label: "Lane difficile",
      detail: "Notre pick souffre contre ce vis-a-vis"
    };
  }

  return {
    tone: "neutral",
    label: "Lane jouable",
    detail: "Matchup plutot stable"
  };
}

function getLaneVerdictPriority(matchup) {
  if (!matchup) {
    return 0;
  }

  let score = matchup.score || 0;
  const sample = matchup.sample || null;
  const proSample = matchup.proSample || null;

  if (sample?.games) {
    score += Math.max(-2.8, Math.min(2.8, ((sample.winRate || 0.5) - 0.5) * 12));
    score += Math.max(-2.8, Math.min(2.8, (sample.avgGoldDiffAt10 || 0) / 260));
    score += Math.max(-1.7, Math.min(1.7, (sample.avgCsDiffAt10 || 0) / 5));
    score += Math.max(-1.7, Math.min(1.7, (sample.avgXpDiffAt10 || 0) / 190));
    score += Math.min(1.2, sample.games * 0.08);
  }

  if (proSample?.games) {
    score += Math.max(-1.8, Math.min(1.8, ((proSample.winRate || 0.5) - 0.5) * 8));
    score += Math.min(0.9, proSample.games * 0.12);
  }

  if (matchup.positiveSignal) {
    score += 2.2;
  }

  if (matchup.negativeSignal) {
    score -= 2.2;
  }

  score += (matchup.confidence || 0) * 0.9;

  return score;
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
  const source = meta?.roleStats || meta?.positions || {};
  const entries = Object.entries(source)
    .filter(([position]) => position !== "UNKNOWN")
    .sort((first, second) => {
      const left = typeof first[1] === "number" ? first[1] : first[1]?.games || 0;
      const right = typeof second[1] === "number" ? second[1] : second[1]?.games || 0;
      return right - left;
    });

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
          const firstRoleMeta = getChampionMetaForRole(first, role);
          const secondRoleMeta = getChampionMetaForRole(second, role);

          if ((secondRoleMeta?.games || 0) !== (firstRoleMeta?.games || 0)) {
            return (secondRoleMeta?.games || 0) - (firstRoleMeta?.games || 0);
          }

          if ((secondRoleMeta?.winRate || 0) !== (firstRoleMeta?.winRate || 0)) {
            return (secondRoleMeta?.winRate || 0) - (firstRoleMeta?.winRate || 0);
          }

          return second.winRate - first.winRate;
        })
    }))
    .filter((group) => group.champions.length);
}

function getChampionTopBuilds(selectedChampion) {
  if (!selectedChampion?.meta) {
    return [];
  }

  const roleKey = getMetaBuildRoleKey(selectedChampion.champion.role);
  return selectedChampion.meta.buildsByRole?.[roleKey]?.topBuilds || [];
}

function getSelectedChampionRoleMeta(selectedChampion) {
  if (!selectedChampion?.meta || !selectedChampion?.champion?.role) {
    return null;
  }

  return getChampionMetaForRole(selectedChampion.meta, selectedChampion.champion.role);
}

function getMetaBuildRoleKey(role) {
  const roleMap = {
    top: "TOP",
    jungle: "JUNGLE",
    mid: "MIDDLE",
    adc: "BOTTOM",
    support: "UTILITY"
  };

  return roleMap[role] || "UNKNOWN";
}
