begin;

create or replace function public.redeem_premium_code(p_code text, p_user_id uuid)
returns table (code_id bigint, plan text, duration_days integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  matched_code public.premium_codes%rowtype;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_code is null or char_length(trim(p_code)) = 0 then
    raise exception 'INVALID_CODE';
  end if;

  select *
  into matched_code
  from public.premium_codes c
  where upper(trim(c.code)) = upper(trim(p_code))
    and c.active = true
  for update;

  if not found then
    raise exception 'CODE_NOT_FOUND';
  end if;

  if matched_code.expires_at is not null and matched_code.expires_at <= now() then
    raise exception 'CODE_EXPIRED';
  end if;

  if exists (
    select 1
    from public.premium_code_redemptions r
    where r.code_id = matched_code.id
      and r.user_id = p_user_id
  ) then
    raise exception 'CODE_ALREADY_REDEEMED';
  end if;

  if matched_code.redemption_count >= matched_code.max_redemptions then
    raise exception 'CODE_REDEMPTION_LIMIT_REACHED';
  end if;

  insert into public.premium_code_redemptions (code_id, user_id, applied_plan, applied_days)
  values (matched_code.id, p_user_id, matched_code.plan, matched_code.duration_days);

  update public.premium_codes c
  set
    redemption_count = c.redemption_count + 1,
    last_redeemed_at = now(),
    last_redeemed_by = p_user_id,
    updated_at = now(),
    active = case
      when c.redemption_count + 1 >= c.max_redemptions then false
      else c.active
    end
  where c.id = matched_code.id;

  return query
  select matched_code.id, matched_code.plan, matched_code.duration_days;
end;
$function$;

revoke all on function public.redeem_premium_code(text, uuid) from public;
grant execute on function public.redeem_premium_code(text, uuid) to service_role;

commit;
