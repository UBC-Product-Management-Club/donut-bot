/**
 * Webhook receiver for slack events ie button clicks, App Home opens.
*/

import { supabase, verifySlackSignature, publishHomeView } from "@shared";
import { serve, jsonResponse, requireEnv } from "@shared/handler";
import {
  ACTION_DID_YOU_MEET_YES,
  ACTION_DID_YOU_MEET_NO,
  ACTION_OPT_IN,
  ACTION_OPT_OUT,
  ACTION_SET_LOCATION,
  RESPONSE_YES,
  RESPONSE_NO,
  LOCATIONS,
  DEFAULT_PREFERENCES,
  buildHomeBlocks,
} from "@shared/messages";
import type { ConfigValue, Location, UserPreferences } from "@shared";

interface BlockAction {
  action_id: string;
  value?: string;
  selected_option?: { value: string };
}

interface InteractivityPayload {
  type: string;
  user?: { id: string; username?: string; name?: string };
  actions?: BlockAction[];
  response_url?: string;
}

/** Events API body (JSON), as opposed to interactivity (form-encoded). */
interface EventsPayload {
  type: string;
  challenge?: string;
  event?: { type: string; user?: string; tab?: string };
}

serve(async (req) => {
  const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
  if (signingSecret instanceof Response) return signingSecret;

  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const rawBody = await req.text();

  const isValid = await verifySlackSignature(rawBody, signature, timestamp, signingSecret);
  if (!isValid) return jsonResponse({ error: "Invalid signature" }, 401);

  if (req.headers.get("content-type")?.includes("application/json")) {
    return await handleEvent(rawBody);
  }

  const payloadStr = new URLSearchParams(rawBody).get("payload");
  if (!payloadStr) return jsonResponse({ error: "Missing payload" }, 400);

  let payload: InteractivityPayload;
  try {
    payload = JSON.parse(payloadStr) as InteractivityPayload;
  } catch {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return new Response(null, { status: 200 });
  }

  const homeAction = payload.actions.find(
    (a) => a.action_id === ACTION_OPT_IN || a.action_id === ACTION_OPT_OUT || a.action_id === ACTION_SET_LOCATION
  );
  if (homeAction && payload.user) {
    await handleHomeAction(payload.user, homeAction);
    return new Response(null, { status: 200 });
  }

  const action = payload.actions.find(
    (a) => a.action_id === ACTION_DID_YOU_MEET_YES || a.action_id === ACTION_DID_YOU_MEET_NO
  );

  if (!action?.value) return new Response(null, { status: 200 });

  const matchId = action.value;
  const isYes = action.action_id === ACTION_DID_YOU_MEET_YES;
  const metStatus = isYes ? "yes" : "no";

  const { error } = await supabase
    .from("matches")
    .update({ met_status: metStatus, updated_at: new Date().toISOString() })
    .eq("id", matchId);

  if (error) console.error("Failed to update match:", error);

  if (payload.response_url) {
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replace_original: true,
        text: isYes ? RESPONSE_YES : RESPONSE_NO,
      }),
    });
  }

  return new Response(null, { status: 200 });
});

async function handleEvent(rawBody: string): Promise<Response> {
  let payload: EventsPayload;
  try {
    payload = JSON.parse(rawBody) as EventsPayload;
  } catch {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  // one-time handshake when the Event Subscriptions URL is saved
  if (payload.type === "url_verification") {
    return jsonResponse({ challenge: payload.challenge });
  }

  const event = payload.event;
  if (payload.type === "event_callback" && event?.type === "app_home_opened" && event.tab === "home" && event.user) {
    await renderHome(event.user);
  }

  return new Response(null, { status: 200 });
}

async function handleHomeAction(
  user: NonNullable<InteractivityPayload["user"]>,
  action: BlockAction
): Promise<void> {
  const update: Partial<UserPreferences> = {};
  if (action.action_id === ACTION_OPT_IN) update.opted_in = true;
  if (action.action_id === ACTION_OPT_OUT) update.opted_in = false;
  if (action.action_id === ACTION_SET_LOCATION) {
    const loc = action.selected_option?.value;
    if (!LOCATIONS.some((l) => l.value === loc)) return;
    update.location = loc as Location;
  }

  const { data: updated, error } = await supabase
    .from("users")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("slack_user_id", user.id)
    .select("slack_user_id");
  if (error) console.error("Failed to update preferences for", user.id, error);

  // insert so people can set preferences before their first round;
  // create-pairs re-syncs is_active from channel membership before matching
  if (!error && ((updated ?? []) as unknown[]).length === 0) {
    const { error: insertError } = await supabase.from("users").insert({
      slack_user_id: user.id,
      display_name: user.name || user.username || user.id,
      is_active: false,
      ...update,
    });
    if (insertError) console.error("Failed to insert preferences for", user.id, insertError);
  }

  await renderHome(user.id);
}

async function renderHome(userId: string): Promise<void> {
  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!slackToken) {
    console.error("SLACK_BOT_TOKEN not configured");
    return;
  }

  const [{ data: userRow }, { data: configRow }] = await Promise.all([
    supabase.from("users").select("opted_in, location").eq("slack_user_id", userId).maybeSingle(),
    supabase.from("config").select("value").eq("key", "round_channel_id").maybeSingle(),
  ]);

  const prefs = (userRow as UserPreferences | null) ?? DEFAULT_PREFERENCES;
  const rawChannel = (configRow as ConfigValue | null)?.value;
  const roundChannelId = rawChannel ? String(rawChannel).replace(/^"|"$/g, "") : null;

  const blocks = buildHomeBlocks(prefs, roundChannelId);
  const ok = await publishHomeView(slackToken, userId, blocks);

  // Slack rejects the whole view if it can't fetch an image, so retry without the banner
  if (!ok) {
    await publishHomeView(slackToken, userId, blocks.filter((b) => b.type !== "image"));
  }
}
