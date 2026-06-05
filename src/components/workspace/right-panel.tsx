"use client";

import { OUTPUT_GENERATORS } from "@/lib/types";
import { modelOptions } from "@/lib/ai/models";
import { useWorkspace } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RightPanel() {
  const { modelId, setModel } = useWorkspace();

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Generate
        </span>
        <Select value={modelId} onValueChange={setModel}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 px-3 pb-4">
          {OUTPUT_GENERATORS.map((g) => (
            <Card
              key={g.type}
              className="cursor-pointer gap-1 p-3 transition-colors hover:bg-accent"
            >
              <div className="text-sm font-medium">{g.label}</div>
              <div className="text-xs text-muted-foreground">{g.blurb}</div>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
