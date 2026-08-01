UPDATE public.charge_catalog
SET application_mode = 'per_room', updated_at = now()
WHERE key IN ('water_bottle','food_order','coffee','tea','soft_drinks','early_checkin','late_checkout','pet_charge','dental_kit','shaving_kit','laundry','transportation','printing_charges','cleaning_fee','extra_pet','extra_person')
  AND application_mode <> 'per_room';

UPDATE public.charge_catalog
SET application_mode = 'per_booking', updated_at = now()
WHERE key IN ('past_due','razorpay_charges','other','booking_fee','airport_pickup','airport_transfer','conference_package')
  AND application_mode <> 'per_booking';