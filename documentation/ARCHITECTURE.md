# Architecture

Comment Orchestrator est assemblé : les composants, le flux de données, le modèle d'exécution, et les raisons derrière les choix.

---

## 1. Contexte et objectifs

Orchestrator exécute des **flux** d'automatisation écrits par les utilisateurs — des graphes orientés de nœuds de script — sur cron, sur événement, via une requête HTTP, ou à la demande. Les objectifs :

- **Édition visuelle.** Des workflows non triviaux se construisent et se modifient sous forme de graphe, avec un vrai éditeur de code par nœud.
- **Exécution polyglotte.** JavaScript, Python, Groovy, PowerShell, Batch et Playwright cohabitent dans un même flux.
- **Exécution distribuée.** On déporte le travail lourd ou propre à un OS vers des workers distants sans avoir à ouvrir de port entrant chez eux — ce sont les workers qui interrogent le serveur, pas l'inverse.
- **Auto-hébergeable, peu de dépendances.** Ça tourne sur NeDB embarqué dès le départ ; on passe à MongoDB en posant une seule variable d'environnement. Le tout se livre en binaire unique.

---

## 2. Carte des composants

```
                         ┌──────────────────────────────────────────────┐
   Navigateur            │            Serveur Orchestrator              │
 ┌──────────┐  HTTP/SSE  │  (orchestrator-webpanel/server, Express)     │
 │Interface │◄─────────► │                                              │
 │  (React) │  /api/v1   │  ┌────────┐  ┌──────────┐  ┌──────────────┐  │
 └──────────┘            │  │ Routes │─►│ flowExec │─►│Routeur worker│  │
                         │  └────────┘  └────┬─────┘  └──────┬───────┘  │
                         │  ┌──────────┐     │               │          │
   Cron / Événement /    │  │Planif.   │─────┘               │          │
   Trigger API ─────────►│  │+ eventBus│                     │          │
                         │  └──────────┘                     │          │
                         │  ┌──────────┐   ┌──────────┐      │          │
                         │  │ Auth/RBAC│   │  Crypto  │      │          │
                         │  └──────────┘   └──────────┘      │          │
                         │  ┌──────────────────────────┐     │          │
                         │  │  DB (NeDB | MongoDB)     │     │          │
                         │  └──────────────────────────┘     │          │
                         └───────────────────────────────────│──────────┘
                                                             │ long-poll HTTP
                         ┌───────────────────────────────────▼────────────┐
                         │           Worker(s) Orchestrator               │
                         │  enregistre → poll /jobs → exécute → logs      │
                         │  processus enfants : node/python/java/pwsh/cmd │
                         └────────────────────────────────────────────────┘
```

### Serveur (`orchestrator-webpanel/server/src`)

| Domaine | Fichiers | Responsabilité |
|---|---|---|
| Point d'entrée / câblage | `server.ts` | Configuration Express, CORS, service du panneau statique, montage des routes, migrations de démarrage, planificateurs, reaper de workers, écoute HTTP/HTTPS. |
| Authentification | `middleware/auth.ts`, `middleware/rbac.ts` | Auth JWT + clé API, contrôle des rôles. |
| API | `routes/*.ts` | flows, executions, jobs, workers, schedules, triggers, secrets, users. |
| Exécution | `services/executor/flowExecutor.ts`, `nodeExecutor.ts` | Parcours du DAG + runners par langage. |
| Planification | `services/scheduler/cronScheduler.ts`, `eventBus.ts` | Planifications node-cron + surveillance du dossier inbox pour les événements. |
| Crypto | `services/crypto/aes.ts` | AES-256-GCM pour les secrets au repos. |
| Données | `services/db/index.ts`, `db/models/*` | Abstraction de stockage NeDB/MongoDB + modèles typés. |

### Client (`orchestrator-webpanel/client/src`)

React 18 + Vite. React Flow dessine le graphe de nœuds ; Monaco gère l'édition de code par nœud. Les stores Zustand portent l'état session/flux/éditeur (`store/`). `utils/apiClient.ts` enveloppe l'API REST ; les logs en direct arrivent via SSE.

### Worker (`orchestrator-worker/src`)

`agent.ts` gère l'enregistrement, le polling, le heartbeat et la répartition. `executor/nodeExecutor.ts` lance les processus enfants par langage. Sans état — toute la mémoire des jobs vit sur le serveur.

---

## 3. Modèle de données

