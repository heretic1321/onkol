# Onkol — Decentralized On-Call Agent System

**Date:** 2026-03-22
**Status:** Design approved, ready for implementation

## Problem

A solo operator manages ~10 applications across different VMs (prod, staging, testing). Issues — bugs, features, operational problems, analysis requests — can arrive at any time. There is no team to rotate on-call duties. The operator needs a system that can handle these issues autonomously or semi-autonomously, minimizing interruption to their daily life.

## Solution

Onkol is a decentralized on-call agent system. Each VM runs an **Onkol Node** — a self-contained orchestrator that listens for tasks via Discord and spawns Claude Code worker sessions to handle them. Workers connect to Discord in their own channels, allowing direct human-agent conversation. When work is complete, workers dissolve, leaving behind learnings that make the orchestrator smarter over time.

## Core Principles

1. **Decentralized** — Each VM is self-contained. No central server. If one node goes down, the other 9 still work.
2. **Stateless orchestrator** — All important state lives in files, never only in conversation history. Kill and restart anytime with zero data loss.
3. **Intent-driven** — The system reads your natural language to determine how autonomously to act. "Fix this" vs "look into this" vs "just ship it" drive different behaviors.
4. **Knowledge accumulation** — Every resolved task leaves behind a learning. The system gets smarter by the day.
5. **Outbound-only connections** — VMs connect outbound to Discord's API. No inbound ports, no SSH tunnels, works behind any firewall or VPN.

## Architecture

### System Topology

```
Discord Server
├── Category: loyalty-voicebot (VM 1)
│   ├── #orchestrator              ← Orchestrator CC session
│   ├── #fix-auth                  ← Worker CC session (temporary)
│   └── #analyze-logs              ← Worker CC session (temporary)
├── Category: payment-gateway (VM 2)
│   ├── #orchestrator              ← Orchestrator CC session
│   └── #add-retry-logic           ← Worker CC session (temporary)
└── Category: crm-backend (VM 3)
    └── #orchestrator              ← Orchestrator CC session
```

Each VM runs:
- One persistent orchestrator Claude Code session (in tmux, managed by systemd)
- Zero or more ephemeral worker Claude Code sessions (in tmux windows, managed by orchestrator)
- One shared Discord bot token across all sessions on that VM
- The custom `discord-filtered` MCP channel plugin for routing (all sessions use this plugin — orchestrator and workers alike, each configured with their own channel ID)

> **Implementation note:** The official Discord plugin may already support per-channel filtering via its `access.json` groups and `DISCORD_STATE_DIR` for multi-instance state separation. During implementation, investigate this first. If sufficient, replace `discord-filtered` with configured instances of the official plugin, eliminating ~200-400 lines of custom code. If insufficient (e.g., pairing flow too interactive for automated worker spawning), proceed with the custom plugin.

> **Channels research preview note:** Custom channel plugins require the `--dangerously-load-development-channels` flag during the research preview. The setup wizard and spawn scripts must handle this flag. When Channels graduates from research preview, this flag will no longer be needed.

### Component Overview

| Component | Purpose | Size |
|---|---|---|
| `npx onkol setup` | Interactive setup wizard, one-time per VM | ~400 lines TS |
| `discord-filtered` plugin | Custom MCP channel server, routes by channel ID | ~300-400 lines TS |
| `spawn-worker.sh` | Creates Discord channel, worker dir, starts CC session | ~120-150 lines bash |
| `dissolve-worker.sh` | Captures learnings, kills session, cleans up | ~80 lines bash |
| `list-workers.sh` / `check-worker.sh` | Status utilities | ~50 lines bash |
| `healthcheck.sh` | Cron-based worker health monitor | ~30 lines bash |
| Orchestrator CLAUDE.md | Instructions for the orchestrator | ~100 lines markdown |
| Worker CLAUDE.md template | Generated per-task by orchestrator | ~50 lines markdown |
| Knowledge base | Files + index.json | Data, not code |

