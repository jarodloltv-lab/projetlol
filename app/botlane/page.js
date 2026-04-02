"use client";

import { useEffect, useState } from "react";
import {
  styleProfiles,
  priorityTags,
  generateBestBotlane,
  evaluateBotlaneDuo,
  getBotlaneVariants,
  getBotlaneMatchupAlternatives,
  getTopRecentBotlanes,
  getBotlaneDuoInsights,
  getBotlaneDuoSummary,
  formatBotlanePowerWindows,
  botlaneProfileSource,
  getBotlaneChampionOptions,
  formatTag,
  getChampionMatchupInsights,
  getChampionPortrait,
  getChampionProfile,
  championPool
} from "../../lib/lol-data";

const defaultFilters = {
  style: "teamfight",
  risk: "balanced",
  priority: "engage"
};

const styleKeys = ["teamfight", "pick", "poke", "protect", "wombo"];
const riskKeys = ["safe", "balanced", "spicy"];
const priorityKeys = Object.keys(priorityTags);

export default function BotlanePage() {
  const [filters, setFilters] = useState(defaultFilters);
  const [customizeDraft, setCustomizeDraft] = useState(false);
  const [selectedAdcId, setSelectedAdcId] = useState("");
  const [selectedSupportId, setSelectedSupportId] = useState("");
  const [selectedEnemyAdcId, setSelectedEnemyAdcId] = useState("");
  const [selectedEnemySupportId, setSelectedEnemySupportId] = useState("");
  const [openPickerRole, setOpenPickerRole] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [metaSnapshot, setMetaSnapshot] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [result, setResult] = useState(null);
  const [variantDuos, setVariantDuos] = useState([]);
  const [matchupAlternatives, setMatchupAlternatives] = useState({ adc: [], support: [] });
  const [topDuos, setTopDuos] = useState([]);
  const [selectedChampion, setSelectedChampion] = useState(null);
  const [selectedDuo, setSelectedDuo] = useState(null);
  const riotLiveConnected = metaSnapshot?.liveConnected ?? metaSnapshot?.connected ?? false;
  const botlaneOptions = getBotlaneChampionOptions(metaSnapshot?.byChampion || {});
  const overlapIds = getBotlaneSuggestionOverlapIds(
    selectedAdcId,
    selectedSupportId,
    variantDuos,
    matchupAlternatives
  );

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
          refreshPageState(payload.byChampion || {}, customizeDraft, filters);
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

  function refreshPageState(
    metaByChampion,
    useCustomFilters,
    selectedFilters,
    lockedSelectionOverride,
    enemySelectionOverride
  ) {
    const nextFilters = useCustomFilters ? selectedFilters : getRandomFilters();
    const lockedSelection =
      lockedSelectionOverride !== undefined
        ? lockedSelectionOverride
        : (selectedAdcId || selectedSupportId)
          ? { adcId: selectedAdcId || undefined, supportId: selectedSupportId || undefined }
          : null;
    const enemySelection =
      enemySelectionOverride !== undefined ? enemySelectionOverride : getCurrentEnemySelection();
    const nextResult = generateBestBotlane(nextFilters, metaByChampion, lockedSelection, enemySelection);
    setAppliedFilters(nextFilters);
    setResult(nextResult);
    setVariantDuos(
      getBotlaneVariants(
        nextFilters,
        metaByChampion,
        lockedSelection,
        enemySelection,
        3,
        nextResult?.pair?.duoId || `${nextResult?.adc?.imageId}::${nextResult?.support?.imageId}`
      )
    );
    setMatchupAlternatives(
      nextResult
        ? getBotlaneMatchupAlternatives(
            nextFilters,
            metaByChampion,
            nextResult.adc.imageId,
            nextResult.support.imageId,
            enemySelection,
            2
          )
        : { adc: [], support: [] }
    );
    setTopDuos(getTopRecentBotlanes(metaByChampion, 16));
  }

  function getCurrentLockedSelection(nextAdcId = selectedAdcId, nextSupportId = selectedSupportId) {
    return nextAdcId || nextSupportId
      ? { adcId: nextAdcId || undefined, supportId: nextSupportId || undefined }
      : null;
  }

  function getCurrentEnemySelection(nextEnemyAdcId = selectedEnemyAdcId, nextEnemySupportId = selectedEnemySupportId) {
    return nextEnemyAdcId || nextEnemySupportId
      ? {
          adc: nextEnemyAdcId ? championPool.lookup.adc[nextEnemyAdcId] || null : null,
          support: nextEnemySupportId ? championPool.lookup.support[nextEnemySupportId] || null : null
        }
      : null;
  }

  function updateFilter(key, value) {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);

    if (customizeDraft) {
      refreshPageState(metaSnapshot?.byChampion || {}, true, nextFilters);
    }
  }

  function toggleCustomization() {
    const nextCustomizeDraft = !customizeDraft;
    setCustomizeDraft(nextCustomizeDraft);
    refreshPageState(metaSnapshot?.byChampion || {}, nextCustomizeDraft, filters);
  }

  function updateSelectedAdc(value) {
    setSelectedAdcId(value);
    setOpenPickerRole(null);
    refreshPageState(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      getCurrentLockedSelection(value, selectedSupportId)
    );
  }

  function updateSelectedSupport(value) {
    setSelectedSupportId(value);
    setOpenPickerRole(null);
    refreshPageState(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      getCurrentLockedSelection(selectedAdcId, value)
    );
  }

  function updateSelectedEnemyAdc(value) {
    setSelectedEnemyAdcId(value);
    setOpenPickerRole(null);
    const enemySelection = getCurrentEnemySelection(value, selectedEnemySupportId);
    const currentResult = result
      ? evaluateBotlaneDuo(
          customizeDraft ? filters : appliedFilters,
          result.adc.imageId,
          result.support.imageId,
          metaSnapshot?.byChampion || {},
          enemySelection
        )
      : null;

    if (currentResult) {
      setResult(currentResult);
      setMatchupAlternatives(
        getBotlaneMatchupAlternatives(
          customizeDraft ? filters : appliedFilters,
          metaSnapshot?.byChampion || {},
          currentResult.adc.imageId,
          currentResult.support.imageId,
          enemySelection,
          2
        )
      );
      return;
    }

    refreshPageState(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      getCurrentLockedSelection(),
      enemySelection
    );
  }

  function updateSelectedEnemySupport(value) {
    setSelectedEnemySupportId(value);
    setOpenPickerRole(null);
    const enemySelection = getCurrentEnemySelection(selectedEnemyAdcId, value);
    const currentResult = result
      ? evaluateBotlaneDuo(
          customizeDraft ? filters : appliedFilters,
          result.adc.imageId,
          result.support.imageId,
          metaSnapshot?.byChampion || {},
          enemySelection
        )
      : null;

    if (currentResult) {
      setResult(currentResult);
      setMatchupAlternatives(
        getBotlaneMatchupAlternatives(
          customizeDraft ? filters : appliedFilters,
          metaSnapshot?.byChampion || {},
          currentResult.adc.imageId,
          currentResult.support.imageId,
          enemySelection,
          2
        )
      );
      return;
    }

    refreshPageState(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      getCurrentLockedSelection(),
      enemySelection
    );
  }

  function regenerate() {
    refreshPageState(metaSnapshot?.byChampion || {}, customizeDraft, filters);
  }

  function openChampionDetails(champion) {
    const matchupInsights = getChampionMatchupInsights(champion, metaSnapshot?.byChampion || {});

    setSelectedChampion({
      champion,
      profile: getChampionProfile(champion.imageId),
      meta: metaSnapshot?.byChampion?.[champion.imageId] || null,
      reasons: [],
      matchupInsights
    });
  }

  function openDuoDetails(duo) {
    setSelectedDuo({
      ...duo,
      insights: getBotlaneDuoInsights(duo.adc, duo.support, duo.pair),
      summary: getBotlaneDuoSummary(duo.adc, duo.support, duo.pair, metaSnapshot?.byChampion || {})
    });
  }

  function applySuggestedDuo(duo) {
    const nextAdcId = selectedSupportId && !selectedAdcId ? duo.adc.imageId : duo.adc.imageId;
    const nextSupportId = selectedAdcId && !selectedSupportId ? duo.support.imageId : duo.support.imageId;

    setSelectedAdcId(nextAdcId);
    setSelectedSupportId(nextSupportId);
    setOpenPickerRole(null);

    refreshPageState(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      getCurrentLockedSelection(nextAdcId, nextSupportId)
    );
  }

  function applySuggestedRolePick(role, duo) {
    if (role === "adc") {
      const nextAdcId = duo.adc.imageId;
      setSelectedAdcId(nextAdcId);
      setOpenPickerRole(null);
      refreshPageState(
        metaSnapshot?.byChampion || {},
        customizeDraft,
        customizeDraft ? filters : appliedFilters,
        getCurrentLockedSelection(nextAdcId, selectedSupportId)
      );
      return;
    }

    const nextSupportId = duo.support.imageId;
    setSelectedSupportId(nextSupportId);
    setOpenPickerRole(null);
    refreshPageState(
      metaSnapshot?.byChampion || {},
      customizeDraft,
      customizeDraft ? filters : appliedFilters,
      getCurrentLockedSelection(selectedAdcId, nextSupportId)
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Botlane DuoQ</p>
          <h1>Trouvez un duo ADC support qui se voit vraiment en jeu</h1>
          <p className="hero-text">
            Cette page est pensee pour les joueurs qui lancent en duo au bot. Elle
            met l'accent sur les synergies recentes vues en competition, la meta
            du moment et la lisibilite du plan de lane.
          </p>
        </div>

        <aside className="hero-card">
          <p className="card-label">Focus duo</p>
          <strong>Une page faite pour lancer a deux</strong>
          <span>Le generateur choisit une botlane coherente avec une vraie lecture duoQ.</span>
        </aside>
      </section>

      <section className="dashboard">
        <aside className="panel controls-panel">
          <h2>Generation botlane</h2>

          <div className="generator-mode-card">
            <p className="generator-mode-label">
              {customizeDraft ? "Mode personnalise" : "Mode libre"}
            </p>
            <strong>
              {customizeDraft
                ? "Vous forcez une direction de lane"
                : "Le site vous propose un duo botlane aleatoire"}
            </strong>
            <p>
              {customizeDraft
                ? "Pratique si vous voulez une lane poke, engage, protect carry ou plus agressive."
                : "Activez les options seulement si vous voulez orienter le style du duo."}
            </p>
            <button
              type="button"
              className="preferences-toggle"
              onClick={toggleCustomization}
            >
              {customizeDraft ? "Revenir au mode libre" : "Ajouter des options botlane"}
            </button>
          </div>

          {customizeDraft ? (
            <div className="controls-grid">
              <label>
                <span>Style de duo</span>
                <select
                  value={filters.style}
                  onChange={(event) => updateFilter("style", event.target.value)}
                >
                  {styleKeys.map((key) => (
                    <option key={key} value={key}>
                      {styleProfiles[key].title}
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
                <span>Priorite de lane</span>
                <select
                  value={filters.priority}
                  onChange={(event) => updateFilter("priority", event.target.value)}
                >
                  <option value="engage">Engage</option>
                  <option value="damage">Degats</option>
                  <option value="frontline">Stabilite</option>
                  <option value="cc">Crowd control</option>
                  <option value="scaling">Scaling</option>
                </select>
              </label>

            </div>
          ) : null}

          <button className="generate-btn" onClick={regenerate}>
            {customizeDraft ? "Regenerer ce duo" : "Lancer un duo aleatoire"}
          </button>

          <div className="tips">
            <h3>Ce que regarde la page</h3>
            <ul>
              <li>Duo vu en competition recente sur les grandes ligues</li>
              <li>Compatibilite entre le style ADC et le style support</li>
              <li>Presence des picks dans la meta recente quand Riot est disponible</li>
              <li>Lecture simple pour la phase de lane et les fights de mid game</li>
            </ul>
          </div>

          <div className="meta-box">
            <h3>Etat de la meta live</h3>
            {loadingMeta ? <p>Chargement des donnees Riot...</p> : null}
            {metaError ? <p className="warning-text">{metaError}</p> : null}
            {metaSnapshot ? (
              <>
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
              <p className="card-label">Duo recommande</p>
              <h2>{result.adc.name} + {result.support.name}</h2>
              {selectedAdcId || selectedSupportId ? (
                <p className="card-label">
                  {getPartnerRecommendationLabel(selectedAdcId, selectedSupportId)}
                </p>
              ) : null}
              <p className="hero-text compact">
                {customizeDraft ? "Preferences actives" : "Tirage libre"}.
                {" "}Style: {styleProfiles[appliedFilters.style].title}. Priorite: {prettyLabel(appliedFilters.priority)}. Risque: {prettyLabel(appliedFilters.risk)}.
                {selectedAdcId || selectedSupportId
                  ? ` Choix: ${formatLockedSelectionSummary(selectedAdcId, selectedSupportId)}.`
                  : ""}
              </p>
            </div>

            <div className="score-badge">
              <span>Score duo</span>
              <strong>{result.score}</strong>
            </div>
          </div>

          <div className="botlane-duo-grid">
            {result.duo.map((champion) => (
              <article className="champion-card botlane-card" key={`${champion.role}-${champion.name}`}>
                <div className="botlane-inline-select">
                  <span>{champion.role === "adc" ? "Choisir un ADC" : "Choisir un support"}</span>
                  <button
                    type="button"
                    className="botlane-picker-trigger"
                    onClick={() =>
                      setOpenPickerRole((current) => (current === champion.role ? null : champion.role))
                    }
                  >
                    <div className="botlane-picker-trigger-main">
                      <img
                        src={getChampionPortrait(champion.imageId)}
                        alt={champion.name}
                        className="botlane-picker-trigger-image"
                      />
                      <strong>{champion.name}</strong>
                    </div>
                    <span>{champion.role === "adc" ? "ADC seulement" : "Supports seulement"}</span>
                  </button>
                  {openPickerRole === champion.role ? (
                    <div className="botlane-picker-panel">
                      <button
                        type="button"
                        className="botlane-picker-option auto"
                        onClick={() =>
                          champion.role === "adc" ? updateSelectedAdc("") : updateSelectedSupport("")
                        }
                      >
                        <span className="botlane-picker-auto-badge">Auto</span>
                        <strong>{champion.role === "adc" ? "ADC automatique" : "Support automatique"}</strong>
                        <small>Le générateur choisit le meilleur pick selon la data.</small>
                      </button>
                      <div className="botlane-picker-grid">
                        {(champion.role === "adc"
                          ? botlaneOptions.adc
                          : botlaneOptions.support
                        ).map((option) => (
                          <button
                            type="button"
                            key={`${champion.role}-${option.imageId}`}
                            className={`botlane-picker-option ${
                              (champion.role === "adc" ? selectedAdcId : selectedSupportId) === option.imageId
                                ? "active"
                                : ""
                            }`}
                            onClick={() =>
                              champion.role === "adc"
                                ? updateSelectedAdc(option.imageId)
                                : updateSelectedSupport(option.imageId)
                            }
                          >
                            <img src={getChampionPortrait(option.imageId)} alt={option.name} />
                            <strong>{option.name}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="botlane-enemy-inline">
                  <CompactEnemyPicker
                    label={champion.role === "adc" ? "ADC adverse" : "Support adverse"}
                    helper={
                      champion.role === "adc"
                        ? selectedEnemyAdcId
                          ? "Versus ADC actif"
                          : "Choisir l'ADC en face"
                        : selectedEnemySupportId
                          ? "Versus support actif"
                          : "Choisir le support en face"
                    }
                    value={champion.role === "adc" ? selectedEnemyAdcId : selectedEnemySupportId}
                    options={getEnemyOptions(
                      champion.role,
                      result?.adc?.imageId,
                      result?.support?.imageId,
                      champion.role === "adc" ? selectedEnemyAdcId : selectedEnemySupportId
                    )}
                    pickerKey={champion.role === "adc" ? "enemy-adc" : "enemy-support"}
                    isOpen={openPickerRole === (champion.role === "adc" ? "enemy-adc" : "enemy-support")}
                    onToggle={() =>
                      setOpenPickerRole((current) =>
                        current === (champion.role === "adc" ? "enemy-adc" : "enemy-support")
                          ? null
                          : champion.role === "adc"
                            ? "enemy-adc"
                            : "enemy-support"
                      )
                    }
                    onSelect={champion.role === "adc" ? updateSelectedEnemyAdc : updateSelectedEnemySupport}
                  />
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
                  {champion.role === "adc" ? "ADC" : "Support"}
                </span>
                <h3 className="champion-name">{champion.name}</h3>
                {shouldShowVariantsForRole(champion.role, selectedAdcId, selectedSupportId) && variantDuos.length ? (
                  <div className="inline-variants">
                    <p className="inline-variants-title">
                      {getVariantPanelTitle(selectedAdcId, selectedSupportId)}
                    </p>
                    <div className="inline-variants-list">
                      {variantDuos.map((duo) => (
                        <div
                          className={`inline-variant-item ${
                            isVariantOverlapPick(duo, selectedAdcId, selectedSupportId, overlapIds) ? "overlap-pick" : ""
                          }`}
                          key={`inline-${duo.pair?.duoId || `${duo.adc.imageId}-${duo.support.imageId}`}`}
                        >
                          <button
                            type="button"
                            className="inline-variant-main"
                            onClick={() => openDuoDetails(duo)}
                          >
                            <div className="inline-variant-head">
                              <img
                                src={getChampionPortrait(
                                  selectedSupportId ? duo.adc.imageId : duo.support.imageId
                                )}
                                alt={getVariantPartnerName(duo, selectedAdcId, selectedSupportId)}
                              />
                              <div>
                                <strong>{getVariantPartnerName(duo, selectedAdcId, selectedSupportId)}</strong>
                                {isVariantOverlapPick(duo, selectedAdcId, selectedSupportId, overlapIds) ? (
                                  <span className="overlap-badge">Synergie + contre</span>
                                ) : null}
                              </div>
                            </div>
                            <small>
                              {duo.pair
                                ? `Duo vu en competition recente • ${duo.pair?.games || 0} games PRO`
                                : getRankedFallbackShortLabel(duo.rankedFallback)}
                            </small>
                          </button>
                          <button
                            type="button"
                            className="inline-variant-apply"
                            onClick={() => applySuggestedDuo(duo)}
                            aria-label={`Valider ${getVariantPartnerName(duo, selectedAdcId, selectedSupportId)}`}
                            title="Utiliser ce pick"
                          >
                            ✓
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {(matchupAlternatives.adc.length || matchupAlternatives.support.length) ? (
            <article className="details-panel matchup-alternatives-panel">
              {matchupAlternatives.adc.length ? (
                <div>
                  <h3>2 ADC plus viables</h3>
                  <div className="inline-variants-list">
                    {matchupAlternatives.adc.map((duo) => (
                      <div
                        className={`inline-variant-item ${overlapIds.adc.has(duo.adc.imageId) ? "overlap-pick" : ""}`}
                        key={`matchup-adc-${duo.adc.imageId}-${duo.support.imageId}`}
                      >
                        <button
                          type="button"
                          className="inline-variant-main"
                          onClick={() => openDuoDetails(duo)}
                        >
                          <div className="inline-variant-head">
                            <img src={getChampionPortrait(duo.adc.imageId)} alt={duo.adc.name} />
                            <div>
                              <strong>{duo.adc.name}</strong>
                              {overlapIds.adc.has(duo.adc.imageId) ? (
                                <span className="overlap-badge">Synergie + contre</span>
                              ) : null}
                            </div>
                          </div>
                          <small>Score duo: {duo.score}</small>
                        </button>
                        <button
                          type="button"
                          className="inline-variant-apply"
                          onClick={() => applySuggestedRolePick("adc", duo)}
                          aria-label={`Valider ${duo.adc.name}`}
                          title="Utiliser cet ADC"
                        >
                          ✓
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {matchupAlternatives.support.length ? (
                <div>
                  <h3>2 supports plus viables</h3>
                  <div className="inline-variants-list">
                    {matchupAlternatives.support.map((duo) => (
                      <div
                        className={`inline-variant-item ${overlapIds.support.has(duo.support.imageId) ? "overlap-pick" : ""}`}
                        key={`matchup-support-${duo.adc.imageId}-${duo.support.imageId}`}
                      >
                        <button
                          type="button"
                          className="inline-variant-main"
                          onClick={() => openDuoDetails(duo)}
                        >
                          <div className="inline-variant-head">
                            <img src={getChampionPortrait(duo.support.imageId)} alt={duo.support.name} />
                            <div>
                              <strong>{duo.support.name}</strong>
                              {overlapIds.support.has(duo.support.imageId) ? (
                                <span className="overlap-badge">Synergie + contre</span>
                              ) : null}
                            </div>
                          </div>
                          <small>Score duo: {duo.score}</small>
                        </button>
                        <button
                          type="button"
                          className="inline-variant-apply"
                          onClick={() => applySuggestedRolePick("support", duo)}
                          aria-label={`Valider ${duo.support.name}`}
                          title="Utiliser ce support"
                        >
                          ✓
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ) : null}
            </>
          ) : (
            <article className="summary-panel">
              <h3>Chargement</h3>
              <p>Preparation du duo botlane...</p>
            </article>
          )}
        </section>
      </section>

      <section className="panel botlane-showcase">
        <div className="gallery-header">
          <div>
            <p className="card-label">Competition recente</p>
            <h2>Duos botlane qui reviennent le plus</h2>
            <p className="hero-text compact">
              Une lecture rapide des binomes vus recemment chez les pros.
            </p>
          </div>
        </div>

        <div className="top-duos-grid">
          {topDuos.map((duo) => (
            <button
              type="button"
              className="top-duo-card"
              key={duo.pair?.duoId || `${duo.adc.imageId}-${duo.support.imageId}`}
              onClick={() => openDuoDetails(duo)}
            >
              <div className="top-duo-portraits">
                <img src={getChampionPortrait(duo.adc.imageId)} alt={duo.adc.name} />
                <img src={getChampionPortrait(duo.support.imageId)} alt={duo.support.name} />
              </div>
              <h3>{duo.adc.name} + {duo.support.name}</h3>
              <p>{duo.pair ? "Duo vu en competition recente" : "Lecture via la meta ranked"}</p>
              <p>{duo.pair ? `Games PRO analysees: ${duo.pair?.games || 0}` : getRankedFallbackLabel(duo.rankedFallback)}</p>
              {duo.performanceProfile ? (
                <p>
                  Fort sur {formatBotlanePowerWindows(duo.performanceProfile)}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {selectedDuo ? (
        <div className="modal-backdrop" onClick={() => setSelectedDuo(null)}>
          <article className="champion-modal duo-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setSelectedDuo(null)}
            >
              Fermer
            </button>

            <div className="modal-hero duo-modal-hero">
              <div className="duo-modal-portraits">
                <img src={getChampionPortrait(selectedDuo.adc.imageId)} alt={selectedDuo.adc.name} />
                <img src={getChampionPortrait(selectedDuo.support.imageId)} alt={selectedDuo.support.name} />
              </div>
              <div>
                <p className="card-label">Fiche duo botlane</p>
                <h2>{selectedDuo.adc.name} + {selectedDuo.support.name}</h2>
                <p className="hero-text compact">{selectedDuo.summary}</p>
              </div>
            </div>

            <div className="modal-grid">
              <section className="mini-panel">
                <h3>Lecture du duo</h3>
                <ul>
                  {selectedDuo.insights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Competition recente</h3>
                <ul>
                  {selectedDuo.pair ? (
                    <>
                      <li>Games PRO analysees: {selectedDuo.pair?.games || 0}</li>
                      <li>Win rate recent: {formatPercent(selectedDuo.pair.winRate)}</li>
                      <li>Premiere trace: {selectedDuo.pair?.firstPlayed || "N/A"}</li>
                      <li>Derniere trace: {selectedDuo.pair?.lastPlayed || "N/A"}</li>
                      <li>Source: {botlaneProfileSource}</li>
                    </>
                  ) : (
                    <>
                      <li>{getRankedFallbackLabel(selectedDuo.rankedFallback)}</li>
                      <li>Win rate moyen ranked: {selectedDuo.rankedFallback ? formatPercent(selectedDuo.rankedFallback.averageWinRate) : "N/A"}</li>
                      <li>Pick rate moyen ranked: {selectedDuo.rankedFallback ? formatPercent(selectedDuo.rankedFallback.averagePickRate) : "N/A"}</li>
                      <li>Source: fallback meta Riot ranked recente</li>
                    </>
                  )}
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Profil de lane</h3>
                {selectedDuo.performanceProfile ? (
                  <ul>
                    <li>Fenetre forte: {formatBotlanePowerWindows(selectedDuo.performanceProfile)}</li>
                    <li>Lane: {humanizeLaneAssessment(selectedDuo.performanceProfile.laneAssessment)}</li>
                    <li>Lecture tempo: {humanizeTimingProfile(selectedDuo.performanceProfile)}</li>
                      <li>Echantillon solide: {selectedDuo.performanceProfile.sampledGames} games PRO utiles</li>
                  </ul>
                ) : (
                  <ul>
                    <li>Pas encore de profil Oracle's Elixir disponible pour ce duo.</li>
                  </ul>
                )}
              </section>

              <section className="mini-panel">
                <h3>Equipes qui l'ont joue</h3>
                <ul>
                  {(selectedDuo.performanceProfile?.teams || selectedDuo.pair?.teams || []).slice(0, 8).map((team) => (
                    <li key={team}>{team}</li>
                  ))}
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Tags du duo</h3>
                <div className="champion-tags">
                  {[...(selectedDuo.adc.displayTags || selectedDuo.adc.tags), ...(selectedDuo.support.displayTags || selectedDuo.support.tags)]
                    .filter((tag, index, array) => array.indexOf(tag) === index)
                    .slice(0, 6)
                    .map((tag) => (
                      <span key={`duo-${selectedDuo.adc.name}-${selectedDuo.support.name}-${tag}`}>{formatTag(tag)}</span>
                    ))}
                </div>
              </section>
            </div>
          </article>
        </div>
      ) : null}

      {selectedChampion ? (
        <div className="modal-backdrop" onClick={() => setSelectedChampion(null)}>
          <article className="champion-modal" onClick={(event) => event.stopPropagation()}>
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
                  Role dans le duo: <InlineRoleLabel role={selectedChampion.champion.role} label={selectedChampion.champion.role === "adc" ? "ADC" : "Support"} />
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
                </ul>
              </section>

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

              <section className="mini-panel">
                <h3>Ce champion est fort contre</h3>
                <ul className="matchup-list">
                  {(selectedChampion.matchupInsights?.favorable || []).map((entry) => (
                    <li key={`botlane-fav-${entry.id}`} className="matchup-item">
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
                    <li key={`botlane-weak-${entry.id}`} className="matchup-item">
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
    frontline: "Stabilite",
    cc: "Crowd control",
    scaling: "Scaling",
    safe: "Safe",
    balanced: "Equilibre",
    spicy: "Agressif"
  };

  return labels[value] || value;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "N/A";
}

function humanizeLaneAssessment(value) {
  const labels = {
    dominant: "tres forte en lane",
    forte: "forte en lane",
    stable: "stable en lane",
    fragile: "plus fragile en lane",
    faible: "faible en lane"
  };

  return labels[value] || "lecture de lane indisponible";
}

function humanizeTimingProfile(profile) {
  const windows = formatBotlanePowerWindows(profile);
  return windows ? `pic de puissance surtout sur ${windows}` : "profil de tempo indisponible";
}

function getChampionNameByRole(role, championId) {
  const options = getBotlaneChampionOptions()[role === "adc" ? "adc" : "support"];
  return options.find((champion) => champion.imageId === championId)?.name || championId;
}

function getPartnerRecommendationLabel(selectedAdcId, selectedSupportId) {
  if (selectedAdcId && selectedSupportId) {
    return `Duo propose autour de ${getChampionNameByRole("adc", selectedAdcId)} et ${getChampionNameByRole("support", selectedSupportId)}`;
  }

  if (selectedAdcId) {
    return `Meilleur support propose pour ${getChampionNameByRole("adc", selectedAdcId)}`;
  }

  if (selectedSupportId) {
    return `Meilleur ADC propose pour ${getChampionNameByRole("support", selectedSupportId)}`;
  }

  return "";
}

function formatLockedSelectionSummary(selectedAdcId, selectedSupportId) {
  if (selectedAdcId && selectedSupportId) {
    return `${getChampionNameByRole("adc", selectedAdcId)} + ${getChampionNameByRole("support", selectedSupportId)}`;
  }

  if (selectedAdcId) {
    return `ADC ${getChampionNameByRole("adc", selectedAdcId)}`;
  }

  if (selectedSupportId) {
    return `Support ${getChampionNameByRole("support", selectedSupportId)}`;
  }

  return "";
}

function getRankedFallbackLabel(rankedFallback) {
  if (!rankedFallback) {
    return "Pas encore assez de data ranked recente";
  }

  return `Games ranked analysees: ${rankedFallback.totalGames}`;
}

function getBotlaneSourceLabel(rankedFallback) {
  if (rankedFallback) {
    return "Fallback meta Riot ranked recente";
  }

  return botlaneProfileSource;
}

function getVariantPanelTitle(selectedAdcId, selectedSupportId) {
  if (selectedAdcId) {
    return `Autres supports solides avec ${getChampionNameByRole("adc", selectedAdcId)}`;
  }

  if (selectedSupportId) {
    return `Autres ADC solides avec ${getChampionNameByRole("support", selectedSupportId)}`;
  }

  return "Autres variantes solides";
}

function getVariantPartnerName(duo, selectedAdcId, selectedSupportId) {
  if (selectedAdcId) {
    return duo.support.name;
  }

  if (selectedSupportId) {
    return duo.adc.name;
  }

  return `${duo.adc.name} + ${duo.support.name}`;
}

function shouldShowVariantsForRole(role, selectedAdcId, selectedSupportId) {
  if (selectedSupportId && !selectedAdcId) {
    return role === "adc";
  }

  if (selectedAdcId && !selectedSupportId) {
    return role === "support";
  }

  return false;
}

function getRankedFallbackShortLabel(rankedFallback) {
  if (!rankedFallback) {
    return "Peu de data recente";
  }

  return `Lecture ranked • ${Math.round(rankedFallback.averageWinRate * 100)}% WR`;
}

function getBotlaneSuggestionOverlapIds(
  selectedAdcId,
  selectedSupportId,
  variantDuos,
  matchupAlternatives
) {
  const adc = new Set();
  const support = new Set();

  if (selectedSupportId && !selectedAdcId) {
    const variantAdcIds = new Set(variantDuos.map((duo) => duo.adc.imageId));
    matchupAlternatives.adc.forEach((duo) => {
      if (variantAdcIds.has(duo.adc.imageId)) {
        adc.add(duo.adc.imageId);
      }
    });
  }

  if (selectedAdcId && !selectedSupportId) {
    const variantSupportIds = new Set(variantDuos.map((duo) => duo.support.imageId));
    matchupAlternatives.support.forEach((duo) => {
      if (variantSupportIds.has(duo.support.imageId)) {
        support.add(duo.support.imageId);
      }
    });
  }

  return { adc, support };
}

function isVariantOverlapPick(duo, selectedAdcId, selectedSupportId, overlapIds) {
  if (selectedSupportId && !selectedAdcId) {
    return overlapIds.adc.has(duo.adc.imageId);
  }

  if (selectedAdcId && !selectedSupportId) {
    return overlapIds.support.has(duo.support.imageId);
  }

  return false;
}

function getEnemyOptions(role, alliedAdcId, alliedSupportId, currentSelectedId = "") {
  const options = getBotlaneChampionOptions()[role === "adc" ? "adc" : "support"];

  return options.filter((option) => {
    if (option.imageId === currentSelectedId) {
      return true;
    }

    if (role === "adc") {
      return option.imageId !== alliedAdcId;
    }

    return option.imageId !== alliedSupportId;
  });
}

function CompactEnemyPicker({
  label,
  helper,
  value,
  options,
  isOpen,
  onToggle,
  onSelect
}) {
  const selectedOption = options.find((option) => option.imageId === value) || null;

  return (
    <div className="compact-enemy-picker">
      <span>{label}</span>
      <button
        type="button"
        className="compact-enemy-trigger"
        onClick={onToggle}
      >
        <div className="compact-enemy-trigger-main">
          {selectedOption ? (
            <img src={getChampionPortrait(selectedOption.imageId)} alt={selectedOption.name} />
          ) : (
            <span className="compact-enemy-placeholder">?</span>
          )}
          <strong>{selectedOption ? selectedOption.name : label}</strong>
        </div>
        <small>{helper}</small>
      </button>
      {isOpen ? (
        <div className="compact-enemy-panel botlane-picker-panel">
          <button
            type="button"
            className="botlane-picker-option auto"
            onClick={() => onSelect("")}
          >
            <span className="botlane-picker-auto-badge">Auto</span>
            <strong>{label} automatique</strong>
            <small>Le matchup reste libre si vous ne forcez pas ce champion.</small>
          </button>
          <div className="botlane-picker-grid compact-enemy-grid">
            {options.map((option) => (
              <button
                type="button"
                key={`${label}-${option.imageId}`}
                className={`botlane-picker-option ${value === option.imageId ? "active" : ""}`}
                onClick={() => onSelect(option.imageId)}
              >
                <img src={getChampionPortrait(option.imageId)} alt={option.name} />
                <strong>{option.name}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
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
    adc: "/roles/adc.png",
    support: "/roles/support.png"
  };

  return iconMap[role] || iconMap.support;
}
