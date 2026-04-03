"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  roleLabels,
  formatTag,
  getChampionPortrait,
  getChampionPickReasons,
  getChampionProfile,
  getChampionMatchupInsights,
  getChampionMetaForRole
} from "../../../lib/lol-data";

const validRoles = ["top", "jungle", "mid", "adc", "support"];

export default function MetaRolePage() {
  const params = useParams();
  const currentRole = params?.role;
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

  const roleChampions = useMemo(() => {
    const champions = Object.values(metaSnapshot?.byChampion || {});

    return champions
      .map((champion) => ({
        ...champion,
        roleMeta: getChampionMetaForRole(champion, currentRole)
      }))
      .filter((champion) => champion.roleMeta?.games)
      .sort((first, second) => {
        if ((second.roleMeta?.games || 0) !== (first.roleMeta?.games || 0)) {
          return (second.roleMeta?.games || 0) - (first.roleMeta?.games || 0);
        }

        if ((second.roleMeta?.winRate || 0) !== (first.roleMeta?.winRate || 0)) {
          return (second.roleMeta?.winRate || 0) - (first.roleMeta?.winRate || 0);
        }

        return second.name.localeCompare(first.name);
      });
  }, [metaSnapshot, currentRole]);

  if (!validRoles.includes(currentRole)) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="card-label">Meta live</p>
          <h1>Poste inconnu</h1>
          <p className="hero-text compact">
            Ce poste n&apos;existe pas dans la meta live.
          </p>
          <Link href="/" className="preferences-toggle">
            Retour a la draft complete
          </Link>
        </section>
      </main>
    );
  }

  function openChampionDetails(metaChampion) {
    const champion = {
      imageId: metaChampion.id,
      name: metaChampion.name,
      role: currentRole,
      displayTags: getChampionProfile(metaChampion.id)?.displayTags || []
    };

    setSelectedChampion({
      champion,
      profile: getChampionProfile(metaChampion.id),
      meta: metaSnapshot?.byChampion?.[metaChampion.id] || null,
      roleMeta: getChampionMetaForRole(metaSnapshot?.byChampion?.[metaChampion.id] || null, currentRole),
      reasons: getChampionPickReasons(champion, metaSnapshot?.byChampion || {}),
      matchupInsights: getChampionMatchupInsights(champion, metaSnapshot?.byChampion || {})
    });
  }

  return (
    <main className="page-shell">
      <section className="panel meta-role-page">
        <div className="gallery-header">
          <div>
            <p className="card-label">Meta live</p>
            <h1>Top picks {roleLabels[currentRole]}</h1>
            <p className="hero-text compact">
              Tous les picks suivis sur ce poste avec leur win rate et leur volume de parties.
            </p>
          </div>

          <Link href="/" className="preferences-toggle meta-role-back">
            Retour a la draft complete
          </Link>
        </div>

        {loadingMeta ? <p className="gallery-state">Chargement des donnees Riot...</p> : null}
        {metaError ? <p className="warning-text">{metaError}</p> : null}
        {!loadingMeta && !metaError ? (
          <p className="gallery-count">
            {roleChampions.length} champions suivis sur le poste {roleLabels[currentRole]}.
          </p>
        ) : null}

        <div className="meta-role-page-grid">
          {roleChampions.map((champion) => (
            <button
              key={`${currentRole}-${champion.id}`}
              type="button"
              className="meta-champion-card"
              onClick={() => openChampionDetails(champion)}
            >
              <img
                className="meta-champion-image"
                src={getChampionPortrait(champion.id)}
                alt={champion.name}
              />
              <div className="meta-champion-body">
                <h3>{champion.name}</h3>
                <p>
                  Win rate: {champion.roleMeta?.winRate != null
                    ? formatPercent(champion.roleMeta.winRate)
                    : "N/A"}
                </p>
                <p>Parties sur ce poste: {champion.roleMeta?.games || 0}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

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
                  Poste analyse: {roleLabels[currentRole]}
                </p>
                <div className="champion-tags">
                  {(selectedChampion.profile?.displayTags || []).slice(0, 6).map((tag) => (
                    <span key={`${selectedChampion.champion.name}-meta-${tag}`}>{formatTag(tag)}</span>
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
                  <li>Type d&apos;attaque: {selectedChampion.profile?.attackType || "N/A"}</li>
                  <li>Portee: {selectedChampion.profile?.range || "N/A"}</li>
                  <li>Postes sources: {(selectedChampion.profile?.positions || []).join(" / ") || "N/A"}</li>
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Meta recente</h3>
                <ul>
                  <li>
                    Win rate: {selectedChampion.roleMeta?.winRate != null
                      ? formatPercent(selectedChampion.roleMeta.winRate)
                      : "N/A"}
                  </li>
                  <li>
                    Pick rate: {selectedChampion.roleMeta?.pickRate != null
                      ? formatPercent(selectedChampion.roleMeta.pickRate)
                      : "N/A"}
                  </li>
                  <li>Parties echantillonnees sur ce poste: {selectedChampion.roleMeta?.games || 0}</li>
                </ul>
              </section>

              <section className="mini-panel">
                <h3>3 stuffs ranked les plus joues sur ce champion</h3>
                {getChampionTopBuilds(selectedChampion, currentRole).length ? (
                  <div className="build-list">
                    {getChampionTopBuilds(selectedChampion, currentRole).map((build, buildIndex) => (
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
                        <strong>{roleLabels[currentRole]}</strong>
                        <p>{build.games} parties ranked</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="build-empty">
                    Pas encore assez de data ranked sur ce champion et ce poste pour sortir 3 stuffs fiables.
                  </p>
                )}
              </section>

              <section className="mini-panel">
                <h3>Ce champion est fort contre</h3>
                <ul className="matchup-list">
                  {(selectedChampion.matchupInsights?.favorable || []).map((entry) => (
                    <li key={`meta-fav-${entry.id}`} className="matchup-item">
                      <img
                        className="matchup-item-image"
                        src={getChampionPortrait(entry.id)}
                        alt={entry.name}
                      />
                      <div>
                        <strong>{entry.name}</strong>
                        <span>{entry.reason}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mini-panel">
                <h3>Ce champion souffre contre</h3>
                <ul className="matchup-list">
                  {(selectedChampion.matchupInsights?.difficult || []).map((entry) => (
                    <li key={`meta-weak-${entry.id}`} className="matchup-item">
                      <img
                        className="matchup-item-image"
                        src={getChampionPortrait(entry.id)}
                        alt={entry.name}
                      />
                      <div>
                        <strong>{entry.name}</strong>
                        <span>{entry.reason}</span>
                      </div>
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

function getChampionTopBuilds(selectedChampion, role) {
  if (!selectedChampion?.meta) {
    return [];
  }

  const roleMap = {
    top: "TOP",
    jungle: "JUNGLE",
    mid: "MIDDLE",
    adc: "BOTTOM",
    support: "UTILITY"
  };

  const roleKey = roleMap[role] || "UNKNOWN";
  return selectedChampion.meta.buildsByRole?.[roleKey]?.topBuilds || [];
}

function formatPercent(value) {
  if (value == null) {
    return "N/A";
  }

  return `${Math.round(value * 100)}%`;
}
