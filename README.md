# Onkol

Your AI on-call team. One command per VM, and you get an autonomous agent on Discord that handles bugs, features, analysis, and ops so you don't have to.

Onkol turns Codex or Claude Code into a decentralized on-call system. Each VM runs one persistent orchestrator bot that listens on Discord. You describe a problem in plain English; it creates a temporary channel, summons a dedicated worker session, and dissolves it after the task is complete.

## How it works

```
You on Discord:  "the auth endpoint is returning 403 after token refresh"
                              |
                    Orchestrator (Codex or Claude Code)
                    reads your message, understands intent,
                    prepares context, spawns a worker
                              |
                    Worker (new agent session)
                    diagnoses the bug, fixes auth.py,
                    runs tests, commits to a branch
                              |
You on Discord:  "Fixed. Clock skew between auth server and app server.
                  Added 5s tolerance. Tests pass. Branch: fix/auth-403"
```

**What makes it different:**
- **Decentralized.** Each VM is self-contained. No central server. 10 VMs = 10 independent agents.
- **Intent-driven.** Say "fix this" and it fixes autonomously. Say "look into this" and it investigates without touching code. Your phrasing controls the behavior.
- **Gets smarter.** Every resolved task leaves behind a learning. Next time a similar issue comes up, the agent already knows what to look for.
- **Works behind firewalls.** All connections are outbound to Discord. No inbound ports, no SSH tunnels, no VPN required.

## Real-world setup

The intended way to use Onkol is with a **dedicated Discord server** that becomes your ops control center.

I manage about 10 applications across prod and staging. I created one Discord server and set it up exclusively for Onkol. Each VM I onboard creates its own category with an orchestrator channel. My Discord sidebar looks like this:

```
MY-INFRA (Discord server)
│
├── API-SERVER-PROD                ← VM running in GCP
│   ├── #orchestrator              ← talk to this VM's brain here
│   ├── #fix-auth-403              ← active worker (auto-created)
│   └── #analyze-error-logs        ← active worker (auto-created)
│
├── WEB-APP-STAGING                ← VM running in AWS
│   └── #orchestrator
│
├── BACKEND-PROD                   ← VM behind corporate VPN
│   ├── #orchestrator
│   └── #add-export-endpoint       ← active worker
│
├── DATA-PIPELINE-STAGING          ← Another GCP VM
│   └── #orchestrator
│
└── ... (as many VMs as you have)
```

### The workflow

From your phone, laptop, or anywhere with Discord:

1. Open the server, go to `#orchestrator` under the VM you care about
2. Type what you need: "there's a bug where users get 403 after token refresh"
3. The orchestrator creates a new channel `#fix-auth-403` and spawns a worker
4. The worker posts its progress and findings in `#fix-auth-403`
5. You can jump into that channel to give more context or redirect
6. When it's done, the orchestrator dissolves the worker, the channel disappears, learnings are saved

You can do this from a party, a flight, or bed at 2 AM. You're just texting on Discord. The agent does the SSH, the debugging, the code reading, the fixing.

### Multiple VMs, one view

Every VM is a category. Every task is a channel. You see your entire infrastructure at a glance in the Discord sidebar. No dashboards to build, no web apps to deploy. Discord IS the dashboard.

The VMs don't need to know about each other. Each one connects outbound to Discord independently. If a VM is behind a VPN you can only reach from one specific laptop, doesn't matter. As long as it has outbound HTTPS, it can connect to Discord and you can talk to it.

### Setting up a new VM

```bash
# SSH into the VM (one time only)
ssh user@my-new-vm

# Run setup (2 minutes)
npx onkol@latest setup

# Answer the questions, done.
# A new category appears in your Discord server.
# You never need to SSH into this VM again.
```

## Quick start

### Prerequisites

You need these on the VM where you're setting up:

