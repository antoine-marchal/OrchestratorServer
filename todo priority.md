# Orchestrator — Improvement Backlog - Top Priority

--

[x] versions button should be styled like other buttons and placed after redo button.
[x] versions management should take into accounts sessions and artifacts but record only 10 last minutes changes (if any) by record. (customizable with environment variable)
[x] code editting panel for node is ommiting first keystroke ....
    if i edit a code of a node and begin to type something the first letter is ommited ruining the ux
[x] 7z format should be eligible for artifact unzip ..
[x] trace execution of nested flowRef :
    if i run a flow1 accounting for a flownode pointing at flow2, i want to see in flow2 executions list and general exeuctions list an execution of flow2 with logs but with trigger label : triggered - flow1 instead of api or manual - admin
[x] add the ability to modify namespace by double clicking on namespace in http://localhost:3939/#/flows/mpegsgynfbqoul or http://localhost:3939/#/flows just like name
[x] remove flow-scoped feature for secrets and replace flow-scope counter with worker-scoped
[x] flows must have an attribute : owner, the creator of the flow
[x] operator should be able to edit only their own flows and other operator's flow but not admin's
[x] admin can change flow's owner by double cliking on it.
[x] operators cannot reach schedules and api triggero ptions
