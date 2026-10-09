/**
 * Slack Web API client utilities.
 * Pure API interactions only; message templates live in messages.ts.
 */

const SLACK_API_BASE = "https://slack.com/api";

/**
 * Verify Slack request signature
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (ts < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(baseString)
  );
  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(`v0=${computedHex}`, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Open or create a group DM (MPIM) with the given user IDs.
 * @returns channel ID or null on failure
 */
export async function openMPIM(
  token: string,
  userIds: string[]
): Promise<string | null> {
  const res = await fetch(`${SLACK_API_BASE}/conversations.open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ users: userIds.join(",") }),
  });

  if (!res.ok) {
    console.error("conversations.open failed:", await res.text());
    return null;
  }

  const data = await res.json();
  if (!data.ok || !data.channel?.id) return null;
  return data.channel.id;
}

/**
 * Post a message to a Slack channel (including MPIM channels).
 */
export async function postMessage(
  token: string,
  channelId: string,
  text: string,
  blocks?: Record<string, unknown>[]
): Promise<boolean> {
  const body: Record<string, unknown> = { channel: channelId, text };
  if (blocks && blocks.length > 0) body.blocks = blocks;

  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("chat.postMessage failed:", await res.text());
    return false;
  }
  const data = await res.json();
  return data.ok === true;
}

/**
 * Get all member IDs in a Slack channel
 */
export async function getChannelMembers(
  token: string,
  channelId: string
): Promise<string[]> {
  const members: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ channel: channelId, limit: "200" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${SLACK_API_BASE}/conversations.members?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error("conversations.members failed:", await res.text());
      break;
    }

    const data = await res.json();
    if (!data.ok) {
      console.error("conversations.members error:", data.error);
      break;
    }

    members.push(...(data.members ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return members;
}

export interface SlackUserInfo {
  id: string;
  display_name: string;
  is_bot: boolean;
}

/**
 * Get a single user's info
 */
export async function getUserInfo(
  token: string,
  userId: string
): Promise<SlackUserInfo | null> {
  const res = await fetch(`${SLACK_API_BASE}/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error("users.info failed:", await res.text());
    return null;
  }

  const data = await res.json();
  if (!data.ok || !data.user) return null;

  const user = data.user;
  const displayName =
    user.profile?.display_name || user.profile?.real_name || user.name || userId;

  return {
    id: user.id,
    display_name: displayName,
    is_bot: user.is_bot === true || user.id === "USLACKBOT",
  };
}

/**
 * Publish (or refresh) a user's App Home tab.
 */
export async function publishHomeView(
  token: string,
  userId: string,
  blocks: Record<string, unknown>[]
): Promise<boolean> {
  const res = await fetch(`${SLACK_API_BASE}/views.publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user_id: userId, view: { type: "home", blocks } }),
  });

  if (!res.ok) {
    console.error("views.publish failed:", await res.text());
    return false;
  }
  const data = await res.json();
  if (!data.ok) console.error("views.publish error:", data.error);
  return data.ok === true;
}

/**
 * Deep link that opens this app's Home tab, e.g. for "change your settings" links.
 * @see https://docs.slack.dev/interactivity/deep-linking
 * @returns null if the IDs can't be looked up (callers fall back to plain text)
 */
export async function getAppHomeLink(token: string): Promise<string | null> {
  const headers = { Authorization: `Bearer ${token}` };

  const authRes = await fetch(`${SLACK_API_BASE}/auth.test`, { method: "POST", headers });
  const auth = authRes.ok ? await authRes.json() : null;
  if (!auth?.ok || !auth.team_id || !auth.bot_id) {
    console.error("auth.test failed:", auth?.error);
    return null;
  }

  const botRes = await fetch(`${SLACK_API_BASE}/bots.info?bot=${auth.bot_id}`, { headers });
  const bot = botRes.ok ? await botRes.json() : null;
  if (!bot?.ok || !bot.bot?.app_id) {
    console.error("bots.info failed:", bot?.error);
    return null;
  }

  return `slack://app?team=${auth.team_id}&id=${bot.bot.app_id}&tab=home`;
}
