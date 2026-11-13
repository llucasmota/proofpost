import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type ScheduleSlot = { weekday: number; hour: number; minute: number }; // launchd: 1 = Monday

/** Monday, Wednesday and Friday at 08:00. */
export const DEFAULT_SCHEDULE: ScheduleSlot[] = [
  { weekday: 1, hour: 8, minute: 0 },
  { weekday: 3, hour: 8, minute: 0 },
  { weekday: 5, hour: 8, minute: 0 },
];

export const LABEL = 'com.content-builder.ideas';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const str = (s: string) => `<string>${xml(s)}</string>`;

export function buildLaunchAgentPlist(o: { label: string; nodePath: string; projectDir: string; logDir: string; schedule: ScheduleSlot[] }): string {
  const args = [o.nodePath, '--env-file', path.join(o.projectDir, '.env'), '--import', 'tsx', path.join(o.projectDir, 'src/discovery/cli.ts')];
  const pathEnv = `${path.dirname(o.nodePath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  const log = path.join(o.logDir, 'ideas.log');
  const slots = o.schedule.map((s) =>
    `    <dict>\n      <key>Weekday</key><integer>${s.weekday}</integer>\n      <key>Hour</key><integer>${s.hour}</integer>\n      <key>Minute</key><integer>${s.minute}</integer>\n    </dict>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(o.label)}
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    ${str(a)}`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  ${str(o.projectDir)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    ${str(pathEnv)}
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${slots}
  </array>
  <key>StandardOutPath</key>
  ${str(log)}
  <key>StandardErrorPath</key>
  ${str(log)}
</dict>
</plist>
`;
}

const DAY = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

async function install() {
  const projectDir = process.cwd();
  const logDir = path.join(projectDir, 'ideas', 'logs');
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  const domain = `gui/${process.getuid?.() ?? 501}`;

  await fs.mkdir(logDir, { recursive: true });
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.writeFile(plistPath, buildLaunchAgentPlist({ label: LABEL, nodePath: process.execPath, projectDir, logDir, schedule: DEFAULT_SCHEDULE }));
  try { execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
  execFileSync('launchctl', ['bootstrap', domain, plistPath]);

  console.log(`✅ Pautas agendadas: ${DEFAULT_SCHEDULE.map((s) => `${DAY[s.weekday]} ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`).join(', ')}`);
  console.log(`   node: ${process.execPath}`);
  console.log(`   log:  ${path.join(logDir, 'ideas.log')}`);
  console.log(`   plist: ${plistPath}`);
  console.log('   Se trocar a versão do node no nvm, rode `npm run ideas:schedule` de novo.');
}

async function uninstall() {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  try { execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded */ }
  await fs.rm(plistPath, { force: true });
  console.log('✅ Agendamento das pautas removido.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  (cmd === 'install' ? install() : cmd === 'uninstall' ? uninstall() : Promise.reject(new Error('Use: install | uninstall')))
    .catch((e) => { console.error(`❌ ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
}
