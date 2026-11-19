DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.create_whatsapp_room_draft(jsonb,jsonb)'::regprocedure);
  definition := replace(definition, 'check_in,check_out,nights,rate,subtotal', 'check_in,check_out,rate,subtotal');
  definition := replace(definition, '(v_item->>''check_out'')::date-(v_item->>''check_in'')::date,', '');
  EXECUTE definition;
END;
$migration$;