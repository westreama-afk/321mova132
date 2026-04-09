"use server";

import { tmdb } from "@/api/tmdb";
import { UnifiedPlayerEventData } from "@/hooks/usePlayerEvents";
import { ActionResponse, ContentType } from "@/types";
import { HistoryDetail } from "@/types/movie";
import { mutateMovieTitle, mutateTvShowTitle } from "@/utils/movies";
import { createClient } from "@/utils/supabase/server";

const normalizeDurationSeconds = (duration: number, lastPosition: number): number => {
  let normalizedDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const normalizedLastPosition =
    Number.isFinite(lastPosition) && lastPosition > 0 ? lastPosition : 0;

  // Some providers report duration in milliseconds.
  if (normalizedDuration > 100000 && normalizedLastPosition > 0 && normalizedLastPosition < 100000) {
    normalizedDuration /= 1000;
  }

  // Some providers report duration in minutes.
  if (normalizedDuration > 0 && normalizedDuration < 1000 && normalizedLastPosition > normalizedDuration * 2) {
    normalizedDuration *= 60;
  }

  return Math.max(0, normalizedDuration);
};

const isDurationReasonable = (duration: number, expectedDuration: number): boolean => {
  if (duration <= 0 || expectedDuration <= 0) return false;
  return duration >= expectedDuration * 0.35 && duration <= expectedDuration * 2.5;
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

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "You must be logged in to save history",
      };
    }

    // Validate required fields
    if (!data.mediaId || !data.mediaType) {
      return {
        success: false,
        message: "Missing required fields",
      };
    }

    // Validate type
    if (!["movie", "tv"].includes(data.mediaType)) {
      return {
        success: false,
        message: 'Invalid content type. Must be "movie" or "tv"',
      };
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

    // Insert or update history
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

    if (error) {
      console.info("History save error:", error);
      return {
        success: false,
        message: "Failed to save history",
      };
    }

    console.info("History saved:", history);

    return {
      success: true,
      message: "History saved",
    };
  } catch (error) {
    console.info("Unexpected error:", error);
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
};

export const getUserHistories = async (limit: number = 20): ActionResponse<HistoryDetail[]> => {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "User not authenticated",
      };
    }

    const { data, error } = await supabase
      .from("histories")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.info("History fetch error:", error);
      return {
        success: false,
        message: "Failed to fetch history",
      };
    }

    const normalizedData = await Promise.all(
      data.map(async (item) => {
        let durationForList = normalizeDurationSeconds(item.duration, item.last_position);
        const shouldValidateAgainstTmdb =
          item.last_position > 0 &&
          (durationForList <= 0 || durationForList > item.last_position * 6);

        if (shouldValidateAgainstTmdb) {
          const fallbackDuration = await getTmdbRuntimeSeconds(
            item.type,
            item.media_id,
            item.season,
            item.episode,
          );

          if (fallbackDuration > 0 && !isDurationReasonable(durationForList, fallbackDuration)) {
            durationForList = fallbackDuration;
          } else if (durationForList <= 0 && fallbackDuration > 0) {
            durationForList = fallbackDuration;
          }
        }

        if (durationForList <= 0) return item;
        return durationForList === item.duration ? item : { ...item, duration: durationForList };
      }),
    );

    return {
      success: true,
      data: normalizedData,
    };
  } catch (error) {
    console.info("Unexpected error:", error);
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
};

export const getMovieLastPosition = async (id: number): Promise<number> => {
  try {
    const supabase = await createClient();

    // Get current user
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

    // Get current user
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
      return {
        success: false,
        message: "Missing history id",
      };
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "User not authenticated",
      };
    }

    const { error } = await supabase
      .from("histories")
      .delete()
      .eq("id", historyId)
      .eq("user_id", user.id);

    if (error) {
      console.info("History remove error:", error);
      return {
        success: false,
        message: "Failed to remove history",
      };
    }

    return {
      success: true,
      message: "Removed from Continue Your Journey",
    };
  } catch (error) {
    console.info("Unexpected error:", error);
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
};
