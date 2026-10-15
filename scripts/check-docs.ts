// Fails when the docs describe something that doesn't exist: a CLI command or
// option, a widget option in an options table, a script tag `data-*` attribute or a
// `<field-notes>` attribute, or a file a relative link points at. Commands and options come
// from the CLI's own OPTIONS table, so the docs and the CLI can't disagree.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { OPTIONS } from '../packages/cli/src/index.ts';

const root = resolve(import.meta.dirname, '..');
const GITHUB = 'https://github.com/deanbot/field-notes/blob/main/';
const GLOBAL = ['--help', '--version', '-h', '-v'];

/** Every markdown file that documents the project. */
function docFiles(): string[] {
  const files = ['README.md', 'CONTRIBUTING.md', 'PLAN.md', 'spec/SPEC.md'];
  for (const entry of readdirSync(join(root, 'docs'), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(root, join(entry.parentPath, entry.name)));
    }
  }
  for (const example of readdirSync(join(root, 'examples'))) {
    if (existsSync(join(root, 'examples', example, 'README.md'))) {
      files.push(`examples/${example}/README.md`);
    }
  }
  for (const name of readdirSync(join(root, '.changeset'))) {
    if (name.endsWith('.md') && name !== 'README.md') files.push(`.changeset/${name}`);
  }
  return files;
}

/** The code in a markdown file: each line of a fenced block, and each inline span. */
function codeOf(text: string): string[] {
  const code: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) code.push(line);
    else for (const [, , span = ''] of line.matchAll(/(`+)(.+?)\1/g)) code.push(span);
  }
  return code;
}

// `field-notes <command>`, run directly or through npx or pnpm, but not
// `field-notes-<date>.zip`, `field-notes/vite` or `--field-notes-accent`.
const COMMAND =
  /(?:^|[\s$(`'"])(?:npx\s+(?:@deanbot\/)?|pnpm\s+(?:exec\s+)?)?field-notes\s+([a-z][a-z-]*)(.*)$/;

/** The CLI command and options on a line of code, if it runs one. */
function commandOn(line: string): { command: string; options: string[] } | undefined {
  const match = COMMAND.exec(line);
  if (!match) return undefined;
  // A pipe or a comment ends the command; `a|b` inside brackets doesn't.
  const rest = (match[2] ?? '').split(/\s\|\s|\s#\s|\s#$|;|&&/)[0] ?? '';
  const options = [...rest.matchAll(/(?:^|[\s[(])(--?[a-z][a-z-]*)/g)].map((m) => m[1] ?? '');
  return { command: match[1] ?? '', options };
}

/** Keys of an exported interface in a source file. */
function interfaceKeys(file: string, name: string): string[] {
  const source = readFileSync(join(root, file), 'utf8');
  const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1];
  if (!body) throw new Error(`no interface ${name} in ${file}`);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1] ?? '');
}

/** The attributes a declared `<field-notes>` reads; the script tag reads each as `data-*`. */
function elementAttributes(): string[] {
  const source = readFileSync(join(root, 'packages/widget/src/attributes.ts'), 'utf8');
  return [...new Set([...source.matchAll(/\bread\('([a-z-]+)'\)/g)].map((m) => m[1] ?? ''))];
}

/** Option names in the first column of tables headed `option`. */
function tableOptions(text: string): string[] {
  const names: string[] = [];
  let inTable = false;
  for (const line of text.split('\n')) {
    if (/^\|\s*option\s*\|/i.test(line)) inTable = true;
    else if (!line.startsWith('|')) inTable = false;
    else if (inTable) {
      const cell = line.split('|')[1] ?? '';
      for (const [, name = ''] of cell.matchAll(/`(\w+)`/g)) names.push(name);
    }
  }
  return names;
}

const problems: string[] = [];
const counts = { files: 0, commands: 0, tableOptions: 0, attributes: 0, links: 0 };
const widgetOptions = interfaceKeys('packages/widget/src/mount.ts', 'FieldNotesOptions');
const elementNames = elementAttributes();
const attributes = elementNames.map((name) => `data-${name}`);
if (widgetOptions.length < 10 || attributes.length < 5) {
  throw new Error('found too few widget options or script tag attributes: the parsing broke');
}

for (const file of docFiles()) {
  const text = readFileSync(join(root, file), 'utf8');
  counts.files++;
  const where = (what: string): void => {
    problems.push(`${file}: ${what}`);
  };

  for (const line of codeOf(text)) {
    const found = commandOn(line);
    if (found) {
      counts.commands++;
      const allowed = OPTIONS[found.command];
      if (!allowed) where(`\`field-notes ${found.command}\` isn't a command`);
      else {
        for (const option of found.options) {
          if (!GLOBAL.includes(option) && !allowed.includes(option.replace(/^--/, ''))) {
            where(`\`field-notes ${found.command}\` doesn't take ${option}`);
          }
        }
      }
    }
    if (line.includes('<script')) {
      for (const [attribute = ''] of line.matchAll(/\bdata-[a-z-]+(?==)/g)) {
        counts.attributes++;
        if (!attributes.includes(attribute)) where(`the script tag doesn't read ${attribute}`);
      }
    }
    for (const [, tag = ''] of line.matchAll(/<field-notes\b([^>]*)>/g)) {
      for (const [, attribute = ''] of tag.matchAll(/\b([a-z-]+)=/g)) {
        counts.attributes++;
        if (!elementNames.includes(attribute)) where(`<field-notes> doesn't read ${attribute}`);
      }
    }
  }

  // PLAN describes the design, including options it settled differently.
  if (file !== 'PLAN.md') {
    for (const name of tableOptions(text)) {
      counts.tableOptions++;
      if (!widgetOptions.includes(name)) where(`\`${name}\` isn't a widget option`);
    }
  }

  for (const [, target = ''] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    let path: string;
    if (target.startsWith(GITHUB)) path = join(root, target.slice(GITHUB.length));
    else if (/^[a-z]+:|^#/.test(target)) continue;
    else path = join(root, dirname(file), target);
    counts.links++;
    if (!existsSync(path.replace(/#.*$/, ''))) where(`the link to ${target} goes nowhere`);
  }
}

if (counts.commands === 0) problems.push('no CLI commands found in the docs: the parsing broke');
for (const problem of problems) console.error(`  ✗ ${problem}`);
const summary = Object.entries(counts)
  .map(([name, n]) => `${String(n)} ${name}`)
  .join(', ');
console.log(`check-docs: ${problems.length ? 'FAILED' : 'ok'} (${summary})`);
if (problems.length) process.exitCode = 1;