Le stockage est masqué derrière `ICollection` (`services/db/index.ts`). Une implémentation enveloppe MongoDB, l'autre `@seald-io/nedb` ; la même sémantique de requêtes fonctionne sur les deux. Le choix est automatique : si `MONGO_URI` est défini → MongoDB, sinon → fichiers NeDB sous `<WORK_DIR>/data/`.

Les collections :

| Collection | Contient |
|---|---|
| `users` | Comptes, hash bcrypt du mot de passe, rôle, `apiKeys[]` embarquées (hashées en SHA-256). |
| `roles` | Définitions de rôles RBAC (par défaut : admin / operator / viewer). |
| `flows` | Graphe du flux (`nodes`, `edges`), propriétaire, `workerId` assigné, artefacts. |
| `flow_versions` | Historique de snapshots pour la fonctionnalité de versions/restauration. |
| `executions` | Enregistrement par run : statut, début/fin, durée, résultats par nœud. |
| `schedules` | Lignes de planification cron / event / api-trigger. |
| `trigger_tokens` | Tokens émis pour les triggers HTTP (expiration automatique). |
| `workers` | Workers enregistrés, `tokenHash`, `lastSeenAt`, groupe. |
| `worker_jobs` | Unités de travail réparties, avec leur statut de cycle de vie. |
| `sessions` | Enregistrements de session. |

Les index des chemins critiques sont créés à la connexion : `apiKeys.keyHash`, `login` (unique), `name`/`lastSeenAt` des workers, `workerId`/`status`/`executionId` des `worker_jobs`, `flowId`/`status`/`startTime` des executions, plus schedules, secrets et flow_versions.

---

## 4. Modèle d'exécution

Un flux est un document JSON de `nodes` + `edges`. `parseFlowContent` (`flowExecutor.ts`) construit les cartes des arêtes entrantes/sortantes et identifie les **racines** (les nœuds sans arête entrante). L'exécuteur parcourt le DAG depuis ces racines, en respectant le branchement `goto`/condition, le retry par nœud, et les timeouts par nœud et par flux.

**Local vs distant.** Les types de nœuds présents dans `REMOTE_TYPES` — `powershell`, `batch`, `python`, `groovy`, `jsbackend`, `playwright`, `shell`, `bash` — sont envoyés au worker assigné au flux dès qu'il y en a un. Le JavaScript inline tourne en cours de processus. L'orchestration (parcours du flux, nœuds sous-flux `flow`) tourne toujours en cours de processus, même quand `ORCHESTRATOR_SERVER_EXECUTION_ENABLED=false` (qui interdit par ailleurs l'exécution locale des nœuds feuilles).

**Sous-flux (`flowRef`).** Un nœud de type `flow` qui référence un autre flux par son ID le charge depuis la base et l'exécute inline, en créant son propre enregistrement d'exécution (`triggeredBy = "triggered - <parent>"`). Un sous-flux tourne sous **son propre** worker assigné, et ne retombe sur celui du parent que s'il n'en a aucun.

**Variables et secrets.** Les variables de flux sont injectées dans chaque script puis récupérées via des fichiers JSON annexes (le mécanisme diffère selon le langage — voir le README du worker). Les secrets référencés par `${{ secrets.NAME }}` sont résolus côté serveur juste avant l'exécution et ne sont jamais écrits dans les logs.

### Artefacts (fichiers joints au flux)

Un flux peut transporter des **artefacts** : des fichiers attachés au flux lui-même, déposés sur le disque avant l'exécution pour que le code des nœuds puisse les lire. Typiquement un jar, un CSV de référence, un binaire, ou une archive à décompresser.

**Forme.** Chaque artefact est `{ name, data }`, où `data` est le contenu du fichier encodé en **base64**. Ils sont stockés dans le champ `artifacts[]` du document `flows` (donc versionnés avec le flux et inclus dans ses snapshots). Comme le base64 gonfle le corps des requêtes, c'est la principale raison de monter `JSON_BODY_LIMIT` (serveur) et `WORKER_MAX_HTTP_SIZE` (worker).

**Cycle de vie d'un run** (`extractArtifacts` / `cleanupArtifacts` dans `nodeExecutor.ts`) :

1. **Au démarrage du run, avant tout nœud :** chaque artefact est décodé et écrit dans le répertoire d'exécution (`ORCHESTRATOR_EXECUTION_DIR`, sinon `ORCHESTRATOR_WORK_DIR`).
   - **Côté serveur** si le flux n'a pas de worker assigné (exécution locale).
   - **Côté worker** sinon : les artefacts voyagent dans le payload du job (`dispatchToWorker`) et le worker les extrait dans son propre répertoire d'exécution avant de lancer le nœud.
2. **Déduplication.** Si le fichier existe déjà à l'identique (comparaison octet à octet), on ne le réécrit pas — on se contente de redécompresser si c'est une archive.
3. **Auto-décompression.** Si le `name` finit par une extension d'archive (`.zip`, `.tar`, `.tar.gz`, `.tgz`, `.gz`, `.7z`), le fichier est décompressé sur place via le `tar` de la plateforme (avec repli sur `7z`/`7za` pour les `.7z`). L'archive elle-même est ensuite supprimée — le code du flux ne voit donc que l'arborescence décompressée — sauf si `ORCHESTRATOR_KEEP_ARTIFACTS=true`.
4. **À la fin du run :** les artefacts extraits sont supprimés, sauf si `ORCHESTRATOR_KEEP_ARTIFACTS=true`.

**Sécurité — protection contre la traversée de chemin.** `safeArtifactPath` résout chaque `name` de façon stricte *à l'intérieur* du répertoire cible et **rejette** : les chemins absolus (lettre de lecteur Windows, slash de tête, UNC), les segments `..` qui sortent du répertoire, et les noms vides. Un artefact au nom dangereux est ignoré (jamais écrit) — c'est l'item de durcissement #7 du backlog. Les sous-dossiers sains (`sous/dossier/fichier.txt`) sont en revanche autorisés et créés.

**Héritage par les sous-flux (`flowRef`).** Un sous-flux voit l'ensemble **fusionné** : les artefacts du flux parent **plus** les siens. En cas de collision de nom, **le parent gagne** (il masque l'artefact du sous-flux portant le même nom). Le sous-flux extrait d'abord ses propres artefacts, puis le jeu fusionné est transmis à ses nœuds.

