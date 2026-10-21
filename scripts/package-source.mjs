import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
const files=['.gitignore','README.md','astro.config.mjs','svelte.config.js','tsconfig.json','package.json','package-lock.json','wrangler.jsonc','worker-configuration.d.ts'];
async function walk(dir){for(const f of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,f.name);if(f.isDirectory())await walk(file);else files.push(file);}}
for(const dir of ['src','public','server','scripts','tests','migrations'])await walk(dir);
const archive={};
for(const file of files)archive['little-by-little/'+file]=new Uint8Array(await readFile(file));
await writeFile('dist/little-by-little-source.zip',zipSync(archive,{level:6}));
console.log(`Packaged ${files.length} source files for the authenticated source download.`);
