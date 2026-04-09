import { cn } from "@/utils/helpers";
import { ArrowLeft, Grid, Party, Server } from "@/utils/icons";
import ActionButton from "./ActionButton";

interface MoviePlayerHeaderProps {
  id: number;
  movieName: string;
  hidden?: boolean;
  onOpenSource: () => void;
  onOpenServer?: () => void;
  showServerButton?: boolean;
  onStartParty?: () => void;
  partyCreating?: boolean;
}

const MoviePlayerHeader: React.FC<MoviePlayerHeaderProps> = ({
  id,
  movieName,
  hidden,
  onOpenSource,
  onOpenServer,
  showServerButton = false,
  onStartParty,
  partyCreating = false,
}) => {
  return (
    <div
      aria-hidden={hidden ? true : undefined}
      className={cn(
        "absolute top-0 z-[10050] flex h-24 w-full items-start justify-between gap-2 max-[360px]:h-20 sm:h-28 sm:gap-4",
        "bg-linear-to-b from-black/80 to-transparent p-1.5 text-white transition-opacity max-[360px]:p-1 sm:p-2 md:p-4 pointer-events-none",
        {
          "opacity-0": hidden,
          "opacity-100": !hidden,
        },
      )}
    >
      <div className="pointer-events-auto">
        <ActionButton label="Back" href={`/movie/${id}`}>
          <ArrowLeft className="size-8 max-[360px]:size-7 sm:size-10" />
        </ActionButton>
      </div>
      <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col justify-center text-center sm:flex">
        <p className="text-sm text-white text-shadow-lg sm:text-lg lg:text-xl">{movieName}</p>
      </div>
      <div className="pointer-events-none flex max-w-[72vw] items-center gap-2 overflow-x-auto sm:max-w-none sm:gap-3 md:gap-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {showServerButton && onOpenServer ? (
          <ActionButton label="Servers" tooltip="Servers" onClick={onOpenServer}>
            <Grid className="size-6 max-[360px]:size-5 sm:size-7" />
          </ActionButton>
        ) : null}
        <ActionButton label="Sources" tooltip="Sources" onClick={onOpenSource}>
          <Server className="size-6 max-[360px]:size-5 sm:size-7" />
        </ActionButton>
        {onStartParty ? (
          <ActionButton label="Watch Party" tooltip="Start Watch Party" onClick={onStartParty} disabled={partyCreating}>
            <Party className="size-6 max-[360px]:size-5 sm:size-7" />
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
};

export default MoviePlayerHeader;
