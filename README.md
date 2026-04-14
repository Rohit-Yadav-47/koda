# Koda

AI coding agent for the terminal. Reads, writes, and runs code with any OpenAI-compatible API.

## Install

One line — clone, build, and `koda` is in your PATH:

```bash
curl -fsSL https://raw.githubusercontent.com/Rohit-Yadav-47/koda/main/install.sh | bash
```

Then just run:

```bash
koda
```

> **Note:** On first run, type `/config set api_key YOUR_KEY` to set your API key.

### Update

Re-run the same curl command — it pulls the latest and rebuilds.

## Setup

```
/config set api_key sk-your-key-here
```

For local models (Ollama, LM Studio):
```
/config set api_base_url http://localhost:11434/v1
/config set model llama3
```

## Dev Setup

```bash
git clone https://github.com/Rohit-Yadav-47/koda.git && cd koda
npm install
npm start        # dev with tsx
npm run build    # production bundle → dist/index.js
```

## Usage

Just type naturally:

```
you ❯ read the package.json and explain this project
you ❯ find all TODO comments in the codebase
you ❯ add error handling to the login function
you ❯ run the tests and fix any failures
you ❯ create a new API endpoint for user profiles
```

Press **Ctrl+C** to stop the agent mid-run.

## Tools

| Tool | Description |
|------|------------|
| `read_file` | Read files with line numbers |
| `write_file` | Create/overwrite files (shows diff) |
| `edit_file` | Find and replace in files (shows diff) |
| `run_terminal` | Execute shell commands |
| `search_code` | Regex search across files |
| `glob_files` | Find files by pattern |
| `git_ops` | Git status, diff, log, commit |

## Commands

| Command | Description |
|---------|------------|
| `/new` | New conversation |
| `/history` | List conversations |
| `/switch <id>` | Resume conversation |
| `/config set <k> <v>` | Set config |
| `/model <name>` | Switch model |
| `/project <path>` | Change project directory |
| `/undo` | Revert last file change |
| `/help` | All commands |
| `/quit` | Exit |

## Architecture

```
src/
├── cli/       CLI interface, readline, commands
├── core/      Agent loop, context mgmt, diff, setup
├── db/        SQLite store (better-sqlite3)
├── mcp/       MCP client for external tools
├── tools/     Built-in tool implementations
├── ui/        Terminal rendering, colors, markdown
└── index.ts   Entry point
```

## License

MIT
