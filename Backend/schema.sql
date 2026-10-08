-- Tally schema. Safe to run more than once.
-- Run with:  npm run db:init   (or paste into the Supabase SQL editor)

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  name        text,
  provider    text not null default 'google',
  google_id   text unique,                 -- optional: use it or ignore it in auth.js
  created_at  timestamptz not null default now()
);

create table if not exists lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  recurrence  text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  created_at  timestamptz not null default now()
);
create index if not exists lists_user_idx on lists (user_id);

create table if not exists tasks (
  id             uuid primary key default gen_random_uuid(),
  list_id        uuid not null references lists(id) on delete cascade,
  title          text not null,
  description    text not null default '',
  due_date       date,
  priority       text not null default 'medium' check (priority in ('low','medium','high')),
  is_complete    boolean not null default false,
  recurrence     text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  order_index    integer not null default 0,        -- drag-and-drop position within a list
  next_generated boolean not null default false,    -- true once the next repeat has been created
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists tasks_list_order_idx on tasks (list_id, order_index);

-- Login sessions (used by connect-pg-simple). Created here so it exists before the first sign-in.
create table if not exists session (
  sid    varchar not null primary key,
  sess   json not null,
  expire timestamp(6) not null
);
create index if not exists session_expire_idx on session (expire);
