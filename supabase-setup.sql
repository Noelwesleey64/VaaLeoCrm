-- Run this file in Supabase Dashboard > SQL Editor.
-- The app uses the publishable/anon key only. Never put a service-role key in the app.

create table if not exists public.measurement_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  colour text,
  garment_style text,
  tel text,
  record_number text,
  date text,
  measurements jsonb not null default '{}'::jsonb,
  design_images jsonb not null default '[]'::jsonb,
  fabric_images jsonb not null default '[]'::jsonb,
  notes text,
  collection_date text,
  recorded_in text,
  approval text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

alter table public.measurement_records enable row level security;

drop policy if exists "Users can read their own measurement records" on public.measurement_records;
create policy "Users can read their own measurement records"
  on public.measurement_records for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own measurement records" on public.measurement_records;
create policy "Users can insert their own measurement records"
  on public.measurement_records for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own measurement records" on public.measurement_records;
create policy "Users can update their own measurement records"
  on public.measurement_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists measurement_records_user_updated_idx
  on public.measurement_records (user_id, updated_at desc);

create table if not exists public.customer_number_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  next_number bigint not null check (next_number > 0)
);

alter table public.customer_number_counters enable row level security;

create or replace function public.allocate_customer_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  allocated_number bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to allocate a customer number';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select next_number into allocated_number
    from public.customer_number_counters where user_id = auth.uid();

  if allocated_number is null then
    select coalesce(max(record_number::bigint), 0) + 1
      into allocated_number
      from public.measurement_records
     where user_id = auth.uid()
       and record_number ~ '^[1-9][0-9]{0,5}$';
    insert into public.customer_number_counters (user_id, next_number)
    values (auth.uid(), allocated_number + 1);
  else
    update public.customer_number_counters
       set next_number = allocated_number + 1 where user_id = auth.uid();
  end if;

  return allocated_number;
end;
$$;

revoke all on function public.allocate_customer_number() from public;
grant execute on function public.allocate_customer_number() to authenticated;
