# ![Orchestrator Logo](logo-full.png)

Orchestrator is a web application built with React and Node.js. It enables you to visually orchestrate, edit, and execute custom scripts or nodes (JavaScript, Batch, Groovy, PowerShell, Playwright) through a modern, interactive graphical interface.

![Orchestrator](captures/main.jpg)

## Features

- Intuitive drag-and-drop GUI for building and managing node-based flows
- Execute scripts in JavaScript (frontend & backend), Groovy, Batch, PowerShell, and Playwright
- Visualize, edit, and connect nodes with custom code or constants
- Save, load, and version flows as `.or` or `.json` files
- Add comments and documentation nodes to your flows
- Built-in code editor with syntax highlighting for multiple languages
- Advanced console for real-time logs, outputs, and error tracking per node
- Multi-session support with drag-and-drop tab reordering
- Comprehensive keyboard shortcuts for all operations (save, load, undo, redo, copy, paste)
- Resizable, customizable nodes and flow layout auto-arrangement
- Execution time display for performance monitoring
- Flow history navigation with undo/redo functionality
- Copy/paste functionality for nodes and configurations
- Flow nodes linked to sessions for live editing

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/) (usually included with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/antoine-marchal/OrchestratorServer.git
cd OrchestratorServer

# Install dependencies
npm install
```

### Development Usage

```bash
# Start the backend (Node.js) - runs on port 3000
npm run backend

# Start the frontend (React) - runs on port 5173
npm run dev

# Or use all-in-one (backend + frontend)
npm run start
```

> **Tip:** In development mode, the interface opens at `http://localhost:5173`.

### Production Usage

```bash
# Build the frontend
npm run build

# Serve the built application
npm run preview
```

## Project Structure

| Directory/File | Description |
|----------------|-------------|
| `src/` | React source code (frontend) |
| `src/components/` | UI components (FlowEditor, CodeEditorModal, Console, SessionTabs, etc.) |
| `src/components/node/` | Node-specific components (CustomNode, NodeHeader, NodeBody, etc.) |
| `src/store/` | Zustand state management for sessions and flows |
| `src/types/` | TypeScript types for nodes and edges |
| `backend/` | Node.js/Express backend for script execution |

## Node Types

Orchestrator supports various node types, each with a unique icon for quick identification:

| Node Type | Icon | Description |
|-----------|------|-------------|
| **JavaScript** | FileCode (yellow) | Run code in the frontend context |
| **Backend JS** | Server (blue) | Run JavaScript in the backend context |
| **Groovy** | Coffee (red) | Execute Groovy scripts via the backend |
| **Batch** | Terminal (gray) | Run Windows batch scripts |
| **PowerShell** | TerminalSquare (blue) | Execute PowerShell scripts |
| **Variable** | Hash (purple) | Shared state accessible and modifiable by all nodes |
| **Comment** | MessageSquare (gray) | Add documentation/comments to your flow |
| **Flow** | GitBranch (green) | Execute another flow (linked to a session) |
| **Goto** | CornerRightDown (yellow) | Conditional branching based on JS expressions |

## Core Features

### Code Editing

- Edit node code with syntax highlighting (Ace Editor)
- Supports JavaScript, Groovy, Batch, PowerShell
- Keyboard shortcuts: Save (Ctrl/Cmd+S), Close (Esc)

### Console & Logging

- Real-time per-node logs, input/output, and error tracking
- Filter log types (input, output, log, error)
- Expand/collapse and fullscreen console view
- Clear Output button and keyboard shortcut (Ctrl+W)
- Configurable timeout parameter dropdown for long-running operations
- Execution time display for each node operation

### Multi-Session Support

- Work on multiple flows simultaneously with tabbed interface
- Drag-and-drop tab reordering
- Sessions persist to localStorage
- Configurable backend server address per browser

### Backend Execution

- Content-based execution - flows are sent as JSON, not file paths
- Direct processor calls for each node type
- Support for nested flow execution
- Groovy, Batch, PowerShell, Playwright, and Node.js backend execution

### Keyboard Shortcuts

- **Ctrl+S**: Save flow
- **Ctrl+O**: Open flow
- **Ctrl+W**: Clear console output
- **Ctrl+Z**: Undo last action
- **Ctrl+Y**: Redo action
- **Ctrl+C**: Copy selected node(s)
- **Ctrl+V**: Paste copied node(s)
- **Ctrl+D**: Duplicate selected node
- **Ctrl+R**: Run/execute current flow
- **Ctrl+P**: Open project settings
- **Esc**: Close modals/editor

All keyboard shortcuts are context-aware, meaning they intelligently adapt based on your current focus in the application.

### Flow History & Node Management

- Comprehensive undo/redo system for all flow modifications
- Copy and paste functionality for nodes with all configurations preserved
- Starter node selection feature for quick flow initialization
- Context-aware keyboard shortcut handling based on current focus

## Flow Nodes

Flow nodes are a powerful feature that allows you to create reusable, modular workflows by linking to other sessions.

### What are Flow Nodes?

Flow nodes act as containers that execute another flow, enabling hierarchical workflow composition and code reuse. They serve as building blocks for complex workflows, allowing you to:

- Break down complex processes into manageable, reusable components
- Create modular workflows that can be nested within other workflows
- Edit linked flows in their own session tab with live synchronization
- Reuse common workflow patterns across multiple projects

### Creating Flow Nodes

1. **From Existing Session**:
   - Click the **Add Node** button and select **Flow**
   - Choose an existing session from the dropdown
   - The flow node links directly to that session (no new session created)

2. **From File Upload**:
   - Click the **Add Node** button and select **Flow**
   - Choose "Upload File" and select a `.or` file
   - A new session is created with the flow content and linked to the flow node

### Editing Flow Nodes

Click the edit button (pencil icon) on a flow node:
- If the flow node is already linked to an existing session, you'll switch to that session
- If not linked, a new session is created with the flow content, linked, and you switch to it

Any changes made in the linked session are **automatically reflected** when you execute the flow node - no manual sync required.

### How Flow Nodes Execute

Flow nodes operate by executing the workflow from their linked session:

1. **Input Processing**: The flow node receives input data from connected input nodes
2. **Content Retrieval**: If linked to a session, fetches the current flow state from that session
3. **Dependency Resolution**: The system determines the execution order
4. **Sequential Execution**: Each node in the flow is executed
5. **Result Collection**: The output from the last node becomes the output of the flow node
6. **Output Passing**: This output is passed to connected nodes

### Best Practices

- **Single Responsibility**: Design each flow to perform a specific task
- **Meaningful Names**: Use descriptive session names for your flows
- **Hierarchical Structure**: Create a logical hierarchy of flows
- **Consistent Inputs/Outputs**: Maintain consistent formats for compatibility
- **Complexity Management**: Break complex workflows into smaller flows
- **Documentation**: Add comment nodes to document purpose and expected inputs/outputs

### Example Use Cases

- **Data Processing Pipelines**: Data cleaning, format conversion, enrichment
- **Business Process Automation**: Customer onboarding, order processing, approvals
- **Integration Scenarios**: API handling, authentication flows, error handling

## Variable Nodes

Variable nodes provide shared state that can be read and modified by any node during flow execution.

### Key Features

- **JSON Parsing**: Values are automatically parsed as JSON objects when possible
- **Dual Access**: Variables are accessible both via edge connections AND by name in code
- **Real-time Updates**: When a script modifies a variable, subsequent nodes see the updated value immediately
- **Cross-language Support**: Works with JavaScript (browser & backend), Groovy, PowerShell, and Batch

### How to Use Variables

1. **Create a Variable Node**: Add a Variable node and give it a name (e.g., "config")
2. **Set Initial Value**: Enter a value in the node (JSON objects work: `{"timeout": 30, "retries": 3}`)
3. **Access in Scripts**: The variable is automatically available in your scripts by its name

### Language Examples

**JavaScript (Browser & Backend):**
```javascript
// Read variable
console.log(config.timeout);  // 30

// Modify variable
config.newField = "added";
config.retries = 5;
```

**Groovy:**
```groovy
// Read variable
println config.timeout  // 30

// Modify variable
config.newField = "added"
config.retries = 5
```

**PowerShell:**
```powershell
# Read variable
Write-Output $config.timeout  # 30

# Modify variable
$config.newField = "added"
$config.retries = 5
```

**Batch (read-only):**
```batch
REM Variables available as environment variables (strings only)
echo %config%
```

### Variable Behavior

- **Persistence**: Changes persist throughout the flow execution
- **Chaining**: When Node A modifies a variable, Node B (executed after) sees the changes
- **Starter Nodes**: When a starter node is set, only nodes from that point forward execute
- **Conflict Resolution**: Last write wins for parallel modifications
- **Name Sanitization**: Variable names are sanitized for valid identifiers (spaces become underscores)

### Best Practices

- Use descriptive variable names that reflect their purpose
- Initialize variables with proper JSON structure when storing objects
- Use variables for configuration, counters, or shared state between nodes
- Avoid reserved names: `input`, `output`, `console`, `process`, `require`, `module`, `exports`

## Goto Nodes

Goto nodes enable conditional branching within your flows:

- Define multiple conditions using JavaScript expressions
- Each condition specifies a target node to jump to
- Optionally forward the input value to the target node
- Useful for loops, error handling, and dynamic flow control

## Contributing

Contributions are welcome!
- Fork the project
- Create a branch
- Open a Pull Request

## Useful Links

- [React](https://react.dev/)
- [Node.js](https://nodejs.org/)
- [Playwright](https://playwright.dev/)
- [Ace Editor](https://ace.c9.io/)
- [ReactFlow](https://reactflow.dev/)
- [Zustand](https://zustand-demo.pmnd.rs/)

---
© 2025 Orchestrator. All rights reserved.
