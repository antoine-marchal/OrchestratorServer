# Orchestrator

Une plateforme d'automatisation auto-hébergée : un éditeur de flux visuel, un moteur d'exécution en graphe (DAG), de la planification, une gestion des secrets et des agents d'exécution distants — le tout dans un seul dépôt.

Concrètement : on construit des flux dans un éditeur de graphe en glisser-déposer (JavaScript, Python, Groovy, PowerShell, Batch, Playwright, sous-flux, conditions), on les déclenche via cron, événement, requête HTTP ou à la demande, et on regarde les logs défiler en direct dans le navigateur. Le travail lourd ou propre à un OS est délégué à des agents **worker** distants, qui s'enregistrent eux-mêmes auprès du serveur en HTTP.

Chaque flux est en plus versionné dans un **dépôt git interne** : les sauvegardes de l'éditeur deviennent des commits, on travaille par **branches**, et on peut `git clone`/`push`/`pull` un flux avec un client git standard. On exécute un même flux en plusieurs **variantes** (worker/branche différents) planifiables indépendamment, et ses fichiers joints (**artefacts**) sont stockés une seule fois en adressage par contenu.

> Version 3.2.4 · Node.js ≥ 18 · TypeScript

---

## Organisation du dépôt

```
OrchestratorServer/
├── orchestrator-webpanel/     # Serveur central + interface web (l'« Orchestrator »)
│   ├── server/                # Backend Express + TypeScript (API, exécuteur, planificateur)
│   └── client/                # Frontend React + Vite (éditeur de flux, admin, tableaux de bord)
├── orchestrator-worker/       # Agent d'exécution distant (s'enregistre, interroge, exécute les jobs)
├── oauth_proxy/               # Pont OAuth2 de test (Grafana → CAS) — voir son README
├── authent_test_service/      # Mock CAS/SSO pour tester proxy-auth et oauth_proxy
├── release/                   # Binaires packagés + exemples de .env (sortie de build)
├── documentation/             # Architecture, API, runbook, onboarding, deck (commencez ici)
├── build-server.bat           # Build + pkg du serveur vers release/
├── build-worker.bat           # Build + pkg du worker vers release/
├── deploy.bat                 # Copie les binaires de release vers la cible de déploiement
├── set-version.bat            # Applique .version à tous les package.json
└── dev-*.bat                  # Lanceurs de dev en un clic (server / client / worker)
```

À noter : il n'y a **pas de `package.json` à la racine** — `orchestrator-webpanel` et `orchestrator-worker` sont deux projets npm indépendants. Les commandes npm se lancent dans chacun.

---

## Ce qu'on trouve dedans

| Composant | Son rôle |
|---|---|
| **Serveur** (`orchestrator-webpanel/server`) | L'API REST, l'exécuteur de flux en cours de processus, le planificateur cron/événement, la répartition vers les workers, le versionnage git des flux, le stockage d'artefacts adressé par contenu, l'authentification et le chiffrement des secrets. Il sert aussi l'interface web une fois buildée. |
| **Interface web** (`orchestrator-webpanel/client`) | L'éditeur visuel React Flow, les panneaux de code Monaco, l'historique d'exécution avec streaming de logs en direct, le sélecteur de branche et les variantes de flux, et l'administration des planifications, secrets, workers et utilisateurs. |
| **Worker** (`orchestrator-worker`) | Un agent distant sans état. Il s'enregistre auprès du serveur, interroge en long-poll pour récupérer des jobs, exécute les nœuds de script dans des processus enfants isolés, et renvoie les logs au fil de l'eau. |

---

## Démarrage rapide (développement)

Prérequis : Node.js ≥ 18. Selon les types de nœuds : Java 11+ (Groovy), Python (nœuds Python), PowerShell/pwsh, et les navigateurs Playwright.

```bash
# 1. Installer les dépendances dans chaque projet
cd orchestrator-webpanel/server && npm install
cd ../client && npm install
cd ../../orchestrator-worker && npm install
```

Ensuite, on lance les trois processus (scripts Windows en un clic ci-dessous ; l'équivalent npm est entre parenthèses) :

```bat
dev-server.bat     ::  orchestrator-webpanel/server  -> http://localhost:3939   (npm run dev)
dev-client.bat     ::  orchestrator-webpanel/client  -> http://localhost:5173   (npm run dev)
dev-worker.bat     ::  orchestrator-worker            -> se connecte à :3939      (npm run dev)
```

Le client Vite proxifie `/api/*` vers le serveur sur le port `:3939`. Ouvrez **http://localhost:5173** et connectez-vous avec le compte admin créé automatiquement (`admin` / la valeur de `ADMIN_PASSWORD`, `admin` par défaut).

Pour un tour complet, voir [documentation/ONBOARDING.md](documentation/ONBOARDING.md).

---

## Démarrage rapide (production / binaire packagé)

```bat
build-server.bat          :: build client + serveur, package vers release/orchestrator-server-*
build-worker.bat          :: build + package release/orchestrator-worker-*
```

Posez un `.env` à côté de chaque binaire (à partir de `release/server.env.example` / `release/worker.env.example`) puis lancez le binaire. Voir [documentation/RUNBOOK.md](documentation/RUNBOOK.md) pour les procédures de déploiement, mise à jour, sauvegarde et gestion d'incident.

> **Garde-fou production :** avec `NODE_ENV=production`, le serveur refuse de démarrer si `JWT_SECRET`, `ORCHESTRATOR_MASTER_KEY`, `WORKER_REGISTRATION_SECRET` ou `ADMIN_PASSWORD` sont restés sur leurs valeurs par défaut. C'est volontaire.

---

## Documentation

| Document | À lire quand… |
|---|---|
| [documentation/ARCHITECTURE.md](documentation/ARCHITECTURE.md) | Vous voulez la vue d'ensemble : composants, flux de données, modèle d'exécution, décisions de conception. |
| [documentation/API.md](documentation/API.md) | Vous appelez l'API REST ou construisez une intégration. |
| [documentation/RUNBOOK.md](documentation/RUNBOOK.md) | Vous déployez, mettez à jour, sauvegardez ou réparez un incident en production. |
| [documentation/ONBOARDING.md](documentation/ONBOARDING.md) | Vous venez d'arriver et il vous faut un environnement qui tourne + une carte du code. |
| [orchestrator-webpanel/README.md](orchestrator-webpanel/README.md) | Détail de la stack et des modules côté serveur/UI. |
| [orchestrator-worker/README.md](orchestrator-worker/README.md) | Runtimes, passage de variables et types de nœuds, côté worker. |
| [todo.md](todo.md) | Le backlog d'améliorations (sécurité / fiabilité / scalabilité / etc.). |

---

## Stack technique

**Backend :** Node.js, TypeScript (mode strict), Express 4, NeDB *ou* MongoDB (choisi automatiquement selon `MONGO_URI`), authentification JWT, secrets en AES-256-GCM, node-cron, dépôt git interne maison (objets/refs en base, smart-HTTP), stockage d'artefacts adressé par contenu (sha256, chunking).
**Frontend :** React 18, Vite, React Flow, Monaco Editor, Zustand, Tailwind CSS.
**Worker :** Node.js, TypeScript, axios, playwright, tree-kill. Packagé en binaire unique avec `@yao-pkg/pkg`.
