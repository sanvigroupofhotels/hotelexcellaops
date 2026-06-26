
create or replace function public.notifications_dispatch_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select value #>> '{}' into v_url    from public.app_settings where key = 'push_dispatch_url';
    select value #>> '{}' into v_secret from public.app_settings where key = 'push_dispatch_secret';
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
