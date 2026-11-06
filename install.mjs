// Installs Herdr 7 into a Herdr app home: node extensions/win7/install.mjs [home] [--update]
// --update replaces an installed copy (the old one is kept in <home>/win7-backup-<time>/).
// The mod's files are copied before its main.js, so a running Herdr reloads a complete build.
import { existsSync, mkdirSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const update = args.includes('--update');
const home = resolve(args.find((a) => !a.startsWith('--')) || process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app'));
const targets = ['mods/win7', 'layouts/win7.json', 'themes/win7.json'];
const present = targets.filter((t) => existsSync(join(home, t)));

if (present.length && !update) {
  throw new Error(`Refusing to overwrite ${present.map((t) => join(home, t)).join(', ')}. Run with --update to replace it (the old copy is backed up).`);
}
if (present.length) {
  const backup = join(home, `win7-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (const t of present) {
    mkdirSync(dirname(join(backup, t)), { recursive: true });
    cpSync(join(home, t), join(backup, t), { recursive: true });
  }
  console.log(`Backed up the installed copy to ${backup}`);
}

// The mod: assets and modules first, main.js last. Files Herdr writes itself stay out.
const mod = join(source, 'mods', 'win7');
const dest = join(home, 'mods', 'win7');
mkdirSync(dest, { recursive: true });
const skip = new Set(['main.js', 'gpui-kit.d.ts', 'jsconfig.json']);
for (const name of readdirSync(mod)) {
  if (!skip.has(name)) cpSync(join(mod, name), join(dest, name), { recursive: true });
}
// Art from the earlier build that this one no longer uses (hidden files aren't reloaded).
for (const old of ['start.svg', 'terminal.svg', 'settings.svg']) {
  if (existsSync(join(dest, old))) renameSync(join(dest, old), join(dest, `.${old}.old`));
}
cpSync(join(mod, 'main.js'), join(dest, 'main.js'));
for (const t of ['themes/win7.json', 'layouts/win7.json']) {
  mkdirSync(dirname(join(home, t)), { recursive: true });
  cpSync(join(source, t), join(home, t));
}
console.log(`Installed Herdr 7 in ${home}\nSwitch with: herdr-app do layout.switch --name win7`);
