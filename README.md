<div align="center">

```
  ██╗  ██╗ ██████╗ ██████╗  █████╗ 
  ██║ ██╔╝██╔═══██╗██╔══██╗██╔══██╗
  █████╔╝ ██║   ██║██║  ██║███████║
  ██╔═██╗ ██║   ██║██║  ██║██╔══██║
  ██║  ██╗╚██████╔╝██████╔╝██║  ██║
  ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝
```

### AI Coding Agent for the Terminal

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)

**~3,000 lines of TypeScript** · **91KB production bundle** · **Zero runtime bloat**

Reads, writes, edits, searches, and runs code with any OpenAI-compatible API.

[Install](#install) · [Features](#features) · [Commands](#commands) · [Configuration](#configuration) · [Architecture](#architecture)

</div>

---

## Why Koda?

Most AI coding tools are heavy Electron apps or bloated Node servers. Koda is a single 91KB file that does everything you need — no frameworks, no Electron, no 500MB of node_modules at runtime.

- **Lightweight** — 91KB bundled binary. Starts instantly. Uses ~90MB RAM.
- **Streaming** — Tokens stream in real-time. Thinking tags are parsed and styled separately.
- **Diff Preview** — Every file write shows a full color diff before executing.
- **Ctrl+C to stop** — Interrupt the agent mid-run, mid-tool, mid-stream.
- **Works with any LLM** — OpenAI, Anthropic, Groq, Ollama, LM Studio, any OpenAI-compatible API.
- **MCP Support** — Connect external tool servers via Model Context Protocol.
- **Undo** — Revert any file change with `/undo`. Full undo stack.
- **Conversations** — Persistent SQLite storage. Switch, fork, resume, export.
- **Context Management** — Auto-compaction, token counting, overflow recovery.
- **Profiles** — Switch between work/personal/local model profiles instantly.
- **Parallel Tools** — Multiple tool calls execute concurrently.
- **Sandboxed** — File operations are restricted to your project directory.

---

## Install

One command — clones, builds, and puts `koda` in your PATH:

```bash
curl -fsSL https://raw.githubusercontent.com/Rohit-Yadav-47/koda/main/install.sh | bash
```

Then just run:

```bash
koda
```

### Update

Re-run the same curl command. It detects an existing install and pulls the latest.

### Manual Install

```bash
git clone https://github.com/Rohit-Yadav-47/koda.git && cd koda
npm install
npm run build
npm link
koda
```

### Uninstall

```bash
rm -rf ~/.koda-app ~/.koda /usr/local/bin/koda
```

---

## First Run

Koda launches an interactive setup wizard on first run. Pick from 8 providers:

| Provider | API URL | Models |
|----------|---------|--------|
| OpenAI | `api.openai.com/v1` | gpt-4o, gpt-4o-mini |
| Anthropic | `api.anthropic.com/v1` | claude-sonnet-4-20250514 |
| Groq | `api.groq.com/openai/v1` | llama-3.3-70b |
| Together AI | `api.together.xyz/v1` | meta-llama/Llama-3 |
| OpenRouter | `openrouter.ai/api/v1` | (200+ models) |
| Ollama | `localhost:11434/v1` | (local models) |
| LM Studio | `localhost:1234/v1` | (local models) |
| Custom | (any URL) | (any model) |

Or set manually:

```
/config set api_key sk-your-key-here
/config set api_base_url https://api.openai.com/v1
/config set model gpt-4o
```

---

## Features

### Natural Language Coding

Just type what you want:

```
you ❯ read the package.json and explain this project
you ❯ find all TODO comments in the codebase
you ❯ add error handling to the login function
you ❯ run the tests and fix any failures
you ❯ refactor the auth module to use JWT
you ❯ create a REST API endpoint for user profiles
you ❯ review my staged changes for security issues
```

### Streaming with Thinking Support

Responses stream token-by-token. When models use `<thinking>` tags (like DeepSeek), they're:

- **Stripped during streaming** — no raw tags shown
- **Rendered separately** — displayed as dimmed thinking blocks after the response

An animated spinner shows status at every stage: `calling model...` → `thinking...` → streaming response.

### Diff Preview

Every file write and edit shows a full color diff before executing:

```
  src/auth.ts
  ────────────────────────────────────────
  12 │ - const token = null;
  12 │ + const token = generateJWT(user);
  13 │ + if (!token) throw new AuthError('Token generation failed');
```

### Context Window Management

- **Token estimation** with model-specific limits (gpt-4o: 128k, claude: 200k, gemini: 1M, etc.)
- **Auto-compaction** — old messages are compressed to fit the context window
- **Overflow recovery** — if the API returns a context error, aggressively compacts and retries
- **`/tokens`** — shows a visual bar chart of context usage

### Ctrl+C Interrupt

Press **Ctrl+C** at any time to:
- Abort the API stream mid-response
- Stop tool execution mid-run
- Return to the prompt cleanly

### Undo Stack

Every `write_file` and `edit_file` is tracked. Revert with:

```
you ❯ /undo
  ↩ Reverted edit_file on src/auth.ts
```

### Parallel Tool Execution

When the model calls multiple tools in one response, they execute in parallel. Single tools get individual spinners, multiple tools run concurrently.

### MCP (Model Context Protocol)

Connect external tool servers for extended capabilities:

```
/mcp add filesystem npx @anthropic/mcp-server-filesystem /path
/mcp add github npx @anthropic/mcp-server-github
/mcp list
/mcp restart
```

MCP tools are auto-discovered, auto-converted to OpenAI format, and executed alongside built-in tools.

### Profiles

Switch between configurations instantly:

```
/profile work        → saves current API key + URL + model
/profile local       → saves another config
/profile work        → switches back to work config
/profiles            → lists all saved profiles
```

### Live Command Picker

Type `/` and get a fuzzy-filtered command list with arrow-key navigation and tab completion.

### Multi-line Input

Use `"""` delimiters for multi-line prompts:

```
you ❯ """
create a function that:
1. validates email
2. checks DNS records
3. returns true/false
"""
```

### Piped Input

```bash
echo "explain this code" | koda
cat error.log | koda "what went wrong?"
git diff | koda "review these changes"
```

---

## Tools

| Tool | Auto | Description |
|------|:----:|-------------|
| `read_file` | ✓ | Read files with line numbers, offset, and limit |
| `write_file` | diff | Create or overwrite files (full diff preview) |
| `edit_file` | diff | Find and replace exact strings (full diff preview) |
| `run_terminal` | diff | Execute shell commands with timeout |
| `search_code` | ✓ | Regex search across project files |
| `glob_files` | ✓ | Find files by glob pattern |
| `git_ops` | diff | Git status, diff, log, add, commit, branch, checkout |

All file operations are **sandboxed** to the project directory. Accessing files outside throws a clear error with a hint to use `/project <path>`.

---

## Commands

### Chat

| Command | Alias | Description |
|---------|-------|-------------|
| `/new [title]` | `/n` | Start a new conversation |
| `/history` | `/ls` | List recent conversations |
| `/switch <id>` | `/s` | Resume a conversation |
| `/delete <id>` | `/d` | Delete a conversation |
| `/clear` | | Clear current conversation messages |
| `/messages` | `/m` | Show message history |
| `/compact` | | Manually compress old messages |
| `/tokens` | | Show context window usage (bar chart) |
| `/retry` | `/r` | Resend last message |
| `/fork` | | Branch into a new conversation |

### Context

| Command | Description |
|---------|-------------|
| `/inject <file>` | Inject file content into next message only |
| `/add <file>` | Pin file into every message (persistent) |
| `/context` | Show currently pinned files |
| `/drop <file\|all>` | Unpin a file or all files |

### Quick Actions

| Command | Alias | Description |
|---------|-------|-------------|
| `/commit` | | Auto-generate commit from git diff |
| `/review` | | Review staged changes for bugs/security |
| `/test [cmd]` | | Run tests, auto-fix failures (3 attempts) |
| `/diff` | | Show `git diff` |
| `/status` | | Show `git status` |
| `/run <cmd>` | `/!` | Run shell command directly |
| `/copy` | | Copy last response to clipboard |
| `/export [file]` | | Export conversation to markdown |
| `/undo` | | Revert last file change |

### Scheduling

| Command | Description |
|---------|-------------|
| `/future <min> <msg>` | Send message after N minutes |
| `/loop <min> <msg>` | Repeat message every N minutes |
| `/loops` | List active loops and pending timers |
| `/stop <id\|all>` | Stop a loop/timer |

### Modes

| Command | Description |
|---------|-------------|
| `/ask` | Toggle read-only mode (no writes) |
| `/plan <task>` | Plan step-by-step without executing |

### Settings

| Command | Alias | Description |
|---------|-------|-------------|
| `/config set <k> <v>` | `/c` | Set a config value |
| `/config show` | | Show all config values |
| `/model <name>` | | Switch model |
| `/project [path]` | `/p` | Show or change project directory |
| `/profile <name>` | | Save or switch profile |
| `/profiles` | | List saved profiles |
| `/setup` | | Re-run setup wizard |
| `/help` | `/h` | Show help |
| `/quit` | `/q` | Exit |

### MCP

| Command | Description |
|---------|-------------|
| `/mcp add <name> <cmd> [args]` | Add and connect MCP server |
| `/mcp remove <name>` | Remove MCP server |
| `/mcp list` | Show connected servers and tools |
| `/mcp restart [name]` | Reconnect server(s) |

---

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `api_key` | *(required)* | OpenAI-compatible API key |
| `api_base_url` | `https://api.openai.com/v1` | API endpoint URL |
| `model` | `gpt-4o` | Model name |
| `max_iterations` | `25` | Max agent tool-calling loops |
| `system_prompt` | *(built-in)* | Custom system prompt |
| `context_limit` | *(auto)* | Override context window token limit |

Set with `/config set <key> <value>`.

---

## Architecture

```
koda (~3,000 LOC)
├── src/
│   ├── cli/         1,107 lines — readline, commands, input, scheduling
│   ├── core/          911 lines — agent loop, context, diff, setup
│   │   ├── agent.ts    340 lines — streaming agent with tool execution
│   │   ├── context.ts  229 lines — token estimation, compaction, overflow
│   │   ├── diff.ts     247 lines — color diff generation
│   │   └── setup.ts     95 lines — interactive setup wizard
│   ├── tools/         291 lines — 7 built-in tools with sandbox + undo
│   ├── ui/            348 lines — markdown, colors, spinners, picker
│   ├── mcp/           221 lines — MCP client, tool discovery, execution
│   ├── db/            111 lines — SQLite with WAL, prepared statements
│   └── index.ts         2 lines — entry point
├── dist/
│   └── index.js      91KB — production bundle (tsup)
├── install.sh        one-line installer
└── tests/            968 lines — unit tests
```

### Data Storage

| Path | Description |
|------|-------------|
| `~/.koda/koda.db` | SQLite database (conversations, messages, config) |
| `~/.koda/mcp.json` | MCP server configurations |
| `~/.koda-app/` | Application source (if installed via curl) |

### Performance

- **Startup**: <500ms (no compilation step in production)
- **RAM**: ~90MB idle
- **Bundle**: 91KB single file
- **Dependencies**: 12 runtime packages
- **Native modules**: 1 (`better-sqlite3`)

### Database

SQLite with optimized settings:
- **WAL mode** — concurrent reads during writes
- `synchronous = NORMAL` — fast fsync
- `mmap_size = 256MB` — memory-mapped I/O
- `cache_size = 64MB` — large page cache
- **Prepared statements** — all queries pre-compiled and reused

---

## Comparison

| | Koda | Claude Code | Aider | Continue |
|---|---|---|---|---|
| **Size** | 91KB | ~200MB | ~50MB | Electron |
| **Runtime** | Node.js | Node.js | Python | Electron |
| **Any LLM** | ✓ | Anthropic only | ✓ | ✓ |
| **Streaming** | ✓ | ✓ | ✓ | ✓ |
| **Diff Preview** | ✓ | ✓ | ✓ | ✓ |
| **MCP** | ✓ | ✗ | ✗ | ✓ |
| **Local Models** | ✓ | ✗ | ✓ | ✓ |
| **Undo** | ✓ | ✓ | ✓ | ✗ |
| **Profiles** | ✓ | ✗ | ✗ | ✗ |
| **Installer** | curl | npm | pip | Desktop |

---

## License

MIT

<div align="center">
<br>
Made with ♥ by <a href="https://github.com/Rohit-Yadav-47">Rohit Yadav</a>
</div>
