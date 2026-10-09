/**
 * All Slack message templates and block kit payloads.
 * 
 * 1. Match intro message 
 * 2. Meet reminder message
 * 3. Did you meet? message
 * 4. Weekly summary text
 * 5. App Home tab (opt in/out + location)
 */

import type { Location, UserPreferences } from "./types.ts";

export const MATCH_INTRO =
  "🍩 *You have been matched for a donut!* Pick a time soon and make it happen :sparkles:";

export const MIDPOINT_REMINDER_FALLBACK =
  "⏰ Midpoint check-in: have you scheduled your donut yet?";

export const MEET_REMINDER_FALLBACK =
  "☕ Quick check-in: did you have your donut chat?";

export function buildMidpointNudgeBlocks(
  assignedUserId: string
): Record<string, unknown>[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "⏰ *Midpoint check-in!* Have you scheduled your donut yet?\n" +
          `If not, <@${assignedUserId}>, you have been randomly assigned to schedule a time this round. :calendar:`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Suggestion: Drop 2-3 time options so it is easy to lock in a slot.",
        },
      ],
    },
  ];
}

export function buildDidYouMeetBlocks(
  matchId: string,
  introText = "☕ *Were you able to meet this round?*"
): Record<string, unknown>[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: introText },
    },
    {
      type: "actions",
      block_id: "did_you_meet_block",
      elements: [
        {
          type: "button",
          action_id: "did_you_meet_yes",
          text: { type: "plain_text", text: "Yes, we met! 🎉", emoji: true },
          value: matchId,
          style: "primary",
        },
        {
          type: "button",
          action_id: "did_you_meet_no",
          text: { type: "plain_text", text: "Not yet", emoji: true },
          value: matchId,
        },
      ],
    },
  ];
}

export interface SummaryCounts {
  met: number;
  not_met: number;
  pending: number;
  total: number;
}

export function buildSummaryText(roundDate: string, counts: SummaryCounts): string {
  const completion = counts.total > 0
    ? Math.round((counts.met / counts.total) * 100)
    : 0;

  return [
    "📊 *Donut round recap*",
    `_${roundDate}_`,
    "",
    `✅ Met: *${counts.met}*`,
    `⏳ Pending: *${counts.pending}*`,
    `❌ Not met: *${counts.not_met}*`,
    `🏁 Completion: *${completion}%* (${counts.met}/${counts.total})`,
  ].join("\n");
}

// app home tab (per-user preferences)

export const LOCATIONS: { value: Location; label: string }[] = [
  { value: "vancouver", label: "🏔️ Vancouver" },
  { value: "toronto", label: "🍁 Toronto" },
  { value: "virtual", label: "💻 Virtual" },
];

export const DEFAULT_PREFERENCES: UserPreferences = { opted_in: true, location: "vancouver" };

/** 906x200 banner (@2x), served from the public repo's main branch. */
export const HOME_BANNER_URL =
  "https://raw.githubusercontent.com/UBC-Product-Management-Club/donut-bot/main/docs/home-banner.jpg";

/** Where people go for help. Plain text; swap for `<#CHANNEL_ID>` to make it a clickable link. */
const HELP_CHANNEL = "#tech";

function locationOption(loc: { value: Location; label: string }) {
  return { text: { type: "plain_text", text: loc.label, emoji: true }, value: loc.value };
}

/** Bold title on the first line, description below, optional control on the right. */
function homeSection(title: string, body: string, accessory?: Record<string, unknown>) {
  return {
    type: "section",
    text: { type: "mrkdwn", text: `*${title}*\n${body}` },
    ...(accessory ? { accessory } : {}),
  };
}

export function buildHomeBlocks(
  prefs: UserPreferences,
  roundChannelId: string | null
): Record<string, unknown>[] {
  const channel = roundChannelId ? `<#${roundChannelId}>` : "the donut channel";
  const currentLocation = LOCATIONS.find((l) => l.value === prefs.location) ?? LOCATIONS[0];

  const status = prefs.opted_in
    ? homeSection("🟢  You're in!", "You'll be paired up in the next round.", {
      type: "button",
      action_id: ACTION_OPT_OUT,
      text: { type: "plain_text", text: "⏸️  Opt out", emoji: true },
    })
    : homeSection("🔴  You're sitting out", "You won't be paired until you opt back in.", {
      type: "button",
      action_id: ACTION_OPT_IN,
      style: "primary",
      text: { type: "plain_text", text: "▶️  Opt in", emoji: true },
    });

  return [
    {
      type: "image",
      image_url: HOME_BANNER_URL,
      alt_text: "PMC Donut Bot banner: two PMC mascots holding up a giant donut",
    },
    homeSection(
      "🍩  What's a donut?",
      "A casual 1:1 chat with another PMC member, over coffee, a walk, or a call. " +
        "Each round you're paired with someone new, so it's an easy way to get to know " +
        "people across the club beyond meetings and events.",
    ),
    { type: "divider" },
    status,
    { type: "divider" },
    homeSection("📍  Location", "You'll only be paired with people in the same location.", {
      type: "static_select",
      action_id: ACTION_SET_LOCATION,
      placeholder: { type: "plain_text", text: "Choose a location" },
      options: LOCATIONS.map(locationOption),
      initial_option: locationOption(currentLocation),
    }),
    { type: "divider" },
    homeSection(
      "📋  How it works",
      `• Be in ${channel} and opted in to get paired\n` +
        "• You'll be matched with someone in your location, prioritising people you haven't met\n" +
        "• Changes apply from the next round",
    ),
    { type: "divider" },
    homeSection("💬  Questions or bugs?", `Reach out in ${HELP_CHANNEL}.`),
  ];
}

// action ids & responses

export const ACTION_DID_YOU_MEET_YES = "did_you_meet_yes";
export const ACTION_DID_YOU_MEET_NO = "did_you_meet_no";
export const ACTION_OPT_IN = "home_opt_in";
export const ACTION_OPT_OUT = "home_opt_out";
export const ACTION_SET_LOCATION = "home_set_location";

export const RESPONSE_YES = "Amazing! 🎉 Love to hear it.";
export const RESPONSE_NO = "No worries - there is always next round 💪";
