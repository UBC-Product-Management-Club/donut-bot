/** 
 * Creates pairings, opens Slack group DMs, sends intro message.
 * Called by pg_cron schedule.
 */

import { supabase, openMPIM, postMessage, getChannelMembers, getUserInfo, getAppHomeLink } from "@shared";
import { serve, jsonResponse, errorResponse, requireEnv } from "@shared/handler";
import { MATCH_INTRO, buildMatchIntroBlocks } from "@shared/messages";
import { computeMatches, type PastMatch } from "@shared/matching";
import type { RoundIdResult, MatchIdResult, ConfigValue } from "@shared";

serve(async () => {
  const slackToken = requireEnv("SLACK_BOT_TOKEN");
  if (slackToken instanceof Response) return slackToken;

  // check if enough time has passed since last round before writing to db
  const { data: intervalRow } = await supabase
    .from("config")
    .select("value")
    .eq("key", "pairing_interval_days")
    .single();

  const intervalDays = parseIntervalDays((intervalRow as ConfigValue | null)?.value);

  const { data: lastRound } = await supabase
    .from("rounds")
    .select("round_date")
    .order("round_date", { ascending: false })
    .limit(1)
    .single();

  if (lastRound) {
    const lastDate = new Date((lastRound as { round_date: string }).round_date);
    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86_400_000);
    if (daysSince < intervalDays) {
      return jsonResponse({
        message: "Skipping — not yet time for next round",
        days_since_last: daysSince,
        interval_days: intervalDays,
      });
    }
  }

  const { data: configRow } = await supabase
    .from("config")
    .select("value")
    .eq("key", "round_channel_id")
    .single();

  const channelId = (configRow as ConfigValue | null)?.value
    ? String((configRow as ConfigValue).value).replace(/^"|"$/g, "")
    : null;

  if (!channelId) {
    return errorResponse("round_channel_id not configured in config table");
  }

  // Before matching, syncs /users with any members who have newly joined or left
  const memberIds = await getChannelMembers(slackToken, channelId);
  if (memberIds.length === 0) {
    return errorResponse("No members found in channel");
  }

  const humanMembers: { id: string; display_name: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const uid of memberIds) {
    const info = await getUserInfo(slackToken, uid);
    if (!info) {
      skipped.push({ id: uid, reason: "users.info failed" });
    } else if (info.is_bot) {
      skipped.push({ id: uid, reason: "bot" });
    } else {
      humanMembers.push({ id: info.id, display_name: info.display_name });
    }
  }

  if (humanMembers.length < 2) {
    return jsonResponse({
      error: "Not enough humans to match",
      channel_members: memberIds.length,
      humans: humanMembers.length,
      skipped,
    }, 400);
  }

  for (const member of humanMembers) {
    const { error: upsertError } = await supabase.from("users").upsert(
      { slack_user_id: member.id, display_name: member.display_name, is_active: true },
      { onConflict: "slack_user_id" }
    );
    if (upsertError) console.error("Upsert failed for", member.id, upsertError);
  }

  const activeIds = humanMembers.map((m) => m.id);
  const { data: allUsers } = await supabase.from("users").select("slack_user_id").eq("is_active", true);
  const currentUsers = (allUsers ?? []) as { slack_user_id: string }[];
  for (const u of currentUsers) {
    if (!activeIds.includes(u.slack_user_id)) {
      await supabase.from("users").update({ is_active: false }).eq("slack_user_id", u.slack_user_id);
    }
  }

  /**
   * Only opted-in channel members are eligible, and pairs never cross locations.
   * Within each location, picks the pairing with the fewest/oldest repeats (see matching.ts).
   */
  const { data: candidateRows, error: candidatesError } = await supabase
    .from("users")
    .select("slack_user_id, location")
    .eq("is_active", true)
    .eq("opted_in", true);

  if (candidatesError) {
    return errorResponse("Failed to fetch candidates", 500, candidatesError);
  }

  const history = await fetchAllMatchHistory();
  if (history instanceof Response) return history;

  const { data: avoidRows } = await supabase.from("user_avoid_list").select("user_id, avoid_user_id");

  const candidates = ((candidateRows ?? []) as { slack_user_id: string; location: string }[])
    .map((u) => ({ id: u.slack_user_id, location: u.location }));
  const avoidPairs = ((avoidRows ?? []) as { user_id: string; avoid_user_id: string }[])
    .map((a): [string, string] => [a.user_id, a.avoid_user_id]);

  const { groups, unmatched } = computeMatches(candidates, history, avoidPairs);
  if (unmatched.length > 0) console.log("Unmatched this round (no one else eligible):", unmatched);

  // only record a round once there's something to send, so a failed run doesn't block next week
  if (groups.length === 0) {
    return jsonResponse({ message: "No matches this round", unmatched });
  }

  const { data: roundData, error: roundError } = await supabase
    .from("rounds")
    .insert({ status: "active" })
    .select("id")
    .single();

  if (roundError || !roundData) {
    return errorResponse("Failed to create round", 500, roundError);
  }

  const roundId = (roundData as RoundIdResult).id;

  const homeLink = await getAppHomeLink(slackToken);

  for (const participantIds of groups) {
    const { data: matchData, error: matchInsertError } = await supabase
      .from("matches")
      .insert({ round_id: roundId, participant_ids: participantIds, met_status: "pending" })
      .select("id")
      .single();

    if (matchInsertError || !matchData) {
      console.error("Failed to insert match:", matchInsertError);
      continue;
    }

    const matchId = (matchData as MatchIdResult).id;

    const mpimId = await openMPIM(slackToken, participantIds);
    if (!mpimId) {
      console.error("Failed to open MPIM for:", participantIds);
      continue;
    }

    await supabase.from("matches").update({ slack_channel_id: mpimId }).eq("id", matchId);
    await postMessage(slackToken, mpimId, MATCH_INTRO, buildMatchIntroBlocks(participantIds, homeLink));
  }

  return jsonResponse({ message: "Matches created", round_id: roundId, groups_count: groups.length, unmatched });
});

/** All past matches, paged since PostgREST caps each response (default 1000 rows). */
async function fetchAllMatchHistory(): Promise<PastMatch[] | Response> {
  const PAGE = 1000;
  const history: PastMatch[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("matches")
      .select("participant_ids, matched_at")
      .order("matched_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return errorResponse("Failed to fetch match history", 500, error);
    const rows = (data ?? []) as PastMatch[];
    history.push(...rows);
    if (rows.length < PAGE) return history;
  }
}

function parseIntervalDays(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const unquoted = value.replace(/^"|"$/g, "").trim();
    const parsed = Number(unquoted);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }

  return 7;
}
