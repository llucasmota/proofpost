import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** Sends console output to a file (and optionally still to the terminal). Returns `restore`. */
export function captureConsole(logFile: string, opts: { echo: boolean }): () => void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const originals = METHODS.map((m) => console[m]);
  METHODS.forEach((m, i) => {
    console[m] = (...args: unknown[]) => {
      fs.appendFileSync(logFile, `${format(...args)}\n`);
      if (opts.echo) originals[i].apply(console, args);
    };
  });
  return () => METHODS.forEach((m, i) => { console[m] = originals[i]; });
}
