export function generateSystemdUnit(nodeName: string, user: string, onkolDir: string): string {
  // Resolve PATH additions for claude and bun at generation time
  const homeDir = process.env.HOME || `/home/${user}`
  const extraPaths = [
    `${homeDir}/.local/bin`,
    `${homeDir}/.bun/bin`,
  ].filter(p => {
    try { return require('fs').existsSync(p) } catch { return false }
  })
  const pathEnv = extraPaths.length > 0
    ? `Environment=PATH=${extraPaths.join(':')}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
    : ''

  return `[Unit]
Description=Onkol Node: ${nodeName}
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${user}
${pathEnv}
Environment=HOME=${homeDir}
ExecStart=${onkolDir}/scripts/start-orchestrator.sh
ExecStop=/usr/bin/tmux kill-session -t onkol-${nodeName}
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
`
}


export function generateCrontab(onkolDir: string): string {
  return `*/5 * * * * ${onkolDir}/scripts/healthcheck.sh
*/3 * * * * ${onkolDir}/scripts/worker-watchdog.sh
0 4 * * * find ${onkolDir}/workers/.archive -maxdepth 1 -mtime +30 -exec rm -rf {} \\;
`
}
