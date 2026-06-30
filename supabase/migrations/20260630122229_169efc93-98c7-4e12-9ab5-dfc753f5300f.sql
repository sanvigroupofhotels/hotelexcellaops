
CREATE POLICY "inv photos read"   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'inventory-photos');
CREATE POLICY "inv photos insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inventory-photos');
CREATE POLICY "inv photos update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'inventory-photos') WITH CHECK (bucket_id = 'inventory-photos');
CREATE POLICY "inv photos delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'inventory-photos');
