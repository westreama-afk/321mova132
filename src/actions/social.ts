"use server";

import { createClient } from "@/utils/supabase/server";
import { ActionResponse, ContentType } from "@/types";
import { Database } from "@/utils/supabase/types";

const COMMENT_MIN_LENGTH = 1;
const COMMENT_MAX_LENGTH = 1000;
const DEFAULT_COMMENT_LIMIT = 20;

type CommentRow = Database["public"]["Tables"]["comments"]["Row"];

export type MediaRatingSummary = {
  averageRating: number;
  ratingsCount: number;
  userRating: number | null;
};

export type MediaComment = {
  id: number;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type MediaCommentsPage = {
  page: number;
  limit: number;
  totalCount: number;
  hasNextPage: boolean;
  comments: MediaComment[];
};

const isValidMediaType = (mediaType: string): mediaType is ContentType => {
  return mediaType === "movie" || mediaType === "tv";
};

const normalizeComment = (content: string): string => {
  return content.replace(/\s+/g, " ").trim();
};

const fallbackMediaRatingStats = async (
  mediaId: number,
  mediaType: ContentType,
): Promise<{ averageRating: number; ratingsCount: number } | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ratings")
    .select("rating")
    .eq("media_id", mediaId)
    .eq("media_type", mediaType);

  if (error || !data) {
    return null;
  }

  const ratingsCount = data.length;
  if (ratingsCount === 0) {
    return { averageRating: 0, ratingsCount: 0 };
  }

  const total = data.reduce((sum, item) => sum + item.rating, 0);
  const averageRating = Number((total / ratingsCount).toFixed(1));
  return { averageRating, ratingsCount };
};

export const getMediaRatingSummary = async (
  mediaId: number,
  mediaType: ContentType,
): ActionResponse<MediaRatingSummary> => {
  if (!mediaId || !isValidMediaType(mediaType)) {
    return {
      success: false,
      message: "Invalid media identifier.",
    };
  }

  try {
    const supabase = await createClient();

    const { data: rpcData, error: rpcError } = await supabase.rpc("get_media_rating_stats", {
      p_media_id: mediaId,
      p_media_type: mediaType,
    });

    let averageRating = 0;
    let ratingsCount = 0;

    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      const row = rpcData[0];
      averageRating = Number(row.average_rating ?? 0);
      ratingsCount = Number(row.ratings_count ?? 0);
    } else {
      const fallbackStats = await fallbackMediaRatingStats(mediaId, mediaType);
      if (!fallbackStats) {
        return {
          success: false,
          message: "Failed to load rating summary.",
        };
      }
      averageRating = fallbackStats.averageRating;
      ratingsCount = fallbackStats.ratingsCount;
    }

    let userRating: number | null = null;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: userRatingRow, error: userRatingError } = await supabase
        .from("ratings")
        .select("rating")
        .eq("user_id", user.id)
        .eq("media_id", mediaId)
        .eq("media_type", mediaType)
        .maybeSingle();

      if (!userRatingError && userRatingRow) {
        userRating = userRatingRow.rating;
      }
    }

    return {
      success: true,
      data: {
        averageRating,
        ratingsCount,
        userRating,
      },
    };
  } catch (error) {
    console.error("getMediaRatingSummary error:", error);
    return {
      success: false,
      message: "Failed to load rating summary.",
    };
  }
};

export const setMediaRating = async (
  mediaId: number,
  mediaType: ContentType,
  rating: number,
): ActionResponse => {
  if (!mediaId || !isValidMediaType(mediaType)) {
    return {
      success: false,
      message: "Invalid media identifier.",
    };
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return {
      success: false,
      message: "Rating must be an integer between 1 and 10.",
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "You must be logged in to rate content.",
      };
    }

    const { error } = await supabase.from("ratings").upsert(
      {
        user_id: user.id,
        media_id: mediaId,
        media_type: mediaType,
        rating,
      },
      {
        onConflict: "user_id,media_id,media_type",
      },
    );

    if (error) {
      console.error("setMediaRating error:", error);
      return {
        success: false,
        message: "Failed to save rating.",
      };
    }

    return {
      success: true,
      message: "Rating saved.",
    };
  } catch (error) {
    console.error("setMediaRating unexpected error:", error);
    return {
      success: false,
      message: "Failed to save rating.",
    };
  }
};

