export const STATUSES=['Draft','Confirmed','Acknowledged','In Production','In Inspection','In Warehouse','Completed','Rejected','Cancelled'];
export const ROLES=['admin','marketing','production_head','production','inspection','warehouse','viewer'];
export const allowed={dashboard:ROLES,orders:['admin','marketing','production_head'],order:ROLES,production:['admin','production_head','production'],inspection:['admin','inspection'],warehouse:['admin','warehouse'],masters:['admin','production_head'],users:['admin'],activity:['admin'],reports:ROLES,password:ROLES};
export const isOpen=o=>!!o.acknowledged_at&&o.confirmation_status==='Confirmed'&&!['Completed','Rejected','Cancelled'].includes(o.status);
export const canEdit=(p,o)=>p.role==='admin'||(p.role==='marketing'&&o.created_by===p.id&&o.status==='Draft');
export const canCreate=p=>['admin','marketing'].includes(p.role);
export const canEntry=(p,o,t)=>isOpen(o)&&(t==='inspections'?['admin','inspection']:t==='warehouse_receipts'?['admin','warehouse']:['admin','production_head','production']).includes(p.role);
export const canEditEntry=(p,o,t)=>p.role==='admin'||(t==='process_logs'&&canEntry(p,o,t));
export function statusOptions(p,o) {
 if(p.role==='marketing')return canEdit(p,o)?['Confirmed','Cancelled']:[];
 if(['admin','production_head'].includes(p.role))return STATUSES.filter(s=>s!==o.status&&(s!=='Acknowledged'||o.status==='Confirmed'||!!o.acknowledged_at)&&(!['In Production','In Inspection','In Warehouse','Completed'].includes(s)||!!o.acknowledged_at));
 if(!isOpen(o))return [];
 return ({production:['In Production','In Inspection'],inspection:['In Production','In Inspection','In Warehouse'],warehouse:['In Inspection','In Warehouse','Completed']}[p.role]||[]).filter(s=>s!==o.status);
}
