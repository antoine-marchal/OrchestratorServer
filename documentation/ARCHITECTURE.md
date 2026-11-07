# Architecture

Comment Orchestrator est assemblé : les composants, le flux de données, le modèle d'exécution, et les raisons derrière les choix.

---

## 1. Contexte et objectifs

Orchestrator exécute des **flux** d'automatisation écrits par les utilisateurs — des graphes orientés de nœuds de script — sur cron, sur événement, via une requête HTTP, ou à la demande. Les objectifs :

- **Édition visuelle.** Des workflows non triviaux se construisent et se modifient sous forme de graphe, avec un vrai éditeur de code par nœud.
- **Exécution polyglotte.** JavaScript, Python, Groovy, PowerShell, Batch et Playwright cohabitent dans un même flux.
- **Exécution distribuée.** On déporte le travail lourd ou propre à un OS vers des workers distants sans avoir à ouvrir de port entrant chez eux — ce sont les workers qui interrogent le serveur, pas l'inverse.
- **Versionné comme du code.** Chaque flux est un vrai dépôt git interne : les sauvegardes deviennent des commits, on travaille par branches, et on peut `clone`/`push`/`pull` avec un client git standard. On exécute un même flux en plusieurs variantes (worker/branche) planifiables indépendamment.
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

Architecture en couches type MVC. Le sens des dépendances ne va que vers le bas :
`http → domain → data` (+ adaptateurs `infra`). Une couche basse n'importe jamais
une couche haute ; une route ne touche jamais directement la base.

```
http/      Contrôleurs : routes/ (fines) + middleware/ (auth, rbac, errorHandler) + validators/
domain/    Services métier sans framework : execution/, workers/, secrets/
data/      db/ (ICollection NeDB/Mongo) + models/ (entités) + repositories/ (un repo typé par entité)
infra/     Adaptateurs : git/, scheduler/, crypto/, auth/ (primitives JWT/clé API)
server.ts  Composition root (câblage, CORS, montage des routes, errorHandler global, démarrage)
```

| Couche | Fichiers | Responsabilité |
|---|---|---|
| Point d'entrée / câblage | `server.ts` | Express, CORS, panneau statique, montage des routes, `errorHandler` global, migrations de démarrage, planificateurs, reaper de workers, écoute HTTP/HTTPS. |
| Contrôleurs (HTTP) | `http/routes/*.ts` | flows, executions, jobs, workers, schedules, triggers, secrets, users. Fines : valident, appellent un service, renvoient la réponse. |
| Auth / validation | `http/middleware/{auth,rbac,errorHandler}.ts`, `http/validators/*` | Auth JWT + clé API, rôles, gestion d'erreurs centralisée, validation des corps de requête (zod, `validateBody`). |
| Services métier | `domain/execution/{flowExecutor,nodeExecutor,artifactStore,executionLogs}.ts`, `domain/workers/workerService.ts`, `domain/secrets/secretService.ts` | Parcours du DAG + runners, dispatch worker, résolution des secrets. Sans Express ni accès base direct. |
| Repositories | `data/repositories/*` (un par entité) + `data/db/index.ts` (`ICollection`) + `data/models/*` | Accès aux entités métier via repos typés (`flowRepository`, etc.) ; l'abstraction NeDB/MongoDB reste cachée. |
| Versionnage git | `infra/git/*` | Dépôt git par flux : matérialisation flux↔arbre git (`flowMaterialize.ts`), commits/branches (`flowCommit.ts`), objets/refs en base (`gitObjects.ts`, `gitStore.ts`), smart-HTTP clone/push (`receivePack.ts`, `FlowGitRepository.ts`). |
| Planification | `infra/scheduler/{cronScheduler,eventBus}.ts` | Planifications node-cron + surveillance du dossier inbox pour les événements. |
| Crypto / tokens | `infra/crypto/aes.ts`, `infra/auth/tokens.ts` | AES-256-GCM pour les secrets ; primitives de hachage de clé API et signature/vérification JWT. |

Règle d'accès : `getCollection` n'apparaît plus que dans `data/repositories/BaseRepository.ts`
et trois adaptateurs de stockage (`artifactStore`, `executionLogs`, `gitStore`). Tout accès
à une entité métier passe par un repository.

### Client (`orchestrator-webpanel/client/src`)

