-- Rename pilot facility (run once in Supabase SQL Editor if DB already seeded)
UPDATE facilities
SET
  name = 'Senior Living Homes',
  contact_email = 'admin@seniorlivinghomes.demo'
WHERE id = '00000000-0000-4000-8000-000000000001';
