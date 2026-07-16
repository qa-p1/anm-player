import { motion } from "framer-motion";
import { NavLink, useLocation } from "react-router-dom";

import { navItems } from "@/components/navigation/nav-items";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 rounded-[1.75rem] border border-white/10 bg-background/78 p-2 shadow-glass backdrop-blur-2xl lg:hidden">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={cn(
              "relative flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[0.72rem] font-medium transition",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {isActive && (
              <motion.span
                layoutId="bottom-active"
                className="absolute inset-0 rounded-2xl bg-white/10"
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            )}
            <Icon className="relative h-5 w-5" />
            <span className="relative leading-none">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
