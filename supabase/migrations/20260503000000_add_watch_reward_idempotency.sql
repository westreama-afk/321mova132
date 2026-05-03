begin;

alter table public.reward_ledger
  add column if not exists reward_key text;

create unique index if not exists reward_ledger_reward_key_unique
  on public.reward_ledger (user_id, reward_key)
  where reward_key is not null;

commit;
