import { motion } from "framer-motion";
import { Disc3, Keyboard } from "lucide-react";
import { NavLink, useLocation } from "react-router";

import { navItems } from "@/components/navigation/nav-items";
import { DownloadQueueTrigger } from "@/components/download-queue";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

export function Sidebar() {
  const location = useLocation();
  const setShortcutHelpOpen = useUiStore((state) => state.setShortcutHelpOpen);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-background/55 px-4 py-5 backdrop-blur-2xl lg:flex">
      <div className="mb-9 flex items-center gap-3 px-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
          <Disc3 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-lg font-bold tracking-normal">ANM Player</p>
          <p className="text-xs text-muted-foreground">Self-hosted music</p>
        </div>
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "relative flex h-12 items-center gap-3 rounded-2xl px-4 text-sm font-medium transition",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-2xl bg-white/10"
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                />
              )}
              <Icon className="relative h-5 w-5" />
              <span className="relative">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <button type="button" onClick={() => setShortcutHelpOpen(true)} className="mb-3 flex h-10 items-center gap-3 rounded-xl px-4 text-xs font-medium text-muted-foreground transition hover:bg-white/8 hover:text-foreground"><Keyboard className="h-4 w-4" />Keyboard shortcuts <kbd className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[0.62rem]">?</kbd></button>
      <DownloadQueueTrigger />
    </aside>
  );
}
