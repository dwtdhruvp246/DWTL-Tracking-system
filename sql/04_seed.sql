-- Optional sample data. Run AFTER bootstrap so sample orders have an actual creator.
begin;
insert into public.fabrics(quality_name,description) values
 ('Cotton Poplin','Plain woven cotton'),('Cotton Twill','Twill construction'),('Poly Cotton','Polyester cotton blend'),('Viscose','Soft woven viscose'),('Denim','Indigo twill') on conflict(quality_name) do nothing;
insert into public.processes(name,typical_order,type) values
 ('Grey Inspection',10,'Inspection'),('Desizing',20,'Wet process'),('Bleaching',30,'Wet process'),('Dyeing',40,'Wet process'),('Printing',50,'Printing'),('Stenter',60,'Machine'),('Finishing',70,'Process'),('Final Inspection',80,'Inspection') on conflict(name) do nothing;
insert into public.customers(name,description) values
 ('Acacia Textiles','Sample customer'),('Riverstone Apparel','Sample customer'),('Meadow Uniforms','Sample customer') on conflict(name) do nothing;
do $$ declare owner_id uuid; begin
 select id into owner_id from public.profiles where role='admin' and active order by created_at limit 1;
 if owner_id is null then raise exception 'Create the first admin using scripts/bootstrap-admin.mjs before running sample orders'; end if;
 insert into public.orders(po_number,customer_id,fabric_id,shade,grade,quantity,order_date,delivery_date,status,confirmation_status,created_by,remarks)
 select 'DEMO-001',c.id,f.id,'Sky blue','A',1200,current_date,current_date+14,'Confirmed','Confirmed',owner_id,'Sample order; acknowledge to begin production'
 from public.customers c, public.fabrics f where c.name='Acacia Textiles' and f.quality_name='Cotton Poplin' on conflict(customer_id,po_number) do nothing;
 insert into public.orders(po_number,customer_id,fabric_id,shade,grade,quantity,order_date,delivery_date,status,confirmation_status,created_by)
 select 'DEMO-002',c.id,f.id,'Natural','B',800,current_date,current_date+10,'Draft','Draft',owner_id
 from public.customers c, public.fabrics f where c.name='Riverstone Apparel' and f.quality_name='Viscose' on conflict(customer_id,po_number) do nothing;
 insert into public.orders(po_number,customer_id,fabric_id,shade,grade,quantity,order_date,delivery_date,status,confirmation_status,created_by)
 select 'DEMO-003',c.id,f.id,'Navy','A',2500,current_date-10,current_date-1,'Confirmed','Confirmed',owner_id
 from public.customers c, public.fabrics f where c.name='Meadow Uniforms' and f.quality_name='Poly Cotton' on conflict(customer_id,po_number) do nothing;
end $$;
commit;
