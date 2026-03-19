begin;

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

drop function if exists public.search_notes(text, int);
drop function if exists public.handle_new_user();
drop function if exists public.sync_admin_role();

drop trigger if exists on_auth_user_created on auth.users;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  constraint user_roles_role_check check (role in ('admin','authenticated'))
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  is_published boolean not null default true,
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
  is_published boolean not null default true,
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

create table if not exists public.friendships (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted',
  created_at timestamptz not null default now(),
  unique(user_id, friend_user_id)
);

create table if not exists public.group_members (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique(group_id, user_id)
);

create table if not exists public.game_leaderboards (
  id uuid primary key default uuid_generate_v4(),
  game_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  score int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.notes add column if not exists teaser text default '';
alter table public.notes add column if not exists body text default '';
alter table public.notes add column if not exists category text default 'Mitschrift';
alter table public.notes add column if not exists image_path text;
alter table public.notes add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.notes add column if not exists is_published boolean default true;
alter table public.notes add column if not exists created_at timestamptz default now();
alter table public.notes add column if not exists updated_at timestamptz default now();

alter table public.modules add column if not exists description text default '';
alter table public.modules add column if not exists content text default '';
alter table public.modules add column if not exists topic text;
alter table public.modules add column if not exists difficulty text default 'Grundlagen';
alter table public.modules add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.modules add column if not exists is_published boolean default true;
alter table public.modules add column if not exists created_at timestamptz default now();
alter table public.modules add column if not exists updated_at timestamptz default now();

alter table public.note_sections add column if not exists order_index int default 1;
alter table public.note_sections add column if not exists created_at timestamptz default now();
alter table public.note_sections add column if not exists updated_at timestamptz default now();
alter table public.search_words add column if not exists created_at timestamptz default now();

alter table public.module_sections add column if not exists type text default 'schwerpunkte';
alter table public.module_sections add column if not exists title text default 'Abschnitt';
alter table public.module_sections add column if not exists content text default '';
alter table public.module_sections add column if not exists created_at timestamptz default now();
alter table public.module_sections add column if not exists updated_at timestamptz default now();

alter table public.module_pdfs add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.module_pdfs add column if not exists name text;
alter table public.module_pdfs add column if not exists url text;
alter table public.module_pdfs add column if not exists created_at timestamptz default now();

alter table public.decks add column if not exists theme text;
alter table public.decks add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.decks add column if not exists is_published boolean default true;
alter table public.decks add column if not exists created_at timestamptz default now();
alter table public.decks add column if not exists updated_at timestamptz default now();

alter table public.flashcards add column if not exists status text default 'new';
alter table public.flashcards add column if not exists created_at timestamptz default now();
alter table public.flashcards add column if not exists updated_at timestamptz default now();

alter table public.deck_repetitions add column if not exists repetition_count int default 0;
alter table public.deck_repetitions add column if not exists last_known_count int default 0;
alter table public.deck_repetitions add column if not exists last_unknown_count int default 0;
alter table public.deck_repetitions add column if not exists created_at timestamptz default now();
alter table public.deck_repetitions add column if not exists updated_at timestamptz default now();

alter table public.quizzes add column if not exists description text default '';
alter table public.quizzes add column if not exists module_id uuid references public.modules(id) on delete set null;
alter table public.quizzes add column if not exists difficulty text default 'Grundlagen';
alter table public.quizzes add column if not exists time_limit_seconds int;
alter table public.quizzes add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.quizzes add column if not exists is_published boolean default true;
alter table public.quizzes add column if not exists created_at timestamptz default now();
alter table public.quizzes add column if not exists updated_at timestamptz default now();

alter table public.quiz_questions add column if not exists type text default 'multiple_choice';
alter table public.quiz_questions add column if not exists options jsonb default '[]'::jsonb;
alter table public.quiz_questions add column if not exists correct_answer jsonb default '[0]'::jsonb;
alter table public.quiz_questions add column if not exists feedback text default '';
alter table public.quiz_questions add column if not exists "order" int default 0;
alter table public.quiz_questions add column if not exists created_at timestamptz default now();
alter table public.quiz_questions add column if not exists updated_at timestamptz default now();

alter table public.groups add column if not exists description text default '';
alter table public.groups add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.groups add column if not exists created_at timestamptz default now();
alter table public.groups add column if not exists updated_at timestamptz default now();
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists about_me text default '';
alter table public.profiles add column if not exists study_program text default '';
alter table public.profiles add column if not exists friendship_code text;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz default now();
alter table public.friendships add column if not exists status text default 'accepted';
alter table public.friendships add column if not exists created_at timestamptz default now();
alter table public.group_members add column if not exists role text default 'member';
alter table public.group_members add column if not exists created_at timestamptz default now();
alter table public.game_leaderboards add column if not exists score int default 0;
alter table public.game_leaderboards add column if not exists created_at timestamptz default now();

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
create index if not exists profiles_username_idx on public.profiles (username);
create unique index if not exists profiles_friendship_code_unique_idx on public.profiles (friendship_code);
create index if not exists friendships_user_idx on public.friendships (user_id, friend_user_id);
create index if not exists group_members_group_idx on public.group_members (group_id, user_id);
create index if not exists game_leaderboards_game_idx on public.game_leaderboards (game_id, score desc);

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

create or replace function public.sync_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, full_name, friendship_code)
  values (
    new.id,
    new.email,
    split_part(coalesce(new.email, ''), '@', 1),
    split_part(coalesce(new.email, ''), '@', 1),
    upper(substr(md5(new.id::text || coalesce(new.email, '') || now()::text), 1, 10))
  )
  on conflict (id) do update
    set email = excluded.email,
        username = coalesce(public.profiles.username, excluded.username),
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        friendship_code = coalesce(public.profiles.friendship_code, excluded.friendship_code);

  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case when lower(coalesce(new.email, '')) = lower('Florian_97@live.de') then 'admin' else 'authenticated' end
  )
  on conflict (user_id) do update
    set role = case when lower(coalesce(new.email, '')) = lower('Florian_97@live.de') then 'admin' else public.user_roles.role end;

  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