React 18 + Vite. React Flow dessine le graphe de nœuds ; Monaco gère l'édition de code par nœud. Les stores Zustand portent l'état session/flux/éditeur (`store/`). La couche `api/` sépare le transport HTTP (`api/http.ts` — auth, refresh, verbes génériques, binaire) des clients par domaine (`flowsApi`, `flowGitApi`, `executionsApi`, `workersApi`, `secretsApi`, `usersApi`, `schedulesApi`) : les vues appellent `flowsApi.update(id, body)` plutôt que d'écrire des URLs à la main. `utils/apiClient.ts` reste un ré-export de compatibilité. Les logs en direct arrivent via SSE.

### Worker (`orchestrator-worker/src`)

Découpé par responsabilité. `agent.ts` est un point d'entrée fin (câblage). `config.ts` centralise la configuration ; `transport/httpClient.ts` l'instance axios + le token. `lifecycle.ts` gère enregistrement/heartbeat/déconnexion, `poller.ts` la boucle de long-poll et le mode d'exécution. `jobs/` exécute un job (`jobRunner.ts`) avec résolution des secrets (`secrets.ts`) et cycle de vie des artefacts (`artifacts.ts`). `runtimes/` contient un fichier par langage (js/python/groovy/powershell/batch/shell) derrière une interface `Runtime` commune, plus un registre `index.ts` qui expose `executeNode`. Sans état — toute la mémoire des jobs vit sur le serveur.

---

## 3. Modèle de données

Le stockage est masqué derrière `ICollection` (`data/db/index.ts`). Une implémentation enveloppe MongoDB, l'autre `@seald-io/nedb` ; la même sémantique de requêtes fonctionne sur les deux. Le choix est automatique : si `MONGO_URI` est défini → MongoDB, sinon → fichiers NeDB sous `<WORK_DIR>/data/`.

Les collections :

| Collection | Contient |
|---|---|
| `users` | Comptes, hash bcrypt du mot de passe, rôle, `apiKeys[]` embarquées (hashées en SHA-256). |
| `roles` | Définitions de rôles RBAC (par défaut : admin / operator / viewer). |
| `flows` | Graphe du flux (`nodes`, `edges`), propriétaire, assignation worker, `activeBranch`, `variants[]`, refs d'artefacts (`{name, sha}`). |
| `flow_versions` | Historique de snapshots pour la fonctionnalité de versions/restauration (collapse via `ORCHESTRATOR_VERSION_MIN_INTERVAL_MS`). |
| `git_objects` | Objets git immuables par flux (`<flowId>:<sha>` → blob/tree/commit). Bytes en BinData (Mongo) ou base64 (NeDB). |
| `git_refs` | Refs git mutables par flux (`<flowId>:<ref>` → sha) — `refs/heads/<branche>`. |
| `artifact_blobs` | Corps d'artefacts dédupliqués, clé = sha256. Petits : inline ; gros : manifeste + `chunks`. |
| `artifact_chunks` | Tranches de 8 Mo des gros artefacts (contourne le plafond BSON de 16 Mo de Mongo). |
| `executions` | Enregistrement par run : statut, début/fin, durée, `branch`, résultats par nœud. |
| `schedules` | Lignes de planification cron / event / api-trigger (avec `variantId`/`workerId`/`branch` optionnels pour les variantes). |
| `trigger_tokens` | Tokens émis pour les triggers HTTP (expiration automatique). |
| `workers` | Workers enregistrés, `tokenHash`, `lastSeenAt`, `group`, politique d'`access`. |
| `worker_jobs` | Unités de travail réparties, avec leur statut de cycle de vie + refs d'artefacts. |
| `sessions` | Enregistrements de session. |

Les index des chemins critiques sont créés à la connexion : `apiKeys.keyHash`, `login` (unique), `name`/`lastSeenAt` des workers, `workerId`/`status`/`executionId` des `worker_jobs`, `flowId`/`status`/`startTime` des executions, plus schedules, secrets, flow_versions et les objets/refs git (`flowId`).

---

## 4. Modèle d'exécution

Un flux est un document JSON de `nodes` + `edges`. `parseFlowContent` (`flowExecutor.ts`) construit les cartes des arêtes entrantes/sortantes et identifie les **racines** (les nœuds sans arête entrante). L'exécuteur parcourt le DAG depuis ces racines, en respectant le branchement `goto`/condition, le retry par nœud, et les timeouts par nœud et par flux.

