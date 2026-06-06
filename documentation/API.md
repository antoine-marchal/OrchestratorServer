# Référence API

L'API REST du serveur Orchestrator. Toutes les routes sont préfixées par **`/api/v1`**.

- **URL de base (dev) :** `http://localhost:3939/api/v1`
- **Type de contenu :** `application/json` (taille de corps limitée par `JSON_BODY_LIMIT`, `100mb` par défaut)
- **Logs en direct :** Server-Sent Events (`text/event-stream`)

---

## Authentification

Les identifiants se passent dans l'en-tête `Authorization`.

| Schéma | En-tête | Émis par |
|---|---|---|
| JWT (session) | `Authorization: Bearer <jwt>` | `POST /auth/login` (8 h) |
| Clé API | `Authorization: ApiKey <rawkey>` | `POST /users/:id/apikeys` |

Pour les endpoints qui ne peuvent pas poser d'en-têtes (SSE, téléchargements), on peut passer un JWT en paramètre de requête : `?token=<jwt>`.

```bash
# Connexion
curl -X POST http://localhost:3939/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin"}'
# → { "accessToken": "...", "refreshToken": "...", "user": {...} }

# Utiliser le token
curl http://localhost:3939/api/v1/flows \
  -H 'Authorization: Bearer <accessToken>'
```

**Rôles :** `admin` (tout), `operator` (exécuter/gérer), `viewer` (lecture seule). Chaque endpoint indique le rôle minimum requis.

### Forme des erreurs

La plupart des routes renvoient les erreurs ainsi :

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid credentials" } }
```

Codes courants : `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `NOT_CONFIGURED` (503), `INTERNAL_ERROR` (500). Les endpoints worker renvoient une forme plus simple : `{ "error": "..." }`.

---

## Santé

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| GET | `/ping` | public | `{ status: "ok", version }` |

---

## Auth et utilisateurs

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Corps `{ login, password }` → `{ accessToken, refreshToken, user }`. |
| POST | `/auth/refresh` | public | Corps `{ refreshToken }` → `{ accessToken }`. |
| GET | `/authProxy/config` | public | `{ enabled, paramName, loginUrl, service }` — config SSO pour le bootstrap front (redirection auto vers `loginUrl`). |
| GET | `/authProxy?<ticket>=…` | public | Échange un ticket SSO externe contre des tokens. |
| GET | `/users` | admin, operator | Liste les utilisateurs (sans hash ; les clés API n'apparaissent qu'en métadonnées). |
| POST | `/users` | admin | Corps `{ login, password?, role? }` → utilisateur créé. **`password` optionnel** : omis = utilisateur SSO-only (login mot de passe refusé, connexion via ticket SSO uniquement). |
| PATCH | `/users/:id/password` | soi-même ou admin | Corps `{ password }`. |
| DELETE | `/users/:id` | admin | Supprime un utilisateur. |
| POST | `/users/:id/apikeys` | admin | Corps `{ label, expiresAt? }` → `{ id, label, rawKey }`. **`rawKey` n'est montrée qu'une fois.** |
| DELETE | `/users/:id/apikeys/:keyId` | admin | Révoque une clé API. |

---

## Flux

Montés sur `/api/v1/flows` ; tout requiert une authentification. L'édition/suppression exige en plus un accès en édition au flux.

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/flows` | Liste les flux. |
| POST | `/flows` | Crée un flux. |
| GET | `/flows/:id` | Récupère un flux (graphe, planification, worker assigné). |
| PUT | `/flows/:id` | Met à jour un flux (crée un snapshot de version). |
| DELETE | `/flows/:id` | Supprime un flux. |
| POST | `/flows/:id/execute` | Lance un run à la demande → renvoie l'id d'exécution. |
| GET | `/flows/:id/versions` | Liste les snapshots de versions. |
| GET | `/flows/:id/versions/:vid` | Récupère un snapshot. |
| POST | `/flows/:id/versions/:vid/restore` | Restaure le flux vers un snapshot. |
| PUT | `/flows/:id/schedule` | Définit la planification cron du flux. |
| DELETE | `/flows/:id/schedule` | Retire la planification cron du flux. |

**Overrides à l'exécution.** `POST /flows/:id/execute` accepte un corps optionnel `{ workerId?, branch? }` pour lancer une **variante** (« subrow ») : un worker et/ou une branche autres que les défauts du flux. `workerId: ""` force l'exécution locale. L'accès au worker effectif est contrôlé (403 si interdit — voir Workers). Réservé à admin/operator.

### Branches (git)

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/flows/:id/branches` | Liste les branches + la branche active. |
| POST | `/flows/:id/branches` | Crée une branche. Corps `{ name, from? }` (`from` = commit/branche, défaut = HEAD actif). |
| POST | `/flows/:id/branches/:name/checkout` | Bascule la branche active et matérialise son HEAD dans le flux. |
| POST | `/flows/:id/branches/:name/reset` | Rework. Corps `{ commit, mode }` — `mode: 'head'` (`reset --hard`) ou `'root'` (nouvelle racine). GC immédiat des objets/artefacts orphelins. |

