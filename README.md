# slack donut bot 🍩
Slack bot that facilitates weekly donuts in your workspace for unlimited members. Free marketplace solutions are capped at ~20 members at a time, hence the need. 

Members of the specified channel are automatically synced each round; members can join the channel to be eligible and leave to opt out.

Members can also manage their own settings from the bot's **Home** tab in Slack: opt in 🟢 / opt out 🔴 of pairings, and pick a location (Vancouver by default, Toronto, or Virtual). Right before each round, only opted-in channel members are paired, and only with people in the same location.

## Used
- Supabase: Edge Functions (Deno), PSQL, pg_cron
- Slack web API

## Setup & Deploy

### 1. Create Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) > **Create New App** > **From a manifest**. Paste the contents of [`docs/sample_manifest.json`](docs/sample_manifest.json), replacing `YOUR_PROJECT_REF` with your Supabase project ref. This configures the required scopes (`chat:write`, `mpim:write`, `users:read`, `channels:read`, `groups:read`) interactivity URL, Home tab, and `app_home_opened` event subscription automatically.

> **Existing app?** Under **App Home**, enable the Home Tab. Under **Event Subscriptions**, enable events, set the Request URL to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-events`, and subscribe to the `app_home_opened` bot event. Reinstall if prompted.

> **Private channels**: The bot must be invited to the channel (`/invite @Donut Bot`) to access its member list.

After creating, install the app to your workspace. Copy the **Bot User OAuth Token** (`xoxb-...`) and **Signing Secret** from the app's Basic Information page.

### 2. Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- A Supabase project with **pg_cron** and **pg_net** enabled (Dashboard > Database > Extensions)

### 3. Link & push schema
Project ref can be found under Dashboard > Project Settings > General Settings.
```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 4. Set Vault secrets (SQL Editor)
Used by `pg_cron` to call Edge Functions. Get the publishable key from Dashboard > Project Settings > API.
```sql
SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
SELECT vault.create_secret('YOUR_PUBLISHABLE_KEY', 'pub_key');
```

### 5. Set Edge Function secrets
```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-bot-token
supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret
```

### 6. Configure channel
Get the channel ID: right-click `#chosen-channel` in Slack > **View channel details** > copy the ID at the bottom.
```sql
UPDATE config SET value = '"C_YOUR_CHANNEL_ID"'::jsonb WHERE key = 'round_channel_id';
```

### 7. Deploy functions
```bash
supabase functions deploy create-pairs post-reminder weekly-summary slack-events
```

### 8. Test
Trigger a manual run to verify the full flow (sync users from channel, create matches, send DMs):
```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-pairs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PUBLISHABLE_KEY"
```

Then test the reminder:
```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/post-reminder \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PUBLISHABLE_KEY"
```

Check `users` and `matches` in Dashboard > Table Editor. Click a Yes/No button in Slack and confirm `matches.met_status` updates.

## Configuration

### Schedule

`pg_cron` runs `create-pairs` every Monday at 9am UTC. The function checks `pairing_interval_days` in the config table and skips if not enough days have passed since the last round. Default interval is 7 days (weekly).

| Function | Cron | When |
|----------|------|------|
| `create-pairs` | `0 9 * * 1` | Mondays 09:00 UTC -- syncs users, creates pairings (skips if too soon) |
| `post-reminder` | `0 17 * * 0` | Sundays 17:00 UTC -- sends midpoint scheduling nudge, then final "did you meet?" check once interval elapses |
| `weekly-summary` | `0 17 * * 5` | Fridays 17:00 UTC -- posts stats to channel |

### Changing pairing frequency

Run via SQL:

```sql
-- Every 2 weeks
UPDATE config SET value = '14'::jsonb WHERE key = 'pairing_interval_days';

-- Every 3 weeks
UPDATE config SET value = '21'::jsonb WHERE key = 'pairing_interval_days';

-- Monthly
UPDATE config SET value = '30'::jsonb WHERE key = 'pairing_interval_days';
```

Note that the cron job is fixed at `0 9 * * 1` (every Monday). `create_pairs` decides whether to actually write based on how many days have elapsed since the last round.

## How matching works

Each round (`create-pairs`, logic in [`_shared/matching.ts`](supabase/functions/_shared/matching.ts)):

1. Sync channel members. Only people in the channel **and** opted in are eligible.
2. Split eligible people by location; nobody is paired across locations.
3. Within each location, score every possible pair by history: never met = 0, and each past meeting adds `1000 / (1 + weeks since)` (last week = 500, a month ago ≈ 190, a year ago ≈ 19). Avoid-list pairs are excluded.
4. Find the pairing with the lowest total score across the whole location (maximum weight matching via Edmonds' blossom algorithm), pairing as many people as possible first.
5. With an odd count, the leftover joins whichever pair they've met least recently, making a trio. Someone alone in their location sits out the round.

This guarantees no repeats whenever a repeat-free pairing exists, and when repeats are unavoidable (small groups, many rounds) it picks the oldest ones instead of back-to-back repeats.

## Optional: Avoid List

To prevent specific users from being paired:
```sql
INSERT INTO user_avoid_list (user_id, avoid_user_id) VALUES ('U01234567', 'U07654321');
```

## Local Development
Docker Desktop is needed to spin up dependencies locally.
```bash
supabase start
supabase functions serve
```

Lint by running `deno lint`, and run the matching tests with `deno test` (both from `supabase/functions`).

Friendly reminder to keep the deploy and db actions up-to-date ie. if you are adding a new function.

## Working on
* Admin panel for user-friendly configs ie. setting the pairing frequency, which can only be done in SQL for now
* Enable JWT for functions