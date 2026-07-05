
CREATE POLICY "laundry-slips read authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'laundry-slips');
CREATE POLICY "laundry-slips insert authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'laundry-slips');
CREATE POLICY "laundry-slips update authenticated"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'laundry-slips') WITH CHECK (bucket_id = 'laundry-slips');
CREATE POLICY "laundry-slips delete authenticated"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'laundry-slips');
