import { db, CONFIG, configured } from './client.js';
import { profile, logout, homes, passwordDialog, bindPassword } from './auth.js';
import { $, $$, esc, roleName, notice } from './ui.js';
import { allowed } from './permissions.js';
import { orderList, orderDetail, workScreen } from './orders.js';
import { masters, users, activity } from './admin.js';
let p=null,renderId=0,checking=false,leaving=false;
const content=$('#content');
const links=[['dashboard','Dashboard'],['orders','Orders'],['production','Production'],['inspection','Inspection'],['warehouse','Warehouse'],['masters/fabrics','Master data'],['users','Users'],['activity','Login activity'],['reports','Reports'],['password','Change my password']];
function nav() {
 $('#plant-name').textContent=CONFIG.plantName;
 $('#plant-name').href=`#${homes[p.role]}`;
 $('#user-info').textContent=`${p.full_name} · ${roleName(p.role)}`;
 $('#nav').innerHTML=p.must_change_password?'':links.filter(([route])=>allowed[route.split('/')[0]].includes(p.role)).map(([route,label])=>`<a href="#${route}">${esc(label)}</a>`).join('');
}
async function identity() {
 if(leaving)return false;
 const current=await profile();
 if(!current?.active){leaving=true;await logout('Your session expired or your account is inactive. Sign in again or contact your administrator.');return false;}
 const changed=p&&(current.role!==p.role||current.must_change_password!==p.must_change_password);
 p=current;nav();
 if(p.must_change_password&&location.hash!=='#password')location.hash='password';
 return changed;
}
async function render() {
 const token=++renderId;$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');
 if($('#dialog').open)$('#dialog').close();
 content.innerHTML='<p class="loading">Loading records…</p>';
 try {
  await identity();if(leaving||token!==renderId)return;
  let path=location.hash.slice(1)||homes[p.role], [route,arg]=path.split('/');
  if(p.must_change_password)route='password';
  if(!allowed[route]||!allowed[route].includes(p.role)){notice('Your role cannot open that screen.','error');location.replace(`#${homes[p.role]}`);return;}
  $$('a',$('#nav')).forEach(a=>a.classList.toggle('active',a.hash.slice(1).split('/')[0]===route));
  const ctx={p,content,active:()=>token===renderId,reload:async()=>{await render();}};
  if(route==='password'){
   content.innerHTML=passwordDialog(p,p.must_change_password);
   bindPassword(async()=>{await identity();notice('Password updated.');location.hash=homes[p.role];});
  }else if(route==='dashboard'||route==='orders'||route==='reports')await orderList(ctx,route);
  else if(route==='order')await orderDetail(ctx,arg);
  else if(['production','inspection','warehouse'].includes(route))await workScreen(ctx,route);
  else if(route==='masters')await masters(ctx,arg);
  else if(route==='users')await users(ctx);
  else if(route==='activity')await activity(ctx);
 }catch(e){if(token!==renderId)return;content.innerHTML=`<section class="card"><h1>Unable to load this screen</h1><p>${esc(e.message)}</p><div class="actions"><button id="retry">Try again</button><a class="button secondary" href="#dashboard">Dashboard</a></div></section>`;$('#retry').onclick=render;}
}
$('#menu-toggle').onclick=()=>{const open=$('#sidebar').classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String(open));};
$('#logout').onclick=async e=>{e.currentTarget.disabled=true;await logout();};
window.addEventListener('hashchange',render);
window.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');}});
async function refreshIdentity(){if(checking||leaving)return;checking=true;try{if(await identity())await render();}catch(e){notice('Cannot verify the session. Check your connection; data actions remain protected.','error');}finally{checking=false;}}
window.addEventListener('focus',refreshIdentity);
setInterval(refreshIdentity,30000);
// Avoid async Supabase calls inside onAuthStateChange (may deadlock the Auth client).
db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'&&!leaving){leaving=true;location.replace('index.html?message=Session%20expired.%20Please%20sign%20in%20again.');}});
if(!configured)location.replace('index.html');else render();
