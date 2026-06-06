# Guide d'onboarding

Faire tourner Orchestrator en local, comprendre comment les pièces s'emboîtent, et faire votre première modif. Comptez 30 à 60 minutes.

---

## 1. Sur quoi vous travaillez

Orchestrator est une plateforme d'automatisation auto-hébergée : les utilisateurs construisent des **flux** (des graphes de nœuds de script) dans le navigateur, et le serveur les exécute sur planification/événement/trigger ou à la demande. Le travail de script peut tourner en cours de processus ou être délégué à des agents **worker** distants.

Trois livrables, un seul dépôt :

- `orchestrator-webpanel/server` — l'API + l'exécuteur + le planificateur, en Express + TypeScript.
- `orchestrator-webpanel/client` — l'interface web React + Vite.
- `orchestrator-worker` — l'agent d'exécution distant.

Lisez [ARCHITECTURE.md](ARCHITECTURE.md) pour la vue d'ensemble une fois votre environnement debout.

---

## 2. Prérequis

| Outil | Pourquoi |
|---|---|
| Node.js ≥ 18 | Les trois projets. |
| Git | Évident. |
| (Optionnel) MongoDB | Seulement si vous voulez Mongo plutôt que le NeDB embarqué par défaut. |
| (Optionnel) Java 11+, Python, PowerShell/pwsh | Seulement pour exécuter ces types de nœuds sur un worker. |
| (Optionnel) Navigateurs Playwright | `npx playwright install chromium` pour les nœuds Playwright. |

Rien d'autre en global que Node — chaque projet porte ses propres dépendances.

---

## 3. Mise en place de l'environnement

```bash
git clone <repo> && cd OrchestratorServer

# Installer les dépendances dans chaque projet
cd orchestrator-webpanel/server && npm install
cd ../client && npm install
cd ../../orchestrator-worker && npm install
cd ..
```

Créez le fichier d'env du serveur (les défauts de dev font l'affaire — le garde-fou des secrets de production ne se déclenche qu'avec `NODE_ENV=production`) :

```bash
# depuis orchestrator-webpanel/server, copiez et éditez
cp ../../release/server.env.example .env
```

Laissez `MONGO_URI` commenté pour utiliser NeDB (les données atterrissent dans `<WORK_DIR>/data/`). Aucune base à installer.

---

## 4. Le lancer (trois terminaux)

Sous Windows, utilisez les lanceurs en un clic depuis la racine du dépôt :

```bat
dev-server.bat     :: serveur -> http://localhost:3939
dev-client.bat     :: client  -> http://localhost:5173  (proxifie /api -> :3939)
dev-worker.bat     :: worker  -> se connecte à :3939
```

Les équivalents multiplateformes :

```bash
cd orchestrator-webpanel/server && npm run dev      # ts-node, rechargement à chaud
cd orchestrator-webpanel/client && npm run dev      # Vite HMR
cd orchestrator-worker          && npm run dev      # agent ts-node
```

Ensuite :

1. Ouvrez **http://localhost:5173**.
2. Connectez-vous : `admin` / `admin` (ou votre `ADMIN_PASSWORD`).
3. Vérifiez que le worker apparaît sous **Workers** (en ligne en quelques secondes).

---

## 5. Carte du code

Où regarder quand vous devez changer quelque chose :

| Vous voulez… | Allez voir |
|---|---|
| Ajouter/modifier un endpoint REST | `orchestrator-webpanel/server/src/routes/*.ts` (montés dans `server.ts`) |
| Toucher à l'auth / aux tokens | `server/src/middleware/auth.ts`, `rbac.ts` |
| Changer comment un flux s'exécute (parcours DAG, retry, dispatch) | `server/src/services/executor/flowExecutor.ts` |
| Ajouter/modifier un runner de type de nœud | `server/src/services/executor/nodeExecutor.ts` (serveur) et `orchestrator-worker/src/executor/nodeExecutor.ts` (worker) — gardez-les synchronisés |
| Toucher au versionnage git / branches / smart-HTTP | `server/src/services/git/*` (`flowMaterialize`, `flowCommit`, `gitStore`, `receivePack`) |
| Toucher au stockage/GC des artefacts | `server/src/services/executor/artifactStore.ts` |
| Toucher à la planification | `server/src/services/scheduler/cronScheduler.ts`, `eventBus.ts` |
| Changer le stockage / ajouter une collection | `server/src/services/db/index.ts` + `db/models/*` |
| Modifier le canvas de l'éditeur de flux | `client/src/components/FlowEditor.tsx`, `components/node/*`, `components/editor/*` |
| Modifier les vues liste de flux / exécutions | `client/src/components/flows/*`, `components/execution/*` |
| Changer les appels API côté client | `client/src/utils/apiClient.ts` |
| Changer l'état côté client | `client/src/store/*` (Zustand) |

