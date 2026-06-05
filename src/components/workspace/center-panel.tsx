"use client";

import { useWorkspace } from "@/lib/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CenterMode } from "@/lib/types";

export function CenterPanel() {
  const { centerMode, setCenterMode } = useWorkspace();

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={centerMode}
        onValueChange={(v) => setCenterMode(v as CenterMode)}
        className="flex h-full flex-col"
      >
        <div className="border-b px-4 py-3">
          <TabsList>
            <TabsTrigger value="learn">Learn</TabsTrigger>
            <TabsTrigger value="ask">Ask</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <TabsContent value="learn" className="mt-0 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Add a source</h2>
              <p className="text-sm text-muted-foreground">
                Paste a YouTube URL, article, website, or notes. ProjectForge saves a
                snapshot and generates a structured learning doc.
              </p>
            </div>
            <div className="flex gap-2">
              <Input placeholder="https://youtube.com/watch?v=…" />
              <Button disabled>Capture</Button>
            </div>
            <Textarea placeholder="…or paste raw notes / transcript here" rows={8} />
            <p className="text-xs text-muted-foreground">
              Phase 1 wires capture → snapshot → learning doc.
            </p>
          </TabsContent>

          <TabsContent value="ask" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Ask the knowledge base</h2>
            <Card className="p-4 text-sm text-muted-foreground">
              Answers will cite the underlying sources via FTS5 retrieval. Wired in Phase 2.
            </Card>
            <div className="flex gap-2">
              <Input placeholder="What game ideas emerge from these sources?" />
              <Button disabled>Ask</Button>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            <Card className="p-6 text-sm text-muted-foreground">
              Select a source or generated doc to preview its Markdown here.
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