### Répartition vers le worker et long-poll

```
flowExecutor.dispatchToWorker(job)
   │  insère une ligne worker_jobs (status=pending)
   │  enregistre un "awaiter" en mémoire (pendingWorkerJobs)
   ▼
Worker  GET /workers/:id/jobs   ── le serveur garde la requête ouverte (long-poll, ~25 s max)
   │    une nouvelle répartition réveille immédiatement les attentes en pause (jobWaiters)
   ▼
Worker  ack → status → log* → complete   (chacun renvoie vers /workers/:id/jobs/:jobId/*)
   │
   ▼
le serveur résout l'awaiter → l'exécuteur poursuit le DAG
```

Un timeout dur de 5 minutes borne chaque répartition. Le **reaper de workers** (balayage toutes les 30 s dans `server.ts`) annule les jobs en cours d'un worker qu'on n'a pas vu depuis `WORKER_OFFLINE_TIMEOUT_MS` (60 s par défaut) et rejette l'awaiter, pour que l'exécuteur ne reste pas bloqué jusqu'au timeout complet.

### Logs en direct

Les logs d'exécution sont streamés vers le navigateur en **Server-Sent Events** (`GET /executions/:id/stream`). EventSource ne peut pas poser d'en-têtes, donc l'endpoint accepte aussi le JWT via `?token=`. Les workers poussent leurs lignes de log vers `/workers/:id/jobs/:jobId/log`, que le serveur redistribue aux abonnés SSE.

---

## 5. Authentification et autorisation

Deux types d'identifiants, tous deux via l'en-tête `Authorization` (`middleware/auth.ts`) :

- **JWT** (`Bearer <jwt>`) — émis par `/auth/login` (accès 8 h) + `/auth/refresh` (refresh 7 j ; le secret est dérivé en `JWT_SECRET + '-refresh'`). Acceptable aussi en `?token=` pour le SSE et les téléchargements.
- **Clé API** (`ApiKey <rawkey>`) — émise par utilisateur, stockée hashée en SHA-256, retrouvée via l'index `apiKeys.keyHash`.

**L'auth des workers est à part.** `/workers/register` est le seul endpoint worker ouvert (protégé par `WORKER_REGISTRATION_SECRET`). L'enregistrement renvoie un token bearer propre au worker ; tous les autres endpoints worker l'exigent (`workerAuth`, stocké hashé, comparé en temps constant). Les anciens workers sans `tokenHash` sont acceptés une fois, puis invités à se réenregistrer.

