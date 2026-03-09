-- Lyd — Copenhagen Sound Map
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)

-- 1. Add genre column (optional tag per pin)
ALTER TABLE pins ADD COLUMN IF NOT EXISTS genre TEXT;

-- 2. Add neighborhood column (derived server-side from bounding boxes)
ALTER TABLE pins ADD COLUMN IF NOT EXISTS neighborhood TEXT;

-- 2b. Add thumbnail column (oEmbed cover art URL)
ALTER TABLE pins ADD COLUMN IF NOT EXISTS thumbnail TEXT;

-- 2c. Add optional username column
ALTER TABLE pins ADD COLUMN IF NOT EXISTS username TEXT;

-- 3. Materialized view for fast aggregations
--    All dashboard / explore queries hit this view, never the raw table.
CREATE MATERIALIZED VIEW IF NOT EXISTS pin_stats AS
SELECT
  neighborhood,
  source,
  genre,
  song,
  artist,
  date_trunc('hour', created_at) AS hour_bucket,
  date_trunc('day',  created_at) AS day_bucket,
  COUNT(*) AS pin_count
FROM pins
GROUP BY neighborhood, source, genre, song, artist, hour_bucket, day_bucket;

CREATE UNIQUE INDEX IF NOT EXISTS pin_stats_unique_idx
  ON pin_stats (neighborhood, source, genre, song, artist, hour_bucket);

-- 4. Refresh function — call from a Supabase cron job or manually
CREATE OR REPLACE FUNCTION refresh_pin_stats()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY pin_stats;
$$;

-- 5. (Optional) Schedule hourly refresh via pg_cron
--    Uncomment if the pg_cron extension is enabled in your Supabase project:
--
-- SELECT cron.schedule(
--   'refresh-pin-stats',
--   '0 * * * *',
--   'SELECT refresh_pin_stats()'
-- );
