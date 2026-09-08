import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink())
        throw new Error('Symlinks are not release files');
      if (entry.isDirectory())
        return filesUnder(join(directory, entry.name), path + '/');
      if (!entry.isFile()) throw new Error('Unexpected file type');
      return [path];
    })
    .sort();
}
export function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
export function validReleasePath(path) {
  return (
    typeof path === 'string' &&
    /^(api\.zip|web\/[A-Za-z0-9_./-]+)$/.test(path) &&
    !path
      .split('/')
      .some((part) => part === '.' || part === '..' || part === '')
  );
}
