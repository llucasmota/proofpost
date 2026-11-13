import { execFile } from 'node:child_process';

/** macOS notification; silently does nothing elsewhere or on failure. */
export function macNotify(message: string, title = 'content-builder'): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve();
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return new Promise((resolve) => {
    execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`], () => resolve());
  });
}
