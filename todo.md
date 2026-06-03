# Orchestrator — Improvement Backlog

Status legend: ✅ done · 🚧 in progress · ⬜ pending · ❌ won't do

---

Issues :

✅ 1 — Node-run instances now separated. Execution node tree shows a ×N badge + per-visit run rows (click to scope logs to that run's time window); live Console inserts a "run N" divider on each re-visit. (ExecutionNodeTree, FlowDetail, Console, execTiming)
✅ 2 — Goto jump no longer executes the target's graph predecessors (`skipPreds`). Client + server flowExecutor.
✅ 3 — Flow nodes sharing a sub-flow stay solidaire: closing a tab flushes the snapshot + keeps `linkedSessionId`; re-opening recreates the SAME session id so all sharing nodes re-link. Added a re-point menu on flow nodes (link to another session / library flow). (sessionStore, flowNodeContent, NodeHeader)
✅ 4 — Goto condition destination can target multiple nodes (multi-select); all targets execute, forwarding input per the existing per-condition flag. Client + server executor, NodeBody UI, edge overlays.
✅ 5 — Unit-running a node inside a flow-node sub-session now uses ORCHESTRATOR_EXECUTION_DIR (server honours only an ABSOLUTE basePath; bogus relative sub-session flowPath ignored).

1 - Dans le statut des nodes (a l'execution nodetree et logs) le statut est regroupe par node name et non node instance id si bien que si on a les noeuds A, B et C et le flow suivant : A->B->A->C et que le premier A demarre on a le deuxieme A qui s affiche en train de xecuter et les logs du deuxieme A se retrouve lie au premier A ... les deuxi nstances sont bel et bien a separer.

2 - Goto vers l'avant. si j ai un flow A->Goto(destination : D)  et  B -> C -> D -> E alors l' input de C n est pas pris en compte, ce qui est bien mais porutant B et C s executent alors que l on ne veut pas dans ce cas.

3 - De maniere generale les flow nodes lies a une session doivent etre ameliores grandement dans leur synchro. Si j ai un flow de ce type A->B->C->B'->D et que B et B' pointent sur une meme session (sous flux) alors si jouvre B pour modifier l interreieur de la session et que je quitte la session, B' doit pointer sur le meme sous flux qui vient d etre modifie. autrement dit. ce n est pas parceque je quitte une sessiontab que les flownodes qui pointaient vers ce sous flux sont desolidarises et individuels. le sous flux doit etre enregistre dans le flux global et partage entre les flownodes pointant vers ce meme sous flux. 
Aussi, je souhaite pouvoir modifier la session ou le flow pointe par le flownode meme apres creation ...

4 - le node Goto et en particulier la destination d une condition doit pouvoir cibler un node ou un array de node. dans le cas ou je selectionne plusieurs nodes de destination alors les nodes de destinations doivent s executer. (comme si les nodes de destinations etaient lies a loutput du goto mais (avec ou sans) forward input )

5 - Bug : si j ai un flow de ce type A->B->C et que B est un flownode pointant vers une session contenant E->F alors si j ouvre B (ouverture dune session tab contenant E->F) et que j execute de maniere unitaire E alors E s execute pas dans l ORCHESTRATOR_EXECUTION_DIR