import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index}>
          <Skeleton className="mb-3 aspect-square rounded-[1.35rem]" />
          <Skeleton className="mb-2 h-4 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}