### Artefacts

| Méthode | Chemin | Description |
|---|---|---|
| POST | `/flows/:id/artifacts` | Upload **binaire brut** (`application/octet-stream`). Nom dans `?name=` ou `X-Artifact-Name`. Stocké en adressage par contenu ; le flux garde une ref `{name, sha}` ; committé dans git. Limite `ARTIFACT_UPLOAD_LIMIT` (1 Go). |
| GET | `/flows/:id/artifacts/:sha` | Télécharge un artefact en base64 `{ name, sha, data }`. |
| GET | `/flows/:id/artifacts/:sha/raw` | Téléchargement **binaire streamé** (`Content-Disposition: attachment`). Auth via `?token=`. |
| DELETE | `/flows/:id/artifacts/:name` | Retire la ref du flux (le blob est réclamé plus tard par le janitor). |

---

## Git smart-HTTP

Chaque flux est exposé comme un dépôt git sous **`/git/:flowId`** (hors préfixe `/api/v1`). Un client git standard peut `clone`/`pull`/`push`. Auth en **HTTP Basic** : login + **clé API** (pas le mot de passe — les corps git sont binaires).

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/git/:flowId/info/refs` | Advertise refs (clone/fetch/push). |
| POST | `/git/:flowId/git-upload-pack` | Côté fetch/clone. |
| POST | `/git/:flowId/git-receive-pack` | Côté push (relit l'arbre poussé en flux + commit). |

```bash
git clone http://<login>:<apikey>@localhost:3939/git/<flowId> mon-flux
```

Les artefacts apparaissent dans le clone sous `artifacts/` en **pointeurs** (`sha256`), pas en bytes (style git-LFS).

---

## Exécutions

Montées sur `/api/v1/executions` ; tout requiert une authentification.

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/executions` | Liste les exécutions (chaque enregistrement porte la `branch` exécutée). Pagination côté base (sort/skip/limit) et filtrage par flux/statut. |
| DELETE | `/executions` | Vide l'historique en masse. **admin seulement.** |
| DELETE | `/executions/:id` | Supprime une exécution. admin = n'importe laquelle ; operator = uniquement les siennes. |
| GET | `/executions/:id` | Récupère une exécution ; se répare d'elle-même si son job en mémoire a été perdu. |
| PATCH | `/executions/:id` | Met à jour un enregistrement d'exécution. |
| POST | `/executions/:id/kill` | Arrête une exécution en cours. |
| GET | `/executions/:id/stream` | Flux de logs **SSE** en direct + historique. Accepte `?token=<jwt>`. |

```bash
# Streamer les logs (SSE) avec un token en paramètre
curl -N "http://localhost:3939/api/v1/executions/<execId>/stream?token=<jwt>"
```

---

## Planifications

