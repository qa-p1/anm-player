import { motion } from "framer-motion";

import { Card } from "@/components/ui/card";
import type { LibrarySection } from "@/features/library/library-data";

export function LibrarySectionCard({ section }: { section: LibrarySection }) {
  const Icon = section.icon;

  return (
    <motion.article whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 320, damping: 28 }}>
      <Card className="h-full p-5 transition hover:bg-white/10">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-muted-foreground">
            {section.status}
          </span>
        </div>
        <h3 className="text-base font-semibold tracking-normal">{section.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.description}</p>
      </Card>
    </motion.article>
  );
}
