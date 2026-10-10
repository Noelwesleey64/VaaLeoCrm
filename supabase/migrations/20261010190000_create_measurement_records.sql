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
