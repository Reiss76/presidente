-- Migration: Add spatial index for lat/lon
-- Date: 2026-02-07
-- Description: Add partial index on lat/lon for nearby queries

-- Create partial index for codes with coordinates (for performance on nearby queries)
CREATE INDEX IF NOT EXISTS ix_codes_lat_lon ON codes(lat, lon) WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- Add index on code column for quick lookups (if not exists)
CREATE INDEX IF NOT EXISTS ix_codes_code ON codes(code);
