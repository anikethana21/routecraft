/**
 * Copies the production web build into the MCP package so `npm publish mcp`
 * ships a ready-to-run browser app. Run after `npm run build`.
 */
import { cp, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const sourceDist = resolve(root, 'dist');
const targetDist = resolve(root, 'mcp', 'dist');
const sourceSkill = resolve(root, '.claude', 'skills', 'routecraft');
const targetSkill = resolve(root, 'mcp', 'skill');

if (!existsSync(resolve(sourceDist, 'index.html'))) {
  throw new Error('dist/index.html is missing. Run npm run build before packaging the MCP server.');
}

await rm(targetDist, { recursive: true, force: true });
await cp(sourceDist, targetDist, { recursive: true });
await copyFile(resolve(root, 'LICENSE'), resolve(root, 'mcp', 'LICENSE'));
await rm(targetSkill, { recursive: true, force: true });
await cp(sourceSkill, targetSkill, { recursive: true });

if (!process.argv.includes('--quiet')) {
  console.log('Copied dist/, LICENSE and the Agent Skill into mcp/.');
  console.log('Publish with: npm publish ./mcp');
}
