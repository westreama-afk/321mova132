begin;

-- Allow host to update room (episode/season changes)
create policy "Host can update their room"
  on public.party_rooms for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

-- Required so Realtime UPDATE events include all column values
-- (needed for the postgres_changes filter to work on UPDATE)
alter table public.party_rooms replica identity full;

commit;
