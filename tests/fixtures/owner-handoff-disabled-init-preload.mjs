// Fail loudly before SQLite can open a file or a remote driver can initialize.
// Registering the hook performs no external access and reads no credentials.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
function blocked(message) { process.stderr.write(message+'\n'); throw new Error(message); }
registerHooks({resolve(specifier,context,nextResolve){
  if (specifier==='node:sqlite' || specifier==='sqlite' || specifier==='@neondatabase/serverless')
    blocked('DISABLED_INIT_ATTEMPTED_DATABASE_ACCESS');
  return nextResolve(specifier,context);
}});
const dataDir=path.resolve(process.env.DATA_DIR);
function protectedPath(value) {
  if(typeof value !== 'string' && !(value instanceof URL) && !Buffer.isBuffer(value)) return false;
  const p=path.resolve(value instanceof URL ? value.pathname : String(value));
  return p===dataDir || p.startsWith(dataDir+path.sep) || path.basename(p)==='.env';
}
for(const api of [fs,fsp]) {
  for(const name of ['open','openSync','readFile','readFileSync','writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','rm','rmSync','unlink','unlinkSync','createReadStream','createWriteStream']) {
    if(typeof api[name]!=='function')continue;
    const original=api[name];
    api[name]=function(...args){
      if(protectedPath(args[0]))blocked('DISABLED_INIT_ATTEMPTED_DATA_FILE_ACCESS');
      return original.apply(this,args);
    };
  }
}
syncBuiltinESMExports();
