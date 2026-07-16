import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PlayerControlButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  emphasis?: boolean;
  onClick?: () => void;
}

export function PlayerControlButton({ icon: Icon, label, active = false, emphasis = false, onClick }: PlayerControlButtonProps) {
  return (
    <Button
      type="button"
      variant={emphasis ? "default" : active ? "secondary" : "glass"}
      size="icon"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cn(emphasis && "h-16 w-16", active && "text-primary")}
    >
      <Icon className={cn("h-5 w-5", emphasis && "h-7 w-7 fill-current")} />
    </Button>
  );
}
