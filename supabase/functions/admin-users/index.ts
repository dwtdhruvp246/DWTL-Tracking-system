// One server-only function. Service role credentials are injected by Supabase, never sent to browsers.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const roles = ['admin','marketing','production_head','production','inspection','warehouse','viewer'];
const url = Deno.env.get('SUPABASE_URL')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const origins = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s=>s.trim()).filter(Boolean);
Deno.serve(async req => {
 const origin = req.headers.get('Origin') || '';
 const cors: Record<string,string> = { 'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS' };
 if (origins.includes(origin)) cors['Access-Control-Allow-Origin']=origin;
 const reply = (status:number,body:unknown) => new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if (origin && !origins.includes(origin)) return reply(403,{error:'Origin not allowed'});
 if (req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if (req.method!=='POST') return reply(405,{error:'Use POST'});
 try {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i,'');
  if (!token) return reply(401,{error:'Sign in first'});
  const {data:{user:caller},error:authError}=await service.auth.getUser(token);
  if(authError || !caller) return reply(401,{error:'Session expired'});
  const {data:actor,error:actorError}=await service.from('profiles').select('role,active,must_change_password').eq('id',caller.id).single();
  if(actorError || !actor?.active || actor.role!=='admin' || actor.must_change_password) return reply(403,{error:'Active admin required'});
  // Bound request size; passwords are never logged or returned.
  const raw=await req.text(); if(raw.length>12000) return reply(413,{error:'Request too large'});
  const b=JSON.parse(raw);
  const fail=(e:{message:string}|null)=>{if(e) throw new Error(e.message);};
  const log=async(event:string,target:string,details:unknown={})=>{
   const {error}=await service.from('login_audit').insert({user_id:target,created_by:caller.id,event,details:{actor:caller.id,...details as object}}); fail(error);
  };
  if(b.action==='create') {
   const username=String(b.username||'').trim().toLowerCase();
   const full_name=String(b.full_name||'').trim();
   const real_email=String(b.real_email||'').trim();
   if((!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)||username.includes('..')||username.endsWith('.'))) return reply(400,{error:'Username must be 3–32 lowercase letters, digits, dots, underscores or hyphens'});
   if(!full_name || full_name.length>150 || !roles.includes(b.role)) return reply(400,{error:'Full name and valid role required'});
   if(real_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(real_email)) return reply(400,{error:'Enter a valid optional real email'});
   if(typeof b.password!=='string' || b.password.length<8 || new TextEncoder().encode(b.password).length>72) return reply(400,{error:'Temporary password must be at least 8 characters, at most 72 UTF-8 bytes'});
   const {data,error}=await service.auth.admin.createUser({email:`${username}@plant.local`,password:b.password,email_confirm:true,app_metadata:{plant_provisioned:true,username,full_name,real_email,role:b.role,created_by:caller.id,temporary_nonce:crypto.randomUUID()}}); fail(error);
   await log('user_created',data.user!.id,{username,role:b.role});
   return reply(200,{ok:true,id:data.user!.id});
  }
  if(!/^[0-9a-f-]{36}$/i.test(String(b.user_id||''))) return reply(400,{error:'Valid user ID required'});
  const {data:target,error:targetError}=await service.from('profiles').select('id,role,active').eq('id',b.user_id).single(); fail(targetError);
  if(!target) return reply(404,{error:'User not found'});
  if(b.action==='reset_password') {
   if(typeof b.password!=='string' || b.password.length<8 || new TextEncoder().encode(b.password).length>72) return reply(400,{error:'Temporary password must be at least 8 characters, at most 72 UTF-8 bytes'});
   const {data,error}=await service.auth.admin.getUserById(target.id); fail(error);
   // Password + nonce in ONE Auth update: database trigger atomically records the new temporary hash.
   const {error:updateError}=await service.auth.admin.updateUserById(target.id,{password:b.password,app_metadata:{...data.user!.app_metadata,temporary_nonce:crypto.randomUUID()}}); fail(updateError);
   await log('password_reset',target.id);
  } else if(b.action==='change_role') {
   if(!roles.includes(b.role)) return reply(400,{error:'Valid role required'});
   const {error}=await service.rpc('admin_profile_action',{p_actor:caller.id,p_target:target.id,p_role:b.role}); fail(error);
  } else if(b.action==='set_active') {
   if(typeof b.active!=='boolean') return reply(400,{error:'Active must be true or false'});
   // Deactivate in DB first: existing JWTs lose data access instantly, even if the Auth ban fails.
   if(!b.active) {
    const {error}=await service.rpc('admin_profile_action',{p_actor:caller.id,p_target:target.id,p_active:false}); fail(error);
    const {error:banError}=await service.auth.admin.updateUserById(target.id,{ban_duration:'876000h'});
    if(banError) return reply(502,{error:'Data access blocked. Auth ban failed; retry deactivation to finish.'});
   } else {
    const {error}=await service.auth.admin.updateUserById(target.id,{ban_duration:'none'}); fail(error);
    const {error:activateError}=await service.rpc('admin_profile_action',{p_actor:caller.id,p_target:target.id,p_active:true}); fail(activateError);
   }
   await log(b.active?'user_activated':'user_deactivated',target.id);
  } else return reply(400,{error:'Unknown action'});
  return reply(200,{ok:true});
 } catch(e) {
  // No stack or request logging. Auth API messages contain no submitted password.
  return reply(400,{error:e instanceof Error?e.message:'User action failed'});
 }
});