before update on public.notes
for each row execute procedure public.set_updated_at();

drop trigger if exists note_sections_set_updated_at on public.note_sections;
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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.sync_admin_role();

alter table public.user_roles enable row level security;
alter table public.profiles enable row level security;
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
alter table public.friendships enable row level security;
alter table public.group_members enable row level security;
alter table public.game_leaderboards enable row level security;

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

drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_insert_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "profiles_delete_own_or_admin" on public.profiles;
create policy "profiles_select_public" on public.profiles for select using (true);
create policy "profiles_insert_own_or_admin" on public.profiles for insert with check (id = auth.uid() or public.is_admin());
create policy "profiles_update_own_or_admin" on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "profiles_delete_own_or_admin" on public.profiles for delete using (id = auth.uid() or public.is_admin());

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
create policy "module_sections_insert_auth_or_admin" on public.module_sections for insert with check (exists(select 1 from public.modules m where m.id = module_sections.module_id and (m.user_id = auth.uid() or public.is_admin())));
create policy "module_sections_update_auth_or_admin" on public.module_sections for update using (exists(select 1 from public.modules m where m.id = module_sections.module_id and (m.user_id = auth.uid() or public.is_admin()))) with check (exists(select 1 from public.modules m where m.id = module_sections.module_id and (m.user_id = auth.uid() or public.is_admin())));
create policy "module_sections_delete_auth_or_admin" on public.module_sections for delete using (exists(select 1 from public.modules m where m.id = module_sections.module_id and (m.user_id = auth.uid() or public.is_admin())));

drop policy if exists "module_pdfs_select_public_or_auth" on public.module_pdfs;
drop policy if exists "module_pdfs_insert_auth_or_admin" on public.module_pdfs;
drop policy if exists "module_pdfs_delete_owner_or_admin" on public.module_pdfs;
create policy "module_pdfs_select_public_or_auth" on public.module_pdfs for select using (exists(select 1 from public.modules m where m.id = module_pdfs.module_id and (m.is_published = true or auth.uid() is not null or public.is_admin())));
create policy "module_pdfs_insert_auth_or_admin" on public.module_pdfs for insert with check (exists(select 1 from public.modules m where m.id = module_pdfs.module_id and (m.user_id = auth.uid() or public.is_admin())));
create policy "module_pdfs_delete_owner_or_admin" on public.module_pdfs for delete using (public.is_admin() or user_id = auth.uid() or exists(select 1 from public.modules m where m.id = module_pdfs.module_id and m.user_id = auth.uid()));

