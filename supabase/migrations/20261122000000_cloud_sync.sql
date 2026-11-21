-- Cloud sync for Syllabus Tracker.
-- One row per user and collection. Clients read their own rows and write only through
-- sync_push_collections, which rejects a write based on an out-of-date version.

create table public.user_collections (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key in (
    'progress', 'sharedLearning', 'practice', 'weightOverrides',
    'syncSettings', 'planner', 'progressConfig', 'history'
  )),
  data jsonb,
  version bigint not null check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_collections enable row level security;

create policy "Users can read their own collections"
  on public.user_collections
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.user_collections from anon, authenticated, public;
grant select on table public.user_collections to authenticated;

-- p_entries: [{ "key": "progress", "data": {...} or null, "base_version": 3 }, ...]
-- All entries are saved together, or none are.
create function public.sync_push_collections(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_entry jsonb;
  v_key text;
  v_base bigint;
  v_current bigint;
  v_conflicts jsonb := '[]'::jsonb;
  v_versions jsonb := '[]'::jsonb;
  v_allowed constant text[] := array[
    'progress', 'sharedLearning', 'practice', 'weightOverrides',
    'syncSettings', 'planner', 'progressConfig', 'history'
  ];
  v_seen text[] := array[]::text[];
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array'
     or jsonb_array_length(p_entries) not between 1 and 8 then
    raise exception 'p_entries must be a list of 1 to 8 collections' using errcode = '22023';
  end if;

  -- One writer per user at a time, including when a row does not exist yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_key := v_entry ->> 'key';
    if v_key is null or not (v_key = any (v_allowed)) then
      raise exception 'Unknown collection' using errcode = '22023';
    end if;
    if v_key = any (v_seen) then
      raise exception 'Duplicate collection in request' using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;
    if jsonb_typeof(v_entry -> 'base_version') is distinct from 'number'
       or (v_entry ->> 'base_version') !~ '^[0-9]+$' then
      raise exception 'base_version must be a whole number' using errcode = '22023';
    end if;
    if not (v_entry ? 'data')
       or jsonb_typeof(v_entry -> 'data') not in ('object', 'null') then
      raise exception 'data must be an object or null' using errcode = '22023';
    end if;
    if pg_catalog.octet_length((v_entry -> 'data')::text) > 5242880 then
      raise exception 'Collection is larger than 5 MB' using errcode = '54000';
    end if;

    v_base := (v_entry ->> 'base_version')::bigint;
    select c.version into v_current
    from public.user_collections c
    where c.user_id = v_user and c.key = v_key;
    v_current := coalesce(v_current, 0);

    if v_current <> v_base then
      v_conflicts := v_conflicts || jsonb_build_object('key', v_key, 'version', v_current);
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_key := v_entry ->> 'key';
    v_base := (v_entry ->> 'base_version')::bigint;
    insert into public.user_collections as c (user_id, key, data, version, updated_at)
    values (
      v_user,
      v_key,
      case when jsonb_typeof(v_entry -> 'data') = 'null' then null else v_entry -> 'data' end,
      v_base + 1,
      pg_catalog.now()
    )
    on conflict (user_id, key) do update
      set data = excluded.data, version = excluded.version, updated_at = excluded.updated_at;
    v_versions := v_versions || jsonb_build_object('key', v_key, 'version', v_base + 1);
  end loop;

  return jsonb_build_object('ok', true, 'versions', v_versions);
end;
$$;

revoke all on function public.sync_push_collections(jsonb) from public, anon;
grant execute on function public.sync_push_collections(jsonb) to authenticated;
