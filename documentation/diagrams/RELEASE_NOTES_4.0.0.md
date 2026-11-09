# Orchestrator 4.0.0 — Notes de version

**Date :** 7 novembre 2026 · **Version précédente :** 3.3.2

La 4.0 est une version **socle** : elle ne change pas la façon d'utiliser Orchestrator, mais remet toute la pile technique à jour (Node.js 24 LTS, Express 5, React 19, Vite 8, Tailwind 4…), supprime toutes les vulnérabilités connues des dépendances et corrige deux défauts. Le numéro majeur signale le changement de runtime Node et des briques majeures, pas une rupture fonctionnelle : flux, données (NeDB comme MongoDB), API et configuration `.env` restent compatibles.

| | 3.3.2 | 4.0.0 |
|---|---|---|
| Runtime des binaires | Node.js 18 (fin de vie avril 2025) | **Node.js 24 LTS** (support jusqu'en avril 2028) |
| Vulnérabilités npm (serveur / client / worker) | 1 critique, plusieurs hautes | **0 / 0 / 0** |
| Build du client | ~20 s, bundle principal 15 Mo | **~2,4 s**, bundle principal 12,9 Mo |
| Tests serveur | 72 / 72 | 72 / 72 |

---

## Sommaire

1. [À lire avant la mise à jour](#1-à-lire-avant-la-mise-à-jour)
2. [Serveur (`orchestrator-webpanel/server`)](#2-serveur-orchestrator-webpanelserver)
3. [Interface web (`orchestrator-webpanel/client`)](#3-interface-web-orchestrator-webpanelclient)
4. [Worker (`orchestrator-worker`)](#4-worker-orchestrator-worker)
5. [Runner autonome (`orchestrator-runner`)](#5-runner-autonome-orchestrator-runner)
6. [Packaging, RPM et CI](#6-packaging-rpm-et-ci)
7. [Outils de test SSO (`oauth_proxy`, `authent_test_service`)](#7-outils-de-test-sso-oauth_proxy-authent_test_service)
8. [Annexe — Référence complète de l'API](#annexe--référence-complète-de-lapi)

Dans chaque module, **« Acquis 3.x »** résume les fonctionnalités livrées jusqu'à la 3.3.2 (lignes 3.2 et 3.3), et **« Nouveautés 4.0 »** liste ce qui change.

---

## 1. À lire avant la mise à jour

- **Binaires packagés :** rien à installer. Node 24 est embarqué dans `orchestrator-server-*` et `orchestrator-worker-*`. Les `.env` existants fonctionnent tels quels.
- **RPM :** la construction requiert désormais `nodejs >= 24` (flux `nodejs:24` sur Rocky 9). Le paquet installé ne dépend pas d'un Node système.
- **Nœuds JavaScript `.mjs` / Groovy côté serveur :** ils utilisent toujours le Node **de l'hôte** (`NODE_EXECUTABLE_PATH` ou `node` du `PATH`). Le minimum reste Node 18, mais Node 24 est recommandé.
- **MongoDB :** la 4.0 corrige un échec de connexion du binaire packagé vers MongoDB (voir [Serveur](#corrections)). Utilisez le RPM 4.0.0 construit **après** ce correctif (commit `f73ade7`).
- **Développement :** Node 24 requis localement (`.nvmrc` ajouté). `npm run dev` utilise maintenant `tsx` au lieu de `ts-node`.
- **Navigateur :** après la mise à jour, un rechargement forcé (Ctrl+F5) évite qu'un ancien `index.html` en cache référence des scripts qui n'existent plus.
- **Retour arrière :** `dnf downgrade orchestrator-webpanel` (ou réinstallation du RPM 3.3.2). La 4.0 ne modifie pas le format des données. Sauvegardez quand même `/var/lib/orchestrator-webpanel` (ou la base MongoDB) avant.

---

## 2. Serveur (`orchestrator-webpanel/server`)

### Acquis 3.x

**Moteur d'exécution**
- Exécution des flux en graphe (DAG) : nœuds de départ, ordre des prédécesseurs, `goto` avec transmission de l'entrée, sous-flux imbriqués, variables partagées.
- Politiques d'erreur par nœud : retries avec backoff, `continue`.
- Runtimes locaux : JavaScript / Backend JS, Python, Groovy, PowerShell, Batch, Shell.
- Délégation des nœuds à des **workers distants** (file de jobs, long-poll, timeout de dispatch `DISPATCH_TIMEOUT_MIN`, reaper des workers silencieux).
- Détection d'erreur dans les logs optionnelle (`ORCHESTRATOR_FAIL_ON_LOG_ERROR`), timeout global de flux (`DEFAULT_FLOW_TIMEOUT_MS`).
- Logs en direct en SSE, historique d'exécution paginé et stocké en base.

**Déclencheurs**
- Cron (avec fuseau horaire), événements (`flow.completed`, `flow.failed`, `file.arrived` via le dossier `inbox/`), triggers HTTP par token, exécution à la demande.
- **Variantes de flux** : même flux exécuté avec un autre worker et/ou une autre branche, planifiable indépendamment.
- **Trigger synchrone `?wait=<s>` (3.3.2)** : le flux devient un endpoint REST qui renvoie la sortie du dernier nœud. Plafonné par `TRIGGER_MAX_WAIT_SECONDS`.
- **Identification optionnelle de l'appelant (3.3.2)** : `Authorization: ApiKey|Bearer` ou ticket SSO pour attribuer l'exécution à un utilisateur.

**Versionnage git intégré**
- Un dépôt git par flux, stocké en base (objets, refs, GC des objets orphelins).
- Chaque sauvegarde de l'éditeur devient un commit, avec un mécanisme amend-ou-nouveau-commit pour l'autosave.
- Branches : création, bascule, suppression, rework (`reset` en mode `head` ou `root`).
- Accès **smart-HTTP** : `git clone/pull/push` d'un flux avec un client git standard (authentification login + clé API).
- Lecture des fichiers « hors gestion » poussés dans le dépôt (par ex. depuis VS Code) : arborescence, contenu texte, téléchargement.

**Artefacts**
- Stockage adressé par contenu (sha256), découpé en morceaux au-delà de 8 Mo, upload et téléchargement en flux binaire, décompression automatique des archives.
- Héritage des artefacts par les sous-flux, GC des blobs orphelins (`ARTIFACT_GC_MIN_AGE_MS`).

**Sécurité et comptes**
- JWT session + refresh, clés API hashées, rôles `admin` / `operator` / `viewer`, propriété des flux.
- Secrets chiffrés AES-256-GCM, référencés par `${{ secrets.NOM }}`.
- Politique d'accès par groupe de workers (`allow` / `deny` par rôles et utilisateurs).
- SSO par proxy-auth (ticket CAS), utilisateurs SSO-only, vérification TLS configurable (`ORCHESTRATOR_PROXYAUTH_TLS_REJECT_UNAUTHORIZED`, 3.3.x).
- Garde-fou production : refus de démarrer avec les secrets par défaut quand `NODE_ENV=production`.

**Données et architecture**
- NeDB embarqué **ou** MongoDB, choisi selon `MONGO_URI`.
- Couche repositories par entité, validation des corps de requête (zod) et gestionnaire d'erreurs central.
- Migrations idempotentes au démarrage.

### Nouveautés 4.0

**Mises à jour majeures**

| Brique | 3.3.2 | 4.0.0 | Impact |
|---|---|---|---|
| Node.js (binaire) | 18 | **24 LTS** | Runtime supporté, performances |
| Express | 4.22 | **5.3** | Rejets async gérés nativement ; nouvelle syntaxe de chemins |
| Driver `mongodb` | indirect via `mongoose` | **dépendance directe ~7.8.0** | Version du driver maîtrisée |
| node-cron | 3 | **4** | — |
| bcryptjs | 2 | **3** | Types fournis par le paquet |
| dotenv | 16 | **18** | Toujours silencieux via `dotenv/config` |
| zod, playwright, jsonwebtoken, cors, nedb | — | dernières versions | — |
| TypeScript | 5.9 | **6.0.3** | Cible ES2023 |
| `@yao-pkg/pkg` | 5 | **6** | Cibles `node24-*` |
| vitest | 4.1.6 | 4.1.12 | — |

**Compatibilité Express 5 préservée**
- Routes adaptées à la nouvelle syntaxe : `/trigger/:token{/:param}` et fallback SPA `/{*splat}`.
- Comportements v4 conservés explicitement : parseur de query « extended » (`?a[b]=c`) et `req.body = {}` quand la requête n'a pas de corps.

**Dépendances supprimées (inutilisées)**
- `mongoose`, `lodash`, `dayjs`, `uuid`, `ts-node` et les `@types` associés.
- Les identifiants sont générés par `crypto.randomUUID()` natif (même format v4).

<a id="corrections"></a>
**Corrections**
- **Connexion MongoDB depuis le binaire packagé.** Le driver 7 chargeait `os` par un `import()` dynamique, impossible dans un binaire `pkg`. Il envoyait alors des métadonnées vides et MongoDB refusait la connexion (`ClientMetadataMissingField`, code 183), d'où une boucle de redémarrage du service. `os` est maintenant fourni explicitement au driver (`runtimeAdapters`).

**Sécurité**
- 0 vulnérabilité (corrige notamment `proxy-addr` critique et `body-parser` haute via Express).

---

## 3. Interface web (`orchestrator-webpanel/client`)

### Acquis 3.x
- **Éditeur visuel** de flux (React Flow) : nœuds par langage, commentaires, variables, sous-flux, `goto`, connexions guidées, copier-coller, annuler/rétablir, menu contextuel.
- **Éditeur de code** Monaco avec snippets par langage et formatage Prettier.
- **Sessions** multiples (onglets) et arborescence de fichiers façon `git clone` (nodes, sessions, artefacts), visualisation et téléchargement des fichiers poussés hors éditeur.
- **Branches et versions** : sélecteur de branche, création et suppression (sauf `main`), historique des versions avec diff et restauration, variantes de flux.
- **Exécutions** : graphe d'exécution, arbre des nœuds, timeline, logs en direct filtrables par type, entrées/sorties par nœud, kill, suppression, graphique des exécutions.
- **Tableau de bord (3.3.2)** : échecs récents, exécutions en cours, état des workers, activité de la plateforme sur 24 h / 7 j / 30 j.
- **Administration** : utilisateurs et clés API, secrets, workers et politiques d'accès, planifications (cron, événement, trigger API avec aide d'utilisation `?wait`).
- Thème clair / sombre, connexion SSO automatique quand proxy-auth est configuré.

### Nouveautés 4.0

**Fonctionnalités**
- **Filtres par colonne** dans les tableaux d'exécutions (liste globale, onglet Exécutions d'un flux, tableau de bord) : flux, id, statut, déclencheur, lancé par, branche, worker, début, durée, entrée, log.

**Corrections**
- **Badge « Running » bloqué.** L'en-tête d'un flux pouvait rester sur « Running » alors que l'exécution était terminée en succès. Le défaut existait déjà en 3.3.2 : quand la synchronisation de fond voyait la fin du run avant le sondage de statut, elle arrêtait ce sondage sans mettre à jour le dernier statut du flux.

**Mises à jour majeures**

| Brique | 3.3.2 | 4.0.0 |
|---|---|---|
| React / React DOM | 18 | **19** |
| Graphe | `reactflow` 11 | **`@xyflow/react` 12** |
| Routeur | react-router-dom 6 | **7** |
| State | zustand 4 | **5** |
| Build | Vite 5 | **Vite 8** (Rolldown / Oxc) |
| Styles | Tailwind 3 (PostCSS) | **Tailwind 4** (plugin Vite) |
| Monaco | 0.55 | **0.57** |
| Icônes | lucide-react 0.344 | **1.x** |
| Lint | ESLint 9 | **ESLint 10**, typescript-eslint 8.72 |
| TypeScript | 5.9 | **6.0.3** |

- **Rendu inchangé avec Tailwind 4** : migration officielle des classes (24 fichiers) et règles de compatibilité pour garder la couleur de bordure, la couleur des placeholders et le curseur des boutons de la v3.
- **Typage du graphe** : un module `src/types/xyflow.ts` conserve le typage permissif des données de nœud de React Flow 11, sans réécriture des composants.
- **Build** : ~20 s → ~2,4 s ; bundle principal 15 Mo → 12,9 Mo.

**Dépendances supprimées (inutilisées)**
- `react-ace`, `react-resizable`, `prettier-plugin-java`, `prettier-plugin-groovy`, `uuid`, `postcss`, `autoprefixer`.

**Sécurité**
- 0 vulnérabilité. `dompurify` (embarqué par Monaco) et `minimatch` (outillage de lint) sont relevés par `overrides`.

---

## 4. Worker (`orchestrator-worker`)

### Acquis 3.x
- Agent sans état : auto-enregistrement (`WORKER_REGISTRATION_SECRET`), heartbeat, long-poll des jobs, désenregistrement à l'arrêt.
- Runtimes : JavaScript / Backend JS (Playwright inclus), Python, Groovy (`groovyExec.jar` embarqué), PowerShell / pwsh, Batch, Shell / Bash.
- Streaming des logs, résolution des secrets à la demande, téléchargement des artefacts du job (y compris en flux binaire pour les gros fichiers).
- Modes de prise de jobs `parallel` / `sequential`, nettoyage des fichiers temporaires et des artefacts (`ORCHESTRATOR_KEEP_ARTIFACTS`).
- Vérification TLS configurable (`WORKER_TLS_REJECT_UNAUTHORIZED`, 3.3.x).

### Nouveautés 4.0
- Binaire packagé sur **Node 24** (`pkg` 6, cibles `node24-win-x64` / `node24-linux-x64`).
- axios 1.21 (corrige des vulnérabilités hautes via `follow-redirects` et `form-data`), dotenv 18, playwright 1.65.
- `uuid` remplacé par `crypto.randomUUID()` (nom auto-généré `worker-xxxxxxxx` inchangé).
- `npm run dev` via `tsx`.
- 0 vulnérabilité.

---

## 5. Runner autonome (`orchestrator-runner`)

### Acquis 3.x (nouveau module en 3.3)
- CLI Rust autonome qui exécute un fichier de flux `.or` **sans serveur** : `runner.exe nightly.or` exécute le flux puis l'embarque dans l'exécutable, et `runner.exe` seul rejoue le flux embarqué.
- Langages pris en charge : JavaScript / Backend JS (Node système), Python, PowerShell, Batch, Shell, Groovy, ainsi que les nœuds variable, commentaire et goto.
- Sémantique de graphe : sous-flux inline, retries / backoff, politique `continue`, artefacts, variables partagées, nœuds de départ.
- Secrets lus depuis l'environnement (`${{ secrets.NAME }}` → variable `NAME`), logs colorés ANSI (`NO_COLOR=1` pour les désactiver).
- Exécutable Windows avec icône et propriétés de version.

### Nouveautés 4.0
- Aucun changement : le runner ne dépend pas de la pile Node mise à jour.

---

## 6. Packaging, RPM et CI

### Acquis 3.x
- Binaires uniques serveur et worker (`build-server.bat`, `build-worker.bat`), avec web panel et `groovyExec.jar` embarqués, icône et version Windows.
- RPM Rocky / RHEL 9 : service systemd durci, fichier d'environnement `/etc/orchestrator-webpanel/`, script `orchestrator-webpanel-gen-secrets`, build Docker (`build-in-docker.sh`), workflow GitHub sur tag `v*.*.*`.
- `set-version.bat` propage la version aux `package.json`, au spec RPM et au deck de présentation.

### Nouveautés 4.0
- Cibles `pkg` **node24**, `engines: >=24`, `.nvmrc` = 24.
- RPM : `BuildRequires: nodejs >= 24`, flux `nodejs:24` dans le workflow CI et dans `build-in-docker.sh`.
- `tsconfig.base.json` : cible ES2023, `types: ["node"]` explicite (requis par TypeScript 6).
- Documentation (README, ONBOARDING, ARCHITECTURE, README RPM) alignée sur Node 24 et `tsx`.

---

## 7. Outils de test SSO (`oauth_proxy`, `authent_test_service`)

### Acquis 3.x
- `authent_test_service` : simulateur CAS (tickets à usage unique, `/login`, `/validate`) pour tester proxy-auth.
- `oauth_proxy` : petit fournisseur OAuth2 / OIDC qui fait le pont entre Grafana (Generic OAuth) et le simulateur CAS.

### Nouveautés 4.0
- Aucun changement (outils de test hors livraison).

---

## Annexe — Référence complète de l'API

Toutes les routes REST sont préfixées par **`/api/v1`**, sauf git smart-HTTP (`/git/...`). Cette liste est extraite du code de la 4.0.0. Le détail des corps de requête et des réponses est dans [API.md](API.md).

**Authentification**
- `Authorization: Bearer <jwt>` : JWT obtenu par `POST /auth/login`.
- `Authorization: ApiKey <clé>` : clé API.
- `?token=<jwt>` : pour le SSE et les téléchargements, qui ne peuvent pas poser d'en-tête.

**Erreurs** : `{ "error": { "code", "message" } }`. Les endpoints worker renvoient `{ "error": "..." }`.

**Légende des droits**
- **public** : sans authentification.
- **auth** : utilisateur connecté (tout rôle).
- **édition** : admin ou operator ayant accès en édition au flux (règles de propriété du flux).
- **worker** : token propre au worker, renvoyé par `/workers/register`.

### Santé

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/ping` | public | `{ status, version }` |

### Authentification et utilisateurs

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| POST | `/auth/login` | public | `{ login, password }` → `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | public | `{ refreshToken }` → `{ accessToken }` |
| GET | `/authProxy/config` | public | Configuration SSO pour le front (`enabled`, `paramName`, `loginUrl`, `service`) |
| GET | `/authProxy` | public | Échange un ticket SSO contre des tokens |
| GET | `/users` | admin, operator | Liste des utilisateurs (sans hash) |
| POST | `/users` | admin | Crée un utilisateur (`password` omis = utilisateur SSO-only) |
| PATCH | `/users/:id/password` | soi-même ou admin | Change le mot de passe |
| DELETE | `/users/:id` | admin | Supprime un utilisateur |
| POST | `/users/:id/apikeys` | admin | Crée une clé API (`rawKey` affichée une seule fois) |
| DELETE | `/users/:id/apikeys/:keyId` | admin | Révoque une clé API |

### Flux

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/flows` | auth | Liste des flux |
| POST | `/flows` | auth | Crée un flux (`{ name, namespace?, description?, nodes?, edges?, workerId? }`) |
| GET | `/flows/:id` | auth | Détail d'un flux |
| PUT | `/flows/:id` | édition | Met à jour un flux (autosave → commit) |
| DELETE | `/flows/:id` | édition | Supprime un flux |
| POST | `/flows/:id/execute` | admin, operator | Lance une exécution, avec `{ workerId?, branch? }` optionnel pour une variante |
| PUT | `/flows/:id/schedule` | auth | Définit la planification cron du flux (`{ cron, enabled?, timezone? }`) |
| DELETE | `/flows/:id/schedule` | auth | Retire la planification cron du flux |

### Versions et branches (git)

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| POST | `/flows/:id/versions` | édition | Force un commit de l'état courant (« Save version ») ; `unchanged: true` si rien ne change |
| GET | `/flows/:id/versions` | auth | Liste des versions (commits) |
| GET | `/flows/:id/versions/:vid` | auth | Détail d'une version |
| POST | `/flows/:id/versions/:vid/restore` | édition | Restaure une version |
| GET | `/flows/:id/branches` | auth | Branches + branche active |
| POST | `/flows/:id/branches` | édition | Crée une branche `{ name, from? }` |
| POST | `/flows/:id/branches/:name/checkout` | édition | Bascule sur la branche |
| DELETE | `/flows/:id/branches/:name` | édition | Supprime une branche (refusé pour `main` et la branche active) ; GC des objets orphelins |
| POST | `/flows/:id/branches/:name/reset` | édition | Rework `{ commit, mode: 'head' \| 'root' }` |

### Fichiers du dépôt et artefacts

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/flows/:id/tree/extra` | auth | Fichiers hors gestion (hors `nodes/`, `sessions/`, `artifacts/`) de la branche active |
| GET | `/flows/:id/tree/file?path=` | auth | Contenu texte d'un fichier (ou `viewable: false` si binaire ou volumineux) |
| GET | `/flows/:id/tree/raw?path=` | auth | Téléchargement binaire d'un fichier |
| POST | `/flows/:id/artifacts` | édition | Upload binaire brut (`?name=` ou `X-Artifact-Name`), limite `ARTIFACT_UPLOAD_LIMIT` |
| GET | `/flows/:id/artifacts/:sha` | auth | Artefact en base64 `{ name, sha, data }` |
| GET | `/flows/:id/artifacts/:sha/raw` | auth (`?token=` accepté) | Téléchargement binaire streamé |
| DELETE | `/flows/:id/artifacts/:name` | édition | Retire la référence (blob récupéré par le GC) |

### Exécutions

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/executions` | auth | Liste paginée, filtrable (`flowId`, `status`, `since`, `limit`…) |
| DELETE | `/executions` | admin | Vide l'historique |
| GET | `/executions/:id` | auth | Détail (se répare si le job en mémoire a été perdu) |
| PATCH | `/executions/:id` | auth | Met à jour un enregistrement |
| DELETE | `/executions/:id` | admin ; operator pour ses propres exécutions | Supprime une exécution |
| POST | `/executions/:id/kill` | auth | Arrête une exécution en cours |
| GET | `/executions/:id/stream` | auth (`?token=` accepté) | Logs en direct (SSE) + historique |

### Planifications

Toutes réservées aux **admin**.

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/schedules` | Liste des planifications |
| POST | `/schedules/cron` | `{ flowId, cronExpr, label?, timezone?, enabled? }`, avec `variantId` + `workerId` + `branch` optionnels |
| POST | `/schedules/event` | `{ flowId, eventName, label?, enabled? }` |
| POST | `/schedules/api-trigger` | Crée un trigger HTTP → `{ token, url, scheduleId, tokenId }` (token montré une seule fois) |
| PATCH | `/schedules/:id` | Active, désactive ou modifie |
| DELETE | `/schedules/:id` | Supprime |
| GET | `/schedules/:id/tokens` | Tokens d'un trigger API |

### Triggers HTTP

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/trigger/:token{/:param}` | token | Déclenche le flux ; `param` devient l'entrée du premier nœud. Redirection SSO possible (navigateur, sans `?wait`) |
| POST | `/trigger/:token{/:param}` | token | Corps JSON ou `text/*` en entrée du premier nœud ; jamais de redirection SSO |
| POST | `/trigger-tokens/:id/revoke` | admin | Révoque un token |

Options des triggers :

- **`?wait=<secondes>`** : attend la fin de l'exécution et renvoie `{ executionId, status, output, error, duration, triggeredBy }`.
  - `200` : succès.
  - `500` : échec ou exécution arrêtée.
  - `202` : délai d'attente dépassé ; la réponse contient `statusUrl` pour suivre l'exécution.
- **Identification de l'appelant** (optionnelle) : `Authorization: ApiKey|Bearer` ou `?ticket=ST-…`.

### Secrets

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/secrets` | auth | Noms et métadonnées (jamais les valeurs) |
| POST | `/secrets` | admin, operator | `{ name, value }` → chiffré AES-256-GCM |
| DELETE | `/secrets/:id` | admin | Supprime |
| GET | `/secrets/:id/reveal` | admin | Déchiffre et renvoie la valeur |

### Workers — interface

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| GET | `/workers` | auth | Workers enregistrés + statut |
| GET | `/workers/:id` | auth | Détail d'un worker |
| PATCH | `/workers/:id` | auth (champ `access` : admin) | Métadonnées (groupe, politique d'accès) |
| PATCH | `/workers/groups/:group/access` | admin | Politique `{ mode: 'allow' \| 'deny', roles[], users[] }` |
| DELETE | `/workers/:id/record` | auth | Retire l'enregistrement de l'interface |

### Workers — agent

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| POST | `/workers/register` | `WORKER_REGISTRATION_SECRET` | Enregistrement → `{ id, token }` |
| POST | `/workers/:id/heartbeat` | worker | Keepalive |
| GET | `/workers/:id/jobs` | worker | Long-poll des jobs (~25 s) |
| POST | `/workers/:id/jobs/:jobId/ack` | worker | Accusé de réception |
| POST | `/workers/:id/jobs/:jobId/status` | worker | Statut du job |
| POST | `/workers/:id/jobs/:jobId/log` | worker | Ligne de log (relayée en SSE) |
| POST | `/workers/:id/jobs/:jobId/secrets` | worker | Valeurs des secrets du job |
| GET | `/workers/:id/jobs/:jobId/artifacts/:sha` | worker | Artefact en base64 |
| GET | `/workers/:id/jobs/:jobId/artifacts/:sha/raw` | worker | Artefact en flux binaire (gros fichiers, sans tout charger en mémoire) |
| POST | `/workers/:id/jobs/:jobId/complete` | worker | Résultat final (idempotent) |
| DELETE | `/workers/:id` | worker | Désenregistrement |

### Jobs en cours de processus (legacy)

| Méthode | Chemin | Droits | Description |
|---|---|---|---|
| POST | `/jobs` | auth | Met un job en file (`{ type, code, input?, workerId?, … }`) |
| GET | `/jobs/:jobId` | auth | Statut, sortie et logs |
| POST | `/jobs/:jobId/stop` | auth | Arrête le job |
| GET | `/jobs/:jobId/logs` | auth | Logs du job |

### Git smart-HTTP (hors `/api/v1`)

Authentification en HTTP Basic : login + **clé API**.

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/git/:flowId/info/refs` | Annonce des refs (clone, fetch, push) |
| POST | `/git/:flowId/git-upload-pack` | Fetch / clone |
| POST | `/git/:flowId/git-receive-pack` | Push (l'arbre poussé est relu dans le flux) |

```bash
git clone http://<login>:<apikey>@<hôte>:3939/git/<flowId> mon-flux
```

### Interface web

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/` et toute autre route non API | Sert l'application web (fallback SPA) |
