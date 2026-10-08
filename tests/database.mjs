import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite({extensions:{pgcrypto}});let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(),encrypted_password text not null,raw_app_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
for(const f of ['01_schema.sql','02_rls_policies.sql','03_views_triggers.sql']){await db.exec(await readFile('sql/'+f,'utf8'));console.log('Applied',f);}
const query=async(sql,params=[])=> (await db.query(sql,params)).rows;
const test=(label)=>{passed++;console.log('PASS',label);};
const ids={};for(const role of ['admin','marketing','production_head','production','inspection','warehouse','viewer']){
 const [u]=await query(`insert into auth.users(encrypted_password,raw_app_meta_data) values(extensions.crypt('Temporary123!',extensions.gen_salt('bf')), $1::jsonb) returning id`,[JSON.stringify({plant_provisioned:true,username:role,full_name:role,role,temporary_nonce:crypto.randomUUID()})]);ids[role]=u.id;
}
await db.exec(await readFile('sql/04_seed.sql','utf8'));test('seed samples');
async function as(role){await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[role?ids[role]:'']);await db.exec(`set role ${role?'authenticated':'anon'}`);}
async function owner(){await db.exec('reset role');await query("select set_config('request.jwt.claim.sub','',false)");}
async function denied(sql,params=[]){try{await query(sql,params);throw new Error('UNEXPECTED ALLOW: '+sql);}catch(e){if(e.message.startsWith('UNEXPECTED'))throw e;return;}}
await as('viewer');assert.equal((await query('select * from public.orders')).length,0);test('temporary password cannot read orders');
await denied('select public.complete_password_change(null)');test('null password cannot bypass forced change');
await denied('select public.complete_password_change($1)',['Temporary123!']);test('cannot clear forced password flag without a distinct password');
await owner();for(const id of Object.values(ids))await query("update auth.users set encrypted_password=extensions.crypt('NewPassword123!',extensions.gen_salt('bf')) where id=$1",[id]);
for(const role of Object.keys(ids)){await as(role);await query('select public.complete_password_change($1)',['NewPassword123!']);}
test('all roles can complete verified password change');
await as('viewer');assert.equal((await query('select * from public.order_dashboard')).length,3);await denied("insert into public.customers(name) values('Forbidden')");await denied("update public.profiles set role='admin' where id=auth.uid()");test('viewer reads security-invoker view but cannot write or promote');
assert.equal((await query("select * from public.change_audit where table_name='profiles'")).length,0);test('non-admin cannot see profile audit records');
await as('marketing');const [c]=await query("select id from public.customers limit 1"),[f]=await query('select id from public.fabrics limit 1');
const [o]=await query(`insert into public.orders(po_number,customer_id,fabric_id,shade,grade,quantity) values('TEST-001',$1,$2,'Blue','A',1000) returning *`,[c.id,f.id]);
await query("update public.orders set quantity=1100 where id=$1",[o.id]);test('marketing creates and edits own draft without optional fields');
await query("select public.set_order_status($1,'Confirmed','Customer approved','Draft')",[o.id]);
assert.equal((await query("update public.orders set quantity=1200 where id=$1 returning id",[o.id])).length,0);test('marketing cannot edit confirmed order');
await as('production');await denied('insert into public.order_issues(order_id,meters) values($1,100)',[o.id]);test('production blocked before acknowledgement');
await as('production_head');await query("select public.set_order_status($1,'Acknowledged','Accepted','Confirmed')",[o.id]);
const [acked]=await query('select * from public.orders where id=$1',[o.id]);assert.equal(acked.acknowledged_by,ids.production_head);assert.ok(acked.acknowledged_at);test('head acknowledgement records actor and time');
await denied("update public.orders set quantity=2000 where id=$1",[o.id]);test('head cannot alter marketing order fields');
await as('production');await query('insert into public.order_issues(order_id,meters,lot_batch_number) values($1,600,\'LOT-1\'),($1,500,\'LOT-2\')',[o.id]);
await query('insert into public.order_receipts(order_id,meters) values($1,1000)',[o.id]);
const [proc]=await query("select id from public.processes where name='Dyeing'");
const [pass]=await query('insert into public.process_logs(order_id,process_id,meters_in) values($1,$2,1000) returning *',[o.id,proc.id]);
await query('insert into public.process_logs(order_id,process_id,meters_in) values($1,$2,990)',[o.id,proc.id]);test('any process repeated without sequence requirements');
await query('update public.process_logs set date_out=now(),meters_out=980 where id=$1',[pass.id]);await query('delete from public.process_logs where id=$1',[pass.id]);
assert.equal((await query("select * from public.change_audit where record_id=$1 and action in ('UPDATE','DELETE')",[pass.id])).length,2);test('process edits and deletions retain full audit');
await denied('insert into public.inspections(order_id,lot_number,meters_inspected,meters_passed,meters_rejected,final_grade) values($1,\'X\',1000,980,20,\'A\')',[o.id]);test('production cannot create inspections');
await query("select public.set_order_status($1,'In Inspection','Ready','Acknowledged')",[o.id]);
await query("select public.set_order_status($1,'In Production','Re-dye needed','In Inspection')",[o.id]);
await denied("select public.set_order_status($1,'In Inspection','','In Production')",[o.id]);test('backward move allowed with reason; empty reason denied');
await as('inspection');await query('insert into public.inspections(order_id,lot_number,meters_inspected,meters_passed,meters_rejected,final_grade) values($1,\'LOT-1\',1000,980,20,\'A\')',[o.id]);
await denied('insert into public.inspections(order_id,lot_number,meters_inspected,meters_passed,meters_rejected,final_grade) values($1,\'LOT-X\',1000,990,20,\'A\')',[o.id]);
await denied('insert into public.order_receipts(order_id,meters) values($1,200)',[o.id]);test('inspection skips process stages, validates sums, cannot enter production');
await as('warehouse');await query('insert into public.warehouse_receipts(order_id,meters,location) values($1,950,\'Rack A\'),($1,30,\'Rack B\')',[o.id]);
await denied('insert into public.order_receipts(order_id,meters) values($1,200)',[o.id]);
const [dash]=await query('select * from public.order_dashboard where id=$1',[o.id]);
assert.equal(Number(dash.issued),1100);assert.equal(Number(dash.received),1000);assert.equal(Number(dash.passed),980);assert.equal(Number(dash.rejected),20);assert.equal(Number(dash.in_warehouse),980);assert.equal(Number(dash.balance),120);test('dashboard aggregates do not multiply rows');
await query("select public.set_order_status($1,'Completed','Delivery complete','In Production')",[o.id]);
await denied('insert into public.warehouse_receipts(order_id,meters,location) values($1,1,\'Rack C\')',[o.id]);test('warehouse can complete with skips; closed orders block operational entries');
await as('admin');await query("select public.set_order_status($1,'In Production','Reopen for correction','Completed')",[o.id]);
await denied("select public.set_order_status($1,'Completed','Stale update','Completed')",[o.id]);test('admin can reopen; stale status update denied');
await denied("update public.status_history set reason='Tampered' where order_id=$1",[o.id]);test('status history append-only even for admin browser');
await as('production');await denied("insert into public.order_issues(order_id,meters) values($1,'NaN')",[o.id]);test('NaN meters rejected');
await denied('insert into public.order_issues(order_id,meters) values($1,0)',[o.id]);test('zero meters rejected at database boundary');
await denied("insert into public.process_logs(order_id,process_id,date_in,date_out,meters_in,meters_out) values($1,$2,now(),now()-interval '1 hour',1,1)",[o.id,proc.id]);test('process date-out before date-in rejected');
await as('marketing');const [second]=await query(`insert into public.orders(po_number,customer_id,fabric_id,shade,grade,quantity) values('OWNERSHIP-TEST',$1,$2,'Green','A',100) returning id`,[c.id,f.id]);
await owner();await query("update public.profiles set role='marketing' where id=$1",[ids.viewer]);
await as('viewer');assert.equal((await query('update public.orders set quantity=101 where id=$1 returning id',[second.id])).length,0);test('another marketing user cannot edit a draft they do not own');
await owner();await query("update public.profiles set role='viewer' where id=$1",[ids.viewer]);
await owner();await query("select public.admin_profile_action($1,$2,null,false)",[ids.admin,ids.production]);
await as('production');assert.equal((await query('select * from public.orders')).length,0);await denied('insert into public.order_receipts(order_id,meters) values($1,1)',[o.id]);test('deactivation immediately blocks existing JWT identity');
await owner();await query("select public.admin_profile_action($1,$2,'viewer',null)",[ids.admin,ids.marketing]);
await as('marketing');assert.equal((await query('select public.get_my_role() role'))[0].role,'viewer');test('role changes take effect with old session');
await owner();await query("update auth.users set encrypted_password=extensions.crypt('ResetTemp123!',extensions.gen_salt('bf')),raw_app_meta_data=raw_app_meta_data||jsonb_build_object('temporary_nonce','reset-1') where id=$1",[ids.viewer]);
await as('viewer');assert.equal((await query('select * from public.order_dashboard')).length,0);test('admin reset atomically locks data access');
await owner();await query("update auth.users set encrypted_password=extensions.crypt('ResetTemp123!',extensions.gen_salt('bf')) where id=$1",[ids.viewer]);
await as('viewer');await denied('select public.complete_password_change($1)',['ResetTemp123!']);test('rehashing same temporary password cannot bypass forced change');
await owner();await query("update auth.users set encrypted_password=extensions.crypt('DistinctNew123!',extensions.gen_salt('bf')) where id=$1",[ids.viewer]);
await as('viewer');await query('select public.complete_password_change($1)',['DistinctNew123!']);assert.equal((await query('select * from public.orders')).length,5);test('reset user resumes only with distinct new password');
await as(null);await denied('select * from public.orders');await denied('select public.get_my_role()');test('anonymous table and RPC access blocked');
await owner();await denied("select public.admin_profile_action($1,$1,null,false)",[ids.admin]);test('admin cannot deactivate self');
console.log(`DATABASE: ${passed} checks passed`);await db.close();
