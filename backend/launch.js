        import { executeFlowFile } from './poller.cjs';
        import path from 'path';
        // Execute the flow file
        await executeFlowFile("C:\\Workspace\\Orchestrator\\scriptsTest\\pwd\\main.or",null,[],true,true, path.dirname("C:\\Workspace\\Orchestrator\\scriptsTest\\pwd\\main.or"));