| Tool | Why | Install |
|------|-----|---------|
| **Node.js 18+** | Runs the setup CLI | [nodejs.org](https://nodejs.org) |
| **Codex or Claude Code** | The AI runtime that does the work | Log in to the selected runtime on this VM |
| **Bun** | Runs the Claude Discord channel plugin (Claude nodes only) | `curl -fsSL https://bun.sh/install \| bash` |
| **tmux** | Keeps sessions alive | `apt install tmux` / `yum install tmux` |
| **jq** | JSON processing in scripts | `apt install jq` / `yum install jq` |

Codex nodes reuse the login in the selected `CODEX_HOME` (normally `~/.codex`). Claude nodes retain the original Claude OAuth behavior.

The setup wizard checks all dependencies before asking any questions. If something's missing, it tells you exactly what to install and exits without wasting your time.

### Create a Discord bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. New Application, name it, Create
3. Bot, Reset Token, **copy it** (you only see it once)
4. Bot, Privileged Gateway Intents, enable **Message Content Intent**, Save
5. OAuth2, URL Generator, check `bot`, check permissions:
   - View Channels, Send Messages, Read Message History, Attach Files, Manage Channels, **Pin Messages**
6. Copy the URL, open in browser, invite to your Discord server

The setup wizard validates your bot token and checks that Message Content Intent is enabled before proceeding. The bot also needs **Pin Messages** in the orchestrator category and worker channels: Codex keeps one pinned session-status card per channel and edits it in place. If pinning is unavailable, the bridge remains online and keeps the card editable but unpinned.

### Run setup

```bash
npx onkol@latest setup
```

The wizard walks you through everything:

```
Welcome to Onkol Setup

Checking dependencies...
  ✓ codex
  ✓ tmux
  ✓ jq
  ✓ curl

  All dependencies found.

✔ Where should Onkol live? ~/onkol
✔ Which agent runtime? Codex
✔ What should this node be called? api-server-prod
✔ Discord bot token: ****
✔ Discord server (guild) ID: 1234567890
✔ Your Discord user ID: 9876543210
✔ Registry file? Write a prompt — tell the agent what to find
✔ Describe: Find the API endpoints and database URLs from .env
✔ Service summary? Auto-discover
✔ AGENTS.md? Yes — This is a Node.js API server deployed via docker...
✔ Auto-compact Codex sessions at: 80%

✓ Bot token is valid
✓ Message Content intent is enabled
✓ Discord category and #orchestrator channel created
✓ 6 scripts installed
✓ Codex Discord runtime installed
✓ Systemd service installed and enabled
✓ Orchestrator started in tmux session "onkol-api-server-prod"

✓ Onkol node "api-server-prod" is live!
```

Go to your Discord server. You'll see a new category with an `#orchestrator` channel. Send it a message.

### Codex behavior

- You create one Discord application/bot for each VM, not one bot per project or task.
- The VM bot owns one category. Its orchestrator automatically creates a channel and Codex worker for each task, then removes that worker when it is dissolved.
- Each orchestrator and worker channel has one Codex session-status card. When the bot has **Pin Messages**, the card is pinned; otherwise it remains editable but unpinned. It is updated in place with the current model, main-thread context usage, configured auto-compaction threshold, active subagents and requested models, and weekly quota when Codex exposes it. Unavailable metrics are shown as unavailable rather than estimated.
- The bridge waits for Discord login before the automatic startup turn, so new workers show typing while that turn is running. Typing refreshes until `turn/completed` and then stops. Restarting a bridge reuses the existing pinned card instead of posting another message.
- Idle sessions compact automatically at the configured threshold. `/compact`, `/clear`, `/pause`, `/unpause`, and `/restart` remain available in the scoped channel.
- Codex setup and update fetch the latest complete `mattpocock/skills` collection through `skills@latest`, install it globally for Codex, and verify `setup-matt-pocock-skills` is present. Set `codex.syncMattPocockSkills` to `false` to opt out.

### Codex status-card runbook

After setup or an update, verify the session-status card in both `#orchestrator` and a newly spawned worker channel:

1. During the automatic first turn, Discord shows typing; it stops after `turn/completed`.
2. The channel has exactly one status card, pinned when the bot has **Pin Messages**. As the session runs, the same message is edited rather than replaced.
3. The card reports the effective model, main-agent context usage, auto-compaction percentage, active subagents with their requested models, and weekly quota when Codex provides that data. Metrics that Codex does not expose are labeled unavailable.
4. Restart the bridge or its service and confirm the existing pinned card is reused.

If the card cannot be pinned, re-check that the bot has **Pin Messages** as well as **Manage Channels** in the category and its channels.

To migrate an existing source checkout after building this branch, first dissolve active workers, then run:

```bash
npm run build
node dist/cli/index.js update --dir ~/onkol --runtime codex
```

The update backs up `config.json`, preserves registry, knowledge, services, Discord IDs, and worker state, and updates future Codex deployments in place. It refuses a provider switch while workers are active so their channels cannot be silently lost.

## Usage

### Talking to the orchestrator

The orchestrator lives in the `#orchestrator` channel of your node's category. It reads your intent from how you phrase things:

| You say | What happens |
|---------|-------------|
| "fix the 403 bug in auth" | Spawns a worker that diagnoses, fixes, tests, and commits |
| "look into why response times are high" | Spawns a worker that investigates and reports, no code changes |
| "add retry logic to the webhook handler" | Spawns a worker that implements, tests, and waits for your approval |
| "analyze transferred calls for the last 3 weeks" | Spawns a worker that reads logs/data and produces an analysis |
| "just ship it" | Fully autonomous, pushes and deploys (asks for confirmation first) |

### How workers work

When the orchestrator spawns a worker:

1. A new Discord channel appears in your category (e.g., `#fix-auth-bug`)
2. A new Claude Code session starts in tmux on the VM
3. The worker posts progress and results in its Discord channel
4. You can talk to the worker directly in that channel
5. When done, tell the orchestrator to dissolve it. The channel disappears, learnings are saved.

### Managing workers

From the orchestrator channel:
- "dissolve fix-auth-bug" kills the worker, saves learnings, deletes channel
- "list workers" shows all active workers
- "check on fix-auth-bug" gets the worker's current status

### Setup prompts

During setup, you can describe things in plain English instead of providing config files:

- **Registry**: "Find the API endpoints from .env and the S3 bucket from AWS CLI"
- **Services**: Auto-discovers running services, or you describe what to look for
- **CLAUDE.md**: "This is a Node.js API server, Express, deployed via docker..."

The orchestrator executes these prompts on first boot and generates the structured files.

## Architecture

```
Your Discord Server
├── Category: api-server-prod           ← VM 1
│   ├── #orchestrator                   ← persistent Codex or Claude session
│   ├── #fix-auth-bug                   ← worker (temporary)
│   └── #analyze-error-logs             ← worker (temporary)
├── Category: web-app-staging           ← VM 2
│   └── #orchestrator
└── Category: backend-prod              ← VM 3
    └── #orchestrator
```

Each VM runs independently:
- **Orchestrator.** Long-running selected agent runtime in tmux. Receives Discord messages, spawns workers, and manages lifecycle.
- **Workers.** Ephemeral agent sessions. One per task. Each gets its own Discord channel, context, and instructions.
- **Scoped Discord bridge.** Routes messages by channel ID. All sessions on a VM share one bot account, while each session only hears its own channel.

### On-disk structure

```
~/onkol/
├── config.json          # Node config (bot token, server ID, etc.)
├── registry.json        # VM-specific secrets, endpoints, ports
├── services.md          # What runs on this VM
├── CLAUDE.md            # Orchestrator instructions
├── AGENTS.md             # Codex orchestrator instructions
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

If setup fails midway (missing dependency, network error, wrong bot token), your answers are saved automatically. Next time you run `npx onkol setup`, it offers to resume:

```
? Found a previous setup attempt (4 steps completed). What do you want to do?
  ❯ Resume from where it left off (node: api-server-prod)
    Start fresh
```

No re-entering bot tokens or server IDs. It picks up right where it left off.

## Commands

```bash
npx onkol setup          # Interactive setup wizard
npx onkol@latest setup   # Force latest version
onkol update --dir ~/onkol --runtime codex  # Migrate an idle Claude node
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

- A logged-in Codex account or Claude Code OAuth session
- Node.js 18+ and Bun on each VM
- tmux and jq on each VM
- A Discord server with a bot that has Manage Channels and **Pin Messages** permissions
- VMs need outbound HTTPS access (no inbound ports needed)

## How it's built

| Component | Tech | Lines |
|-----------|------|-------|
| Setup wizard | Node.js, TypeScript, Inquirer | ~500 |
| Discord channel plugin | Bun, MCP SDK, discord.js | ~300 |
| Worker lifecycle scripts | Bash | ~400 |
| Orchestrator/worker templates | Handlebars | ~150 |

Claude nodes use Claude Code Channels. Codex nodes use the bundled Codex app-server bridge plus a channel-scoped Discord MCP server. Both implementations route by Discord channel ID, allowing multiple sessions on one VM to share a bot safely.

## License

MIT
