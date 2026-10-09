/** Posts match stats for the current round to #irl-coffeechats. */
// DISABLED: the round recap message is no longer sent for now.
// Re-enable by uncommenting the block below and removing the stub handler.

import { serve, jsonResponse } from "@shared/handler";

serve(() => Promise.resolve(jsonResponse({ message: "Weekly summary disabled" })));

/*
import { supabase, postMessage } from "@shared";
import { serve, jsonResponse, errorResponse, requireEnv } from "@shared/handler";
import { buildSummaryText } from "@shared/messages";
import type { ConfigValue, RoundWithDate, MatchMetStatus } from "@shared";
serve(async () => {
  const slackToken = requireEnv("SLACK_BOT_TOKEN");
  if (slackToken instanceof Response) return slackToken;
  const { data: configRow } = await supabase
    .from("config")
    .select("value")
    .eq("key", "round_channel_id")
    .single();
  const config = configRow as ConfigValue | null;
  const roundChannelId = config?.value ? String(config.value).replace(/^"|"$/g, "") : null;
  if (!roundChannelId) {
    return errorResponse("round_channel_id not configured in config table");
  }
  // Get latest round and aggregate statistics
  const { data: latestRound, error: roundError } = await supabase
    .from("rounds")
    .select("id, round_date")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (roundError || !latestRound) {
    return jsonResponse({ message: "No rounds found" });
  }
  const round = latestRound as RoundWithDate;
  const { data: matchesData, error: matchesError } = await supabase
    .from("matches")
    .select("met_status")
    .eq("round_id", round.id);
  if (matchesError) {
    return errorResponse("Failed to fetch matches", 500, matchesError);
  }
  const matches = (matchesData ?? []) as MatchMetStatus[];
  const counts = { met: 0, not_met: 0, pending: 0, total: matches.length };
  for (const m of matches) {
    if (m.met_status === "yes") counts.met++;
    else if (m.met_status === "no") counts.not_met++;
    else counts.pending++;
  }
  const text = buildSummaryText(round.round_date, counts);
  const ok = await postMessage(slackToken, roundChannelId, text);
  if (!ok) return errorResponse("Failed to post to Slack");
  return jsonResponse({ message: "Weekly summary posted", round_id: round.id, ...counts });
});
*/
