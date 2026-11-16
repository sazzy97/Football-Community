-- ============================================================================
-- FOOTBALL COMMUNITY LAGOS — SUPABASE DATABASE SCHEMA
-- ============================================================================
-- Instructions:
-- 1. Open your Supabase Dashboard (https://supabase.com/dashboard)
-- 2. Go to "SQL Editor" -> "New query"
-- 3. Paste this entire file and click "Run"
-- ============================================================================

-- 1. Players / Users Table
create table if not exists public.users (
  id uuid default gen_random_uuid() primary key,
  full_name text not null,
  email_or_phone text not null,
  location_cluster text,
  formats text[],
  positions text[],
  experience text,
  availability text[],
  created_at timestamptz default now()
);

-- 2. Pitch Bookings Table
create table if not exists public.bookings (
  id uuid default gen_random_uuid() primary key,
  booking_ref text not null,
  user_name text,
  user_contact text,
  venue_name text not null,
  pitch_name text not null,
  format text,
  booking_date text,
  booking_time text,
  amount_ngn integer,
  payment_option text,
  status text default 'confirmed',
  created_at timestamptz default now()
);

-- 3. Open Games Created Table
create table if not exists public.open_games (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  organiser_name text,
  organiser_contact text,
  venue_name text not null,
  pitch_name text,
  match_when text,
  format text,
  players_needed integer,
  slots_left integer,
  price_ngn integer,
  skill_level text,
  requires_approval boolean default false,
  created_at timestamptz default now()
);

-- 4. Open Game Joins / RSVPs Table
create table if not exists public.game_joins (
  id uuid default gen_random_uuid() primary key,
  game_title text not null,
  venue_name text,
  match_when text,
  player_name text,
  player_contact text,
  price_ngn integer,
  status text default 'joined',
  created_at timestamptz default now()
);

-- 5. Event Ticket Orders Table
create table if not exists public.ticket_orders (
  id uuid default gen_random_uuid() primary key,
  ticket_ref text not null,
  event_title text not null,
  venue_name text,
  buyer_name text,
  buyer_contact text,
  quantity integer default 1,
  total_ngn integer,
  created_at timestamptz default now()
);

-- 6. Teams Created Table
create table if not exists public.teams (
  id uuid default gen_random_uuid() primary key,
  team_name text not null,
  location text,
  format text,
  owner_name text,
  owner_contact text,
  created_at timestamptz default now()
);

-- 7. Community Event Submissions Table
create table if not exists public.event_submissions (
  id uuid default gen_random_uuid() primary key,
  event_name text not null,
  category text,
  venue text,
  event_date text,
  event_time text,
  submitted_by text,
  status text default 'pending_review',
  created_at timestamptz default now()
);

-- 8. App Analytics & Activity Log Table
create table if not exists public.app_events (
  id uuid default gen_random_uuid() primary key,
  event_name text not null,
  screen text,
  user_contact text,
  properties jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Enable Row Level Security (RLS) with public insert/read for MVP validation
alter table public.users enable row level security;
alter table public.bookings enable row level security;
alter table public.open_games enable row level security;
alter table public.game_joins enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.teams enable row level security;
alter table public.event_submissions enable row level security;
alter table public.app_events enable row level security;

create policy "Allow public insert on users" on public.users for insert with check (true);
create policy "Allow public select on users" on public.users for select using (true);

create policy "Allow public insert on bookings" on public.bookings for insert with check (true);
create policy "Allow public select on bookings" on public.bookings for select using (true);

create policy "Allow public insert on open_games" on public.open_games for insert with check (true);
create policy "Allow public select on open_games" on public.open_games for select using (true);

create policy "Allow public insert on game_joins" on public.game_joins for insert with check (true);
create policy "Allow public select on game_joins" on public.game_joins for select using (true);

create policy "Allow public insert on ticket_orders" on public.ticket_orders for insert with check (true);
create policy "Allow public select on ticket_orders" on public.ticket_orders for select using (true);

create policy "Allow public insert on teams" on public.teams for insert with check (true);
create policy "Allow public select on teams" on public.teams for select using (true);

create policy "Allow public insert on event_submissions" on public.event_submissions for insert with check (true);
create policy "Allow public select on event_submissions" on public.event_submissions for select using (true);

create policy "Allow public insert on app_events" on public.app_events for insert with check (true);
create policy "Allow public select on app_events" on public.app_events for select using (true);
