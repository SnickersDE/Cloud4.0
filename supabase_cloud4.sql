begin;

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

drop trigger if exists notes_set_updated_at on public.notes;
drop trigger if exists note_sections_set_updated_at on public.note_sections;

drop function if exists public.search_notes(text, int);
drop function if exists public.set_updated_at();
drop function if exists public.is_admin();
drop function if exists public.is_admin(uuid);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  constraint user_roles_role_check check (role in ('admin','authenticated'))
);

create table if not exists public.notes (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  teaser text not null default '',
  body text not null default '',
  category text not null default 'Mitschrift',
  image_path text,
  author_id uuid references auth.users(id) on delete set null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.note_sections (
  id uuid primary key default uuid_generate_v4(),
  note_id uuid not null references public.notes(id) on delete cascade,
  heading text not null,
  content text not null default '',
  order_index int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.search_words (
  id uuid primary key default uuid_generate_v4(),
  note_id uuid not null references public.notes(id) on delete cascade,
  word text not null,
  created_at timestamptz not null default now()
);

alter table public.user_roles alter column role set not null;
alter table public.notes alter column title set not null;
alter table public.notes alter column teaser set not null;
alter table public.notes alter column body set not null;
alter table public.notes alter column category set not null;
alter table public.note_sections alter column heading set not null;
alter table public.note_sections alter column content set not null;
alter table public.search_words alter column word set not null;

create index if not exists notes_created_at_idx on public.notes (created_at desc);
create index if not exists notes_updated_at_idx on public.notes (updated_at desc);
create index if not exists notes_is_published_idx on public.notes (is_published);
create index if not exists notes_title_trgm_idx on public.notes using gin (title gin_trgm_ops);
create index if not exists notes_teaser_trgm_idx on public.notes using gin (teaser gin_trgm_ops);
create index if not exists notes_body_trgm_idx on public.notes using gin (body gin_trgm_ops);
create index if not exists note_sections_note_id_idx on public.note_sections (note_id, order_index);
create index if not exists search_words_note_id_idx on public.search_words (note_id);
create index if not exists search_words_word_trgm_idx on public.search_words using gin (word gin_trgm_ops);
create unique index if not exists search_words_note_word_unique_idx on public.search_words (note_id, lower(word));

create or replace function public.is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.user_roles ur
    where ur.user_id = check_user_id
      and ur.role = 'admin'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(auth.uid());
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
before update on public.notes
for each row execute procedure public.set_updated_at();

create trigger note_sections_set_updated_at
before update on public.note_sections
for each row execute procedure public.set_updated_at();

alter table public.user_roles enable row level security;
alter table public.notes enable row level security;
alter table public.note_sections enable row level security;
alter table public.search_words enable row level security;

drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
drop policy if exists "user_roles_insert_admin_only" on public.user_roles;
drop policy if exists "user_roles_update_admin_only" on public.user_roles;
drop policy if exists "user_roles_delete_admin_only" on public.user_roles;
drop policy if exists "user_roles_read_own_or_admin" on public.user_roles;
drop policy if exists "user_roles_admin_write" on public.user_roles;

create policy "user_roles_select_own_or_admin" on public.user_roles
for select
using (auth.uid() = user_id or public.is_admin());

create policy "user_roles_insert_admin_only" on public.user_roles
for insert
with check (public.is_admin());

create policy "user_roles_update_admin_only" on public.user_roles
for update
using (public.is_admin())
with check (public.is_admin());

create policy "user_roles_delete_admin_only" on public.user_roles
for delete
using (public.is_admin());

drop policy if exists "notes_select_public_or_admin" on public.notes;
drop policy if exists "notes_insert_admin_only" on public.notes;
drop policy if exists "notes_update_admin_only" on public.notes;
drop policy if exists "notes_delete_admin_only" on public.notes;
drop policy if exists "notes_public_select_published" on public.notes;
drop policy if exists "notes_admin_write" on public.notes;

create policy "notes_select_public_or_admin" on public.notes
for select
using (is_published = true or public.is_admin());

create policy "notes_insert_admin_only" on public.notes
for insert
with check (public.is_admin());

create policy "notes_update_admin_only" on public.notes
for update
using (public.is_admin())
with check (public.is_admin());

create policy "notes_delete_admin_only" on public.notes
for delete
using (public.is_admin());

drop policy if exists "note_sections_select_public_or_admin" on public.note_sections;
drop policy if exists "note_sections_insert_admin_only" on public.note_sections;
drop policy if exists "note_sections_update_admin_only" on public.note_sections;
drop policy if exists "note_sections_delete_admin_only" on public.note_sections;
drop policy if exists "note_sections_public_select" on public.note_sections;
drop policy if exists "note_sections_admin_write" on public.note_sections;

create policy "note_sections_select_public_or_admin" on public.note_sections
for select
using (
  exists (
    select 1
    from public.notes n
    where n.id = note_sections.note_id
      and (n.is_published = true or public.is_admin())
  )
);

create policy "note_sections_insert_admin_only" on public.note_sections
for insert
with check (public.is_admin());

create policy "note_sections_update_admin_only" on public.note_sections
for update
using (public.is_admin())
with check (public.is_admin());

create policy "note_sections_delete_admin_only" on public.note_sections
for delete
using (public.is_admin());

drop policy if exists "search_words_select_public_or_admin" on public.search_words;
drop policy if exists "search_words_insert_admin_only" on public.search_words;
drop policy if exists "search_words_update_admin_only" on public.search_words;
drop policy if exists "search_words_delete_admin_only" on public.search_words;
drop policy if exists "search_words_public_select" on public.search_words;
drop policy if exists "search_words_admin_write" on public.search_words;

create policy "search_words_select_public_or_admin" on public.search_words
for select
using (
  exists (
    select 1
    from public.notes n
    where n.id = search_words.note_id
      and (n.is_published = true or public.is_admin())
  )
);

create policy "search_words_insert_admin_only" on public.search_words
for insert
with check (public.is_admin());

create policy "search_words_update_admin_only" on public.search_words
for update
using (public.is_admin())
with check (public.is_admin());

create policy "search_words_delete_admin_only" on public.search_words
for delete
using (public.is_admin());

create or replace function public.search_notes(query_text text, result_limit int default 30)
returns table (
  id uuid,
  title text,
  teaser text,
  body text,
  category text,
  image_path text,
  created_at timestamptz,
  updated_at timestamptz,
  rank_score numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    n.id,
    n.title,
    n.teaser,
    n.body,
    n.category,
    n.image_path,
    n.created_at,
    n.updated_at,
    (
      similarity(n.title, query_text) * 6
      + similarity(n.teaser, query_text) * 3
      + similarity(n.body, query_text)
      + coalesce(max(similarity(sw.word, query_text)) * 4, 0)
    ) as rank_score
  from public.notes n
  left join public.search_words sw on sw.note_id = n.id
  where
    (n.is_published = true or public.is_admin())
    and (
      n.title ilike '%' || query_text || '%'
      or n.teaser ilike '%' || query_text || '%'
      or n.body ilike '%' || query_text || '%'
      or sw.word ilike '%' || query_text || '%'
    )
  group by n.id
  order by rank_score desc, n.updated_at desc
  limit greatest(result_limit, 1);
$$;

revoke all on schema public from public;
grant usage on schema public to anon, authenticated;

revoke all on public.user_roles from anon, authenticated;
revoke all on public.notes from anon, authenticated;
revoke all on public.note_sections from anon, authenticated;
revoke all on public.search_words from anon, authenticated;

grant select on public.notes, public.note_sections, public.search_words to anon;
grant select, insert, update, delete on public.user_roles, public.notes, public.note_sections, public.search_words to authenticated;

revoke all on function public.search_notes(text, int) from public;
grant execute on function public.search_notes(text, int) to anon, authenticated;

insert into public.notes (title, teaser, body, category, image_path, is_published)
select
  'Cloud4.0 Modulararchitektur',
  'Überblick über die Integration von Zusammenfassungen, Karteikarten, Quiz und Spielen.',
  'Die Plattform verbindet alle Lernbereiche in einer Oberfläche. Module liefern Mitschriften, daraus entstehen Karteikarten und Quiz-Sets.',
  'Mitschrift',
  '/images/articles/cloud4-modularchitektur.svg',
  true
where not exists (select 1 from public.notes where title = 'Cloud4.0 Modulararchitektur');

insert into public.notes (title, teaser, body, category, image_path, is_published)
select
  'Cloud4.0 Lernfluss',
  'So läuft der Weg von Upload bis Lernmaterial.',
  'Nach dem Upload werden Inhalte segmentiert, zusammengefasst und als Lernkarten sowie Quiz bereitgestellt.',
  'Mitschrift',
  '/images/articles/cloud4-lernfluss.svg',
  true
where not exists (select 1 from public.notes where title = 'Cloud4.0 Lernfluss');

insert into public.notes (title, teaser, body, category, image_path, is_published)
select
  'Cloud4.0 Prüfungsmodus',
  'Schwierigkeitsstufen und Zeitlimits im Quiz-Bereich.',
  'Quiz-Sets sind in Grundlagen, Vertiefung und Prüfungsvorbereitung gegliedert.',
  'Quiz',
  '/images/articles/cloud4-quizsystem.svg',
  true
where not exists (select 1 from public.notes where title = 'Cloud4.0 Prüfungsmodus');

insert into public.notes (title, teaser, body, category, image_path, is_published)
select
  'Cloud4.0 Admin Workflow',
  'Wie Admins Mitschriften und Suchwörter pflegen.',
  'Der Admin-Bereich erlaubt das Erstellen, Bearbeiten und Entfernen von Mitschriften inklusive Suchwortverwaltung.',
  'Admin',
  '/images/articles/cloud4-admin-workflow.svg',
  true
where not exists (select 1 from public.notes where title = 'Cloud4.0 Admin Workflow');

insert into public.note_sections (note_id, heading, content, order_index)
select n.id, 'Schwerpunkte', n.body, 1
from public.notes n
where n.title in ('Cloud4.0 Modulararchitektur','Cloud4.0 Lernfluss','Cloud4.0 Prüfungsmodus','Cloud4.0 Admin Workflow')
and not exists (select 1 from public.note_sections ns where ns.note_id = n.id and ns.heading = 'Schwerpunkte');

insert into public.search_words (note_id, word)
select n.id, w.word
from public.notes n
join (
  values
    ('Cloud4.0 Modulararchitektur','integration'),
    ('Cloud4.0 Modulararchitektur','module'),
    ('Cloud4.0 Lernfluss','pipeline'),
    ('Cloud4.0 Lernfluss','zusammenfassung'),
    ('Cloud4.0 Prüfungsmodus','quiz'),
    ('Cloud4.0 Prüfungsmodus','pruefung'),
    ('Cloud4.0 Admin Workflow','admin'),
    ('Cloud4.0 Admin Workflow','suchwoerter')
) as w(title, word) on w.title = n.title
where not exists (
  select 1 from public.search_words sw where sw.note_id = n.id and lower(sw.word) = lower(w.word)
);

commit;