drop policy if exists "decks_select_public_or_auth" on public.decks;
drop policy if exists "decks_insert_auth" on public.decks;
drop policy if exists "decks_update_owner_or_admin" on public.decks;
drop policy if exists "decks_delete_owner_or_admin" on public.decks;
create policy "decks_select_public_or_auth" on public.decks for select using (is_published = true or user_id = auth.uid() or public.is_admin());
create policy "decks_insert_auth" on public.decks for insert with check (auth.uid() is not null);
create policy "decks_update_owner_or_admin" on public.decks for update using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
create policy "decks_delete_owner_or_admin" on public.decks for delete using (public.is_admin() or user_id = auth.uid());

drop policy if exists "flashcards_select_public_or_auth" on public.flashcards;
drop policy if exists "flashcards_insert_auth_or_admin" on public.flashcards;
drop policy if exists "flashcards_update_auth_or_admin" on public.flashcards;
drop policy if exists "flashcards_delete_auth_or_admin" on public.flashcards;
create policy "flashcards_select_public_or_auth" on public.flashcards for select using (exists(select 1 from public.decks d where d.id = flashcards.deck_id and (d.is_published = true or d.user_id = auth.uid() or public.is_admin())));
create policy "flashcards_insert_auth_or_admin" on public.flashcards for insert with check (exists(select 1 from public.decks d where d.id = flashcards.deck_id and (d.user_id = auth.uid() or public.is_admin())));
create policy "flashcards_update_auth_or_admin" on public.flashcards for update using (exists(select 1 from public.decks d where d.id = flashcards.deck_id and (d.user_id = auth.uid() or public.is_admin()))) with check (exists(select 1 from public.decks d where d.id = flashcards.deck_id and (d.user_id = auth.uid() or public.is_admin())));
create policy "flashcards_delete_auth_or_admin" on public.flashcards for delete using (exists(select 1 from public.decks d where d.id = flashcards.deck_id and (d.user_id = auth.uid() or public.is_admin())));

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
create policy "quizzes_select_public_or_auth" on public.quizzes for select using (is_published = true or user_id = auth.uid() or public.is_admin());
create policy "quizzes_insert_auth" on public.quizzes for insert with check (auth.uid() is not null);
create policy "quizzes_update_owner_or_admin" on public.quizzes for update using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
create policy "quizzes_delete_owner_or_admin" on public.quizzes for delete using (public.is_admin() or user_id = auth.uid());

drop policy if exists "quiz_questions_select_public_or_auth" on public.quiz_questions;
drop policy if exists "quiz_questions_insert_auth_or_admin" on public.quiz_questions;
drop policy if exists "quiz_questions_update_auth_or_admin" on public.quiz_questions;
drop policy if exists "quiz_questions_delete_auth_or_admin" on public.quiz_questions;
create policy "quiz_questions_select_public_or_auth" on public.quiz_questions for select using (exists(select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and (q.is_published = true or q.user_id = auth.uid() or public.is_admin())));
create policy "quiz_questions_insert_auth_or_admin" on public.quiz_questions for insert with check (exists(select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and (q.user_id = auth.uid() or public.is_admin())));
create policy "quiz_questions_update_auth_or_admin" on public.quiz_questions for update using (exists(select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and (q.user_id = auth.uid() or public.is_admin()))) with check (exists(select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and (q.user_id = auth.uid() or public.is_admin())));
create policy "quiz_questions_delete_auth_or_admin" on public.quiz_questions for delete using (exists(select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and (q.user_id = auth.uid() or public.is_admin())));

drop policy if exists "groups_select_auth_or_admin" on public.groups;
drop policy if exists "groups_insert_auth" on public.groups;
drop policy if exists "groups_update_owner_or_admin" on public.groups;
drop policy if exists "groups_delete_owner_or_admin" on public.groups;
create policy "groups_select_auth_or_admin" on public.groups for select using (auth.uid() is not null or public.is_admin());
create policy "groups_insert_auth" on public.groups for insert with check (auth.uid() is not null);
create policy "groups_update_owner_or_admin" on public.groups for update using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy "groups_delete_owner_or_admin" on public.groups for delete using (public.is_admin() or owner_id = auth.uid());