**Local vs distant.** Les types de nœuds présents dans `REMOTE_TYPES` — `powershell`, `batch`, `python`, `groovy`, `jsbackend`, `playwright`, `shell`, `bash` — sont envoyés au worker assigné au flux dès qu'il y en a un. Le JavaScript inline tourne en cours de processus. L'orchestration (parcours du flux, nœuds sous-flux `flow`) tourne toujours en cours de processus, même quand `ORCHESTRATOR_SERVER_EXECUTION_ENABLED=false` (qui interdit par ailleurs l'exécution locale des nœuds feuilles).

**Sous-flux (`flowRef`).** Un nœud de type `flow` qui référence un autre flux par son ID le charge depuis la base et l'exécute inline, en créant son propre enregistrement d'exécution (`triggeredBy = "triggered - <parent>"`). Un sous-flux tourne sous **son propre** worker assigné, et ne retombe sur celui du parent que s'il n'en a aucun.

**Variables et secrets.** Les variables de flux sont injectées dans chaque script puis récupérées via des fichiers JSON annexes (le mécanisme diffère selon le langage — voir le README du worker). Les secrets référencés par `${{ secrets.NAME }}` sont résolus côté serveur juste avant l'exécution et ne sont jamais écrits dans les logs.

### Artefacts (fichiers joints au flux)

Un flux peut transporter des **artefacts** : des fichiers attachés au flux lui-même, déposés sur le disque avant l'exécution pour que le code des nœuds puisse les lire. Typiquement un jar, un CSV de référence, un binaire, ou une archive à décompresser.

**Stockage adressé par contenu** (`domain/execution/artifactStore.ts`). Le corps de chaque artefact est stocké **une seule fois** dans la collection `artifact_blobs`, clé = son `sha256`. Le document `flows` ne porte qu'un **pointeur** `{ name, sha }` ; les `worker_jobs` répartis idem. Avantages par rapport à l'ancien modèle (base64 inliné dans chaque flux *et* dans chaque job réparti) : déduplication entre nœuds d'un même run et entre runs au contenu identique, et plus de copie jamais réclamée. Les bytes sont gardés en `BinData` sur Mongo (pas d'inflation base64) et en base64 sur NeDB (qui ne sait pas round-tripper un Buffer proprement).

**Chunking.** Mongo plafonne un document BSON à 16 Mo. Un artefact dont le corps dépasse `CHUNK_BYTES` (8 Mo) est découpé en tranches dans `artifact_chunks` (`<sha>:<idx>`), `artifact_blobs` ne gardant qu'un manifeste (`size`, `chunks`). Les lectures réassemblent les tranches dans l'ordre, et le téléchargement streamé (`artifactChunks`) ne matérialise jamais le fichier entier en mémoire.

**Upload / download.** L'éditeur envoie un artefact en **binaire brut** (`POST /flows/:id/artifacts`, corps `application/octet-stream`, nom dans `?name=` — limite `ARTIFACT_UPLOAD_LIMIT`, 1 Go par défaut) pour éviter l'inflation base64 et le parseur JSON. Le téléchargement passe par `GET /flows/:id/artifacts/:sha/raw` (streamé, respectant la backpressure) ou `…/:sha` (base64). Comme le base64 gonfle toujours les payloads de job, c'est l'une des raisons de monter `JSON_BODY_LIMIT` (serveur) et `WORKER_MAX_HTTP_SIZE` (worker).

**Versionné dans git.** Les artefacts sont aussi committés dans le dépôt git du flux (voir §4.bis) en **bytes réels** : le blob git contient le fichier complet, pas seulement le `sha256`. Un `git clone` récupère donc le **vrai fichier**, ouvrable directement dans le dossier cloné — y compris pour un artefact uploadé via l'UI. Les bytes sont **aussi** adressés par contenu dans `artifact_blobs` pour les chemins frontend/worker (duplication assumée). Les anciens commits stockaient un **pointeur** style git-LFS (`sha256` seul, pas les bytes) — encore lu en rétro-compatibilité, et re-homé dans `artifact_blobs` à la lecture.

