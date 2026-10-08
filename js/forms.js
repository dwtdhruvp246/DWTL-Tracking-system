import { all, mutate, rpc, remove } from './client.js';
import { field, dialog, confirmDialog, notice, today, localTime, esc } from './ui.js';
import { statusOptions } from './permissions.js';
const options=(rows,label,selected)=>[{value:'',label:'Choose…'},...rows.filter(r=>r.active||r.id===selected).map(r=>({value:r.id,label:r[label]+(r.active?'':' (inactive)')}))];
const nullable=v=>v===''?null:v;
export async function orderForm(p,o,onDone) {
 const [customers,fabrics]=await Promise.all([all('customers',{order:'name',ascending:true}),all('fabrics',{order:'quality_name',ascending:true})]);
 if(!customers.some(r=>r.active)||!fabrics.some(r=>r.active))throw new Error('Ask your admin or production head to add active customers and fabrics first.');
 const draft=!o||o.status==='Draft';
 dialog(o?'Edit order':'New order',[
  field('po_number','PO number',{required:true,value:o?.po_number,max:100}),
  field('customer_id','Customer',{required:true,value:o?.customer_id,options:options(customers,'name',o?.customer_id)}),
  field('fabric_id','Fabric quality',{required:true,value:o?.fabric_id,options:options(fabrics,'quality_name',o?.fabric_id)}),
  field('shade','Shade',{required:true,value:o?.shade}),field('grade','Grade',{required:true,value:o?.grade}),
  field('quantity','Ordered quantity (meters)',{type:'number',required:true,min:0.001,step:0.001,value:o?.quantity}),
  field('order_date','Order date',{type:'date',required:true,value:o?.order_date||today()}),
  field('delivery_date','Delivery date',{type:'date',value:o?.delivery_date||''}),
  draft?field('status','Confirmation status',{required:true,value:o?.status||'Draft',options:['Draft','Confirmed','Cancelled'].map(v=>({value:v,label:v}))}):`<p class="field">Current status: ${esc(o.status)}. Use Change status to move stages.</p>`,
  field('remarks','Remarks',{type:'textarea',value:o?.remarks,wide:true}),
  '<h3 class="wide">Additional information — all optional</h3>',
  field('roll_lot_number','Roll / lot number',{value:o?.roll_lot_number}),field('gsm','GSM',{type:'number',step:'any',value:o?.gsm}),
  field('width','Width',{value:o?.width}),field('design_article_number','Design / article number',{value:o?.design_article_number}),
  field('notes','Notes',{type:'textarea',value:o?.notes,wide:true})
 ].join(''),async v=>{
  const data={...v,quantity:Number(v.quantity),gsm:v.gsm===''?null:Number(v.gsm),delivery_date:nullable(v.delivery_date)};
  if(v.status) {data.confirmation_status=v.status;if(o&&v.status!==o.status)data.status_reason=v.status==='Confirmed'?'Confirmed from order form':'Cancelled from order form';}
  await mutate('orders',data,o?.id,o?.updated_at);await onDone();notice(o?'Order updated.':'Order created.');
 });
}
export function changeStatus(p,o,onDone,onlyStatus=null) {
 const opts=onlyStatus?[onlyStatus]:statusOptions(p,o);if(!opts.length)return;
 dialog('Change order status',`<p class="wide">Current stage: <strong>${esc(o.status)}</strong>. Backward moves and skipped stages are allowed within your role. Every change is audited.</p>`+field('status','New status',{required:true,options:opts.map(v=>({value:v,label:v}))})+field('reason','Reason',{required:true,type:'textarea',wide:true}),async v=>{
  if(!v.reason.trim())throw new Error('Enter a reason for this change.');
  await rpc('set_order_status',{p_id:o.id,p_status:v.status,p_reason:v.reason.trim(),p_expected:o.status});await onDone();notice('Status updated.');
 });
}
export function acknowledge(o,onDone) {
 dialog('Acknowledge order',`<p class="wide">Acknowledge PO ${esc(o.po_number)} and release it to production. Your identity and the current time will be recorded.</p>`+field('reason','Acknowledgement note',{type:'textarea',value:'Order accepted for production',required:true,wide:true}),async v=>{
  await rpc('set_order_status',{p_id:o.id,p_status:'Acknowledged',p_reason:v.reason,p_expected:o.status});await onDone();notice('Order acknowledged.');
 },{saveLabel:'Acknowledge'});
}
export const entryDefs={
 order_issues:{title:'Fabric issues',singular:'fabric issue',columns:[['entry_date','Date'],['meters','Meters'],['lot_batch_number','Lot / batch'],['remarks','Remarks']]},
 order_receipts:{title:'Production receipts',singular:'production receipt',columns:[['entry_date','Date'],['meters','Meters'],['remarks','Remarks']]},
 process_logs:{title:'Process timeline',singular:'process pass',columns:[['date_in','Date in'],['date_out','Date out'],['process_name','Process / machine'],['meters_in','Meters in'],['meters_out','Meters out'],['loss','Loss / gain'],['operator','Operator'],['remarks','Remarks']]},
 inspections:{title:'Inspection results',singular:'inspection',columns:[['entry_date','Date'],['lot_number','Lot'],['meters_inspected','Inspected'],['meters_passed','Passed'],['meters_rejected','Rejected'],['final_grade','Final grade'],['remarks','Remarks']]},
 warehouse_receipts:{title:'Warehouse receipts',singular:'warehouse receipt',columns:[['entry_date','Date'],['meters','Meters'],['location','Location / rack'],['remarks','Remarks']]}
};
export async function entryForm(table,o,row,onDone) {
 let html='';
 if(table==='process_logs') {
  const processes=await all('processes',{order:'typical_order',ascending:true});
  html=field('process_id','Process / machine',{required:true,value:row?.process_id,options:options(processes,'name',row?.process_id)})+
   field('date_in','Date in',{type:'datetime-local',required:true,value:localTime(row?.date_in)})+
   field('date_out','Date out',{type:'datetime-local',value:row?.date_out?localTime(row.date_out):'',help:'Leave date out and meters out blank while in progress.'})+
   field('meters_in','Meters in',{type:'number',required:true,value:row?.meters_in,min:0.001,step:0.001})+
   field('meters_out','Meters out',{type:'number',value:row?.meters_out,min:0,step:0.001})+field('operator','Operator',{value:row?.operator});
 } else {
  html=field('entry_date','Date',{type:'date',required:true,value:row?.entry_date||today()});
  if(table==='inspections')html+=field('lot_number','Lot number',{required:true,value:row?.lot_number})+field('meters_inspected','Meters inspected',{type:'number',required:true,value:row?.meters_inspected,min:0.001,step:0.001})+field('meters_passed','Meters passed',{type:'number',required:true,value:row?.meters_passed,min:0,step:0.001})+field('meters_rejected','Meters rejected',{type:'number',required:true,value:row?.meters_rejected,min:0,step:0.001})+field('final_grade','Final grade',{required:true,value:row?.final_grade});
  else html+=field('meters','Meters',{type:'number',required:true,value:row?.meters,min:0.001,step:0.001});
  if(table==='order_issues')html+=field('lot_batch_number','Lot / batch number',{value:row?.lot_batch_number});
  if(table==='warehouse_receipts')html+=field('location','Location / rack',{required:true,value:row?.location});
 }
 html+=field('remarks','Remarks',{type:'textarea',value:row?.remarks,wide:true});
 dialog(`${row?'Edit':'Add'} ${entryDefs[table].singular} · ${o.po_number}`,html,async v=>{
  const data={...v};
  for(const k of ['meters','meters_in','meters_out','meters_inspected','meters_passed','meters_rejected'])if(k in data)data[k]=data[k]===''?null:Number(data[k]);
  if(table==='process_logs') {
   if(!!v.date_out!==!!v.meters_out)throw new Error('Enter both date out and meters out, or leave both blank.');
   data.date_in=new Date(v.date_in).toISOString();data.date_out=v.date_out?new Date(v.date_out).toISOString():null;
   if(data.date_out&&data.date_out<data.date_in)throw new Error('Date out must be after date in.');
  }
  if(table==='inspections'&&Math.round(data.meters_passed*1000)+Math.round(data.meters_rejected*1000)!==Math.round(data.meters_inspected*1000))throw new Error('Passed + rejected meters must equal inspected meters.');
  if(!row)data.order_id=o.id;
  await mutate(table,data,row?.id,row?.updated_at);await onDone();notice('Entry saved.');
 });
}
export function deleteEntry(table,row,onDone) {
 confirmDialog('Delete entry','This removes the entry from totals. Its original values remain in the audit trail.',async()=>{await remove(table,row.id,row.updated_at);await onDone();notice('Entry deleted and audited.');});
}
