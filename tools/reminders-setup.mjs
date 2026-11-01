#!/usr/bin/env node
// Laptop only, after `npx wrangler login`. Makes the push keys once (kept in the private folder you
// name, mode 600) and sets the reminders worker's secrets. Prints the public push key only, never a
// secret or anything wrangler says. The public key then goes in src/reminders.js.
//
//   node tools/reminders-setup.mjs --out <private folder> --sub https://<the app's address>
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));

export async function makeVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { jwk, publicKey: Buffer.from(raw).toString('base64url') };
}

function secret(name, value) {
  return new Promise((ok, fail) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], { cwd: WORKER, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`Could not set ${name}.`))));
    child.stdin.end(value);
  });
}

async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!opt.out || !opt.sub) throw new Error('Usage: node tools/reminders-setup.mjs --out <private folder> --sub https://<the app\'s address>');
  const out = resolve(opt.out);
  await mkdir(out, { recursive: true, mode: 0o700 });

  const vapidFile = join(out, 'vapid.json');
  if (!existsSync(vapidFile)) {
    await writeFile(vapidFile, JSON.stringify(await makeVapid()));
    await chmod(vapidFile, 0o600);
  }
  const { jwk, publicKey } = JSON.parse(await readFile(vapidFile, 'utf8'));

  await secret('VAPID_PUBLIC', publicKey);
  await secret('VAPID_PRIVATE_JWK', JSON.stringify(jwk));
  await secret('VAPID_SUB', opt.sub);
  console.log('Secrets set.');
  console.log(`Public push key: ${publicKey}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
}