**Total custom code: ~1200 lines.** (If official Discord plugin's channel filtering works, subtract ~300-400 lines.)

## Directory Structure

Each Onkol Node lives at `/home/{user}/onkol/` (configurable during setup):

```
/home/{user}/onkol/
├── config.json              # Node identity, Discord bot token, server ID, category ID
├── registry.json            # VM-specific secrets, endpoints, ports, repo links
├── services.md              # What runs on this VM, how to access logs, deploy commands
├── CLAUDE.md                # Orchestrator's system instructions
├── state.md                 # Pending decisions (written before compaction/restart)
├── knowledge/               # Accumulated learnings from dissolved workers
│   ├── index.json           # Searchable index of all learnings
│   ├── 2026-03-22-fix-auth-clock-skew.md
│   └── 2026-03-20-log-analysis.md
├── workers/
│   ├── tracking.json        # Active workers: name, session ID, channel ID, status
│   └── {worker-name}/       # Per-worker directory (created on spawn)
│       ├── .mcp.json        # Worker's discord-filtered channel config
│       ├── CLAUDE.md        # Worker's instructions (generated by orchestrator)
│       ├── task.md          # The task brief
│       ├── context.md       # Relevant registry, services, knowledge excerpts
│       ├── status.json      # Worker's self-reported progress
│       ├── learnings.md     # What this worker learned (written before dissolution)
│       └── bash-log.txt     # All bash commands executed (audit trail)
│   └── .archive/            # Dissolved worker directories (timestamped: {date}-{name}/)
├── scripts/
│   ├── spawn-worker.sh
│   ├── dissolve-worker.sh
│   ├── list-workers.sh
│   ├── check-worker.sh
│   └── healthcheck.sh      # Cron-based worker health monitor
├── plugins/
│   └── discord-filtered/
│       ├── index.ts         # Custom MCP channel plugin
│       └── package.json
└── .claude/
    └── settings.json        # Hooks: PreCompact, PostToolUse logging
```

## Component Specifications

### 1. Setup Wizard (`npx onkol setup`)

Interactive CLI that runs once per VM during initial setup.

**Questions asked:**

1. **Install location** — Where Onkol should live. Default: `/home/{user}/onkol/`
2. **Node name** — Display name for Discord (e.g., "loyalty-voicebot")
3. **Discord bot token** — Shared bot token for this node
4. **Discord server ID** — Which Discord server to use
5. **Registry file** — Import or create interactively. Contains:
   - GCS bucket links, S3 paths
   - VPC service endpoints and ports
   - GitHub/GitLab repo URLs
   - Database connection strings
   - API keys and secrets
   - Any other per-VM variables
6. **Service summary** — Import, type manually, or auto-discover:
   - Auto-discover runs: `docker ps`, `pm2 list`, `systemctl list-units`, `ss -tlnp`
   - Captures running services, ports, container names
   - User confirms and edits the result
7. **Claude Code plugins** — Which plugins workers should have (context7, superpowers, code-simplifier, etc.)
8. **Claude Code auth** — Verify claude.ai OAuth is active on this VM

**Actions performed:**

1. Creates directory structure
2. Writes config.json, registry.json, services.md
3. Generates orchestrator CLAUDE.md from templates
4. Installs discord-filtered plugin dependencies (`bun install`)
5. Creates Discord category and #orchestrator channel via Discord API
6. Installs systemd service for auto-restart
7. Starts orchestrator in tmux session
8. Orchestrator sends first message in Discord confirming it's online

### 2. Custom Discord-Filtered Channel Plugin

A custom MCP channel server that follows the Claude Code Channels protocol but filters messages by Discord channel ID. This enables multiple Claude Code sessions to share one Discord bot while each only hears messages from its assigned channel.

**Protocol compliance:**
- Declares `experimental: { 'claude/channel': {} }` capability
- Emits `notifications/claude/channel` events
- Exposes `reply` and `reply_with_file` tools via MCP tool handlers
- Follows sender allowlist security model

**Configuration (via environment variables):**

| Variable | Purpose |
|---|---|
| `DISCORD_BOT_TOKEN` | Shared bot token |
| `DISCORD_CHANNEL_ID` | The specific channel this instance listens to |
| `DISCORD_ALLOWED_USERS` | JSON array of allowed Discord user IDs |

**Core behavior:**

```
Discord message arrives
  → Is it from MY_CHANNEL_ID? No → ignore
  → Is it from an allowed user? No → ignore
  → Emit notifications/claude/channel to Claude Code session

Claude calls reply tool
  → Send message to MY_CHANNEL_ID only

Claude calls reply_with_file tool
  → Send message + file attachment to MY_CHANNEL_ID
```

**Message batching:** Buffer outgoing messages for 3 seconds to avoid Discord rate limits (5 messages/second/channel). Combine multiple rapid replies into one message.

**Gateway connections:** Each plugin instance creates its own Discord gateway connection. With ~30 max concurrent connections (10 VMs, ~3 workers each), this is well within Discord's limits.

> **Discord IDENTIFY rate limit:** Each new gateway connection requires an IDENTIFY call. Discord allows ~1000 IDENTIFY calls per 24 hours per bot. Normal operation (~50-100 worker spawns/day across all VMs) is well within this. However, crash loops or rapid respawning could burn through the budget. If the IDENTIFY limit is hit, Discord terminates ALL active sessions. Mitigation: spawn scripts should implement backoff on connection failures, and the orchestrator should cap worker spawn rate.
>
> **Future optimization:** A single gateway connection per VM that routes to multiple sessions (via local IPC) would reduce gateway connections from N-per-VM to 1-per-VM. Deferred to V2.

### 3. Orchestrator Claude Code Session

A persistent Claude Code session running in tmux, connected to Discord via the `discord-filtered` channel plugin (configured with the #orchestrator channel ID), listening in the #orchestrator channel of its category.

**What it does:**
- Receives task descriptions from the user via Discord
- Understands intent from natural language
- Prepares context for workers (registry excerpts, relevant knowledge, service info)
- Spawns workers by running bash scripts
- Monitors worker health
- Handles worker dissolution and knowledge capture
- Gets smarter over time from accumulated learnings

**What it does NOT do:**
- Write code
- Directly fix bugs
- Access project codebases
- Make code changes

**Intent detection:**

The orchestrator reads intent from how the user phrases their message:

| Phrasing | Detected intent | Worker behavior |
|---|---|---|
| "fix the 403 bug in auth" | fix (autonomous) | Diagnose, fix, test, commit to branch, report |
| "look into why response times are high" | investigate (report only) | Analyze, gather data, report findings, no code changes |
| "add a retry mechanism to the webhook handler" | build (semi-autonomous) | Implement, test, create branch, show diff, wait for approval |
| "just ship it" | override (fully autonomous) | Do everything including push and deploy |
| "analyze all transferred calls for 3 weeks" | analyze (read-only) | Read logs/data, produce analysis, no changes |

**Adaptive communication rules:**

- Quick tasks (< 5 minutes): Just report results
- Medium tasks (5-15 minutes): Report at start and finish
- Long tasks (15+ minutes): Milestone updates every 10 minutes
- If stuck: Ask immediately, block until human responds

**Health checks (two mechanisms):**

*Reactive (on every message):* Every time the orchestrator receives a message, it also checks:
1. Read `tracking.json` for active workers
2. Check if each worker's tmux window still exists
3. If a worker died, report it and ask what to do

*Proactive (cron-based):* A cron job runs `healthcheck.sh` every 5 minutes:
1. Checks tmux windows against `tracking.json`
2. If discrepancy found, sends a message to the orchestrator's Discord channel via `curl` + bot token
3. This triggers the orchestrator's reactive detection logic
4. Ensures dead workers are detected even when no one is messaging

**Startup routine (after restart/fresh session):**

1. Read config.json, registry.json, services.md
2. Read workers/tracking.json for active workers
3. For each tracked worker, verify tmux window exists. If not, clean up orphaned Discord channels via Discord API and mark worker as dead in tracking.json.
4. Read knowledge/index.json for available learnings
5. Read state.md for any pending decisions from before restart
6. Post in #orchestrator: "{name} is online. {N} active workers. {M} workers lost during downtime."

### 4. Worker Claude Code Sessions

Ephemeral Claude Code sessions spawned by the orchestrator to handle specific tasks. Each worker runs in its own tmux window, in the relevant project directory, with its own discord-filtered channel connection.

**Spawning (what spawn-worker.sh does):**

1. Accept parameters: `--name`, `--dir` (working directory), `--task` (task description)
2. Create Discord text channel in the node's category via Discord API (`curl` + bot token)
3. Create worker directory at `/onkol/workers/{name}/`
4. Write `.mcp.json` with discord-filtered plugin config (channel ID from step 2)
5. Write `CLAUDE.md` with:
   - Task intent and behavior rules
   - Allowed tools based on intent
   - Project-specific dos and don'ts
   - How to report progress
   - Instructions to write learnings before dissolution
6. Write `task.md` with the full task brief
7. Write `context.md` with relevant excerpts from registry, services, knowledge
8. Start Claude Code in tmux as an interactive session with channels and an initial prompt:
   ```
   tmux new-window -t onkol -n "{name}" \
     "cd {dir} && claude \
       --dangerously-load-development-channels server:discord-filtered \
       --mcp-config /home/{user}/onkol/workers/{name}/.mcp.json \
       --allowedTools 'Bash,Read,Edit,Write,Glob,Grep' \
       'Read /home/{user}/onkol/workers/{name}/task.md and context.md, then begin work.'"
   ```
   > **Note:** The `-p` (print/headless) flag is NOT used here. `-p` runs non-interactively and exits after one prompt, which is incompatible with `--channels` (which requires a persistent session to receive Discord messages). Instead, the initial prompt is passed as a positional argument to the interactive session.
   > **Note:** `--dangerously-load-development-channels` is required during the Channels research preview for custom plugins. This flag may prompt for confirmation — the spawn script should handle this (e.g., via `yes |` pipe or by pre-accepting in Claude Code settings).
9. Update tracking.json with worker info

**Worker permissions by intent:**

| Intent | `--allowedTools` | CLAUDE.md soft restriction |
|---|---|---|
| fix | Bash, Read, Edit, Write, Glob, Grep | None |
| investigate | Bash, Read, Glob, Grep | "Do NOT modify files. Only read, search, and run read-only commands." |
| build | Bash, Read, Edit, Write, Glob, Grep | None |
| analyze | Bash, Read, Glob, Grep | "Do NOT modify files. Only read, search, and run read-only commands." |
| override | Bash, Read, Edit, Write, Glob, Grep | "Full autonomy including push and deploy." Requires confirmation: "About to deploy. Confirm?" |

> **Enforcement model:** Claude Code's `--allowedTools` flag controls which tools are available (hard enforcement). For investigate/analyze intents, Edit and Write are excluded entirely. Within Bash, "read-only" is enforced via CLAUDE.md instructions (soft enforcement). For additional safety, a `PreToolUse` hook can inspect bash commands and block write operations (e.g., `rm`, `mv`, `git push`) for restricted intents.

**Worker self-reporting:**

Workers update their `status.json` periodically:
```json
{
  "status": "running tests after applying fix",
  "updated": "2026-03-22T14:35:00Z",
  "files_changed": ["auth.py"],
  "branch": "fix/auth-403-skew"
}
```

**Dissolution (what dissolve-worker.sh does):**

1. Ensure worker has written `learnings.md` (check file exists and is non-empty)
2. Copy `learnings.md` to `/onkol/knowledge/{date}-{name}.md`
3. Update `knowledge/index.json` with new entry (tags, summary, project path)
4. Kill the worker's tmux window
5. Delete the Discord channel via Discord API
6. Move worker directory to `/onkol/workers/.archive/{date}-{name}/` (timestamped to avoid collisions if same task name is reused)
7. Remove worker from tracking.json

### 5. Knowledge Base

File-based knowledge store that accumulates learnings from every dissolved worker.

**Learning file format:**

```markdown
---
date: 2026-03-22
task: fix-auth
worker: fix-auth
project: /opt/loyalty-bot
tags: [auth, token, clock-skew, 403]
---

## What happened
[Description of the issue]

## Root cause
[What caused it]

## Fix
[What was done]

## For next time
[Advice for future similar issues]
```

**Index file (`index.json`):**

```json
[
  {
    "file": "2026-03-22-fix-auth-clock-skew.md",
    "date": "2026-03-22",
    "tags": ["auth", "token", "clock-skew", "403"],
    "project": "/opt/loyalty-bot",
    "summary": "403 after token refresh caused by clock skew, fixed with tolerance constant"
  }
]
```

**Search strategy (tiered):**

| Knowledge base size | Search method |
|---|---|
| < 100 entries | Orchestrator reads full index.json, semantically picks relevant entries |
| 100-500 entries | Tag/keyword matching via grep across knowledge files |
| 500-1000 entries | Lightweight embedded vector search (ChromaDB or SQLite + embeddings) |
| 1000+ entries | Proper RAG pipeline |

The knowledge format is designed to be RAG-ready from day one. Upgrading the search layer requires no changes to the data.

**Registry evolution:** If a worker discovers new endpoints, services, or config values not in the registry, the orchestrator can append them to registry.json. The registry is a living document.

### 6. Context Window Management

The orchestrator runs continuously. Without management, its context window degrades over time.

**Strategy: stateless by design.**

All important state lives in files:

| Information | Source |
|---|---|
| Node identity | config.json |
| VM environment | registry.json + services.md |
| Accumulated knowledge | knowledge/index.json |
| Active workers | workers/tracking.json |
| Pending decisions | state.md |

Conversation history is ephemeral. Losing it costs nothing.

**Mechanisms:**

1. **PreCompact hook** — Before Claude Code compacts context, a hook prompts the orchestrator to write any in-flight state to files (state.md, tracking.json).

2. **Session rotation** — Daily (configurable) cron job restarts the orchestrator session. Fresh context, reads state from files, fully operational within one message.

3. **Startup routine** — CLAUDE.md instructs the orchestrator to read all state files on first message after restart.

### 7. Error Handling

**Worker crashes:**

Orchestrator detects orphaned workers by checking tmux windows against tracking.json. Reports in #orchestrator with options: respawn, dissolve, or investigate.

**Orchestrator crashes:**

Systemd restarts it via a wrapper script. Active workers continue independently (separate tmux windows, separate Discord connections).

```ini
# /etc/systemd/system/onkol-{name}.service
[Unit]
Description=Onkol Node: {name}
After=network.target

[Service]
Type=forking
User={user}
ExecStart=/home/{user}/onkol/scripts/start-orchestrator.sh
ExecStop=/usr/bin/tmux kill-session -t onkol-{name}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# start-orchestrator.sh
#!/bin/bash
# Creates tmux session if not exists, starts orchestrator
tmux has-session -t onkol-{name} 2>/dev/null || \
  tmux new-session -d -s onkol-{name} \
    "cd /home/{user}/onkol && claude \
      --dangerously-load-development-channels server:discord-filtered \
      --mcp-config /home/{user}/onkol/.mcp.json"
```

**Discord rate limits:**

The discord-filtered plugin buffers outgoing messages for 3 seconds, combining rapid sequential replies into one message.

**Permission prompts:**

Workers are spawned with pre-approved tool lists based on intent. This prevents permission prompts from blocking the session.

**VM goes offline:**

On recovery, systemd restarts orchestrator. It detects interrupted workers from tracking.json, reports status, asks whether to respawn or dissolve.

**Dangerous commands:**

PostToolUse hook logs all bash commands to `bash-log.txt` per worker. Workers inherit project-specific restrictions via CLAUDE.md (e.g., "do NOT touch production.yml").

## Prerequisites

Each VM needs:
- **Bun runtime** — Required for the discord-filtered channel plugin
- **Claude Code** — Authenticated via claude.ai OAuth (not API key)
- **tmux** — For persistent session management
- **curl** — For Discord API calls in bash scripts
- **systemd** — For orchestrator auto-restart (or equivalent init system)
- **Node.js 18+** — For the setup wizard (`npx onkol setup`)

## Security Considerations

1. **Sender allowlist** — Only configured Discord user IDs can send messages to any session. All others are silently dropped.
2. **No inbound ports** — All connections are outbound to Discord's API. Works behind firewalls and VPNs.
3. **Bot token storage** — Stored in config.json with filesystem permissions (600). Never committed to git.
4. **Worker isolation** — Each worker runs in its own directory with its own config. Workers cannot access other workers' state.
5. **Audit trail** — All bash commands logged per worker. Knowledge base preserves what was done and why.
6. **Registry secrets** — registry.json contains sensitive data. File permissions must be restricted. Workers receive only relevant excerpts via context.md, not the full registry.

## Claude Code Usage Management

With 10 VMs each running an orchestrator plus workers under a single claude.ai subscription, usage limits are a real concern.

**Assumed subscription:** Claude Max ($100/month or $200/month) which provides higher usage caps.

**Expected concurrent sessions:** 10 orchestrators (mostly idle, listening for messages) + 0-5 active workers at any time. Peak during incidents could be 10+ active workers simultaneously.

**Rate limit handling:**
- Orchestrators are low-usage — they mostly dispatch, not code. Each orchestrator interaction is a few messages.
- Workers are high-usage — they read files, write code, run tests. A complex task could use significant context.
- If a worker hits rate limits, it should report "Rate limited, pausing for X minutes" in its Discord channel rather than silently failing.
- The orchestrator should avoid spawning more than 3-5 concurrent workers. If the limit is reached, queue tasks and notify the user: "Worker limit reached. Task queued, will start when a slot opens."

**Worker concurrency limit:** Configurable in `config.json` (default: 3 per node). The orchestrator checks `tracking.json` before spawning. If at capacity, it queues the task and notifies the user.

## Disk Usage Management

Workers produce `bash-log.txt` files, knowledge files accumulate, and archived worker directories persist.

**Cleanup strategy:**
- `.archive/` directories: Auto-delete after 30 days (configurable). A cron job handles this.
- `bash-log.txt`: Rotated per worker, deleted with archive cleanup.
- Knowledge base: Retained indefinitely (this is the system's memory — don't delete).
- Orchestrator session transcripts: Managed by Claude Code's own `cleanupPeriodDays` setting.

## Future Enhancements (Not in Scope for V1)

1. **Vector DB for knowledge search** — When knowledge base exceeds ~200 entries
2. **Web dashboard** — Aggregated view of all nodes across all VMs
3. **Swap to official Channels** — When Discord plugin supports channel-level routing natively
4. **Slack support** — When Channels adds Slack integration
5. **Cross-node awareness** — Nodes sharing knowledge across VMs
6. **Auto-discovery of new projects** — Orchestrator detects new repos/services on the VM
7. **Cost tracking** — Track Claude Code usage per worker/task
