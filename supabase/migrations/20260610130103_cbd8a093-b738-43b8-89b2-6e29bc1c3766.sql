CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique_when_set
  ON public.customers (phone)
  WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

INSERT INTO public.master_data (category, value, label, sort_order, active) VALUES
  ('income_category', 'Advance Payment', 'Advance Payment', 10, true),
  ('income_category', 'Full Payment', 'Full Payment', 20, true),
  ('income_category', 'Owner Deposit', 'Owner Deposit', 30, true),
  ('income_category', 'Other Income', 'Other Income', 90, true),
  ('expense_category_system', 'Owner Payout', 'Owner Payout', 10, true),
  ('complaint_status', 'Open', 'Open', 10, true),
  ('complaint_status', 'In Progress', 'In Progress', 20, true),
  ('complaint_status', 'Resolved', 'Resolved', 30, true),
  ('complaint_status', 'Closed', 'Closed', 40, true),
  ('payment_method', 'Cash', 'Cash', 10, true),
  ('payment_method', 'UPI', 'UPI', 20, true),
  ('payment_method', 'Bank Transfer', 'Bank Transfer', 30, true),
  ('payment_method', 'Card', 'Card', 40, true),
  ('payment_method', 'Other', 'Other', 90, true)
ON CONFLICT (category, value) DO NOTHING;