Montées sur `/api/v1/schedules` ; tout requiert une authentification.

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/schedules` | Liste les planifications. |
| POST | `/schedules/cron` | Crée une planification cron. Le corps inclut `flowId`, `cronExpr`, `label`, `enabled`. Optionnel `variantId`+`workerId`+`branch` pour planifier une variante. |
| POST | `/schedules/event` | Crée une planification événement. Le corps inclut `flowId`, `eventName`, `enabled`. |
| POST | `/schedules/api-trigger` | Crée un trigger HTTP → renvoie l'URL/token du trigger. Optionnel `variantId`+`workerId`+`branch` (le trigger lance la variante). |
| PATCH | `/schedules/:id` | Active/désactive/met à jour une planification. |
| DELETE | `/schedules/:id` | Supprime une planification. |
| GET | `/schedules/:id/tokens` | Liste les tokens de trigger d'une planification api-trigger. |

Noms d'événements émis par le serveur : `flow.completed`, `flow.failed`, `file.arrived` (dépôt d'un fichier dans `<WORK_DIR>/inbox`).

---

## Triggers (HTTP)

Montés sur `/api/v1`.

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| GET | `/trigger/:token` | public | Déclenche le flux lié à ce token api-trigger. |
| POST | `/trigger-tokens/:id/revoke` | admin | Révoque un token de trigger. |

---

## Secrets

Montés sur `/api/v1/secrets` ; tout requiert une authentification. Les valeurs sont chiffrées en AES-256-GCM au repos et référencées dans le code des nœuds par `${{ secrets.NAME }}`.

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| GET | `/secrets` | requis | Liste les secrets (noms/métadonnées seulement — jamais les valeurs). |
| POST | `/secrets` | admin, operator | Corps `{ name, value }` → stocké chiffré. |
| DELETE | `/secrets/:id` | admin | Supprime un secret. |
| GET | `/secrets/:id/reveal` | admin | Déchiffre et renvoie la valeur. |

---

## Workers

Montés sur `/api/v1/workers`. Deux publics :

**Endpoints UI** (requièrent un JWT/clé API utilisateur) :

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/workers` | Liste les workers enregistrés + leur statut en ligne. |
| GET | `/workers/:id` | Récupère un worker. |
| PATCH | `/workers/:id` | Met à jour les métadonnées d'un worker (par ex. son groupe). |
| PATCH | `/workers/groups/:group/access` | **admin.** Définit la politique d'accès `{ mode: 'allow'\|'deny', roles[], users[] }` d'un groupe de workers. |
| DELETE | `/workers/:id/record` | Retire l'enregistrement d'un worker de l'UI. |

> **Politique d'accès.** `allow` = seuls les rôles/logins listés peuvent sélectionner/exécuter sur ces workers ; `deny` = ils en sont exclus ; absente = ouvert à tous. Les admins gardent toujours l'accès. Le contrôle s'applique à `POST /flows/:id/execute`.

**Endpoints agent** (utilisés par le processus worker). `/register` est protégé par `WORKER_REGISTRATION_SECRET` ; tous les autres exigent le token bearer propre au worker renvoyé à l'enregistrement :

| Méthode | Chemin | Description |
|---|---|---|
| POST | `/workers/register` | Auto-enregistrement → renvoie `{ id, token }`. |
| POST | `/workers/:id/heartbeat` | Keepalive (maintient le statut `online`). |
| GET | `/workers/:id/jobs` | Long-poll des jobs en attente (le serveur garde ~25 s). |
| POST | `/workers/:id/jobs/:jobId/ack` | Accuse réception d'un job. |
| POST | `/workers/:id/jobs/:jobId/status` | Remonte le statut d'un job. |
| POST | `/workers/:id/jobs/:jobId/log` | Streame une ligne de log/erreur (redistribuée au SSE). |
| POST | `/workers/:id/jobs/:jobId/secrets` | Demande les valeurs de secrets résolues pour le job. |
| GET | `/workers/:id/jobs/:jobId/artifacts/:sha` | Télécharge le corps d'un artefact (base64) référencé par le job. |
| POST | `/workers/:id/jobs/:jobId/complete` | Remonte le résultat final (idempotent — n'écrase pas un état terminal). |
| DELETE | `/workers/:id` | Désenregistrement (envoyé à l'arrêt propre du worker). |

---

## Jobs en cours de processus (legacy)

Montés sur `/api/v1/jobs` ; tout requiert une authentification. Utilisés par l'ancien chemin de file de jobs en cours de processus.

| Méthode | Chemin | Description |
|---|---|---|
| POST | `/jobs` | Met un job en file. |
| GET | `/jobs/:jobId` | Récupère le statut d'un job. |
| POST | `/jobs/:jobId/stop` | Arrête un job. |
| GET | `/jobs/:jobId/logs` | Récupère les logs d'un job. |

---

## Cycle de vie d'un job worker

```
pending ──(GET /jobs)──► acked ──► running ──► (complete) ──► success | error
   │                                                               ▲
   └──────────── reaper / redémarrage serveur ─────────► cancelled ┘
```

Une répartition est bornée par un timeout dur (`DISPATCH_TIMEOUT_MIN`, 5 min par défaut) ; le reaper de workers annule les jobs des workers silencieux depuis plus de `WORKER_OFFLINE_TIMEOUT_MS` (60 s par défaut).
