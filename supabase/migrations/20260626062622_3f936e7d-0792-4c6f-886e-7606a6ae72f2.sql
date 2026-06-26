
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  audience_role text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_self_select" on public.push_subscriptions;
create policy "push_subs_self_select"
  on public.push_subscriptions for select
  using (user_id = auth.uid());

drop policy if exists "push_subs_self_modify" on public.push_subscriptions;
create policy "push_subs_self_modify"
  on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.push_subscriptions_fill_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.audience_role is null then
    select role into new.audience_role from public.profiles where id = new.user_id limit 1;
  end if;
  return new;
end $$;

drop trigger if exists push_subscriptions_fill_role_trg on public.push_subscriptions;
create trigger push_subscriptions_fill_role_trg
  before insert or update on public.push_subscriptions
  for each row execute function public.push_subscriptions_fill_role();

create or replace function public.notifications_dispatch_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select value into v_url    from public.app_settings where key = 'push_dispatch_url';
    select value into v_secret from public.app_settings where key = 'push_dispatch_secret';
    if v_url is null or v_secret is null then
      return new;
    end if;
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('content-type','application/json','x-dispatch-secret', v_secret),
      body    := jsonb_build_object('notification_id', new.id::text)
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists notifications_dispatch_push_trg on public.notifications;
create trigger notifications_dispatch_push_trg
  after insert on public.notifications
  for each row execute function public.notifications_dispatch_push();
