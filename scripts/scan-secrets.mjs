import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const listed = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
if (listed.status !== 0) {
  console.error(listed.stderr || 'Unable to list tracked files.');
  process.exit(1);
}

const files = listed.stdout.split('\0').filter(Boolean);
const findings = [];
const forbiddenNames = [
  /^\.env$/i,
  /^\.env\.(?!example$)[^.]+$/i,
  /^\.dev\.vars$/i,
  /firebase-adminsdk.*\.json$/i,
];
const forbiddenExtensions = new Set(['.key', '.p12', '.pfx', '.pem']);
const tokenRules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['Google service account private key', /"type"\s*:\s*"service_account"[\s\S]{0,4000}"private_key"\s*:/g],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['OpenAI-style secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['Stripe live secret', /\bsk_live_[A-Za-z0-9]{20,}\b/g],
  ['Mercado Pago live token', /\bAPP_USR-[A-Za-z0-9-]{20,}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];
const placeholder = /(?:example|sample|placeholder|replace|change[-_ ]?me|your[-_ ]|demo|dummy|fake|test|with-at-least|<[^>]+>|\$\{)/i;
const dotenvSecret = /^\s*([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/gm;

for (const file of files) {
  if (!existsSync(file)) continue;
  const name = basename(file);
  if (forbiddenNames.some((pattern) => pattern.test(name)) || forbiddenExtensions.has(extname(name).toLowerCase())) {
    findings.push(`${file}: sensitive filename must not be tracked`);
    continue;
  }

  const size = statSync(file).size;
  if (size > 5 * 1024 * 1024) continue;
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');

  for (const [label, pattern] of tokenRules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const lineEnd = text.indexOf('\n', match.index);
      const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (!line.includes('secret-scan: allow')) findings.push(`${file}: possible ${label}`);
    }
  }

  dotenvSecret.lastIndex = 0;
  for (const match of text.matchAll(dotenvSecret)) {
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (value && value.length >= 12 && !placeholder.test(value)) {
      findings.push(`${file}: non-placeholder value assigned to ${match[1]}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed: ${files.length} tracked files checked.`);
