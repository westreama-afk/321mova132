"use client";

import {
  createMediaComment,
  deleteMediaComment,
  getMediaComments,
  getMediaRatingSummary,
  removeMediaRating,
  setMediaRating,
} from "@/actions/social";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import { ColorType } from "@/types/component";
import { ContentType } from "@/types";
import SectionTitle from "@/components/ui/other/SectionTitle";
import { Star, Trash } from "@/utils/icons";
import { addToast, Button, Spinner, Textarea } from "@heroui/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

interface CommunitySectionProps {
  mediaId: number;
  mediaType: ContentType;
  color?: Extract<ColorType, "primary" | "warning">;
}

const commentLimit = 10;

const CommunitySection: React.FC<CommunitySectionProps> = ({
  mediaId,
  mediaType,
  color = "primary",
}) => {
  const queryClient = useQueryClient();
  const { data: user, isLoading: isUserLoading } = useSupabaseUser();
  const [commentInput, setCommentInput] = useState("");

  const ratingQuery = useQuery({
    queryKey: ["media-rating-summary", mediaType, mediaId, user?.id],
    queryFn: () => getMediaRatingSummary(mediaId, mediaType),
    staleTime: 1000 * 60,
  });

  const commentsQuery = useInfiniteQuery({
    queryKey: ["media-comments", mediaType, mediaId],
    queryFn: ({ pageParam = 1 }) => getMediaComments(mediaId, mediaType, pageParam, commentLimit),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.success && lastPage.data?.hasNextPage) {
        return lastPage.data.page + 1;
      }
      return undefined;
    },
    staleTime: 1000 * 30,
  });

  const ratingMutation = useMutation({
    mutationFn: async (value: number | null) => {
      const result =
        value === null
          ? await removeMediaRating(mediaId, mediaType)
          : await setMediaRating(mediaId, mediaType, value);

      if (!result.success) {
        throw new Error(result.message || "Failed to save rating.");
      }

      return value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media-rating-summary", mediaType, mediaId] });
      addToast({
        title: "Rating updated",
        color: "success",
      });
    },
    onError: (error) => {
      addToast({
        title: "Could not update rating",
        description: error instanceof Error ? error.message : "Please try again.",
        color: "danger",
      });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (content: string) => {
      const result = await createMediaComment(mediaId, mediaType, content);
      if (!result.success) {
        throw new Error(result.message || "Failed to post comment.");
      }
      return result;
    },
    onSuccess: () => {
      setCommentInput("");
      queryClient.invalidateQueries({ queryKey: ["media-comments", mediaType, mediaId] });
      addToast({
        title: "Comment posted",
        color: "success",
      });
    },
    onError: (error) => {
      addToast({
        title: "Could not post comment",
        description: error instanceof Error ? error.message : "Please try again.",
        color: "danger",
      });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      const result = await deleteMediaComment(commentId);
      if (!result.success) {
        throw new Error(result.message || "Failed to delete comment.");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media-comments", mediaType, mediaId] });
      addToast({
        title: "Comment deleted",
        color: "success",
      });
    },
    onError: (error) => {
      addToast({
        title: "Could not delete comment",
        description: error instanceof Error ? error.message : "Please try again.",
        color: "danger",
      });
    },
  });

  const comments = useMemo(() => {
    return commentsQuery.data?.pages.flatMap((page) => page.data?.comments ?? []) ?? [];
  }, [commentsQuery.data?.pages]);

  const ratingData = ratingQuery.data?.data;
  const averageRating = ratingData?.averageRating ?? 0;
  const ratingsCount = ratingData?.ratingsCount ?? 0;
  const userRating = ratingData?.userRating ?? null;

  const submitComment = () => {
    if (!user) {
      addToast({
        title: "Sign in required",
        description: "You need an account to comment.",
        color: "warning",
      });
      return;
    }

    commentMutation.mutate(commentInput);
  };

  const selectedColorClass =
    color === "warning"
      ? "border-warning bg-warning/10 text-warning-700"
      : "border-primary bg-primary/10 text-primary-700";

  const accentBorder = color === "warning" ? "border-warning/40" : "border-primary/40";
  const accentText = color === "warning" ? "text-warning" : "text-primary";
  const accentGlow = color === "warning" ? "from-warning/25" : "from-primary/25";
  const surfaceBorder = "border-white/10";
  const surfaceBg = "bg-black/25";

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border ${surfaceBorder} ${surfaceBg} p-4 backdrop-blur-lg md:p-6`}
      id="community"
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accentGlow} to-transparent`} />
      <div className="relative z-1 flex flex-col gap-6">
        <div className="space-y-2">
          <SectionTitle color={color}>Community</SectionTitle>
          <p className="text-sm text-default-400">
            Rate this title and share your thoughts with other viewers.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.25fr]">
          <div className={`space-y-4 rounded-2xl border ${surfaceBorder} bg-black/30 p-4`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Your Rating</h3>
              <div className={`flex items-center gap-1 rounded-full border ${accentBorder} px-3 py-1`}>
                <Star />
                <span className={`text-sm font-semibold ${accentText}`}>
                  {averageRating.toFixed(1)}
                  <span className="ml-1 text-default-400">({ratingsCount})</span>
                </span>
              </div>
            </div>

            {!isUserLoading && !user && (
              <p className="text-sm text-default-500">Sign in to submit your own rating.</p>
            )}

            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 10 }, (_, index) => {
                const value = index + 1;
                const selected = userRating === value;

                return (
                  <Button
                    key={value}
                    size="sm"
                    variant={selected ? "solid" : "flat"}
                    color={color}
                    isDisabled={!user || ratingMutation.isPending}
                    onPress={() => ratingMutation.mutate(value)}
                    className={selected ? "font-bold" : "text-default-600"}
                  >
                    {value}
                  </Button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-default-500">
                {userRating ? `Your score: ${userRating}/10` : "Tap a number to rate"}
              </p>
              {userRating && (
                <Button
                  color="danger"
                  variant="light"
                  size="sm"
                  isLoading={ratingMutation.isPending}
                  onPress={() => ratingMutation.mutate(null)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>

          <div className={`space-y-4 rounded-2xl border ${surfaceBorder} bg-black/30 p-4`}>
            <h3 className="text-lg font-semibold">Write a Comment</h3>
            <Textarea
              value={commentInput}
              onValueChange={setCommentInput}
              maxLength={1000}
              minRows={4}
              placeholder="Share what you think about this title..."
              variant="bordered"
              classNames={{
                inputWrapper: "bg-black/35 border-default-200/70",
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs text-default-500">{commentInput.trim().length}/1000</p>
                {!user && !isUserLoading && (
                  <p className="text-xs text-default-500">Sign in required to post.</p>
                )}
              </div>
              <Button
                color={color}
                isLoading={commentMutation.isPending}
                isDisabled={!commentInput.trim() || commentMutation.isPending}
                onPress={submitComment}
              >
                Post Comment
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Comments</h3>
            {commentsQuery.data?.pages[0]?.data && (
              <span className="text-sm text-default-400">
                {commentsQuery.data.pages[0].data.totalCount} total
              </span>
            )}
          </div>

          {commentsQuery.isPending ? (
            <div className={`rounded-2xl border ${surfaceBorder} bg-black/45 p-6`}>
              <Spinner size="lg" variant="simple" color={color} />
            </div>
          ) : commentsQuery.isError ? (
            <div className="space-y-2 rounded-2xl border border-danger/30 bg-danger/5 p-4">
              <p className="text-sm text-danger">Failed to load comments.</p>
              <Button
                size="sm"
                color="danger"
                variant="light"
                onPress={() => commentsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : comments.length === 0 ? (
            <p className={`rounded-2xl border ${surfaceBorder} bg-black/30 p-4 text-sm text-default-500`}>
              No comments yet. Be the first to post one.
            </p>
          ) : (
            <>
              {comments.map((comment) => (
                <article
                  key={comment.id}
                  className={`space-y-3 rounded-2xl border ${surfaceBorder} bg-black/30 p-4`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border text-xs font-bold uppercase ${comment.user_id === user?.id ? selectedColorClass : "border-default-200 text-default-600"}`}
                      >
                        {comment.username.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{comment.username}</p>
                        <p className="text-xs text-default-500">
                          {new Date(comment.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {comment.user_id === user?.id && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        isLoading={deleteCommentMutation.isPending}
                        onPress={() => deleteCommentMutation.mutate(comment.id)}
                      >
                        <Trash />
                      </Button>
                    )}
                  </div>

                  <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                    {comment.content}
                  </p>
                </article>
              ))}

              {commentsQuery.hasNextPage && (
                <div className="flex justify-center pt-2">
                  <Button
                    color={color}
                    variant="flat"
                    isLoading={commentsQuery.isFetchingNextPage}
                    onPress={() => commentsQuery.fetchNextPage()}
                  >
                    Load More Comments
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default CommunitySection;
