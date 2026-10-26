#!/usr/bin/env node
// Fails if any name from a private list appears in this repository: tracked files, their paths and
// commit messages. The list lives outside the repository (OFFSCRIPT_NAMES_FILE, by default
// ~/.off-script-names.txt): one name or phrase per line, # for comments. It is matched as whole
// words in any case. Only file and line numbers are printed, never the names. It also fails if a
// script, document or audio file is tracked, or a commit carries an email address other than a
// GitHub noreply one. Run before every push (the pre push hook does): node tools/privacy-check.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function readNames(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length >= 2);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

// One pattern for every name: whole words, any case, curly or straight apostrophes alike.
export function namePattern(names) {
  const alternatives = names.map((n) => escape(n.replace(/[’‘]/g, "'")).replace(/'/g, "['’‘]"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

// Where names appear: [{ where, line }] with line numbers from 1.
export function findNames(pattern, sources) {
  const hits = [];
  for (const { where, text } of sources) {
    text.split('\n').forEach((line, i) => {
      if (pattern.test(line)) hits.push({ where, line: i + 1 });
    });
  }
  return hits;
}

const BINARY = /\.(png|jpg|jpeg|gif|ico|zip|mp3|wav|aiff|docx|pdf|woff2?)$/i;
const RISKY = /\.(docx?|pdf|zip|mp3|m4a|wav|aiff?)$/i;

// Tracked files that could hold the script or its audio, counted by kind: { '.docx': 1 }.
export function riskyFiles(paths) {
  const counts = {};
  for (const f of paths) {
    const m = f.match(RISKY);
    if (m) counts[m[0].toLowerCase()] = (counts[m[0].toLowerCase()] || 0) + 1;
  }
  return counts;
}

// Commit emails that are not GitHub noreply addresses.
export function personalEmails(emails) {
  return [...new Set(emails.filter((e) => e && !/@users\.noreply\.github\.com$/i.test(e)))];
}

function main() {
  const file = process.env.OFFSCRIPT_NAMES_FILE || join(homedir(), '.off-script-names.txt');
  if (!existsSync(file)) {
    console.error('No names list found. Make one outside the repository (see HANDOVER) or set OFFSCRIPT_NAMES_FILE.');
    process.exit(2);
  }
  const names = readNames(readFileSync(file, 'utf8'));
  if (!names.length) {
    console.error('The names list is empty.');
    process.exit(2);
  }
  const pattern = namePattern(names);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  const sources = [{ where: 'file names', text: tracked.join('\n') }];
  for (const f of tracked) {
    if (BINARY.test(f) || !existsSync(f)) continue;
    sources.push({ where: f, text: readFileSync(f, 'utf8') });
  }
  let log = '';
  let emails = [];
  try {
    log = git('log', '--format=%H%n%an%n%cn%n%B');
    emails = git('log', '--format=%ae%n%ce').split('\n');
  } catch {
    // no commits yet
  }
  sources.push({ where: 'commit messages', text: log });
  const hits = findNames(pattern, sources);
  for (const hit of hits) console.log(`${hit.where}:${hit.line}`);
  const risky = Object.entries(riskyFiles(tracked));
  const personal = personalEmails(emails);
  const problems = [];
  if (hits.length) problems.push(`a listed name appears in ${hits.length} place${hits.length === 1 ? '' : 's'} (above). Remove them.`);
  if (risky.length) problems.push(`files that could hold the script or its audio are tracked (${risky.map(([ext, n]) => `${n} ${ext}`).join(', ')}). Untrack them with git rm --cached and add them to .gitignore.`);
  if (personal.length) problems.push(`${personal.length} email address${personal.length === 1 ? ' is' : 'es are'} on commits. Use your GitHub noreply address for user.email and rewrite those commits.`);
  if (problems.length) {
    for (const p of problems) console.error(`Privacy check failed: ${p}`);
    process.exit(1);
  }
  console.log(`Privacy check passed: ${tracked.length} tracked files, their names and the commit messages hold none of the ${names.length} listed names.`);
}

if (process.argv[1] && process.argv[1].endsWith('privacy-check.mjs')) main();
