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

  select next_number
    into allocated_number
    from public.customer_number_counters
   where user_id = auth.uid();

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
       set next_number = allocated_number + 1
     where user_id = auth.uid();
  end if;

  return allocated_number;
end;
$$;

revoke all on function public.allocate_customer_number() from public;
grant execute on function public.allocate_customer_number() to authenticated;
