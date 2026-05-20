# Orchestrator — Improvement Backlog - Top Priority

--

[x] Secrets scope not to a flow but to a worker
    That means if there is three secrets named exactly the same : PASSWORD
    PASSWORD - global - value {1}
    PASSWORD - worker1 - value {2}
    PASSWORD - worker2 - value {3}

    if node executed by worker1 : {{secrets.PASSWORD}} gives 2,
                    by worker2  : {{secrets.PASSWORD}} gives 3,
                    else  :  {{secrets.PASSWORD}} gives 1,

[x] Add a env var for server to enable / disabler execution by Server

[x] Add the ability for operator role to list secrets and add a new secret but not to decode nor delete a secret

[x] Group the flows by namespace with the same UX as the groups for workers

[x] Remove the how to connect worker

[] add the ability to add a .zip or .tar or (other archive extension) as artifact and at the beginning of the flow, the archive artifact is unzipped to the execution folder

[] artifacts deployment must work as well in yellow button run flow in edit mode

[] artifacts deployment must work as well if artifacts are linked to flow2 and I m executing flow1 that contains a flownode pointing at flow2

[] if I m executing flow1 that contains a flownode pointing at flow2 :
    [] flow2 execution must be traced as well with a status : name of the flow2
    [] in execution graph, timeline graph and logs i must have nodes of flow2 as well and ability to filter just like if the flow2 was embedded in flow1

[x] add a env var to enable ERROR or FAILED parsing in logs to trigger a error in execution of a node (Server AND Worker)

[] add in edit tab a right panel (resizable) following the modifications of the flow (versions management in fact)
        [] a version management based on diff ? a little bit like GIT ? should be a nice to have !!!


