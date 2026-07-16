import type { TargetAndTransition, Transition } from "framer-motion";

const transition: Transition = { duration: 0.28, ease: [0.22, 1, 0.36, 1] };

export const pageTransition: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: 14, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(8px)" },
  transition,
};
