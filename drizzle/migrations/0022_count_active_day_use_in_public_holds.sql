DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.create_whatsapp_room_draft'::regproc) INTO definition;
 IF position('i.check_out>v_day' IN definition)=0 OR position('b.check_out>v_day' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected room allocation definition'; END IF;
 definition := replace(definition, 'i.check_out>v_day', 'GREATEST(i.check_out, i.check_in + 1)>v_day');
 definition := replace(definition, 'b.check_out>v_day', 'GREATEST(b.check_out, b.check_in + 1)>v_day');
 definition := replace(definition, 'm.end_date>v_day', 'GREATEST(m.end_date, m.start_date + 1)>v_day');
 EXECUTE definition;
END $$;