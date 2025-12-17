# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run agent (different modes)
npm run start:agent              # Daemon mode (24/7 with scheduled notifications)
node dist/agent.js interactive   # Interactive mode (chat with agent)
node dist/agent.js once          # One-time summary

# Run MCP server standalone
npm run start:server

# Development (without build)
npm run dev:agent
npm run dev:server
```

## Environment Variables

- `OPENAI_API_KEY` - Required for agent operation
- `REMINDER_CRON` - Cron schedule for daemon notifications (default: `*/30 * * * *`)
- `TASKS_FILE` - Path to tasks JSON file (default: `data/tasks.json`)

## Architecture

This is a task reminder agent built with OpenAI API and MCP (Model Context Protocol).

**Two main components:**

1. **MCP Server** (`src/mcp-server.ts`) - Stdio-based MCP server providing task management tools. Exposes 8 tools: `get_tasks`, `get_task_summary`, `get_task_by_id`, `add_task`, `update_task_status`, `delete_task`, `get_overdue_tasks`, `get_today_tasks`.

2. **Agent** (`src/agent.ts`) - OpenAI-powered agent that connects to the MCP server via stdio. Contains:
   - `MCPClient` class - JSON-RPC client communicating with MCP server
   - `ReminderAgent` class - Orchestrates OpenAI API calls with MCP tools

**Data layer:**
- `TaskService` (`src/task-service.ts`) - File-based task storage with JSON persistence
- Tasks stored in `data/tasks.json`

**Data flow:**
```
User → Agent (Claude API) → MCPClient → MCP Server → TaskService → tasks.json
```

## TypeScript Configuration

- ES2022 target with NodeNext modules
- Source in `src/`, compiled to `dist/`
- ESM modules (`"type": "module"` in package.json)