**Garbage collection.** Le janitor (balayage `JANITOR_INTERVAL_MS`, 5 min) supprime les blobs qu'aucun `worker_job`, aucun `flow`, ni aucun artefact committé dans git ne référence. Les blobs/chunks plus jeunes que `ARTIFACT_GC_MIN_AGE_MS` (10 min) ne sont jamais réclamés, pour ne pas courir contre un upload en cours.

**Cycle de vie d'un run** (`extractArtifacts` / `cleanupArtifacts` dans `nodeExecutor.ts`) :

1. **Au démarrage du run, avant tout nœud :** chaque artefact est décodé et écrit dans le répertoire d'exécution (`ORCHESTRATOR_EXECUTION_DIR`, sinon `ORCHESTRATOR_WORK_DIR`).
   - **Côté serveur** si le flux n'a pas de worker assigné (exécution locale) : `artifactStore` résout les refs en corps avant extraction.
   - **Côté worker** sinon : le job répartit les refs `{name, sha}` ; le worker télécharge chaque corps via `GET /workers/:id/jobs/:jobId/artifacts/:sha` puis l'extrait dans son propre répertoire d'exécution avant de lancer le nœud.
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

Un timeout dur borne chaque répartition (`DISPATCH_TIMEOUT_MIN`, 5 min par défaut). Le **reaper de workers** (balayage toutes les 30 s dans `server.ts`) annule les jobs en cours d'un worker qu'on n'a pas vu depuis `WORKER_OFFLINE_TIMEOUT_MS` (60 s par défaut) et rejette l'awaiter, pour que l'exécuteur ne reste pas bloqué jusqu'au timeout complet.

### Logs en direct

Les logs d'exécution sont streamés vers le navigateur en **Server-Sent Events** (`GET /executions/:id/stream`). EventSource ne peut pas poser d'en-têtes, donc l'endpoint accepte aussi le JWT via `?token=`. Les workers poussent leurs lignes de log vers `/workers/:id/jobs/:jobId/log`, que le serveur redistribue aux abonnés SSE.

---

## 4.bis Versionnage git des flux

Chaque flux est un **dépôt git complet** vivant en base (`infra/git/*`). Pas de `.git` sur disque : objets et refs sont des documents (`git_objects`, `git_refs`), scopés par `flowId`.

**Matérialisation flux ↔ arbre git** (`flowMaterialize.ts`). Un flux JSON est projeté dans une arborescence lisible, et relue sans perte :

```
nodes/<titreCamel>.<ext>     un fichier par nœud feuille — contenu = data.code (.ps1/.py/.js/.groovy/…)
sessions/<titreCamel>/        un dossier par nœud de type 'flow' — son sous-graphe, récursivement
artifacts/<name>              un fichier par artefact (bytes réels — `git clone` récupère le fichier ; anciens commits : pointeur sha256 style git-LFS, encore lu)
relations.json                structure du graphe (nœuds sans le code externalisé + edges + meta + maps id→chemin)
```

Les noms de fichiers dérivent du libellé du nœud (camelCase) ; `relations.json` mappe `id de nœud → chemin exact`, donc le round-trip est sans perte quels que soient les noms ou collisions. Les fichiers que l'utilisateur ajoute au dépôt cloné (`.gitignore`, `README`, …) ne sont pas gérés par le matérialiseur mais **reportés** d'une sauvegarde à l'autre au lieu d'être écrasés.

