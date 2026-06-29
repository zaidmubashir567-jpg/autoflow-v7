-- Migration 013 — Add Apify API key column to clients
-- Used by run-pipeline edge function to call Apify Google Maps Scraper
-- Also stored as APIFY_API_KEY Supabase secret for edge function access

ALTER TABLE clients ADD COLUMN IF NOT EXISTS apify_key text;

COMMENT ON COLUMN clients.apify_key IS 'Apify API key for Google Maps scraper — improves lead accuracy from 33% to 95%+';
