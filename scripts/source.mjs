import { execFileSync } from 'node:child_process';

export function gitSource() {
  const read = (...args) => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  try {
    return read('status', '--porcelain') ? null : read('rev-parse', 'HEAD');
  } catch {
    return null;
  }
}
