// Local source checks only. Does not connect to Supabase. Node 20+, no packages.
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for(const f of ['config.js',...(await readdir('js')).filter(x=>x.endsWith('.js')).map(x=>'js/'+x),'scripts/bootstrap-admin.mjs']) {
 const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);console.log('PASS syntax',f);
}
for(const f of ['index.html','dashboard.html']) {
 const text=await readFile(f,'utf8');
 for(const match of text.matchAll(/(?:src|href)="([^"#]+)"/g)){const path=match[1];if(!path.startsWith('https:'))await readFile(path);}
 console.log('PASS linked assets',f);
}
const schema=await readFile('sql/01_schema.sql','utf8'),rls=await readFile('sql/02_rls_policies.sql','utf8');
for(const t of ['profiles','customers','fabrics','processes','orders','order_issues','order_receipts','process_logs','inspections','warehouse_receipts','status_history','login_audit','change_audit']){
 assert(schema.includes('create table public.'+t));assert(rls.includes("'"+t+"'"));
}
assert((await readFile('sql/03_views_triggers.sql','utf8')).includes('security_invoker=true'));
assert(!/SERVICE_ROLE/i.test(await readFile('config.js','utf8')));
console.log('PASS required tables, RLS setup, security-invoker view, and public configuration');