**Commits.** Une sauvegarde de l'éditeur (`flowCommit.ts`) sérialise l'état en objets git et décide d'**amender** le HEAD ou de créer un **nouveau commit**, en comparant les arbres git (insensible au formatage JSON) :
- nœud ajouté/supprimé → nouveau commit ;
- édits mineurs seuls (positions, edges, libellés) → amende le HEAD ;
- contenu d'un nœud modifié → nouveau commit, **sauf** si c'est le même nœud que le dernier commit éditait (session d'édition continue) → amende.

L'amend ne touche **que** les commits d'autosave de l'UI (préfixe `Save by `) — jamais un commit venu d'un `git push`, d'un checkpoint manuel, d'une restauration ou d'un import.

**État transitoire non persisté.** Avant tout PUT/commit, l'éditeur normalise le graphe (`utils/flowSanitize.ts`, `sanitizeNodesForSave`) pour retirer l'état d'UI et de run de React Flow — il n'est **ni** envoyé en base/git **ni** compté comme une modification, donc il ne déclenche aucun autosave/commit. Ces champs ne vivent que dans le `localStorage` de la session (le canvas les retrouve après un rechargement) :
- niveau nœud : `selected`, `dragging`, `resizing`, `positionAbsolute`, `width`, `height`, `draggable` ;
- `data` du nœud : `executionStatus`, `executionAttempt`, `output` (résultat d'exécution du nœud), `executionTime`.

Le même `sanitizeNodesForSave` sert d'empreinte (« le graphe a-t-il vraiment changé ? ») et de filtre de sauvegarde, donc tous les chemins d'écriture (autosave, snapshot manuel, passage en session principale) restent cohérents.

**Branches** (`flowCommit.ts`, routes `/flows/:id/branches*`). Un flux porte une `activeBranch` (défaut `main`) ; l'exécuteur lance toujours le HEAD de la branche active, matérialisé dans le document. On crée une branche depuis le HEAD courant ou un commit/branche explicite, on bascule (`checkout` → re-matérialise le HEAD dans le doc), et on **rework** une branche autour d'un commit : `mode: 'head'` = `reset --hard` (jette les descendants), `mode: 'root'` = fait du commit la nouvelle racine (jette les ancêtres). Les objets git devenus inatteignables et les blobs d'artefacts orphelins sont GC'd dans la foulée.

**Variantes (« subrows »).** Un flux peut déclarer des `variants[]` = `{ id, workerId, branch }` : la même définition de flux exécutée avec un worker et/ou une branche différents, lançable et **planifiable indépendamment**. À l'exécution, `POST /flows/:id/execute` accepte des overrides `{ workerId, branch }` ; les planifications/triggers d'une variante portent `variantId` + `workerId` + `branch` (le cronScheduler évite les « ghost runs » des variantes supprimées).

**Smart-HTTP** (`receivePack.ts`, `FlowGitRepository.ts`, monté sous `/git/:flowId`). Un client git standard peut `clone`/`pull`/`push` un flux :

```bash
git clone http://<login>:<apikey>@<host>:<PORT>/git/<flowId> mon-flux
```

L'auth est en **HTTP Basic** : login + **clé API** (les bodies git sont binaires `application/x-git-*`). Les trois endpoints (`/info/refs`, `/git-upload-pack`, `/git-receive-pack`) sont implémentés maison — `report-status`, dépaquetage des thin-packs et upload-pack arbitraire, ce que `@fusebit/cloud-git` ne fournissait pas. Un `push` met à jour le flux : l'arbre poussé est relu en document de flux, les bytes d'artefacts sous `artifacts/` sont re-homés dans `artifact_blobs` (adressage par contenu), et un nouveau commit devient le HEAD de la branche.

---

## 5. Authentification et autorisation

Deux types d'identifiants, tous deux via l'en-tête `Authorization` (`middleware/auth.ts`) :

- **JWT** (`Bearer <jwt>`) — émis par `/auth/login` (accès 8 h) + `/auth/refresh` (refresh 7 j ; le secret est dérivé en `JWT_SECRET + '-refresh'`). Acceptable aussi en `?token=` pour le SSE et les téléchargements.
- **Clé API** (`ApiKey <rawkey>`) — émise par utilisateur, stockée hashée en SHA-256, retrouvée via l'index `apiKeys.keyHash`.

**L'auth des workers est à part.** `/workers/register` est le seul endpoint worker ouvert (protégé par `WORKER_REGISTRATION_SECRET`). L'enregistrement renvoie un token bearer propre au worker ; tous les autres endpoints worker l'exigent (`workerAuth`, stocké hashé, comparé en temps constant). Les anciens workers sans `tokenHash` sont acceptés une fois, puis invités à se réenregistrer.

**RBAC** (`middleware/rbac.ts`) : `requireRole(...)` protège les routes. admin = tout ; operator = exécuter/gérer ; viewer = lecture seule.

**Politiques d'accès aux workers** (`db/models/Worker.ts`, `canUserUseWorker`). Un worker peut porter une politique `access = { mode: 'allow' | 'deny', roles[], users[] }` : `allow` = seuls les rôles/logins listés peuvent le sélectionner et exécuter dessus ; `deny` = ils en sont exclus, les autres y ont droit ; absente = ouvert à tous. Les admins gardent toujours l'accès (pas d'auto-verrouillage) et sont seuls à éditer la politique (`PATCH /workers/groups/:group/access`). Le gate est appliqué à l'exécution : `POST /flows/:id/execute` refuse (403) si le worker effectif — celui du flux ou l'override de variante — n'est pas permis pour l'utilisateur.

**SSO / proxy auth.** Quand `ORCHESTRATOR_PROXYAUTH_URL` + `ORCHESTRATOR_PROXYAUTH_REGEX` sont définis, `/authProxy` valide un ticket SSO/CAS externe (en construisant `service=<DOMAIN>:<PORT>`), extrait le login via la regex, et émet des tokens pour l'utilisateur correspondant. Côté front, toute route atteinte sans session redirige automatiquement le navigateur vers `ORCHESTRATOR_PROXYAUTH_LOGIN_URL` (défaut : l'URL de validation avec `/validate`→`/login`) pour obtenir un ticket, puis l'échange. Le formulaire mot de passe reste accessible via la route explicite `#/login` (échappatoire — pas de redirection auto). Un utilisateur **sans `passwordHash`** est SSO-only : `/auth/login` lui refuse le login mot de passe (« Password login disabled for this account »), connexion par ticket uniquement. Le mock CAS de test vit dans `authent_test_service/`.

---

## 6. Planification et triggers

| Type | Mécanisme |
|---|---|
| **cron** | `cronScheduler.ts` charge les lignes `schedules` de `type=cron` et enregistre des jobs node-cron. |
| **event** | `eventBus.watchInbox(<WORK_DIR>/inbox)` surveille un dossier ; l'arrivée d'un fichier déclenche `file.arrived`. La fin/l'échec d'un flux émettent `flow.completed`/`flow.failed`. Les planifications `type=event` qui correspondent s'exécutent. |
| **api-trigger** | Crée un token ; `GET /trigger/:token/:param?` déclenche le flux et transmet `param` au premier nœud. Si proxy-auth est configuré, un aller-retour SSO attribue l'exécution à l'utilisateur. Une tentative corrélée lance un secours attribué à l'IP après 5 s si le callback n'arrive pas ; le premier chemin à réclamer la tentative gagne afin d'éviter une double exécution. Les tokens expirent automatiquement (balayés chaque minute dans `server.ts`). |

---

## 7. Séquence de démarrage (`start()` dans `server.ts`)

1. `connectDB()` — choisit Mongo/NeDB, crée les index.
2. `seedDefaultData()` — sème les rôles ; crée l'utilisateur `admin` si aucun n'existe.
3. `migrateLegacyFlowSchedules()` — recopie les anciens `flow.schedule` dans la collection `schedules`.
4. `backfillFlowOwners()` — pose `owner=admin` sur les flux sans propriétaire.
5. `reconcileStrandedExecutions()` — marque en `FAILED`/`cancelled` les executions restées `RUNNING` (et les worker_jobs orphelins) après un crash ou un redémarrage.
6. Câble l'exécuteur cron + charge les planifications ; démarre la surveillance de l'inbox + les gestionnaires d'événements.
7. Démarre l'expiration des trigger-tokens (60 s), le reaper de workers (30 s) et le **janitor** (`JANITOR_INTERVAL_MS`, 5 min) qui élague les `worker_jobs` terminés au-delà de `WORKER_JOB_RETENTION_MS` (1 h) puis réclame les blobs d'artefacts non référencés.
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
| Dépôt git par flux, en base (pas de `.git`) | Versionnage type code (branches, commits, clone/push) sans dépendre d'un git système ni d'un stockage fichier. | Implémentation smart-HTTP maison à maintenir ; les objets git vivent dans la même base que le reste. |
| Artefacts adressés par contenu (`artifact_blobs`) + bytes réels committés dans git | Un seul exemplaire par contenu côté base, dédupliqué entre runs/nœuds ; le `git clone` récupère le vrai fichier (ouvrable hors-ligne). | Duplication assumée entre `artifact_blobs` et les blobs git ; GC nécessaire (fenêtre de fraîcheur pour ne pas réclamer un upload en cours). |
| Binaire unique packagé (`pkg`) | Déploiement « pose-et-lance » ; embarque `groovyExec.jar`. | Cible Node 24 LTS (`@yao-pkg/pkg` 6). |

Voir [todo.md](../todo.md) pour le backlog complet des limites connues et du durcissement prévu.
