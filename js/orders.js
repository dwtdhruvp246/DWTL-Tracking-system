import { all, db, check, CONFIG } from './client.js';
import { $, $$, esc, num, stamp, today, badge, table, field, csv, notice, busy } from './ui.js';
import { STATUSES, canCreate, canEdit, canEntry, canEditEntry, statusOptions, isOpen } from './permissions.js';
import { orderForm, changeStatus, acknowledge, entryDefs, entryForm, deleteEntry } from './forms.js';
export function progress(o) {
 return `<div class="progress-stack">${[['issued','Issued'],['received','Received'],['in_warehouse','Warehouse']].map(([key,label])=>{const ratio=Number(o[key])/Number(o.quantity)*100;return `<div class="progress-line"><span>${label}</span><div class="progress-track" role="progressbar" aria-label="${label} versus ordered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.max(0,ratio)).toFixed(1)}"><div class="progress-fill ${key==='in_warehouse'?'warehouse':key}" style="width:${Math.min(100,Math.max(0,ratio))}%"></div></div><span>${ratio.toFixed(0)}%</span></div>`;}).join('')}</div>`;
}
const selectOptions=(values)=>[{value:'',label:'All'},...values.map(v=>({value:v,label:v}))];
export async function orderList(ctx,mode='dashboard') {
 const rows=await all('order_dashboard');
 if(!ctx.active())return;
 let filtered=rows;
 const opts=k=>selectOptions([...new Set(rows.map(r=>r[k]))].filter(Boolean).sort());
 ctx.content.innerHTML=`<div class="page-head"><div><h1>${mode==='reports'?'Reports':mode==='orders'?'Orders':'Plant dashboard'}</h1><p>${mode==='reports'?'Filter orders and download a CSV. Open an order to export its full trace.':'Order totals and activity across every department.'}</p></div><div class="actions">${canCreate(ctx.p)?'<button id="new-order">New order</button>':''}<button class="secondary" id="export-orders">Export filtered CSV</button><button class="secondary" id="refresh">Refresh</button></div></div><div id="stats" class="stats"></div><section class="card filters"><h2>Filter orders</h2><form id="filters" class="filter-grid">${field('po','PO search')}${field('status','Status',{options:selectOptions(STATUSES)})}${field('customer_name','Customer',{options:opts('customer_name')})}${field('quality_name','Quality',{options:opts('quality_name')})}${field('shade','Shade',{options:opts('shade')})}${field('grade','Grade',{options:opts('grade')})}${field('from','Order date from',{type:'date'})}${field('to','Order date to',{type:'date'})}${field('sort','Sort by',{value:'last_activity|desc',options:[{value:'last_activity|desc',label:'Last activity · newest'},{value:'order_date|desc',label:'Order date · newest'},{value:'order_date|asc',label:'Order date · oldest'},{value:'delivery_date|asc',label:'Delivery date · earliest'},{value:'po_number|asc',label:'PO number · A to Z'},{value:'quantity|desc',label:'Ordered meters · highest'}]})}${field('inactive','Highlight inactivity after days',{type:'number',value:CONFIG.inactiveDays,min:1,step:1})}<div class="wide actions"><button type="button" id="reset-filters" class="secondary">Reset filters</button><span id="filter-count" class="subtle"></span></div></form></section><section class="card"><div id="orders-table"></div></section>`;
 const form=$('#filters');
 function render() {
  const f=Object.fromEntries(new FormData(form));
  if(f.from&&f.to&&f.from>f.to){$('#filter-count').textContent='The start date must be before the end date.';filtered=[];}else{
   filtered=rows.filter(r=>!f.po||r.po_number.toLowerCase().includes(f.po.trim().toLowerCase())).filter(r=>['status','customer_name','quality_name','shade','grade'].every(k=>!f[k]||r[k]===f[k])).filter(r=>(!f.from||r.order_date>=f.from)&&(!f.to||r.order_date<=f.to));
   $('#filter-count').textContent=`${filtered.length} of ${rows.length} orders. Summary cards reflect these filters.`;
  }
  const [key,dir]=f.sort.split('|');filtered.sort((a,b)=>{const x=a[key],y=b[key];if(x==null)return 1;if(y==null)return -1;const c=typeof x==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true});return dir==='desc'?-c:c;});
  $('#stats').innerHTML=[['Total orders',filtered.length],...STATUSES.map(s=>[s,filtered.filter(r=>r.status===s).length])].map(([label,total])=>`<div class="stat"><small>${esc(label)}</small><strong>${total}</strong></div>`).join('');
  $('#orders-table').innerHTML=table(filtered,[
   {label:'PO / order date',html:r=>`<a href="#order/${r.id}">${esc(r.po_number)}</a><br><small>${esc(r.order_date)}</small>`},
   {key:'customer_name',label:'Customer'},{key:'quality_name',label:'Quality'},{key:'shade',label:'Shade'},{key:'grade',label:'Grade'},
   {label:'Ordered (m)',html:r=>num(r.quantity)},{label:'Current stage',html:r=>badge(r.status)},
   {label:'Progress vs ordered',html:progress},{label:'Warehouse / balance (m)',html:r=>`${num(r.in_warehouse)} / ${num(r.balance)}`},
   {label:'Delivery / attention',html:r=>`${esc(r.delivery_date||'—')}<br>${!['Completed','Cancelled','Rejected'].includes(r.status)&&r.delivery_date&&r.delivery_date<today()?'<span class="warning">Past delivery date</span> ':''}${!['Completed','Cancelled','Rejected'].includes(r.status)&&Date.now()-new Date(r.last_activity).getTime()>Math.max(1,Number(f.inactive)||CONFIG.inactiveDays)*86400000?'<span class="warning">No recent activity</span>':''}`},
   {label:'Last activity',html:r=>stamp(r.last_activity)}
  ],{empty:'No orders match your filters.'});
 }
 form.onsubmit=e=>e.preventDefault();form.oninput=render;form.onchange=render;
 $('#reset-filters').onclick=()=>{form.reset();render();};$('#refresh').onclick=()=>ctx.reload();
 $('#export-orders').onclick=()=>csv('fabric-orders.csv',filtered.map(r=>({po_number:r.po_number,customer:r.customer_name,quality:r.quality_name,shade:r.shade,grade:r.grade,order_date:r.order_date,delivery_date:r.delivery_date,ordered_meters:r.quantity,issued:r.issued,received:r.received,inspected:r.inspected,passed:r.passed,rejected:r.rejected,in_warehouse:r.in_warehouse,balance:r.balance,status:r.status,last_activity:r.last_activity})));
 if($('#new-order'))$('#new-order').onclick=e=>busy(e.currentTarget,()=>orderForm(ctx.p,null,ctx.reload));render();
}
export async function trace(id) {
 const order=check(await db.from('order_dashboard').select('*').eq('id',id).single());
 const tables=Object.keys(entryDefs).concat(['status_history','change_audit']);
 const [masters,...lists]=await Promise.all([all('processes'),...tables.map(t=>all(t,{eq:{order_id:id},ascending:true,order:t==='process_logs'?'date_in':'created_at'}))]);
 const data=Object.fromEntries(tables.map((t,i)=>[t,lists[i]]));
 data.process_logs=data.process_logs.map(r=>({...r,process_name:masters.find(m=>m.id===r.process_id)?.name||'Unknown process',loss:r.meters_out==null?null:Number(r.meters_in)-Number(r.meters_out)}));
 return {order,data};
}
function traceCSV(o,data) {
 // Section column creates one portable rectangular file containing every original record and all audit values.
 csv(`trace-${o.po_number}.csv`,[{section:'order',...o},...Object.entries(data).flatMap(([section,rows])=>rows.map(r=>({section,...r})))]);
}
export async function orderDetail(ctx,id) {
 if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new Error('Invalid order link.');
 const {order:o,data}=await trace(id),p=ctx.p;
 if(!ctx.active())return;
 const info=[['PO number',o.po_number],['Customer',o.customer_name],['Fabric quality',o.quality_name],['Shade',o.shade],['Grade',o.grade],['Ordered meters',num(o.quantity)],['Confirmation',o.confirmation_status],['Order date',o.order_date],['Delivery date',o.delivery_date],['Roll / lot number',o.roll_lot_number],['GSM',o.gsm],['Width',o.width],['Design / article',o.design_article_number],['Acknowledged at',stamp(o.acknowledged_at)],['Acknowledged by',o.acknowledged_by],['Creator',o.created_by],['Remarks',o.remarks],['Notes',o.notes]];
 ctx.content.innerHTML=`<div class="page-head"><div><a href="#dashboard">← Dashboard</a><h1>PO ${esc(o.po_number)}</h1>${badge(o.status)}</div><div class="actions">${canEdit(p,o)?'<button id="edit-order">Edit order</button>':''}${['admin','production_head'].includes(p.role)&&o.status==='Confirmed'&&!o.acknowledged_at?'<button id="ack-order">Acknowledge</button><button id="reject-order" class="secondary">Reject</button>':''}${statusOptions(p,o).length?'<button id="change-status" class="secondary">Change status</button>':''}<button id="trace-export" class="secondary">Export full trace CSV</button><button class="secondary" id="refresh">Refresh</button></div></div><section class="card"><h2>Order information</h2><dl class="detail-grid">${info.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v??'—')}</dd></div>`).join('')}</dl></section><div class="stats">${[['Ordered',o.quantity],['Issued',o.issued],['Produced / received',o.received],['Passed inspection',o.passed],['Rejected',o.rejected],['In warehouse',o.in_warehouse],['Balance to warehouse',o.balance]].map(([k,v])=>`<div class="stat"><small>${esc(k)} (m)</small><strong>${num(v)}</strong></div>`).join('')}</div><section class="card"><h2>Progress against ordered meters</h2>${progress(o)}<p class="subtle">Totals are independently recorded. Reinspection and rework may increase cumulative totals; negative balance indicates over-delivery.</p></section><section class="card"><h2>Status history</h2><ol class="timeline">${data.status_history.map(r=>`<li>${r.from_status?badge(r.from_status)+' → ':''}${badge(r.to_status)}<small>${stamp(r.created_at)} · By ${esc(r.changed_by||r.created_by||'Setup')}</small><p>${esc(r.reason)}</p></li>`).join('')||'<li>No status changes yet.</li>'}</ol></section>${Object.entries(entryDefs).map(([t,d])=>`<section class="card"><div class="section-head"><h2>${esc(d.title)}</h2>${canEntry(p,o,t)?`<button data-add="${t}">Add ${esc(d.singular)}</button>`:''}</div>${table(data[t],d.columns.map(([key,label])=>({key,label,html:key.startsWith('meters')||key==='loss'?r=>r[key]==null?'—':num(r[key]):key.startsWith('date_')?r=>stamp(r[key]):undefined})),{actions:canEditEntry(p,o,t)?r=>`<button class="secondary" data-edit="${t}/${r.id}">Edit</button><button class="secondary" data-delete="${t}/${r.id}">Delete</button>`:null})}</section>`).join('')}<section class="card"><h2>Change audit</h2><p class="subtle">Append-only records include original values for deleted process passes. Actor identifiers correspond to Supabase user IDs.</p>${data.change_audit.length?data.change_audit.map(r=>`<details><summary>${esc(r.table_name)} · ${esc(r.action)} · ${stamp(r.created_at)} · ${esc(r.created_by||'Setup')}</summary><pre class="audit-json">${esc(JSON.stringify({before:r.old_data,after:r.new_data},null,2))}</pre></details>`).join(''):'<p class="empty">No changes yet.</p>'}</section>`;
 const refresh=ctx.reload;
 if($('#edit-order'))$('#edit-order').onclick=e=>busy(e.currentTarget,()=>orderForm(p,o,refresh));
 if($('#change-status'))$('#change-status').onclick=()=>changeStatus(p,o,refresh);
 if($('#ack-order'))$('#ack-order').onclick=()=>acknowledge(o,refresh);
 if($('#reject-order'))$('#reject-order').onclick=()=>changeStatus(p,o,refresh,'Rejected');
 $('#trace-export').onclick=()=>traceCSV(o,data);$('#refresh').onclick=refresh;
 $$('[data-add]').forEach(b=>b.onclick=()=>busy(b,()=>entryForm(b.dataset.add,o,null,refresh)));
 $$('[data-edit]').forEach(b=>b.onclick=()=>busy(b,async()=>{const [t,rid]=b.dataset.edit.split('/');await entryForm(t,o,data[t].find(r=>r.id===rid),refresh);}));
 $$('[data-delete]').forEach(b=>b.onclick=()=>{const [t,rid]=b.dataset.delete.split('/');deleteEntry(t,data[t].find(r=>r.id===rid),refresh);});
}
export async function workScreen(ctx,mode) {
 const allOrders=await all('order_dashboard'),rows=allOrders.filter(isOpen);
 if(!ctx.active())return;
 const tabs=mode==='production'?['order_issues','order_receipts','process_logs']:mode==='inspection'?['inspections']:['warehouse_receipts'];
 ctx.content.innerHTML=`<div class="page-head"><div><h1>${mode==='production'?'Production':mode==='inspection'?'Inspection':'Warehouse'}</h1><p>Open, acknowledged orders. Use order details to change status, review entries and correct process logs.</p></div><button id="refresh" class="secondary">Refresh</button></div><section class="card">${field('search','Search PO / customer')}<div id="work-table" style="margin-top:18px"></div></section>`;
 function render() {
  const term=$('[name=search]').value.toLowerCase();const list=rows.filter(r=>`${r.po_number} ${r.customer_name}`.toLowerCase().includes(term));
  $('#work-table').innerHTML=table(list,[{label:'PO',html:r=>`<a href="#order/${r.id}">${esc(r.po_number)}</a>`},{key:'customer_name',label:'Customer'},{key:'quality_name',label:'Quality'},{label:'Stage',html:r=>badge(r.status)},{label:'Ordered / issued / received (m)',html:r=>`${num(r.quantity)} / ${num(r.issued)} / ${num(r.received)}`},{label:'Passed / warehouse (m)',html:r=>`${num(r.passed)} / ${num(r.in_warehouse)}`}],{empty:'No open acknowledged orders. Ask the production head to acknowledge a confirmed order.',actions:r=>tabs.map(t=>`<button data-add="${t}/${r.id}">Add ${esc(entryDefs[t].singular)}</button>`).join('')+`<a class="button secondary" href="#order/${r.id}">Full trace / edit</a>`});
  $$('[data-add]').forEach(b=>b.onclick=()=>busy(b,async()=>{const [t,id]=b.dataset.add.split('/');await entryForm(t,rows.find(r=>r.id===id),null,ctx.reload);}));
 }
 $('[name=search]').oninput=render;$('#refresh').onclick=ctx.reload;render();
}
