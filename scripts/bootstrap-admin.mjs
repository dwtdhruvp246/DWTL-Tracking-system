// Node 20+. Run ONCE on your computer. No dependencies. Never place secrets in source files.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this terminal only.');
const rl=createInterface({input:stdin,output:stdout});
const username=(await rl.question('First admin username (3–32 characters): ')).trim().toLowerCase();
const full_name=(await rl.question('Full name: ')).trim();
// Use an environment variable to avoid terminal echo. Do not pass passwords on command lines.
const password=process.env.PLANT_ADMIN_TEMP_PASSWORD; rl.close();
if((!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)||username.includes('..')||username.endsWith('.'))||!full_name||!password||password.length<8||Buffer.byteLength(password)>72) throw new Error('Valid username, full name, and PLANT_ADMIN_TEMP_PASSWORD (minimum 8 characters, maximum 72 UTF-8 bytes) required.');
const res=await fetch(`${url.replace(/\/$/,'')}/auth/v1/admin/users`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email:`${username}@plant.local`,password,email_confirm:true,app_metadata:{plant_provisioned:true,username,full_name,role:'admin',temporary_nonce:crypto.randomUUID()}})});
const body=await res.json(); if(!res.ok) throw new Error(body.msg||body.message||'Bootstrap failed');
console.log(`Admin ${username} created. Sign in and change the temporary password. User ID: ${body.id}`);
