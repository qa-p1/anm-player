import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

interface SectionProps {
  title: string;
  eyebrow?: string;
  actionLabel?: string;
  actionPath?: string;
  icon?: LucideIcon;
  children: ReactNode;
}

export function Section({ title, eyebrow, actionLabel, actionPath, icon: Icon, children }: SectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>}
            <h2 className="break-words text-xl font-bold tracking-normal md:text-2xl">{title}</h2>
          </div>
        </div>
        {actionLabel && actionPath && (
          <Button variant="quiet" size="sm" asChild>
            <Link to={actionPath}>{actionLabel}</Link>
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
