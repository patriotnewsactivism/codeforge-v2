# CodeForge V2

**AI-powered coding platform** — build apps with multi-model AI chat, live preview, smart suggestions, multi-agent mode, and real-time collaboration.

🔗 **Live:** [codeforge-v2-c96b4570.viktor.space](https://codeforge-v2-c96b4570.viktor.space)

## Features

### Core IDE
- **Multi-Model AI Chat** — DeepSeek V3.2, Grok 4.1 Fast, GPT-5 Mini with per-message model switching and automatic fallback
- **Full Code Editor** — Monaco editor with syntax highlighting, tabs, Ctrl+S save
- **File Tree** — Create, rename, delete files and folders
- **Live Preview** — Sandbox with auto-refresh, console output, open-in-new-tab
- **Project Dashboard** — Create and manage multiple projects

### AI Features
- **💡 Smart Suggestions** — AI analyzes your project and proactively suggests features/improvements. One-tap implement.
- **🔄 Live Sandbox Build Loop** — AI builds inside the sandbox, sees errors, fixes them in real-time
- **⚡ Multi-Agent Mode** — Parallel AI agents (UI, Logic, Debug, Feature) tackle different parts simultaneously

### Collaboration
- **👥 Live Presence** — See who's editing which file in real-time
- **🔗 Shareable Sessions** — Generate invite links for live collaboration
- **@codeforge** — Mention to cue the AI from any collaborator

### Quality
- **Error Boundaries** — Per-panel error isolation with retry
- **Loading Skeletons** — Smooth loading experience
- **Session Management** — Rename, delete, archive chat sessions
- **Change History** — Undo suggestions with full change tracking
- **Project Export** — Download project as JSON

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Editor:** Monaco Editor (via @monaco-editor/react)
- **Backend:** Convex (real-time database + serverless functions)
- **Auth:** Convex Auth
- **Layout:** react-resizable-panels
- **UI:** shadcn/ui components

## Development

```bash
# Install dependencies
bun install

# Start Convex dev server + Vite
bun run dev

# Build for production
bun run build

# Deploy Convex to production
bunx convex deploy --prod
```

## Environment Variables

Create `.env.local`:
```
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

## Project Structure

```
├── convex/           # Backend (Convex functions + schema)
│   ├── schema.ts     # Database schema
│   ├── projects.ts   # Project CRUD
│   ├── files.ts      # File management
│   ├── chat.ts       # AI chat with model fallback
│   ├── collaboration.ts  # Real-time presence + invites
│   ├── suggestions.ts    # Smart feature suggestions
│   ├── buildLoop.ts      # Live sandbox build loop
│   ├── agents.ts         # Multi-agent mode
│   ├── changeHistory.ts  # Undo/change tracking
│   └── export.ts         # Project export
├── src/
│   ├── components/
│   │   └── ide/      # IDE panel components
│   ├── pages/         # Route pages
│   └── hooks/         # Custom hooks
└── public/
```

## License

Proprietary — BuildMyBot / Don Matthews
