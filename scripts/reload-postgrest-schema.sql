-- Force PostgREST to reload its schema cache
-- Execute this in Supabase SQL Editor after adding new tables

NOTIFY pgrst, 'reload schema';
