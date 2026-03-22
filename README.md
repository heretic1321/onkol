# Onkol

Your AI on-call team. One command per VM, and you get an autonomous agent on Discord that handles bugs, features, analysis, and ops — so you don't have to.

Onkol turns Claude Code into a decentralized on-call system. Each VM runs an orchestrator that listens on Discord. You describe a problem in plain English, it spins up a dedicated worker session to solve it, and reports back when it's done.

## How it works

```
You on Discord:  "the auth endpoint is returning 403 after token refresh"
                              |
                    Orchestrator (Claude Code)
                    reads your message, understands intent,
                    prepares context, spawns a worker
                              |
                    Worker (new Claude Code session)
                    diagnoses the bug, fixes auth.py,
                    runs tests, commits to a branch
                              |
You on Discord:  "Fixed. Clock skew between auth server and app server.
                  Added 5s tolerance. Tests pass. Branch: fix/auth-403"
```

**What makes it different:**
- **Decentralized** — Each VM is self-contained. No central server. 10 VMs = 10 independent agents.
- **Intent-driven** — Say "fix this" and it fixes autonomously. Say "look into this" and it investigates without touching code. Your phrasing controls the behavior.
- **Gets smarter** — Every resolved task leaves behind a learning. Next time a similar issue comes up, the agent already knows what to look for.
- **Works behind firewalls** — All connections are outbound to Discord. No inbound ports, no SSH tunnels, no VPN required.

## Quick start

### Prerequisites

You need these on the VM where you're setting up:

| Tool | Why | Install |
|------|-----|---------|
| **Node.js 18+** | Runs the setup CLI | [nodejs.org](https://nodejs.org) |
| **Bun** | Runs the Discord channel plugin | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** | The AI that does the work | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code/getting-started) |
| **tmux** | Keeps sessions alive | `apt install tmux` / `yum install tmux` |
| **jq** | JSON processing in scripts | `apt install jq` / `yum install jq` |

Claude Code must be logged in via `claude.ai` OAuth on the VM (not API key).

### Create a Discord bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. New Application → name it → Create
3. Bot → Reset Token → **copy it** (you only see it once)
4. Bot → Privileged Gateway Intents → enable **Message Content Intent** → Save
5. OAuth2 → URL Generator → check `bot` → check permissions:
   - View Channels, Send Messages, Read Message History, Attach Files, Manage Channels
6. Copy the URL → open in browser → invite to your Discord server

### Run setup

```bash
npx onkol@latest setup
```

The wizard walks you through everything:

```
Welcome to Onkol Setup

Checking dependencies...
  ✓ claude
  ✓ bun
  ✓ tmux
  ✓ jq
  ✓ curl

  All dependencies found.

✔ Where should Onkol live? ~/onkol
✔ What should this node be called? loyalty-voicebot
✔ Discord bot token: ****
✔ Discord server (guild) ID: 1234567890
✔ Your Discord user ID: 9876543210
✔ Registry file? Write a prompt — tell Claude what to find
✔ Describe: Find the GCS bucket and API endpoints from .env.local
✔ Service summary? Auto-discover
✔ CLAUDE.md? Yes — This is a LiveKit voice agent for a loyalty program...
✔ Plugins? context7, superpowers, code-simplifier

✓ Discord category and #orchestrator channel created
✓ 6 scripts installed
✓ Plugin installed with 4 files + dependencies
✓ Systemd service installed and enabled
✓ Orchestrator started in tmux session "onkol-loyalty-voicebot"

✓ Onkol node "loyalty-voicebot" is live!
```

That's it. Go to your Discord server — you'll see a new category with an `#orchestrator` channel. Send it a message.

## Usage

### Talking to the orchestrator

The orchestrator lives in the `#orchestrator` channel of your node's category. It reads your intent from how you phrase things:

| You say | What happens |
|---------|-------------|
| "fix the 403 bug in auth" | Spawns a worker that diagnoses, fixes, tests, and commits |
| "look into why response times are high" | Spawns a worker that investigates and reports — no code changes |
| "add retry logic to the webhook handler" | Spawns a worker that implements, tests, and waits for your approval |
| "analyze transferred calls for the last 3 weeks" | Spawns a worker that reads logs/data and produces an analysis |
| "just ship it" | Fully autonomous — pushes and deploys (asks for confirmation first) |

### How workers work

When the orchestrator spawns a worker:

1. A new Discord channel appears in your category (e.g., `#fix-auth-bug`)
2. A new Claude Code session starts in tmux on the VM
3. The worker posts progress and results **in its Discord channel**
4. You can talk to the worker directly in that channel
5. When done, tell the orchestrator to dissolve it — the channel disappears, learnings are saved

