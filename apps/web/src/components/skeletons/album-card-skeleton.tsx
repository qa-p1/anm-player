import { Skeleton } from "@/components/ui/skeleton";

export function AlbumCardSkeleton() {
  return (
    <div className="glass-panel rounded-3xl p-4">
      {/* Album artwork */}
      <Skeleton className="mb-3 aspect-square w-full rounded-2xl" />
      
      {/* Title */}
      <Skeleton className="h-4 w-3/4" />
      
      {/* Artist */}
      <Skeleton className="mt-1 h-3 w-1/2" />
      
      {/* Info */}
      <Skeleton className="mt-1 h-3 w-2/3" />
    </div>
  );
}

export function AlbumCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <AlbumCardSkeleton key={i} />
      ))}
    </div>
  );
}