**RBAC** (`middleware/rbac.ts`) : `requireRole(...)` protège les routes. admin = tout ; operator = exécuter/gérer ; viewer = lecture seule.

**SSO / proxy auth.** Quand `ORCHESTRATOR_PROXYAUTH_URL` + `ORCHESTRATOR_PROXYAUTH_REGEX` sont définis, `/authProxy` valide un ticket SSO/CAS externe (en construisant `service=<DOMAIN>:<PORT>`), extrait le login via la regex, et émet des tokens pour l'utilisateur correspondant. Côté front, toute route atteinte sans session redirige automatiquement le navigateur vers `ORCHESTRATOR_PROXYAUTH_LOGIN_URL` (défaut : l'URL de validation avec `/validate`→`/login`) pour obtenir un ticket, puis l'échange. Le formulaire mot de passe reste accessible via la route explicite `#/login` (échappatoire — pas de redirection auto). Un utilisateur **sans `passwordHash`** est SSO-only : `/auth/login` lui refuse le login mot de passe (« Password login disabled for this account »), connexion par ticket uniquement. Le mock CAS de test vit dans `authent_test_service/`.

---

## 6. Planification et triggers

| Type | Mécanisme |
|---|---|
| **cron** | `cronScheduler.ts` charge les lignes `schedules` de `type=cron` et enregistre des jobs node-cron. |
| **event** | `eventBus.watchInbox(<WORK_DIR>/inbox)` surveille un dossier ; l'arrivée d'un fichier déclenche `file.arrived`. La fin/l'échec d'un flux émettent `flow.completed`/`flow.failed`. Les planifications `type=event` qui correspondent s'exécutent. |
| **api-trigger** | Crée un token ; un `GET /trigger/:token` non authentifié déclenche le flux. Les tokens expirent automatiquement (balayés chaque minute dans `server.ts`). |

---

## 7. Séquence de démarrage (`start()` dans `server.ts`)

1. `connectDB()` — choisit Mongo/NeDB, crée les index.
2. `seedDefaultData()` — sème les rôles ; crée l'utilisateur `admin` si aucun n'existe.
3. `migrateLegacyFlowSchedules()` — recopie les anciens `flow.schedule` dans la collection `schedules`.
4. `backfillFlowOwners()` — pose `owner=admin` sur les flux sans propriétaire.
5. `reconcileStrandedExecutions()` — marque en `FAILED`/`cancelled` les executions restées `RUNNING` (et les worker_jobs orphelins) après un crash ou un redémarrage.
6. Câble l'exécuteur cron + charge les planifications ; démarre la surveillance de l'inbox + les gestionnaires d'événements.
7. Démarre l'expiration des trigger-tokens (60 s) et le reaper de workers (30 s).
8. Écoute en HTTP ou HTTPS.

---

## 8. Décisions clés et compromis

| Décision | Pourquoi | Compromis |
|---|---|---|
| NeDB par défaut, Mongo en option | Dev sans config + déploiement en binaire unique ; une seule variable pour monter en charge. | NeDB est mono-processus, sur fichier — pas fait pour la forte concurrence. |
| Les workers interrogent (pas de port entrant) | Les workers tournent n'importe où derrière un NAT/pare-feu ; le serveur ne les appelle jamais. | La latence est bornée par le poll/long-poll ; atténuée par le long-poll de 25 s + le réveil des attentes. |
| Le JS inline tourne en cours de processus | Rapide, pas de coût de spawn pour le cas courant. | Le JS inline n'est **pas sandboxé** (voir item #13 du backlog). Pour du code non fiable, passez par un worker ou `SERVER_EXECUTION_ENABLED=false`. |
| Secrets résolus au moment de l'exécution | Le clair n'est jamais stocké dans le JSON du flux ni dans les logs. | Le serveur détient la clé maître AES ; protégez `ORCHESTRATOR_MASTER_KEY`. |
| Réconciliation des exécutions orphelines au boot | La carte des jobs en mémoire est remise à zéro au redémarrage ; sans ça, les runs tournent à l'infini. | Un run interrompu par un redémarrage est marqué FAILED, pas repris. |
| Binaire unique packagé (`pkg`) | Déploiement « pose-et-lance » ; embarque `groovyExec.jar`. | Épinglé sur la cible Node 18 (backlog : passer à 20/22). |

Voir [todo.md](../todo.md) pour le backlog complet des limites connues et du durcissement prévu.
