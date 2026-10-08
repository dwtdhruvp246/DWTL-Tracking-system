begin;

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

revoke all on function private.on_auth_user()
from public, anon, authenticated;

commit;