export const removeMediaRating = async (
  mediaId: number,
  mediaType: ContentType,
): ActionResponse => {
  if (!mediaId || !isValidMediaType(mediaType)) {
    return {
      success: false,
      message: "Invalid media identifier.",
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "You must be logged in to remove rating.",
      };
    }

    const { error } = await supabase
      .from("ratings")
      .delete()
      .eq("user_id", user.id)
      .eq("media_id", mediaId)
      .eq("media_type", mediaType);

    if (error) {
      console.error("removeMediaRating error:", error);
      return {
        success: false,
        message: "Failed to remove rating.",
      };
    }

    return {
      success: true,
      message: "Rating removed.",
    };
  } catch (error) {
    console.error("removeMediaRating unexpected error:", error);
    return {
      success: false,
      message: "Failed to remove rating.",
    };
  }
};

export const getMediaComments = async (
  mediaId: number,
  mediaType: ContentType,
  page: number = 1,
  limit: number = DEFAULT_COMMENT_LIMIT,
): ActionResponse<MediaCommentsPage> => {
  if (!mediaId || !isValidMediaType(mediaType)) {
    return {
      success: false,
      message: "Invalid media identifier.",
    };
  }

  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  try {
    const supabase = await createClient();

    const { data, error, count } = await supabase
      .from("comments")
      .select("id,user_id,content,created_at,updated_at", { count: "exact" })
      .eq("media_id", mediaId)
      .eq("media_type", mediaType)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("getMediaComments error:", error);
      return {
        success: false,
        message: "Failed to load comments.",
      };
    }

    const rows = (data ?? []) as Pick<
      CommentRow,
      "id" | "user_id" | "content" | "created_at" | "updated_at"
    >[];

    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    const usernameById = new Map<string, string>();

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id,username")
        .in("id", userIds);

      if (profilesError) {
        console.error("getMediaComments profiles error:", profilesError);
      } else {
        (profiles ?? []).forEach((profile) => {
          usernameById.set(profile.id, profile.username);
        });
      }
    }

    const comments: MediaComment[] = rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      username: usernameById.get(row.user_id) ?? "Member",
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    const totalCount = count ?? 0;

    return {
      success: true,
      data: {
        page: safePage,
        limit: safeLimit,
        totalCount,
        hasNextPage: from + comments.length < totalCount,
        comments,
      },
    };
  } catch (error) {
    console.error("getMediaComments unexpected error:", error);
    return {
      success: false,
      message: "Failed to load comments.",
    };
  }
};

export const createMediaComment = async (
  mediaId: number,
  mediaType: ContentType,
  content: string,
): ActionResponse => {
  if (!mediaId || !isValidMediaType(mediaType)) {
    return {
      success: false,
      message: "Invalid media identifier.",
    };
  }

  const normalizedContent = normalizeComment(content);
  if (normalizedContent.length < COMMENT_MIN_LENGTH || normalizedContent.length > COMMENT_MAX_LENGTH) {
    return {
      success: false,
      message: `Comment must be between ${COMMENT_MIN_LENGTH} and ${COMMENT_MAX_LENGTH} characters.`,
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "You must be logged in to comment.",
      };
    }

    const { error } = await supabase.from("comments").insert({
      user_id: user.id,
      media_id: mediaId,
      media_type: mediaType,
      content: normalizedContent,
    });

    if (error) {
      console.error("createMediaComment error:", error);
      return {
        success: false,
        message: "Failed to post comment.",
      };
    }

    return {
      success: true,
      message: "Comment posted.",
    };
  } catch (error) {
    console.error("createMediaComment unexpected error:", error);
    return {
      success: false,
      message: "Failed to post comment.",
    };
  }
};

export const deleteMediaComment = async (commentId: number): ActionResponse => {
  if (!commentId) {
    return {
      success: false,
      message: "Invalid comment identifier.",
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        message: "You must be logged in to delete comments.",
      };
    }

    const { data, error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("deleteMediaComment error:", error);
      return {
        success: false,
        message: "Failed to delete comment.",
      };
    }

    if (!data) {
      return {
        success: false,
        message: "Comment not found.",
      };
    }

    return {
      success: true,
      message: "Comment deleted.",
    };
  } catch (error) {
    console.error("deleteMediaComment unexpected error:", error);
    return {
      success: false,
      message: "Failed to delete comment.",
    };
  }
};
