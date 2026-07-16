import type * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-full border border-input bg-card/80 px-5 text-base text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/70 focus:ring-4 focus:ring-primary/15",
        className,
      )}
      {...props}
    />
  );
}