### Managing workers

From the orchestrator channel:
- "dissolve fix-auth-bug" — Kills the worker, saves learnings, deletes channel
- "list workers" — Shows all active workers
- "check on fix-auth-bug" — Gets the worker's current status

### Setup prompts

During setup, you can describe things in plain English instead of providing config files:

- **Registry**: "Find the API endpoints from .env.local and the GCS bucket from gcloud"
- **Services**: Auto-discovers running services, or you describe what to look for
- **CLAUDE.md**: "This is a LiveKit voice agent, Node.js, deployed via docker..."

The orchestrator executes these prompts on first boot and generates the structured files.

## Architecture

```
Your Discord Server
├── Category: loyalty-voicebot          ← VM 1
│   ├── #orchestrator                   ← persistent Claude Code session
│   ├── #fix-auth-bug                   ← worker (temporary)
│   └── #analyze-call-logs              ← worker (temporary)
├── Category: payment-gateway           ← VM 2
│   └── #orchestrator
└── Category: crm-backend               ← VM 3
    └── #orchestrator
```

Each VM runs independently:
- **Orchestrator** — Long-running Claude Code session in tmux. Receives Discord messages, spawns workers, manages lifecycle.
- **Workers** — Ephemeral Claude Code sessions. One per task. Each gets its own Discord channel, its own context, its own instructions.
- **discord-filtered plugin** — Custom MCP channel server that routes Discord messages by channel ID. All sessions share one bot but each only hears its own channel.

### On-disk structure

```
~/onkol/
├── config.json          # Node config (bot token, server ID, etc.)
├── registry.json        # VM-specific secrets, endpoints, ports
├── services.md          # What runs on this VM
├── CLAUDE.md            # Orchestrator instructions
├── knowledge/           # Learnings from dissolved workers
│   ├── index.json
│   └── 2026-03-22-fix-auth-clock-skew.md
├── workers/
│   ├── tracking.json    # Active workers
│   └── fix-auth-bug/    # Worker directory (while active)
├── scripts/             # Lifecycle scripts
└── plugins/
    └── discord-filtered/  # MCP channel plugin
```

### Knowledge base

Every dissolved worker leaves behind a learning:

```markdown
## What happened
Token validation rejected valid tokens for 2-3 seconds after refresh.

## Root cause
No clock skew tolerance between auth server and app server.

## Fix
Added 5-second CLOCK_SKEW_TOLERANCE in auth.py:47.

## For next time
If 403 errors appear after token operations, check clock sync first.
```

The orchestrator includes relevant past learnings when spawning new workers. The system gets better at diagnosing issues over time.

## Resumable setup

If setup fails midway (e.g., missing dependency, network error), your answers are saved automatically. Next time you run `npx onkol setup`, it offers to resume:

```
? Found a previous setup attempt (4 steps completed). What do you want to do?
  ❯ Resume from where it left off (node: loyalty-voicebot)
    Start fresh
```

## Commands

```bash
npx onkol setup          # Interactive setup wizard
npx onkol@latest setup   # Force latest version
```

On the VM after setup:

```bash
# Attach to the orchestrator
tmux attach -t onkol-<node-name>

# Check service status
systemctl status onkol-<node-name>

# Restart orchestrator
sudo systemctl restart onkol-<node-name>

# View active workers
bash ~/onkol/scripts/list-workers.sh

# Manually dissolve a worker
bash ~/onkol/scripts/dissolve-worker.sh --name "worker-name"
```

## Requirements

- **Claude Code** with `claude.ai` OAuth login (Max plan recommended for concurrent sessions)
- **Node.js 18+** and **Bun** on each VM
- **tmux** and **jq** on each VM
- A **Discord server** with a bot that has Manage Channels permission
- VMs must have **outbound HTTPS** access (no inbound ports needed)

## How it's built

| Component | Tech | Lines |
|-----------|------|-------|
| Setup wizard | Node.js + TypeScript + Inquirer | ~500 |
| Discord channel plugin | Bun + MCP SDK + discord.js | ~300 |
| Worker lifecycle scripts | Bash | ~400 |
| Orchestrator/worker templates | Handlebars | ~150 |

The core mechanism is [Claude Code Channels](https://code.claude.com/docs/en/channels) — an MCP-based system that pushes Discord messages into Claude Code sessions. The `discord-filtered` plugin is a custom channel that routes by Discord channel ID, allowing multiple sessions to share one bot.

## License

MIT
