-- per-user preferences set from the App Home tab.
-- opted_in defaults true so existing channel members keep getting paired.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS opted_in BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS location TEXT    NOT NULL DEFAULT 'vancouver',
ADD CONSTRAINT users_location_check CHECK (location IN ('vancouver', 'toronto', 'virtual'));

-- matching now happens in the create-pairs edge function (_shared/matching.ts),
-- which filters on opted_in/location and minimises repeats across the whole round.
DROP FUNCTION IF EXISTS compute_coffee_chat_matches(UUID);
