-- Add new booking statuses
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'Pending';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'Checked-In';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'Checked-Out';