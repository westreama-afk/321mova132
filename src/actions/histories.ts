"use server";

import { tmdb } from "@/api/tmdb";
import { UnifiedPlayerEventData } from "@/hooks/usePlayerEvents";
import { ActionResponse, ContentType } from "@/types";
import { HistoryDetail } from "@/types/movie";
import { mutateMovieTitle, mutateTvShowTitle } from "@/utils/movies";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

const WATCH_POINTS_DAILY_CAP = 50;
const WATCH_POINTS_MILESTONE_SECONDS = 20 * 60;

const calculateWatchMilestones = (activeWatchSeconds: number) =>
  Math.floor(Math.max(0, activeWatchSeconds) / WATCH_POINTS_MILESTONE_SECONDS);

const normalizeDurationSeconds = (duration: number, lastPosition: number): number => {
  let normalizedDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const normalizedLastPosition =
    Number.isFinite(lastPosition) && lastPosition > 0 ? lastPosition : 0;

  if (normalizedDuration > 100000 && normalizedLastPosition > 0 && normalizedLastPosition < 100000) {
    normalizedDuration /= 1000;
  }

  if (normalizedDuration > 0 && normalizedDuration < 1000 && normalizedLastPosition > normalizedDuration * 2) {
    normalizedDuration *= 60;
  }

  return Math.max(0, normalizedDuration);
};

const isDurationReasonable = (duration: number, expectedDuration: number): boolean => {
  if (duration <= 0 || expectedDuration <= 0) return false;
  return duration >= expectedDuration * 0.35 && duration <= expectedDuration * 2.5;
};

const getTodayRewardPoints = async (
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  userId: string,
) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: watchLedger } = await supabase
    .from("reward_ledger")
    .select("points")
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString())
    .like("entry_type", "watch_active_%");

  return (watchLedger ?? []).reduce((sum, entry) => sum + Math.max(entry.points, 0), 0);
};

const getTmdbRuntimeSeconds = async (
  type: ContentType,
  mediaId: number,
  season?: number,
  episode?: number,
): Promise<number> => {
  try {
    if (type === "movie") {
      const movie = await tmdb.movies.details(mediaId);
      return typeof movie.runtime === "number" && movie.runtime > 0 ? movie.runtime * 60 : 0;
    }

    if (season && episode) {
      const seasonDetail = await tmdb.tvShows.season(mediaId, season);
      const episodeDetail = seasonDetail.episodes.find((ep) => ep.episode_number === episode);
      if (episodeDetail?.runtime && episodeDetail.runtime > 0) {
        return episodeDetail.runtime * 60;
      }
    }

    const tv = await tmdb.tvShows.details(mediaId);
    return Array.isArray(tv.episode_run_time) &&
      typeof tv.episode_run_time[0] === "number" &&
      tv.episode_run_time[0] > 0
      ? tv.episode_run_time[0] * 60
      : 0;
  } catch {
    return 0;
  }
};

