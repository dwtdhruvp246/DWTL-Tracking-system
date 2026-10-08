begin;
create function private.touch_record() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
   raise exception 'Record identity and creator cannot be changed';
  end if;
  new.updated_at=clock_timestamp();
 end if;
 if TG_OP='INSERT' then
  new.created_at=clock_timestamp(); new.updated_at=new.created_at;
  if auth.uid() is not null then new.created_by=auth.uid(); end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['profiles','customers','fabrics','processes','orders','order_issues','order_receipts','process_logs','inspections','warehouse_receipts','status_history','login_audit','change_audit'] loop
 execute format('create trigger a_touch before insert or update on public.%I for each row execute function private.touch_record()',t);
 end loop;
end $$;
create function private.guard_order() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.app_role := public.get_my_role(); ignored text[] := array['status','status_reason','confirmation_status','acknowledged_at','acknowledged_by','updated_at'];
begin
 -- SQL editor, bootstrap and trusted server maintenance only. Anonymous API users never reach this trigger.
 if auth.uid() is null then
  if current_setting('role',true) in ('anon','authenticated') then raise exception 'Authentication required'; end if;
  return new;
 end if;
 if r is null then raise exception 'Active account with a changed password required'; end if;
 new.po_number=btrim(new.po_number);
 if TG_OP='INSERT' then
  if r not in ('admin','marketing') then raise exception 'Order creation not allowed'; end if;
  if new.acknowledged_at is not null or new.acknowledged_by is not null then raise exception 'Acknowledge after confirmation'; end if;
  if new.status not in ('Draft','Confirmed','Cancelled') then raise exception 'Invalid initial status'; end if;
 else
  if new.acknowledged_at is distinct from old.acknowledged_at or new.acknowledged_by is distinct from old.acknowledged_by then raise exception 'Acknowledgement is recorded by the system'; end if;
  if r='marketing' then
   if old.created_by<>auth.uid() or old.status<>'Draft' or new.status not in ('Draft','Confirmed','Cancelled') then raise exception 'Only your own draft orders can be edited'; end if;
  elsif r<>'admin' then
   if (to_jsonb(new)-ignored) is distinct from (to_jsonb(old)-ignored) then raise exception 'This role can change status only'; end if;
   if r='production_head' then null;
   elsif r='production' and new.status in ('In Production','In Inspection') and public.can_work_order(old.id) then null;
   elsif r='inspection' and new.status in ('In Production','In Inspection','In Warehouse') and public.can_work_order(old.id) then null;
   elsif r='warehouse' and new.status in ('In Inspection','In Warehouse','Completed') and public.can_work_order(old.id) then null;
   else raise exception 'Status change not allowed for this role'; end if;
  end if;
  if new.status is distinct from old.status and length(btrim(coalesce(new.status_reason,'')))=0 then raise exception 'A reason is required for every status change'; end if;
  if new.status='Acknowledged' and new.status is distinct from old.status and old.acknowledged_at is null then
   if r not in ('admin','production_head') or old.status<>'Confirmed' then raise exception 'Only a confirmed order can be acknowledged by production head'; end if;
   new.acknowledged_at=clock_timestamp(); new.acknowledged_by=auth.uid();
  end if;
 end if;
 if new.status in ('In Production','In Inspection','In Warehouse','Completed') and new.acknowledged_at is null then raise exception 'Acknowledge this order first'; end if;
 new.confirmation_status=case when new.status='Draft' then 'Draft' when new.status='Cancelled' then 'Cancelled' else 'Confirmed' end;
 if TG_OP='INSERT' or new.customer_id is distinct from old.customer_id then
  if not exists(select 1 from public.customers where id=new.customer_id and active) then raise exception 'Choose an active customer'; end if;
 end if;
 if TG_OP='INSERT' or new.fabric_id is distinct from old.fabric_id then
  if not exists(select 1 from public.fabrics where id=new.fabric_id and active) then raise exception 'Choose an active fabric'; end if;
 end if;
 return new;
end $$;
create trigger b_guard_order before insert or update on public.orders for each row execute function private.guard_order();
create function private.guard_entry() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; pid uuid; begin
 -- Serialize writes with status changes; check the latest parent, even under concurrent requests.
 pid=case when TG_OP='DELETE' then old.order_id else new.order_id end;
 select * into o from public.orders where id=pid for update;
 if auth.uid() is not null and (public.get_my_role() is null or (TG_OP='INSERT' or public.get_my_role()<>'admin') and not public.can_work_order(pid)) then raise exception 'This order is not open for entries'; end if;
 if TG_OP='UPDATE' and new.order_id is distinct from old.order_id then raise exception 'An entry cannot be moved to another order'; end if;
 if TG_TABLE_NAME='process_logs' and TG_OP<>'DELETE' then
  if TG_OP='INSERT' or new.process_id is distinct from old.process_id then
   if not exists(select 1 from public.processes where id=new.process_id and active) then raise exception 'Choose an active process'; end if;
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['order_issues','order_receipts','process_logs','inspections','warehouse_receipts'] loop
 execute format('create trigger b_guard_entry before insert or update or delete on public.%I for each row execute function private.guard_entry()',t);
 end loop;
