import type { SettingsGroup } from "@/features/settings/settings-data";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export function SettingsCard({ group }: { group: SettingsGroup }) {
  const Icon = group.icon;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-white/10 p-5">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-bold tracking-normal">{group.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{group.description}</p>
      </div>
      <div className="divide-y divide-white/10">
        {group.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
            </div>
            {item.interactive === "switch" ? (
              <Switch checked aria-label={item.label} />
            ) : item.interactive === "button" ? (
              <Button variant="glass" size="sm">
                {item.value}
              </Button>
            ) : (
              <span className="shrink-0 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-muted-foreground">
                {item.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
