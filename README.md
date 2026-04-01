# LoL Comp Builder

Base Next.js pour un generateur de compositions League of Legends.

## Demarrage

1. Installer Node.js
2. Installer les dependances
3. Lancer le serveur de developpement

```bash
npm install
npm run dev
```

Puis ouvrir [http://localhost:3000](http://localhost:3000).

## Meta live Riot

Le projet peut utiliser un echantillon reel de donnees Riot si vous ajoutez un fichier `.env.local`
base sur `.env.example`.

Exemple :

```bash
RIOT_API_KEY=your_riot_api_key_here
RIOT_PLATFORM=EUW1
RIOT_REGION=EUROPE
RIOT_META_SUMMONERS=8
RIOT_META_MATCHES_PER_SUMMONER=6
```

Ensuite, relancez `npm run dev`.

Important :
- l'API officielle Riot demande une cle API
- elle ne fournit pas directement une "meta globale" toute prete
- ici, le site calcule une meta echantillonnee a partir de matchs recents de solo queue Challenger
- sans cle Riot, le site reste en mode prototype

## Structure

- `app/page.js` : page principale React
- `app/globals.css` : styles globaux
- `lib/lol-data.js` : pool de champions et logique de generation
- `data/champion-profiles.json` : profils champions compacts generes depuis Riot + Meraki
- `scripts/generate-champion-profiles.cjs` : regeneration des profils

## Evolutions possibles

- connecter de vraies donnees meta
- ajouter les portraits et sorts des champions
- proposer une comp en fonction de la draft ennemie
- enregistrer les compositions favorites

## Regenerer les profils champions

Si vous mettez a jour les fichiers de donnees dans `data/`, vous pouvez regenerer les profils avec :

```bash
npm run generate:profiles
```
