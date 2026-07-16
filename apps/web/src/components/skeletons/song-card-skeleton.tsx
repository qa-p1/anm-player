import { Skeleton } from "@/components/ui/skeleton";

export function SongCardSkeleton() {
  return (
    <div className="glass-panel flex items-center gap-3 rounded-2xl p-3">
      {/* Artwork */}
      <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>
  );
}

export function SongCardSkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SongCardSkeleton key={i} />
      ))}
    </div>
  );
}
