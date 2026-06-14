# Runbook d'exploitation

Les procédures d'exploitation pour déployer, mettre à jour, sauvegarder et récupérer le serveur Orchestrator et ses workers.

**Public visé :** quiconque fait tourner Orchestrator en production.
**Accès nécessaires :** un shell sur les hôtes serveur/worker, un accès en écriture à la cible de déploiement, les fichiers d'env (`server.env`, `worker.env`), et l'emplacement des sauvegardes de base.

---

## 1. Build

À lancer depuis la racine du dépôt (Windows). La sortie atterrit dans `release/`.

```bat
build-server.bat            :: client + serveur -> release/orchestrator-server-win.exe + -linux
build-server.bat win        :: Windows uniquement
build-server.bat linux      :: Linux uniquement

build-worker.bat            :: release/orchestrator-worker-win.exe + -linux
```

Chaque script : compile le TypeScript, package avec `@yao-pkg/pkg`, et copie le `.env.example` correspondant dans `release/`. `groovyExec.jar` est embarqué dans le binaire et extrait à côté de lui au premier lancement.

Avant tout, appliquez une version à tous les `package.json` + `.version` (la version vit dans le fichier [`.version`](../.version) à la racine) :

```bat
set-version.bat <version>   :: ou éditez .version puis lancez set-version.bat sans argument
```

---

## 2. Déploiement

```bat
deploy.bat                  :: copie release/orchestrator-* + *.env.example vers la cible
```

Le chemin cible est défini dans `deploy.bat` (`DEST`). Ajustez-le avant de lancer. Le déploiement manuel se résume à : copier le binaire + un fichier `.env` sur l'hôte.

**Première installation du serveur :**

1. Copiez `orchestrator-server-<os>` et créez un `.env` à côté à partir de `release/server.env.example`.
2. Posez les secrets de production (voir §3). Le serveur **refuse de démarrer** en production avec des valeurs par défaut.
3. Choisissez le stockage : posez `MONGO_URI` pour MongoDB, ou laissez vide pour NeDB (`<WORK_DIR>/data/`).
4. (Optionnel) Activez HTTPS — voir §6.
5. Lancez le binaire. Au premier boot, il sème l'utilisateur `admin` (mot de passe = `ADMIN_PASSWORD`).
6. Connectez-vous sur `http://<host>:<PORT>` et changez le mot de passe admin tout de suite.

**Première installation d'un worker :**

1. Copiez `orchestrator-worker-<os>` et créez un `.env` à partir de `release/worker.env.example`.
2. Posez `ORCHESTRATOR_URL` (juste `scheme://host:port` — le `/api/v1/...` est ajouté automatiquement), `WORKER_NAME`, et `WORKER_REGISTRATION_SECRET` (doit correspondre à celui du serveur).
3. Installez les runtimes dont les flux ont besoin : Java 11+ (Groovy), Python, PowerShell/pwsh, `npx playwright install chromium` (Playwright).
4. Lancez le binaire. Le worker apparaît dans l'UI sous **Workers** en quelques secondes.

---

## 3. Secrets de production (obligatoires)

Avec `NODE_ENV=production`, le serveur échoue dur au démarrage si l'une de ces variables est restée sur une valeur par défaut :

