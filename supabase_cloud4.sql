begin;

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

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

create table if not exists public.modules (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text not null default '',
  content text not null default '',
  topic text,
  difficulty text not null default 'Grundlagen',
  user_id uuid references auth.users(id) on delete set null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.module_sections (
  id uuid primary key default uuid_generate_v4(),
  module_id uuid not null references public.modules(id) on delete cascade,
  type text not null default 'schwerpunkte',
  title text not null default 'Abschnitt',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.module_pdfs (
  id uuid primary key default uuid_generate_v4(),
  module_id uuid not null references public.modules(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.decks (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  theme text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcards (
  id uuid primary key default uuid_generate_v4(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  front text not null,
  back text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deck_repetitions (
  id uuid primary key default uuid_generate_v4(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  repetition_count int not null default 0,
  last_known_count int not null default 0,
  last_unknown_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(deck_id, user_id)
);

create table if not exists public.quizzes (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text not null default '',
  module_id uuid references public.modules(id) on delete set null,
  difficulty text not null default 'Grundlagen',
  time_limit_seconds int,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id uuid primary key default uuid_generate_v4(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  type text not null default 'multiple_choice',
  question text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null default '[0]'::jsonb,
  feedback text not null default '',
  "order" int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text not null default '',
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles alter column role set not null;
alter table public.notes alter column title set not null;
alter table public.notes alter column teaser set not null;
alter table public.notes alter column body set not null;
alter table public.notes alter column category set not null;
alter table public.note_sections alter column heading set not null;
alter table public.note_sections alter column content set not null;
alter table public.search_words alter column word set not null;
alter table public.modules alter column title set not null;
alter table public.module_sections alter column type set not null;
alter table public.module_sections alter column title set not null;
alter table public.module_pdfs alter column name set not null;
alter table public.module_pdfs alter column url set not null;
alter table public.decks alter column title set not null;
alter table public.flashcards alter column front set not null;
alter table public.flashcards alter column back set not null;
alter table public.quizzes alter column title set not null;
alter table public.quiz_questions alter column question set not null;
alter table public.groups alter column name set not null;

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
create index if not exists modules_created_at_idx on public.modules (created_at desc);
create index if not exists module_sections_module_id_idx on public.module_sections (module_id);
create index if not exists module_pdfs_module_id_idx on public.module_pdfs (module_id);
create index if not exists decks_created_at_idx on public.decks (created_at desc);
create index if not exists flashcards_deck_id_idx on public.flashcards (deck_id);
create index if not exists quizzes_created_at_idx on public.quizzes (created_at desc);
create index if not exists quiz_questions_quiz_id_idx on public.quiz_questions (quiz_id, "order");
create index if not exists groups_name_idx on public.groups (name);

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

drop trigger if exists modules_set_updated_at on public.modules;
create trigger modules_set_updated_at
before update on public.modules
for each row execute procedure public.set_updated_at();

drop trigger if exists module_sections_set_updated_at on public.module_sections;
create trigger module_sections_set_updated_at
before update on public.module_sections
for each row execute procedure public.set_updated_at();

drop trigger if exists decks_set_updated_at on public.decks;
create trigger decks_set_updated_at
before update on public.decks
for each row execute procedure public.set_updated_at();

drop trigger if exists flashcards_set_updated_at on public.flashcards;
create trigger flashcards_set_updated_at
before update on public.flashcards
for each row execute procedure public.set_updated_at();

drop trigger if exists deck_repetitions_set_updated_at on public.deck_repetitions;
create trigger deck_repetitions_set_updated_at
before update on public.deck_repetitions
for each row execute procedure public.set_updated_at();

drop trigger if exists quizzes_set_updated_at on public.quizzes;
create trigger quizzes_set_updated_at
before update on public.quizzes
for each row execute procedure public.set_updated_at();

drop trigger if exists quiz_questions_set_updated_at on public.quiz_questions;
create trigger quiz_questions_set_updated_at
before update on public.quiz_questions
for each row execute procedure public.set_updated_at();

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
before update on public.groups
for each row execute procedure public.set_updated_at();

alter table public.user_roles enable row level security;
alter table public.notes enable row level security;
alter table public.note_sections enable row level security;
alter table public.search_words enable row level security;
alter table public.modules enable row level security;
alter table public.module_sections enable row level security;
alter table public.module_pdfs enable row level security;
alter table public.decks enable row level security;
alter table public.flashcards enable row level security;
alter table public.deck_repetitions enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.groups enable row level security;

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

drop policy if exists "modules_select_public_or_auth" on public.modules;
drop policy if exists "modules_insert_auth_or_admin" on public.modules;
drop policy if exists "modules_update_owner_or_admin" on public.modules;
drop policy if exists "modules_delete_owner_or_admin" on public.modules;
create policy "modules_select_public_or_auth" on public.modules for select using (is_published = true or auth.uid() is not null or public.is_admin());
create policy "modules_insert_auth_or_admin" on public.modules for insert with check (auth.uid() is not null);
create policy "modules_update_owner_or_admin" on public.modules for update using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
create policy "modules_delete_owner_or_admin" on public.modules for delete using (public.is_admin() or user_id = auth.uid());

drop policy if exists "module_sections_select_public_or_auth" on public.module_sections;
drop policy if exists "module_sections_insert_auth_or_admin" on public.module_sections;
drop policy if exists "module_sections_update_auth_or_admin" on public.module_sections;
drop policy if exists "module_sections_delete_auth_or_admin" on public.module_sections;
create policy "module_sections_select_public_or_auth" on public.module_sections for select using (exists(select 1 from public.modules m where m.id = module_sections.module_id and (m.is_published = true or auth.uid() is not null or public.is_admin())));
create policy "module_sections_insert_auth_or_admin" on public.module_sections for insert with check (auth.uid() is not null or public.is_admin());
create policy "module_sections_update_auth_or_admin" on public.module_sections for update using (auth.uid() is not null or public.is_admin()) with check (auth.uid() is not null or public.is_admin());
create policy "module_sections_delete_auth_or_admin" on public.module_sections for delete using (auth.uid() is not null or public.is_admin());

drop policy if exists "module_pdfs_select_public_or_auth" on public.module_pdfs;
drop policy if exists "module_pdfs_insert_auth_or_admin" on public.module_pdfs;
drop policy if exists "module_pdfs_delete_owner_or_admin" on public.module_pdfs;
create policy "module_pdfs_select_public_or_auth" on public.module_pdfs for select using (exists(select 1 from public.modules m where m.id = module_pdfs.module_id and (m.is_published = true or auth.uid() is not null or public.is_admin())));
create policy "module_pdfs_insert_auth_or_admin" on public.module_pdfs for insert with check (auth.uid() is not null or public.is_admin());
create policy "module_pdfs_delete_owner_or_admin" on public.module_pdfs for delete using (public.is_admin() or user_id = auth.uid());

drop policy if exists "decks_select_public_or_auth" on public.decks;
drop policy if exists "decks_insert_auth" on public.decks;
drop policy if exists "decks_update_owner_or_admin" on public.decks;
drop policy if exists "decks_delete_owner_or_admin" on public.decks;
create policy "decks_select_public_or_auth" on public.decks for select using (auth.uid() is not null or public.is_admin());
create policy "decks_insert_auth" on public.decks for insert with check (auth.uid() is not null);
create policy "decks_update_owner_or_admin" on public.decks for update using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
create policy "decks_delete_owner_or_admin" on public.decks for delete using (public.is_admin() or user_id = auth.uid());

drop policy if exists "flashcards_select_public_or_auth" on public.flashcards;
drop policy if exists "flashcards_insert_auth_or_admin" on public.flashcards;
drop policy if exists "flashcards_update_auth_or_admin" on public.flashcards;
drop policy if exists "flashcards_delete_auth_or_admin" on public.flashcards;
create policy "flashcards_select_public_or_auth" on public.flashcards for select using (exists(select 1 from public.decks d where d.id = flashcards.deck_id and (d.user_id = auth.uid() or auth.uid() is not null or public.is_admin())));
create policy "flashcards_insert_auth_or_admin" on public.flashcards for insert with check (auth.uid() is not null or public.is_admin());
create policy "flashcards_update_auth_or_admin" on public.flashcards for update using (auth.uid() is not null or public.is_admin()) with check (auth.uid() is not null or public.is_admin());
create policy "flashcards_delete_auth_or_admin" on public.flashcards for delete using (auth.uid() is not null or public.is_admin());

drop policy if exists "deck_repetitions_select_own_or_admin" on public.deck_repetitions;
drop policy if exists "deck_repetitions_insert_own_or_admin" on public.deck_repetitions;
drop policy if exists "deck_repetitions_update_own_or_admin" on public.deck_repetitions;
drop policy if exists "deck_repetitions_delete_own_or_admin" on public.deck_repetitions;
create policy "deck_repetitions_select_own_or_admin" on public.deck_repetitions for select using (user_id = auth.uid() or public.is_admin());
create policy "deck_repetitions_insert_own_or_admin" on public.deck_repetitions for insert with check (user_id = auth.uid() or public.is_admin());
create policy "deck_repetitions_update_own_or_admin" on public.deck_repetitions for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "deck_repetitions_delete_own_or_admin" on public.deck_repetitions for delete using (user_id = auth.uid() or public.is_admin());

drop policy if exists "quizzes_select_public_or_auth" on public.quizzes;
drop policy if exists "quizzes_insert_auth" on public.quizzes;
drop policy if exists "quizzes_update_owner_or_admin" on public.quizzes;
drop policy if exists "quizzes_delete_owner_or_admin" on public.quizzes;
create policy "quizzes_select_public_or_auth" on public.quizzes for select using (auth.uid() is not null or public.is_admin());
create policy "quizzes_insert_auth" on public.quizzes for insert with check (auth.uid() is not null);
create policy "quizzes_update_owner_or_admin" on public.quizzes for update using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
create policy "quizzes_delete_owner_or_admin" on public.quizzes for delete using (public.is_admin() or user_id = auth.uid());

drop policy if exists "quiz_questions_select_public_or_auth" on public.quiz_questions;
drop policy if exists "quiz_questions_insert_auth_or_admin" on public.quiz_questions;
drop policy if exists "quiz_questions_update_auth_or_admin" on public.quiz_questions;
drop policy if exists "quiz_questions_delete_auth_or_admin" on public.quiz_questions;
create policy "quiz_questions_select_public_or_auth" on public.quiz_questions for select using (exists(select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and (q.user_id = auth.uid() or auth.uid() is not null or public.is_admin())));
create policy "quiz_questions_insert_auth_or_admin" on public.quiz_questions for insert with check (auth.uid() is not null or public.is_admin());
create policy "quiz_questions_update_auth_or_admin" on public.quiz_questions for update using (auth.uid() is not null or public.is_admin()) with check (auth.uid() is not null or public.is_admin());
create policy "quiz_questions_delete_auth_or_admin" on public.quiz_questions for delete using (auth.uid() is not null or public.is_admin());

drop policy if exists "groups_select_auth_or_admin" on public.groups;
drop policy if exists "groups_insert_auth" on public.groups;
drop policy if exists "groups_update_owner_or_admin" on public.groups;
drop policy if exists "groups_delete_owner_or_admin" on public.groups;
create policy "groups_select_auth_or_admin" on public.groups for select using (auth.uid() is not null or public.is_admin());
create policy "groups_insert_auth" on public.groups for insert with check (auth.uid() is not null);
create policy "groups_update_owner_or_admin" on public.groups for update using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy "groups_delete_owner_or_admin" on public.groups for delete using (public.is_admin() or owner_id = auth.uid());

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
revoke all on public.modules from anon, authenticated;
revoke all on public.module_sections from anon, authenticated;
revoke all on public.module_pdfs from anon, authenticated;
revoke all on public.decks from anon, authenticated;
revoke all on public.flashcards from anon, authenticated;
revoke all on public.deck_repetitions from anon, authenticated;
revoke all on public.quizzes from anon, authenticated;
revoke all on public.quiz_questions from anon, authenticated;
revoke all on public.groups from anon, authenticated;

grant select on public.notes, public.note_sections, public.search_words to anon;
grant select, insert, update, delete on public.user_roles, public.notes, public.note_sections, public.search_words to authenticated;
grant select on public.modules, public.module_sections, public.module_pdfs, public.decks, public.flashcards, public.quizzes, public.quiz_questions, public.groups to anon;
grant select, insert, update, delete on public.modules, public.module_sections, public.module_pdfs, public.decks, public.flashcards, public.deck_repetitions, public.quizzes, public.quiz_questions, public.groups to authenticated;

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
