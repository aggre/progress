// This operator-only command talks to D1 via authenticated Wrangler, never the public API.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),flags=new Set(['--remote','--local','--claim-legacy','--list']);
const values=new Set(['--challenge','--username','--family']);
const options={};
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
for(let i=0;i<args.length;i++){
 const name=args[i];if(flags.has(name)){if(options[name])fail('Duplicate option: '+name);options[name]=true;}
 else if(values.has(name)){if(options[name]||!args[i+1]||args[i+1].startsWith('--'))fail('Missing or duplicate value: '+name);options[name]=args[++i];}
 else fail('Unknown option: '+name);
}
/** @type {Readonly<Record<string, string | boolean | undefined>>} */
const parsedOptions=options;
if(!!parsedOptions['--remote']===!!parsedOptions['--local'])fail('Choose exactly one of --local or --remote.');
/** @param {string} value */
const literal=value=>"'"+value.replaceAll("'","''")+"'";
let sql;
if(parsedOptions['--list']){
 sql="SELECT id,username,verification_code,datetime(expires_at,'unixepoch') AS expires_at_utc FROM login_challenges WHERE status='pending' AND expires_at>unixepoch() ORDER BY created_at DESC LIMIT 20;";
}else{
 const id=parsedOptions['--challenge'],rawName=parsedOptions['--username'],family=parsedOptions['--family']||'My family';
 if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))fail('Provide --challenge with the pending request ID from the login screen.');
 if(typeof rawName!=='string'||!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(rawName.trim().toLowerCase()))fail('Provide --username with the expected username (3–32 letters, numbers, underscores or hyphens).');
 if(typeof family!=='string'||!family.trim()||family.trim().length>80)fail('Use a family name between 1 and 80 characters.');
 sql=`INSERT INTO bootstrap_approvals (singleton,challenge_id,expected_username,family_id,user_id,family_name,claim_legacy) VALUES (1,${literal(id)},${literal(rawName.trim().toLowerCase())},${literal(randomUUID())},${literal(randomUUID())},${literal(family.trim())},${parsedOptions['--claim-legacy']?1:0});`;
}
await mkdir(resolve(root,'work'),{recursive:true});
const temp=await mkdtemp(resolve(root,'work/bootstrap-')),file=resolve(temp,'operation.sql');
await writeFile(file,sql,{mode:0o600});
try{
 const command=[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--config',resolve(root,'apps/api/wrangler.jsonc'),parsedOptions['--remote']?'--remote':'--local','--file',file,...(parsedOptions['--local']?['--env','development']:[])];
 const result=spawnSync(process.execPath,command,{cwd:root,stdio:'inherit'});
 if(result.error)fail(result.error.message);
 if(result.status!==0)process.exitCode=result.status||1;
 else if(!parsedOptions['--list'])console.log('First-user approval completed. The original browser will finish login on its next poll.');
}finally{await unlink(file);await rmdir(temp);}
