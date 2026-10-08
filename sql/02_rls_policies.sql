begin;
-- Stable, live profile checks: inactive and temporary-password sessions get no business data.
create function public.get_my_role() returns public.app_role language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=auth.uid() and active and not must_change_password
$$;
create function public.is_active_user() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
$$;
create function public.can_work_order(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.get_my_role() is not null and exists(select 1 from public.orders where id=p_order and acknowledged_at is not null and confirmation_status='Confirmed' and status not in ('Completed','Rejected','Cancelled'))
$$;
revoke all on function public.get_my_role(), public.is_active_user(), public.can_work_order(uuid) from public,anon;
grant execute on function public.get_my_role(), public.is_active_user(), public.can_work_order(uuid) to authenticated;
-- Explicit grants: profiles and audit records have no direct client write path.
revoke all on all tables in schema public from anon,authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles,public.status_history,public.login_audit,public.change_audit to authenticated;
grant select,insert,update,delete on public.customers,public.fabrics,public.processes,public.orders,public.order_issues,public.order_receipts,public.process_logs,public.inspections,public.warehouse_receipts to authenticated;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
do $$ declare t text; begin
 foreach t in array array['profiles','customers','fabrics','processes','orders','order_issues','order_receipts','process_logs','inspections','warehouse_receipts','status_history','login_audit','change_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
create policy profiles_read on public.profiles for select to authenticated using (
 (id=auth.uid() and public.is_active_user()) or public.get_my_role()='admin'
);
do $$ declare t text; begin
 foreach t in array array['customers','fabrics','processes'] loop
 execute format('create policy read_active_users on public.%I for select to authenticated using (public.get_my_role() is not null)',t);
 execute format('create policy master_insert on public.%I for insert to authenticated with check (public.get_my_role() in (''admin'',''production_head'') and created_by=auth.uid())',t);
 execute format('create policy master_update on public.%I for update to authenticated using (public.get_my_role() in (''admin'',''production_head'')) with check (public.get_my_role() in (''admin'',''production_head''))',t);
 -- Prefer deactivation; only admins may remove unreferenced master records.
 execute format('create policy master_delete on public.%I for delete to authenticated using (public.get_my_role()=''admin'')',t);
 end loop;
end $$;
create policy orders_read on public.orders for select to authenticated using(public.get_my_role() is not null);
create policy orders_insert on public.orders for insert to authenticated with check(
 public.get_my_role() in ('admin','marketing') and created_by=auth.uid() and status in ('Draft','Confirmed','Cancelled')
);
create policy orders_update on public.orders for update to authenticated using(
 public.get_my_role() in ('admin','production_head','production','inspection','warehouse') or
 (public.get_my_role()='marketing' and created_by=auth.uid() and status='Draft')
) with check(public.get_my_role() is not null);
-- Orders are never physically deleted: cancellation preserves the trace.
do $$ declare t text; begin
 foreach t in array array['order_issues','order_receipts','process_logs'] loop
 execute format('create policy entry_read on public.%I for select to authenticated using(public.get_my_role() is not null)',t);
 execute format('create policy entry_insert on public.%I for insert to authenticated with check(public.get_my_role() in (''admin'',''production_head'',''production'') and public.can_work_order(order_id) and created_by=auth.uid())',t);
 if t='process_logs' then
 execute format('create policy entry_update on public.%I for update to authenticated using(public.get_my_role()=''admin'' or (public.get_my_role() in (''production_head'',''production'') and public.can_work_order(order_id))) with check(public.get_my_role()=''admin'' or (public.get_my_role() in (''production_head'',''production'') and public.can_work_order(order_id)))',t);
 execute format('create policy entry_delete on public.%I for delete to authenticated using(public.get_my_role()=''admin'' or (public.get_my_role() in (''production_head'',''production'') and public.can_work_order(order_id)))',t);
 else
 execute format('create policy admin_update on public.%I for update to authenticated using(public.get_my_role()=''admin'') with check(public.get_my_role()=''admin'')',t);
 execute format('create policy admin_delete on public.%I for delete to authenticated using(public.get_my_role()=''admin'')',t);
 end if;
 end loop;
end $$;
create policy inspection_read on public.inspections for select to authenticated using(public.get_my_role() is not null);
create policy inspection_insert on public.inspections for insert to authenticated with check(public.get_my_role() in ('admin','inspection') and public.can_work_order(order_id) and created_by=auth.uid());
create policy inspection_update on public.inspections for update to authenticated using(public.get_my_role()='admin') with check(public.get_my_role()='admin');
create policy inspection_delete on public.inspections for delete to authenticated using(public.get_my_role()='admin');
create policy warehouse_read on public.warehouse_receipts for select to authenticated using(public.get_my_role() is not null);
create policy warehouse_insert on public.warehouse_receipts for insert to authenticated with check(public.get_my_role() in ('admin','warehouse') and public.can_work_order(order_id) and created_by=auth.uid());
create policy warehouse_update on public.warehouse_receipts for update to authenticated using(public.get_my_role()='admin') with check(public.get_my_role()='admin');
create policy warehouse_delete on public.warehouse_receipts for delete to authenticated using(public.get_my_role()='admin');
create policy history_read on public.status_history for select to authenticated using(public.get_my_role() is not null);
create policy audit_read on public.login_audit for select to authenticated using(public.get_my_role()='admin');
create policy change_read on public.change_audit for select to authenticated using(public.get_my_role()='admin' or (public.get_my_role() is not null and order_id is not null));
commit;
