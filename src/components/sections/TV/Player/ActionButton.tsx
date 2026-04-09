import { cn } from "@/utils/helpers";
import { Tooltip } from "@heroui/react";
import Link from "next/link";

interface ActionButtonProps {
  label: string;
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  tooltip?: string;
  disabled?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  label,
  href = "",
  children,
  onClick,
  tooltip,
  disabled,
}) => {
  const Button = (
    <Tooltip content={tooltip} isDisabled={disabled || !tooltip} showArrow placement="bottom">
      <button
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "group pointer-events-auto flex h-10 w-10 items-center justify-center rounded-md drop-shadow-md transition-colors",
          "max-[360px]:h-9 max-[360px]:w-9 [&>svg]:h-7 [&>svg]:w-7 max-[360px]:[&>svg]:h-6 max-[360px]:[&>svg]:w-6 [&>svg]:transition-all",
          {
          "hover:[&>svg]:scale-125 [&>svg]:hover:text-warning": !disabled,
          "cursor-not-allowed opacity-50": disabled,
          },
        )}
      >
        {children}
      </button>
    </Tooltip>
  );

  return href ? (
    <Link href={href} className="pointer-events-auto flex items-center">
      {Button}
    </Link>
  ) : (
    Button
  );
};

export default ActionButton;
