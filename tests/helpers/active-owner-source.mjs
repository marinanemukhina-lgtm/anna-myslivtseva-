// Active tests use a separate source tree, never a runtime switch in release code.
// Only explicit source paths are copied. Credentials, .env files and local data
// are excluded, including when nested inside an otherwise allowed directory.
import {cp,mkdtemp,mkdir,rm,symlink,writeFile,readFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
export async function createActiveOwnerSource(t,{ui=false}={}) {
  const root=await mkdtemp(path.join(tmpdir(),'anna-active-source-'));
  if(t)t.after(()=>rm(root,{recursive:true,force:true}));
  const allowed=['server','shared','scripts','src','tests','api','worker','index.html','package.json','package-lock.json','vite.config.mjs','playwright.config.mjs'];
  if(ui)allowed.push('public','.openai');
  for(const optional of ['vite.config.js','playwright.config.js']){
    try{await access(path.join(sourceRoot,optional));allowed.push(optional);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const filter=entry=>!/(^|[/\\])(?:\.env(?:\.[^/\\]*)?|node_modules|data|\.git|dist)(?:[/\\]|$)/.test(entry);
  for(const entry of allowed)await cp(path.join(sourceRoot,entry),path.join(root,entry),{recursive:true,filter,mode:constants.COPYFILE_FICLONE});
  await mkdir(path.join(root,'shared'),{recursive:true});
  const modePath=path.join(root,'shared/owner-handoff-mode.mjs');
  const modeSource=await readFile(modePath,'utf8');
  if(!modeSource.includes("export const OWNER_HANDOFF_MODE = 'disabled';"))throw new Error('Expected the reviewed disabled source fixture');
  await writeFile(modePath,modeSource.replace("export const OWNER_HANDOFF_MODE = 'disabled';","export const OWNER_HANDOFF_MODE = 'active';"));
  await symlink(path.join(sourceRoot,'node_modules'),path.join(root,'node_modules'),'dir');
  return {root,import:relative=>import(pathToFileURL(path.join(root,relative)).href),cleanup:()=>rm(root,{recursive:true,force:true})};
}