> À noter : il existe un `store/executors/` côté **client** et un `services/executor/` côté **serveur**. Celui du serveur exécute réellement les jobs ; celui du client modélise le graphe pour l'éditeur. Ne les confondez pas.

---

## 6. Tâches courantes (pas à pas)

### Construire un binaire packagé

```bat
set-version.bat 3.2.4       :: applique la version partout
build-server.bat            :: -> release/orchestrator-server-*
build-worker.bat            :: -> release/orchestrator-worker-*
```

### Lancer les tests

Vitest couvre le crypto, la substitution de secrets, la sûreté des chemins d'artefacts, le parseur de flux, le chunking d'artefacts, le rework de branches et les diffs de commit :

```bash
cd orchestrator-webpanel/server && npm test
```

### Ajouter un endpoint REST

1. Ajoutez le handler dans le router `routes/*.ts` concerné.
2. Il hérite de l'auth appliquée au montage dans `server.ts` ; ajoutez `requireRole('admin', …)` pour un contrôle plus fin.
3. Passez par `getCollection('<name>')` pour l'accès aux données — n'importez jamais un driver de base directement (l'abstraction maintient la parité NeDB/Mongo).
4. Renvoyez la forme d'erreur standard : `{ error: { code, message } }`.
5. Ajoutez/complétez un test Vitest.

### Réinitialiser les données locales

Arrêtez le serveur et supprimez `<WORK_DIR>/data/`. Redémarrez — l'utilisateur `admin` est re-semé.

---

## 7. Conventions et pièges

- **L'accès à la base** passe par `getCollection()` / `ICollection`. Les requêtes doivent fonctionner sur NeDB comme sur Mongo.
- **Les exécuteurs de nœuds serveur et worker doivent rester synchronisés** — un nouveau type de nœud ou un changement de passage de variables touche en général les deux.
- **Les secrets** se référencent par `${{ secrets.NAME }}` et sont résolus côté serveur au moment de l'exécution. Ne loggez jamais les valeurs résolues.
- **Le JS inline n'est pas sandboxé.** Pour du code non fiable, routez-le vers un worker ou posez `ORCHESTRATOR_SERVER_EXECUTION_ENABLED=false`.
- **Redémarrages du backend :** les changements de code serveur sous `npm run dev` se rechargent à chaud via ts-node ; un binaire packagé doit être rebuildé et redémarré.
- **L'URL du worker** est juste `scheme://host:port` — le chemin `/api/v1/...` est ajouté par l'agent. Ne l'incluez pas dans `ORCHESTRATOR_URL`.
- **`req.user`** est rempli par `authMiddleware` (`{ _id, login, role, authType }`).

---

## 8. Pour aller plus loin

- [ARCHITECTURE.md](ARCHITECTURE.md) — composants, flux de données, modèle d'exécution et de dispatch, décisions de conception.
- [API.md](API.md) — la référence complète des endpoints.
- [RUNBOOK.md](RUNBOOK.md) — déploiement, mise à jour, sauvegarde, incidents.
- [../todo.md](../todo.md) — le backlog d'améliorations : une bonne source de premières tâches (les items marqués ⬜).
- [../orchestrator-webpanel/README.md](../orchestrator-webpanel/README.md) et [../orchestrator-worker/README.md](../orchestrator-worker/README.md) — le détail par composant.
