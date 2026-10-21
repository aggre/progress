import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const html=await readFile('dist/index.html','utf8');
const hashes=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!(/\bsrc\s*=/.test(m[1]))).map(m=>`'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`).join(' ');
await build({ entryPoints: ['server/worker.ts'], outfile: 'dist/_worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, define: {__CSP_SCRIPT_HASHES__: JSON.stringify(hashes)} });