export const syncHistory = async (
  data: UnifiedPlayerEventData,
  completed?: boolean,
): ActionResponse => {
  console.info("Saving history:", data);

  if (!data) return { success: false, message: "No data to save" };

  if (data.mediaType === "tv" && (!data.season || !data.episode)) {
    return { success: false, message: "Missing season or episode" };
  }

  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, message: "You must be logged in to save history" };
    }

    if (!data.mediaId || !data.mediaType) {
      return { success: false, message: "Missing required fields" };
    }

    if (!["movie", "tv"].includes(data.mediaType)) {
      return { success: false, message: 'Invalid content type. Must be "movie" or "tv"' };
    }

    const mediaId = Number(data.mediaId);
    const media =
      data.mediaType === "movie"
        ? await tmdb.movies.details(mediaId)
        : await tmdb.tvShows.details(mediaId);

    let mediaRuntimeSecondsRaw =
      "runtime" in media && typeof media.runtime === "number" && media.runtime > 0
        ? media.runtime * 60
        : "episode_run_time" in media &&
            Array.isArray(media.episode_run_time) &&
            typeof media.episode_run_time[0] === "number" &&
            media.episode_run_time[0] > 0
          ? media.episode_run_time[0] * 60
          : 0;

    if (data.mediaType === "tv" && data.season && data.episode) {
      try {
        const seasonDetail = await tmdb.tvShows.season(mediaId, data.season);
        const episodeDetail = seasonDetail.episodes.find(
          (episode) => episode.episode_number === data.episode,
        );
        if (episodeDetail?.runtime && episodeDetail.runtime > 0) {
          mediaRuntimeSecondsRaw = episodeDetail.runtime * 60;
        }
      } catch {
        // Keep fallback to show-level runtime if season lookup fails.
      }
    }

    const normalizedCurrentTime =
      Number.isFinite(data.currentTime) && data.currentTime > 0 ? data.currentTime : 0;
    const normalizedIncomingDuration = normalizeDurationSeconds(data.duration, normalizedCurrentTime);
    const mediaRuntimeSeconds = normalizeDurationSeconds(mediaRuntimeSecondsRaw, normalizedCurrentTime);

    let durationToSave =
      normalizedIncomingDuration > 0
        ? normalizedIncomingDuration
        : mediaRuntimeSeconds;

    if (
      durationToSave > 0 &&
      mediaRuntimeSeconds > 0 &&
      !isDurationReasonable(durationToSave, mediaRuntimeSeconds)
    ) {
      durationToSave = mediaRuntimeSeconds;
    }

    if (!durationToSave) {
      const { data: existingHistory } = await supabase
        .from("histories")
        .select("duration")
        .eq("user_id", user.id)
        .eq("media_id", mediaId)
        .eq("type", data.mediaType)
        .eq("season", data.season || 0)
        .eq("episode", data.episode || 0)
        .maybeSingle();

      if (existingHistory?.duration && existingHistory.duration > 0) {
        durationToSave = normalizeDurationSeconds(existingHistory.duration, normalizedCurrentTime);
      }
    }

    const { data: history, error } = await supabase
      .from("histories")
      .upsert(
        {
          user_id: user.id,
          media_id: mediaId,
          type: data.mediaType,
          season: data.season || 0,
          episode: data.episode || 0,
          duration: durationToSave,
          last_position: normalizedCurrentTime,
          completed: completed || false,
          adult: "adult" in media ? media.adult : false,
          backdrop_path: media.backdrop_path,
          poster_path: media.poster_path,
          release_date: "release_date" in media ? media.release_date : media.first_air_date,
          title: "title" in media ? mutateMovieTitle(media) : mutateTvShowTitle(media),
          vote_average: media.vote_average,
        },
        {
          onConflict: "user_id,media_id,type,season,episode",
        },
      )
      .select();

    const eligibleActiveSeconds = Math.max(0, Math.floor(data.activeWatchSeconds ?? 0));
    const currentMilestones = calculateWatchMilestones(eligibleActiveSeconds);
    const todayRewardPoints = await getTodayRewardPoints(adminSupabase, user.id);
    const remainingToday = Math.max(0, WATCH_POINTS_DAILY_CAP - todayRewardPoints);
    const is321MoviePlayer = data.playerSource === "321movies";

    const { data: lastWatchReward } = await adminSupabase
      .from("reward_ledger")
      .select("metadata")
      .eq("user_id", user.id)
      .like("entry_type", "watch_active_%")
      .contains("metadata", {
        mediaId,
        mediaType: data.mediaType,
        season: data.season || 0,
        episode: data.episode || 0,
      })
      .order("created_at", { ascending: false })
      .maybeSingle();

    const lastMilestoneCount = Number(
      (lastWatchReward?.metadata as Record<string, unknown> | null)?.milestones ?? 0,
    );
    const milestoneDelta = Math.max(0, currentMilestones - lastMilestoneCount);
    const watchPoints = is321MoviePlayer && !data.adBlockDetected ? Math.min(remainingToday, milestoneDelta) : 0;
    const rewardKey = watchPoints > 0 ? `watch:${mediaId}:${data.mediaType}:${data.season || 0}:${data.episode || 0}:${currentMilestones}` : null;

    if (watchPoints > 0 && rewardKey) {
      const { error: ledgerInsertError } = await adminSupabase.from("reward_ledger").insert({
        user_id: user.id,
        entry_type: `watch_active_${currentMilestones * 20}m`,
        points: watchPoints,
        reference_id: history?.[0]?.id ?? null,
        reward_key: rewardKey,
        metadata: {
          mediaId,
          mediaType: data.mediaType,
          season: data.season || 0,
          episode: data.episode || 0,
          currentTime: normalizedCurrentTime,
          activeWatchSeconds: eligibleActiveSeconds,
          milestones: currentMilestones,
        },
      });

      if (!ledgerInsertError) {
        await adminSupabase.rpc("increment_reward_account_balance", {
          p_user_id: user.id,
          p_points: watchPoints,
        });
        await adminSupabase
          .from("reward_accounts")
          .update({
            watch_minutes: Math.floor(durationToSave / 60),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
      } else {
        console.error("Watch reward ledger insert failed:", ledgerInsertError);
      }
    }

    const { data: referral } = await supabase
      .from("referrals")
      .select("*")
      .eq("referred_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (referral && (completed || durationToSave >= 30 * 60)) {
      const rewardPoints = 25;
      const { error: referralLedgerError } = await adminSupabase.from("reward_ledger").insert({
        user_id: referral.referrer_id,
        entry_type: "referral_verified",
        points: rewardPoints,
        metadata: { referred_id: user.id, mediaId, mediaType: data.mediaType },
      });

      if (!referralLedgerError) {
        await adminSupabase.rpc("increment_reward_account_balance", {
          p_user_id: referral.referrer_id,
          p_points: rewardPoints,
        });
        await adminSupabase
          .from("referrals")
          .update({ status: "verified", verified_at: new Date().toISOString(), reward_points: rewardPoints })
          .eq("id", referral.id);
      } else {
        console.error("Referral reward ledger insert failed:", referralLedgerError);
      }
    }

    if (error) {
      console.info("History save error:", error);
      return { success: false, message: "Failed to save history" };
    }

    console.info("History saved:", history);

    return { success: true, message: "History saved" };
  } catch (error) {
    console.info("Unexpected error:", error);
    return { success: false, message: "An unexpected error occurred" };
  }
};

