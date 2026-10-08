import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { CONFIG } from '../config.js';
export { CONFIG };
export const configured = !CONFIG.supabaseUrl.includes('YOUR_') && !CONFIG.supabaseAnonKey.includes('YOUR_');
export const db = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
export function check(result) {
 if (result.error) {
  const e=result.error;
  if(e.code==='23505') throw new Error('This value already exists. PO numbers must be unique for each customer.');
  if(e.code==='23503') throw new Error('This item is referenced by another record. Deactivate it instead.');
  if(e.code==='42501') throw new Error('Access denied. Your role or account state does not allow this action.');
  if(e.code==='23514') throw new Error('Check your values. Meters must be valid, and inspection passed + rejected must equal inspected.');
  throw new Error(e.message || 'Request failed. Please try again.');
 }
 return result.data;
}
// Supabase caps each REST response; fetch EVERY page instead of silently truncating exports.
export async function all(table, {select='*',eq={},order='created_at',ascending=false}={}) {
 let rows=[];
 for(let offset=0;;offset+=500) {
  let query=db.from(table).select(select).order(order,{ascending}).order('id',{ascending:true}).range(offset,offset+499);
  for(const [key,value] of Object.entries(eq)) query=query.eq(key,value);
  const page=check(await query); rows.push(...page); if(page.length<500) return rows;
 }
}
export async function rpc(name,params={}) { return check(await db.rpc(name,params)); }
export async function mutate(table,data,id=null,expected=null) {
 let q=id?db.from(table).update(data).eq('id',id):db.from(table).insert(data);
 if(expected) q=q.eq('updated_at',expected);
 const rows=check(await q.select());
 if(!rows?.length) throw new Error('The record changed or access was denied. Refresh and try again.');
 return rows[0];
}
export async function remove(table,id,expected) {
 const rows=check(await db.from(table).delete().eq('id',id).eq('updated_at',expected).select('id'));
 if(!rows?.length) throw new Error('The record changed or access was denied. Refresh and try again.');
}
export async function adminAction(body) {
 const {data,error}=await db.functions.invoke('admin-users',{body});
 if(error) {
  let message='User action failed. Check function deployment and ALLOWED_ORIGINS.';
  if(error.context?.json) {try {message=(await error.context.json()).error||message;} catch { /* non-JSON gateway error */ }}
  throw new Error(message);
 }
 if(data?.error) throw new Error(data.error);
 return data;
}
