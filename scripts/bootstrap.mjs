// This operator-only command talks to D1 via authenticated Wrangler, never the public API.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),flags=new Set(['--remote','--local','--claim-legacy','--list']);
const values=new Set(['--challenge','--username','--family']);
/**
 * @param {string} message
 * @returns {never}
 */
function fail(message){
 // eslint-disable-next-line functional/no-expression-statements -- Report CLI failures to the operator through stderr.
 console.error(message);
 // eslint-disable-next-line functional/no-expression-statements -- Terminate the CLI process after reporting an invalid operator request.
 process.exit(1);
}
/** @typedef {Readonly<{options: Readonly<Record<string, string | boolean | undefined>>, skip: boolean}>} OptionState */
const initialOptions=/** @type {OptionState} */ ({options:{},skip:false});
const parsed=args.reduce(
 /**
  * @param {OptionState} state
  * @returns {OptionState}
  */
 (state,name,index)=>state.skip ? {options:state.options,skip:false}
  : flags.has(name)
   ? state.options[name] ? fail('Duplicate option: '+name) : {options:{...state.options,[name]:true},skip:false}
   : values.has(name)
    ? state.options[name]||!args[index+1]||args[index+1].startsWith('--')
     ? fail('Missing or duplicate value: '+name)
     : {options:{...state.options,[name]:args[index+1]},skip:true}
    : fail('Unknown option: '+name),
 initialOptions
);
/** @type {Readonly<Record<string, string | boolean | undefined>>} */
const parsedOptions=parsed.options;
if(!!parsedOptions['--remote']===!!parsedOptions['--local'])fail('Choose exactly one of --local or --remote.');
/** @param {string} value */
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const id=parsedOptions['--challenge'],rawName=parsedOptions['--username'],family=parsedOptions['--family']||'My family';
const sql=parsedOptions['--list']
 ? "SELECT id,username,verification_code,datetime(expires_at,'unixepoch') AS expires_at_utc FROM login_challenges WHERE status='pending' AND expires_at>unixepoch() ORDER BY created_at DESC LIMIT 20;"
 : typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  ? fail('Provide --challenge with the pending request ID from the login screen.')
  : typeof rawName!=='string'||!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(rawName.trim().toLowerCase())
   ? fail('Provide --username with the expected username (3–32 letters, numbers, underscores or hyphens).')
   : typeof family!=='string'||!family.trim()||family.trim().length>80
    ? fail('Use a family name between 1 and 80 characters.')
    : `INSERT INTO bootstrap_approvals (singleton,challenge_id,expected_username,family_id,user_id,family_name,claim_legacy) VALUES (1,${literal(id)},${literal(rawName.trim().toLowerCase())},${literal(randomUUID())},${literal(randomUUID())},${literal(family.trim())},${parsedOptions['--claim-legacy']?1:0});`;
// eslint-disable-next-line functional/no-expression-statements -- Create the local workspace for the temporary operator SQL file.
await mkdir(resolve(root,'work'),{recursive:true});
const temp=await mkdtemp(resolve(root,'work/bootstrap-')),file=resolve(temp,'operation.sql');
// eslint-disable-next-line functional/no-expression-statements -- Write the private SQL file consumed by the Wrangler subprocess.
await writeFile(file,sql,{mode:0o600});
// eslint-disable-next-line functional/no-try-statements -- Always remove the temporary SQL and directory after invoking Wrangler, including failures.
try{
 const command=[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--config',resolve(root,'apps/api/wrangler.jsonc'),parsedOptions['--remote']?'--remote':'--local','--file',file,...(parsedOptions['--local']?['--env','development']:[])];
 // eslint-disable-next-line functional/prefer-immutable-types -- The native subprocess result contains mutable process buffers at this CLI boundary.
 const result=spawnSync(process.execPath,command,{cwd:root,stdio:'inherit'});
 if(result.error)fail(result.error.message);
 if(result.status!==0)process.exitCode=result.status||1;
 else if(!parsedOptions['--list']){
  // eslint-disable-next-line functional/no-expression-statements -- Report the completed D1 approval to the operator through stdout.
  console.log('First-user approval completed. The original browser will finish login on its next poll.');
 }
}finally{
 // eslint-disable-next-line functional/no-expression-statements -- Remove the temporary SQL file from the local filesystem.
 await unlink(file);
 // eslint-disable-next-line functional/no-expression-statements -- Remove the temporary directory from the local filesystem.
 await rmdir(temp);
}
