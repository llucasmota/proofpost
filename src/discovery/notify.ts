import { execFile } from 'node:child_process';

/** macOS notification; silently does nothing elsewhere or on failure. */
export const NOTIFY_TITLE = 'Proofpost';

export function macNotify(message: string, title = NOTIFY_TITLE): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve();
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return new Promise((resolve) => {
    execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`], () => resolve());
  });
}
