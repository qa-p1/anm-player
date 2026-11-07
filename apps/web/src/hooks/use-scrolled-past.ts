import { useEffect, useState, type RefObject } from "react";

/** True once the observed element has scrolled above the viewport. */
export function useScrolledPast(ref: RefObject<HTMLElement | null>) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0), { rootMargin: "-72px 0px 0px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return past;
}