export const getUserHistories = async (limit: number = 20): ActionResponse<HistoryDetail[]> => {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, message: "User not authenticated" };
    }

    const { data, error } = await supabase
      .from("histories")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.info("History fetch error:", error);
      return { success: false, message: "Failed to fetch history" };
    }

    return { success: true, data };
  } catch (error) {
    console.info("Unexpected error:", error);
    return { success: false, message: "An unexpected error occurred" };
  }
};

export const getMovieLastPosition = async (id: number): Promise<number> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return 0;
    }

    const { data, error } = await supabase
      .from("histories")
      .select("last_position")
      .eq("user_id", user.id)
      .eq("media_id", id)
      .eq("type", "movie");

    if (error) {
      console.info("History fetch error:", error);
      return 0;
    }

    return data?.[0]?.last_position || 0;
  } catch (error) {
    console.info("Unexpected error:", error);
    return 0;
  }
};

export const getTvShowLastPosition = async (
  id: number,
  season: number,
  episode: number,
): Promise<number> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return 0;
    }

    const { data, error } = await supabase
      .from("histories")
      .select("last_position")
      .eq("user_id", user.id)
      .eq("media_id", id)
      .eq("type", "tv")
      .eq("season", season)
      .eq("episode", episode);

    if (error) {
      console.info("History fetch error:", error);
      return 0;
    }

    return data?.[0]?.last_position || 0;
  } catch (error) {
    console.info("Unexpected error:", error);
    return 0;
  }
};