drop policy if exists "friendships_select_own_or_public_friend" on public.friendships;
drop policy if exists "friendships_insert_own_or_admin" on public.friendships;
drop policy if exists "friendships_update_own_or_admin" on public.friendships;
drop policy if exists "friendships_delete_own_or_admin" on public.friendships;
create policy "friendships_select_own_or_public_friend" on public.friendships for select using (user_id = auth.uid() or friend_user_id = auth.uid() or public.is_admin());
create policy "friendships_insert_own_or_admin" on public.friendships for insert with check (user_id = auth.uid() or public.is_admin());
create policy "friendships_update_own_or_admin" on public.friendships for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "friendships_delete_own_or_admin" on public.friendships for delete using (user_id = auth.uid() or public.is_admin());

drop policy if exists "group_members_select_auth_or_admin" on public.group_members;
drop policy if exists "group_members_insert_owner_or_admin" on public.group_members;
drop policy if exists "group_members_update_owner_or_admin" on public.group_members;
drop policy if exists "group_members_delete_owner_or_admin" on public.group_members;
create policy "group_members_select_auth_or_admin" on public.group_members for select using (auth.uid() is not null or public.is_admin());
create policy "group_members_insert_owner_or_admin" on public.group_members for insert with check (public.is_admin() or exists(select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid()));
create policy "group_members_update_owner_or_admin" on public.group_members for update using (public.is_admin() or exists(select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid()));
create policy "group_members_delete_owner_or_admin" on public.group_members for delete using (public.is_admin() or exists(select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid()));

drop policy if exists "game_leaderboards_select_public" on public.game_leaderboards;
drop policy if exists "game_leaderboards_insert_auth" on public.game_leaderboards;
drop policy if exists "game_leaderboards_update_own_or_admin" on public.game_leaderboards;
drop policy if exists "game_leaderboards_delete_own_or_admin" on public.game_leaderboards;
create policy "game_leaderboards_select_public" on public.game_leaderboards for select using (true);
create policy "game_leaderboards_insert_auth" on public.game_leaderboards for insert with check (auth.uid() is not null and user_id = auth.uid());
create policy "game_leaderboards_update_own_or_admin" on public.game_leaderboards for update using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
create policy "game_leaderboards_delete_own_or_admin" on public.game_leaderboards for delete using (public.is_admin() or user_id = auth.uid());

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
revoke all on public.profiles from anon, authenticated;
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
revoke all on public.friendships from anon, authenticated;
revoke all on public.group_members from anon, authenticated;
revoke all on public.game_leaderboards from anon, authenticated;

grant select on public.notes, public.note_sections, public.search_words to anon;
grant select, insert, update, delete on public.user_roles, public.notes, public.note_sections, public.search_words to authenticated;
grant select on public.modules, public.module_sections, public.module_pdfs, public.decks, public.flashcards, public.quizzes, public.quiz_questions, public.groups to anon;
grant select on public.profiles to anon;
grant select on public.game_leaderboards to anon;
grant select, insert, update, delete on public.profiles, public.modules, public.module_sections, public.module_pdfs, public.decks, public.flashcards, public.deck_repetitions, public.quizzes, public.quiz_questions, public.groups, public.friendships, public.group_members, public.game_leaderboards to authenticated;

revoke all on function public.search_notes(text, int) from public;
grant execute on function public.search_notes(text, int) to anon, authenticated;

alter table public.notes replica identity full;
alter table public.note_sections replica identity full;
alter table public.search_words replica identity full;
alter table public.modules replica identity full;
alter table public.module_sections replica identity full;
alter table public.module_pdfs replica identity full;
alter table public.decks replica identity full;
alter table public.flashcards replica identity full;
alter table public.deck_repetitions replica identity full;
alter table public.quizzes replica identity full;
alter table public.quiz_questions replica identity full;
alter table public.groups replica identity full;
alter table public.friendships replica identity full;
alter table public.group_members replica identity full;
alter table public.game_leaderboards replica identity full;
alter table public.profiles replica identity full;
alter table public.user_roles replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.notes'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.note_sections'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.search_words'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.modules'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.module_sections'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.module_pdfs'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.decks'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.flashcards'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.deck_repetitions'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.quizzes'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.quiz_questions'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.groups'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.friendships'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.group_members'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.game_leaderboards'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.profiles'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.user_roles'; exception when duplicate_object then null; end;
  end if;
end $$;

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
