export function generateSystemdUnit(nodeName: string, user: string, onkolDir: string): string {
  return `[Unit]
Description=Onkol Node: ${nodeName}
After=network.target

[Service]
Type=forking
User=${user}
ExecStart=${onkolDir}/scripts/start-orchestrator.sh
ExecStop=/usr/bin/tmux kill-session -t onkol-${nodeName}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`
}

export function generateCrontab(onkolDir: string): string {
  return `*/5 * * * * ${onkolDir}/scripts/healthcheck.sh
0 4 * * * find ${onkolDir}/workers/.archive -maxdepth 1 -mtime +30 -exec rm -rf {} \\;
`
}