end $$;
create function private.record_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
  insert into public.status_history(order_id,to_status,reason,changed_by,created_by) values(new.id,new.status,coalesce(new.status_reason,'Order created'),auth.uid(),new.created_by);
 elsif new.status is distinct from old.status then
  insert into public.status_history(order_id,from_status,to_status,reason,changed_by) values(new.id,old.status,new.status,new.status_reason,auth.uid());
 end if;
 return new;
end $$;
create trigger c_status_history after insert or update on public.orders for each row execute function private.record_status();
create function private.record_change() returns trigger language plpgsql security definer set search_path='' as $$
declare a jsonb; b jsonb; oid uuid; rid uuid; begin
 if TG_OP<>'INSERT' then a=to_jsonb(old); end if;
 if TG_OP<>'DELETE' then b=to_jsonb(new); end if;
 rid=coalesce((b->>'id')::uuid,(a->>'id')::uuid);
 oid=case when TG_TABLE_NAME='orders' then rid else coalesce((b->>'order_id')::uuid,(a->>'order_id')::uuid) end;
 insert into public.change_audit(table_name,record_id,order_id,action,old_data,new_data) values(TG_TABLE_NAME,rid,oid,TG_OP,a,b);
 if TG_OP='DELETE' then return old; end if; return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['profiles','customers','fabrics','processes','orders','order_issues','order_receipts','process_logs','inspections','warehouse_receipts'] loop
 execute format('create trigger z_change_audit after insert or update or delete on public.%I for each row execute function private.record_change()',t);
 end loop;
end $$;

-- Auth Admin API inserts the user before it writes custom app_metadata.
-- Check the final row at transaction end; unprovisioned signups still fail.
create or replace function private.on_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb;
  u auth.users%rowtype;
  actor uuid;
begin
  if TG_OP = 'INSERT' then
    select * into u from auth.users where id = new.id;
    if not found then
      return new;
    end if;

    m = u.raw_app_meta_data;
    if coalesce((m ->> 'plant_provisioned')::boolean, false) is not true then
      raise exception 'Public registration is disabled';
    end if;

    actor = nullif(m ->> 'created_by', '')::uuid;

    insert into public.profiles(
      id, username, full_name, real_email, role, created_by
    )
    values (
      u.id,
      m ->> 'username',
      m ->> 'full_name',
      nullif(m ->> 'real_email', ''),
      (m ->> 'role')::public.app_role,
      actor
    );

    insert into private.password_guards(id, temporary_hash, created_by)
    values (u.id, u.encrypted_password, actor);
  else
    m = new.raw_app_meta_data;

    -- A new user's profile is created by the deferred INSERT trigger.
    -- Existing users' resets remain immediate within the Auth transaction.
    if m ->> 'temporary_nonce'
      is distinct from old.raw_app_meta_data ->> 'temporary_nonce'
      and exists(select 1 from public.profiles where id = new.id)
    then
      update public.profiles
      set must_change_password = true
      where id = new.id;

      insert into private.password_guards(id, temporary_hash)
      values (new.id, new.encrypted_password)
      on conflict(id) do update
      set temporary_hash = excluded.temporary_hash,
          updated_at = now();
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists plant_provision on auth.users;
drop trigger if exists plant_provision_insert on auth.users;

create trigger plant_provision
after update of encrypted_password, raw_app_meta_data on auth.users
for each row execute function private.on_auth_user();

create constraint trigger plant_provision_insert
after insert on auth.users
deferrable initially deferred
for each row execute function private.on_auth_user();

create function public.complete_password_change(p_password text) returns void language plpgsql security definer set search_path='' as $$
declare current_hash text; temporary_hash text; begin
 if not public.is_active_user() then raise exception 'Inactive account'; end if;
 if p_password is null or length(p_password)<8 or octet_length(p_password)>72 then raise exception 'Password must have at least 8 characters and at most 72 UTF-8 bytes'; end if;
 -- Serialize with admin resets, using Auth's row lock before the profile lock.
 select regexp_replace(u.encrypted_password,'^\$2[by]\$','$2a$'),regexp_replace(g.temporary_hash,'^\$2[by]\$','$2a$') into current_hash,temporary_hash
 from auth.users u join private.password_guards g on g.id=u.id where u.id=auth.uid() for update of u;
 if current_hash is null or extensions.crypt(p_password,current_hash)<>current_hash then raise exception 'Set your new password in Auth before continuing'; end if;
 if extensions.crypt(p_password,temporary_hash)=temporary_hash then raise exception 'Choose a password different from your temporary password'; end if;
 update public.profiles set must_change_password=false where id=auth.uid();
 insert into public.login_audit(user_id,event) values(auth.uid(),'password_changed');