| Variable | À régler sur |
|---|---|
| `JWT_SECRET` | longue chaîne aléatoire (signe les tokens de session + refresh) |
| `ORCHESTRATOR_MASTER_KEY` | chaîne aléatoire stable (clé AES des secrets au repos — **à ne jamais changer une fois des secrets existants** sinon ils deviennent illisibles) |
| `WORKER_REGISTRATION_SECRET` | secret partagé aléatoire ; la même valeur sur chaque worker |
| `ADMIN_PASSWORD` | mot de passe fort (appliqué uniquement au premier boot, à la création de l'admin) |

Pour générer une valeur : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

> **Attention — irréversible :** faire tourner `ORCHESTRATOR_MASTER_KEY` après que des secrets sont stockés rend chaque secret existant indéchiffrable. Ressaisissez tous les secrets après une rotation.

---

## 4. Variables d'environnement clés

Référence complète : `release/server.env.example` et `release/worker.env.example`.

**Serveur :**

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3939` | Port HTTP/HTTPS. |
| `NODE_ENV` | `development` | `production` active le garde-fou des secrets + la liste blanche CORS. |
| `MONGO_URI` | *(absent)* | Défini → MongoDB ; absent → NeDB dans `<WORK_DIR>/data`. |
| `ORCHESTRATOR_WORK_DIR` | cwd | Base pour `data/`, `inbox/`, le `groovyExec.jar` extrait. |
| `ORCHESTRATOR_EXECUTION_DIR` | = `WORK_DIR` | Répertoire de travail où les artefacts sont extraits et où tournent les processus de nœuds. |
| `ORCHESTRATOR_KEEP_ARTIFACTS` | `false` | `true` conserve les artefacts (et archives décompressées) après le run au lieu de les nettoyer. |
| `DOMAIN` | `http://localhost` | URL publique de base (liste blanche CORS + `service=` SSO). |
| `ORCHESTRATOR_CORS_ORIGINS` | — | Origines autorisées supplémentaires, séparées par des virgules (production). |
| `JSON_BODY_LIMIT` | `100mb` | Taille max de corps JSON (les artefacts base64 la gonflent). |
| `ARTIFACT_UPLOAD_LIMIT` | `1024mb` | Taille max d'un upload d'artefact binaire brut (`POST /flows/:id/artifacts`). |
| `WORKER_OFFLINE_TIMEOUT_MS` | `60000` | Seuil du reaper pour déclarer un worker hors ligne. |
| `DISPATCH_TIMEOUT_MIN` | `5` | Timeout dur (minutes) d'un nœud réparti à un worker. |
| `JANITOR_INTERVAL_MS` | `300000` | Cadence du janitor (purge `worker_jobs` finis + GC blobs d'artefacts). |
| `WORKER_JOB_RETENTION_MS` | `3600000` | Durée de conservation d'un `worker_job` terminé avant purge. |
| `ARTIFACT_GC_MIN_AGE_MS` | `600000` | Fenêtre de fraîcheur : un blob/chunk plus jeune n'est jamais réclamé (anti-course à l'upload). |
| `ORCHESTRATOR_VERSION_MIN_INTERVAL_MS` | `600000` | Intervalle min entre deux snapshots de version (les autosaves rapprochés fusionnent). |
| `ORCHESTRATOR_SERVER_EXECUTION_ENABLED` | `true` | `false` interdit l'exécution locale des nœuds feuilles — force tous les nœuds de script sur les workers. |
| `SERVER_EXECUTION_MODE` | `parallel` | Ordonnancement des runs de flux : `parallel` (concurrents) ou `sequential` (sérialisés). |
| `ORCHESTRATOR_FAIL_ON_LOG_ERROR` | `false` | `true` → un nœud dont la sortie contient `ERROR`/`FAILED` est forcé en FAILED même si le process sort en 0 (idem worker). |
| `HTTPS` | `false` | `true` → écoute TLS (voir §6). |
| `ORCHESTRATOR_PROXYAUTH_URL` | — | URL de validation SSO/CAS. Avec `_REGEX`, active le login SSO (redirection auto du front). |
| `ORCHESTRATOR_PROXYAUTH_REGEX` | — | Regex sur la réponse de validation ; groupe 1 = login. Ex. `<cas:user>([^<]+)</cas:user>`. |
| `ORCHESTRATOR_PROXYAUTH_LOGIN_URL` | `_URL` avec `/validate`→`/login` | URL de login SSO vers laquelle le navigateur est redirigé pour obtenir un ticket. |
| `ORCHESTRATOR_PROXYAUTH_NAME` | `ticket` | Nom du paramètre de requête portant le ticket. |

**Worker :**

| Variable | Défaut | Rôle |
|---|---|---|
| `ORCHESTRATOR_URL` | `http://localhost:3939` | URL de base du serveur (sans `/api/v1`). |
| `WORKER_NAME` | `worker-<random>` | Nom affiché dans l'UI. |
| `WORKER_REGISTRATION_SECRET` | — | Doit correspondre au serveur. |
| `POLL_INTERVAL_MS` | `2000` | Cadence d'interrogation des jobs. |
| `HEARTBEAT_INTERVAL_MS` | `10000` | Cadence du keepalive. |
| `WORKER_EXECUTION_MODE` | `parallel` | Mode de prise de jobs : `parallel` ou `sequential`. |
| `WORKER_MAX_HTTP_SIZE` | `100mb` | Taille max d'un échange HTTP avec le serveur (doit être ≥ `JSON_BODY_LIMIT`). |
| `ORCHESTRATOR_FAIL_ON_LOG_ERROR` | `false` | Idem serveur, côté worker. |

---

## 5. Mise à jour

1. **Sauvegardez la base** (voir §7) — toujours, avant toute mise à jour.
2. Buildez/récupérez le nouveau binaire ; arrêtez le serveur en cours.
3. Remplacez le binaire ; gardez le `.env` existant et le `data/` (NeDB) en place.
4. Démarrez le serveur. Les migrations de démarrage tournent automatiquement et sont idempotentes :
   - ancien `flow.schedule` → collection `schedules`
   - artefacts inline (base64) → refs adressées par contenu (`artifact_blobs`)
   - backfill `owner=admin` sur les flux sans propriétaire
   - executions restées `RUNNING` → `FAILED`
5. Vérifiez : `GET /api/v1/ping` renvoie la nouvelle `version` ; l'UI charge ; un flux de test s'exécute.
6. Mettez à jour les workers (remplacez le binaire, redémarrez). Les workers se réenregistrent ; les anciens sans token sont acceptés une fois puis invités à se réenregistrer.

**Rollback :** arrêtez le serveur, restaurez le binaire précédent **et** la sauvegarde de base d'avant mise à jour, redémarrez. Comme les migrations de planifications/propriétaires modifient les données, restaurer le seul binaire ne suffit pas si la nouvelle version a écrit des lignes au nouveau format.

---

## 6. Activer HTTPS

```env
HTTPS=true
# Chemins explicites optionnels ; par défaut <WORK_DIR>/certs/server.crt + server.key
# HTTPS_CERT=/path/server.crt
# HTTPS_KEY=/path/server.key
```

Générez une paire auto-signée avec le `scripts/gen-cert.bat` fourni. Le serveur lève une erreur au démarrage si `HTTPS=true` mais que le cert/la clé manquent.

---

## 7. Sauvegarde et restauration

**NeDB (par défaut) :** les fichiers `<WORK_DIR>/data/*.db` sont du JSON en append-only. Arrêtez le serveur (ou acceptez une copie légèrement périmée) et copiez tout le dossier `data/`. Pour restaurer, on remplace `data/`.

```bash
# Sauvegarde
cp -r "$ORCHESTRATOR_WORK_DIR/data" "backup-$(date +%F)/"
```

**MongoDB :** utilisez `mongodump` / `mongorestore` sur `MONGO_URI`.

> Les fichiers NeDB sont **en clair et lisibles** — ils contiennent les hash bcrypt des mots de passe et les blobs de secrets chiffrés en AES. Protégez l'emplacement de sauvegarde ; les blobs AES sont inutiles sans `ORCHESTRATOR_MASTER_KEY`, mais traitez-les comme sensibles malgré tout.

---

## 8. Guide d'incident

| Symptôme | Cause probable | Action |
|---|---|---|
| Le serveur ne démarre pas, logs `FATAL: refusing to start … default/placeholder secrets` | `NODE_ENV=production` avec un secret absent/par défaut | Posez les variables listées (§3), redémarrez. |
| `HTTPS enabled but cert/key not found` | `HTTPS=true`, fichiers PEM manquants | Générez via `gen-cert.bat` ou corrigez `HTTPS_CERT`/`HTTPS_KEY`. |
| Le worker n'apparaît pas dans l'UI | Mauvais `ORCHESTRATOR_URL`, secret incohérent, ou réseau bloqué | Regardez les logs du worker ; vérifiez que `WORKER_REGISTRATION_SECRET` correspond ; confirmez que le worker atteint l'URL du serveur. |
| Une exécution reste « running » indéfiniment | Serveur redémarré en plein run, ou worker mort | Le redémarrage réconcilie les runs orphelins → FAILED au boot. Pour un run bloqué en direct : `POST /executions/:id/kill`. |
| Un job worker se fige puis échoue après ~5 min | Le worker est passé hors ligne en plein job | Le reaper l'annule après `WORKER_OFFLINE_TIMEOUT_MS` ; remettez le worker en ligne et relancez. |
| `request entity too large` | Artefact plus gros que `JSON_BODY_LIMIT` | Augmentez `JSON_BODY_LIMIT` (serveur) et `WORKER_MAX_HTTP_SIZE` (worker, ≥ serveur). |
| Les secrets s'affichent illisibles / erreurs de déchiffrement | `ORCHESTRATOR_MASTER_KEY` a changé | Restaurez la clé d'origine, ou ressaisissez tous les secrets. |
| Les nœuds Groovy échouent | Java manquant ou `groovyExec.jar` introuvable | Installez Java 11+ ; vérifiez `GROOVY_JAR` / que le jar s'est bien extrait à côté du binaire. |

**Où sont les logs :** le serveur/worker logguent sur stdout/stderr — capturez via votre gestionnaire de processus (journal systemd, log de service Windows, logs du conteneur). Préfixes clés : `[Startup]`, `[DB]`, `[Reaper]`, `[EventBus]`, `[server]`.

---

## 9. Vérifications de routine

- **Santé :** `curl http://<host>:<PORT>/api/v1/ping` → `{ "status": "ok" }`.
- **Workers en ligne :** panneau **Workers** de l'UI, ou `GET /api/v1/workers` (en ligne = vu dans les 30 dernières secondes).
- **Rétention des exécutions :** pas de purge automatique des `executions` pour l'instant (backlog #22) — `DELETE /api/v1/executions` (admin) périodiquement ou élaguez `executions.db` pour maîtriser la croissance. En revanche les `worker_jobs` terminés et les blobs d'artefacts non référencés **sont** purgés par le janitor (`JANITOR_INTERVAL_MS`).
