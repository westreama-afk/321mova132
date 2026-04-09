"use client";

import SectionTitle from "@/components/ui/other/SectionTitle";
import Carousel from "@/components/ui/wrapper/Carousel";
import useDiscoverFilters from "@/hooks/useDiscoverFilters";
import ResumeCard from "./Cards/Resume";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserHistories, removeHistory } from "@/actions/histories";
import { Button, addToast } from "@heroui/react";
import { Close } from "@/utils/icons";

const ContinueWatching: React.FC = () => {
  const { content } = useDiscoverFilters();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryFn: () => getUserHistories(),
    queryKey: ["continue-watching"],
  });

  const removeHistoryMutation = useMutation({
    mutationFn: (historyId: number) => removeHistory(historyId),
    onMutate: async (historyId) => {
      await queryClient.cancelQueries({ queryKey: ["continue-watching"] });
      const previous = queryClient.getQueryData<Awaited<ReturnType<typeof getUserHistories>>>([
        "continue-watching",
      ]);

      queryClient.setQueryData<Awaited<ReturnType<typeof getUserHistories>>>(
        ["continue-watching"],
        (current) => {
          if (!current?.data) return current;
          return {
            ...current,
            data: current.data.filter((item) => item.id !== historyId),
          };
        },
      );

      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["continue-watching"], context.previous);
      }
      addToast({
        title: "Failed to remove from Continue Your Journey",
        color: "danger",
      });
    },
    onSuccess: ({ message }) => {
      addToast({
        title: message || "Removed successfully",
        color: "success",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["continue-watching"] });
    },
  });

  if (!data?.data) return null;

  return (
    <section id="continue-watching" className="min-h-[250px] md:min-h-[300px]">
      <div className="z-3 flex flex-col gap-2">
        <SectionTitle color={content === "movie" ? "primary" : "warning"}>
          Continue Your Journey
        </SectionTitle>
        <Carousel>
          {data.data.map((media) => {
            const isRemoving =
              removeHistoryMutation.isPending && removeHistoryMutation.variables === media.id;

            return (
              <div
                key={media.id}
                className="embla__slide relative flex min-h-fit max-w-fit items-center px-1 py-2"
              >
                <Button
                  isIconOnly
                  radius="full"
                  size="sm"
                  color="danger"
                  variant="solid"
                  isLoading={isRemoving}
                  aria-label="Remove from Continue Your Journey"
                  className="absolute right-3 top-4 z-30"
                  onPress={() => removeHistoryMutation.mutate(media.id)}
                >
                  <Close />
                </Button>
                <ResumeCard media={media} />
              </div>
            );
          })}
        </Carousel>
      </div>
    </section>
  );
};

export default ContinueWatching;