end $$;
create function public.record_login_event(p_event text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Inactive account'; end if;
 if p_event not in ('login','logout','session_expired') then raise exception 'Invalid event'; end if;
 if p_event='login' then update public.profiles set last_login=now() where id=auth.uid(); end if;
 insert into public.login_audit(user_id,event) values(auth.uid(),p_event);
end $$;
-- Invoker RPC preserves RLS and serializes stale UI updates. SQL trigger enforces field permissions too.
create function public.set_order_status(p_id uuid,p_status public.order_status,p_reason text,p_expected public.order_status) returns void language plpgsql security invoker set search_path='' as $$
declare s public.order_status; begin
 select status into s from public.orders where id=p_id for update;
 if s is null then raise exception 'Order not found or access denied'; end if;
 if s is distinct from p_expected then raise exception 'Order changed. Refresh and try again'; end if;
 if s=p_status then raise exception 'Choose a different status'; end if;
 update public.orders set status=p_status,status_reason=p_reason where id=p_id;
 if not found then raise exception 'Status change denied'; end if;
end $$;
-- Server-only role/state updates protect the last active admin under concurrent calls.
create function public.admin_profile_action(p_actor uuid,p_target uuid,p_role public.app_role default null,p_active boolean default null) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; begin
 perform pg_advisory_xact_lock(824165);
 if not exists(select 1 from public.profiles where id=p_actor and role='admin' and active and not must_change_password) then raise exception 'Active admin required'; end if;
 select * into p from public.profiles where id=p_target for update;
 if not found then raise exception 'User not found'; end if;
 if p_target=p_actor and (p_active=false or (p_role is not null and p_role<>'admin')) then raise exception 'You cannot deactivate or demote yourself'; end if;
 if p.role='admin' and p.active and (p_active=false or (p_role is not null and p_role<>'admin')) and not exists(select 1 from public.profiles where id<>p_target and role='admin' and active) then raise exception 'Keep at least one active admin'; end if;
 update public.profiles set role=coalesce(p_role,role),active=coalesce(p_active,active) where id=p_target;
 insert into public.login_audit(user_id,event,details,created_by) values(p_target,'admin_user_updated',jsonb_build_object('actor',p_actor,'role',p_role,'active',p_active),p_actor);
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.complete_password_change(text),public.record_login_event(text),public.set_order_status(uuid,public.order_status,text,public.order_status),public.admin_profile_action(uuid,uuid,public.app_role,boolean) from public,anon,authenticated;
grant execute on function public.complete_password_change(text),public.record_login_event(text),public.set_order_status(uuid,public.order_status,text,public.order_status) to authenticated;
grant execute on function public.admin_profile_action(uuid,uuid,public.app_role,boolean) to service_role;
create view public.order_dashboard with (security_invoker=true) as
select o.*, c.name as customer_name,f.quality_name,
 coalesce(i.total,0) as issued,coalesce(r.total,0) as received,coalesce(n.inspected,0) as inspected,
 coalesce(n.passed,0) as passed,coalesce(n.rejected,0) as rejected,coalesce(w.total,0) as in_warehouse,
 o.quantity-coalesce(w.total,0) as balance,o.status as current_stage,
 greatest(o.updated_at,i.activity,r.activity,p.activity,n.activity,w.activity,a.activity) as last_activity
from public.orders o join public.customers c on c.id=o.customer_id join public.fabrics f on f.id=o.fabric_id
left join lateral(select sum(meters) total,max(updated_at) activity from public.order_issues where order_id=o.id) i on true
left join lateral(select sum(meters) total,max(updated_at) activity from public.order_receipts where order_id=o.id) r on true
left join lateral(select max(updated_at) activity from public.process_logs where order_id=o.id) p on true
left join lateral(select sum(meters_inspected) inspected,sum(meters_passed) passed,sum(meters_rejected) rejected,max(updated_at) activity from public.inspections where order_id=o.id) n on true
left join lateral(select sum(meters) total,max(updated_at) activity from public.warehouse_receipts where order_id=o.id) w on true
left join lateral(select max(created_at) activity from public.change_audit where order_id=o.id) a on true;
revoke all on public.order_dashboard from anon;
grant select on public.order_dashboard to authenticated,service_role;
commit;
