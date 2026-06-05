import { LeftPanel } from "@/components/workspace/left-panel";
import { CenterPanel } from "@/components/workspace/center-panel";
import { RightPanel } from "@/components/workspace/right-panel";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <span className="text-sm font-semibold">ProjectForge</span>
        <span className="text-xs text-muted-foreground">
          local knowledge-to-project compiler
        </span>
      </header>
      <main className="grid flex-1 grid-cols-[260px_1fr_300px] divide-x overflow-hidden">
        <aside className="overflow-hidden">
          <LeftPanel />
        </aside>
        <section className="overflow-hidden">
          <CenterPanel />
        </section>
        <aside className="overflow-hidden">
          <RightPanel />
        </aside>
      </main>
    </div>
  );
}