export const removeHistory = async (historyId: number): ActionResponse => {
  try {
    if (!historyId) {
      return { success: false, message: "Missing history id" };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, message: "User not authenticated" };
    }

    const { error } = await supabase
      .from("histories")
      .delete()
      .eq("id", historyId)
      .eq("user_id", user.id);

    if (error) {
      console.info("History remove error:", error);
      return { success: false, message: "Failed to remove history" };
    }

    return { success: true, message: "Removed from Continue Your Journey" };
  } catch (error) {
    console.info("Unexpected error:", error);
    return { success: false, message: "An unexpected error occurred" };
  }
};

const buildMediaHistoryRow = async (
  userId: string,
  mediaType: ContentType,
  mediaId: number,
  season: number,
  episode: number,
) => {
  const media =
    mediaType === "movie"
      ? await tmdb.movies.details(mediaId)
      : await tmdb.tvShows.details(mediaId);

  return {
    user_id: userId,
    media_id: mediaId,
    type: mediaType,
    season,
    episode,
    adult: "adult" in media ? media.adult : false,
    backdrop_path: media.backdrop_path,
    poster_path: media.poster_path,
    release_date: "release_date" in media ? media.release_date : media.first_air_date,
    title: "title" in media ? mutateMovieTitle(media) : mutateTvShowTitle(media),
    vote_average: media.vote_average,
  };
};

/**
 * Insert a "viewed" history row only if no row exists for this user/media/episode.
 * Does NOT overwrite existing progress (last_position, duration, completed).
 * Used for embed players (e.g. MixDrop) that can't report playback events.
 */
export const markMediaVisited = async (
  mediaType: ContentType,
  mediaId: number,
  season: number = 0,
  episode: number = 0,
): ActionResponse => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: false, message: "Not logged in" };

    const { data: existing } = await supabase
      .from("histories")
      .select("id")
      .eq("user_id", user.id)
      .eq("media_id", mediaId)
      .eq("type", mediaType)
      .eq("season", season)
      .eq("episode", episode)
      .maybeSingle();

    if (existing) return { success: true, message: "Already tracked" };

    const row = await buildMediaHistoryRow(user.id, mediaType, mediaId, season, episode);
    const { error } = await supabase.from("histories").insert(row);
    if (error) return { success: false, message: error.message };
    return { success: true };
  } catch (error) {
    console.info("markMediaVisited error:", error);
    return { success: false, message: "Failed to mark visited" };
  }
};

/**
 * Mark an episode as completed. Updates existing row if present; otherwise creates one.
 * Used by embed players when the user navigates to the next episode — we infer the
 * previous one was watched.
 */
export const markEpisodeCompleted = async (
  mediaType: ContentType,
  mediaId: number,
  season: number,
  episode: number,
): ActionResponse => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { success: false, message: "Not logged in" };

    const runtimeSeconds = await getTmdbRuntimeSeconds(mediaType, mediaId, season, episode);

    const { data: existing } = await supabase
      .from("histories")
      .select("id, duration")
      .eq("user_id", user.id)
      .eq("media_id", mediaId)
      .eq("type", mediaType)
      .eq("season", season)
      .eq("episode", episode)
      .maybeSingle();

    if (existing) {
      const duration = existing.duration > 0 ? existing.duration : runtimeSeconds;
      const { error } = await supabase
        .from("histories")
        .update({
          completed: true,
          last_position: duration,
          duration,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) return { success: false, message: error.message };
      return { success: true };
    }

    const row = await buildMediaHistoryRow(user.id, mediaType, mediaId, season, episode);
    const { error } = await supabase.from("histories").insert({
      ...row,
      duration: runtimeSeconds,
      last_position: runtimeSeconds,
      completed: true,
    });
    if (error) return { success: false, message: error.message };
    return { success: true };
  } catch (error) {
    console.info("markEpisodeCompleted error:", error);
    return { success: false, message: "Failed to mark completed" };
  }
};
