-- AIRa station metadata used by the app and its radio pipeline.
create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  frequency numeric(4, 1) not null unique check (frequency > 0),
  rj_name text not null check (length(trim(rj_name)) > 0),
  language text not null check (length(trim(language)) > 0),
  vibe_category text not null check (length(trim(vibe_category)) > 0)
);

insert into public.stations (frequency, rj_name, language, vibe_category)
values
  (98.3, 'RJ Kabir', 'Hinglish', 'Bollywood & News'),
  (104.2, 'RJ Aarya', 'Marathi', 'Marathi Gold'),
  (92.7, 'RJ Kavya', 'Tamil', 'Tamil Hits')
on conflict (frequency) do nothing;

-- Station metadata is public, but browser clients cannot modify it.
alter table public.stations enable row level security;

grant select on public.stations to anon, authenticated;

drop policy if exists "Stations are publicly readable" on public.stations;

create policy "Stations are publicly readable"
  on public.stations
  for select
  to anon, authenticated
  using (true);
