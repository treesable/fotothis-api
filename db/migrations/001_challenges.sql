-- Outside Challenges (docs/CHALLENGES.md in the app repo). Only daily totals, a nickname and a
-- colour: no email, phone, Apple ID, location or photos. Member secrets are never stored: the
-- server derives each one from the member id and MEMBER_KEY (lib/challenges/auth.js).

create table members (
  id            uuid primary key,
  nickname      text not null check (char_length(nickname) between 1 and 16),
  colour        text not null check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  apns_token    text,
  apns_sandbox  boolean not null default false,  -- development builds push through the sandbox
  share_steps   boolean not null default true,
  time_zone     text not null default 'UTC',      -- for quiet hours and "today"; sent with progress
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table challenges (
  id           uuid primary key,
  code         text not null unique,              -- "OAK-482", stored upper case
  creator_id   uuid references members(id) on delete set null,
  status       text not null default 'waiting' check (status in ('waiting', 'active', 'ended')),
  length_days  int  not null default 7 check (length_days between 1 and 30),
  created_at   timestamptz not null default now(),
  starts_at    timestamptz,                       -- when the second person joins
  ends_at      timestamptz,
  check ((status = 'waiting') = (starts_at is null))
);
create index challenges_ended on challenges (ends_at) where status = 'ended';

create table challenge_members (
  challenge_id  uuid not null references challenges(id) on delete cascade,
  member_id     uuid not null references members(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  removed       boolean not null default false,   -- removed by the creator: can't rejoin this one
  primary key (challenge_id, member_id)
);
create index challenge_members_member on challenge_members (member_id);

create table daily_progress (
  challenge_id       uuid not null,
  member_id          uuid not null,
  local_date         date not null,
  outside            boolean not null,
  photos             int not null check (photos between 0 and 6),
  new_species        jsonb not null default '[]',
  locked_minutes     int not null check (locked_minutes between 0 and 1440),
  emergency_unlocks  int not null check (emergency_unlocks between 0 and 1),
  steps              int check (steps between 0 and 100000),
  updated_at         timestamptz not null default now(),
  primary key (challenge_id, member_id, local_date),
  foreign key (challenge_id, member_id) references challenge_members on delete cascade
);

create table events (
  id            bigserial primary key,
  challenge_id  uuid not null references challenges(id) on delete cascade,
  member_id     uuid references members(id) on delete cascade,
  kind          text not null,   -- joined, outside, new_species, cheer, nudge, left, removed, started, ended
  data          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index events_challenge on events (challenge_id, created_at desc);

create table cheers (
  id            bigserial primary key,
  challenge_id  uuid not null references challenges(id) on delete cascade,
  from_member   uuid not null references members(id) on delete cascade,
  to_member     uuid not null references members(id) on delete cascade,
  kind          text not null check (kind in ('cheer', 'nudge')),
  local_date    date not null,  -- the sender's day
  created_at    timestamptz not null default now()
);
-- One nudge per sender per receiver per day.
create unique index cheers_one_nudge_a_day on cheers (challenge_id, from_member, to_member, local_date) where kind = 'nudge';
