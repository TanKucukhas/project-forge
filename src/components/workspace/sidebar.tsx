"use client";

/**
 * Chat-centric left sidebar (ChatGPT/Claude style):
 *   [Project name ▾]  → corner menu: Dashboard · switch project · + New project
 *   + New chat
 *   <chat 1> <chat 2> …           (project-scoped, listed directly)
 *   ── Learn (Capture + distill)
 *   Settings
 */
import { useState } from "react";
import {
  Plus,
  Sparkles,
  Settings,
  ChevronsUpDown,
  LayoutDashboard,
  FolderPlus,
  Check,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects } from "@/lib/api";
import { listChats, deleteChat, type Chat } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const {
    activeProjectId,
    activeChatId,
    chatsVersion,
    centerMode,
    setCenterMode,
    setActiveChat,
    setActiveProject,
    bumpChats,
  } = useWorkspace();
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === activeProjectId);

  const [menuOpen, setMenuOpen] = useState(false);

  // Project-scoped chats from localStorage (re-read when the version bumps).
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadKey = `${activeProjectId ?? ""}:${chatsVersion}`;
  if (loadKey !== loadedKey) {
    setLoadedKey(loadKey);
    setChats(listChats(activeProjectId));
  }

  const onLearn = centerMode === "learn" || centerMode === "analyze" || centerMode === "dashboard";

  function newChat() {
    setActiveChat(null);
    setCenterMode("chat");
  }

  function openChat(id: string) {
    setActiveChat(id);
    setCenterMode("chat");
  }

  function removeChat(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!activeProjectId) return;
    deleteChat(activeProjectId, id);
    if (activeChatId === id) setActiveChat(null);
    bumpChats();
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r bg-card">
      {/* Project-name corner with menu */}
      <div className="relative p-3">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Project</p>
            <p className="truncate text-sm font-medium">{project?.title ?? "Select a project"}</p>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>

        {menuOpen && (
          <>
            {/* click-away backdrop */}
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-3 right-3 top-[3.75rem] z-20 space-y-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              <MenuItem
                icon={LayoutDashboard}
                label="Dashboard"
                onClick={() => {
                  setCenterMode("dashboard");
                  setMenuOpen(false);
                }}
              />
              {projects && projects.length > 0 && (
                <>
                  <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Switch project
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setActiveProject(p.id);
                          setCenterMode("chat");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{p.title}</span>
                        {p.id === activeProjectId && <Check className="size-3.5 shrink-0 text-primary" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="my-1 border-t" />
              <MenuItem
                icon={FolderPlus}
                label="New project"
                onClick={() => {
                  setCenterMode("projects");
                  setMenuOpen(false);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Learn — project-level destination, grouped under the project header. */}
      <div className="px-3">
        <button
          onClick={() => setCenterMode("dashboard")}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
            onLearn
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Sparkles className="size-4 shrink-0" /> Learn
        </button>
      </div>

      {/* New chat — sits directly above the chat list it creates into. */}
      <div className="px-3 pb-2 pt-2">
        <button
          onClick={newChat}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            centerMode === "chat" && !activeChatId
              ? "border-primary/40 bg-primary/10 text-primary"
              : "hover:bg-muted",
          )}
        >
          <Plus className="size-4" /> New chat
        </button>
      </div>

      {/* Chats — listed directly */}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {chats.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No chats yet. Start one with <strong>New chat</strong>.
          </p>
        ) : (
          chats.map((c) => {
            const active = centerMode === "chat" && activeChatId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => openChat(c.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-muted",
                )}
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <button
                  onClick={(e) => removeChat(e, c.id)}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  title="Delete chat"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </nav>

      {/* Footer: global Settings only */}
      <div className="space-y-1 border-t p-3">
        <button
          onClick={() => setCenterMode("global-settings")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
            centerMode === "global-settings"
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Settings className="size-[18px] shrink-0" />
          <span className="flex-1">Settings</span>
        </button>
        <p className="px-3 pt-1 text-[11px] text-muted-foreground/70">ProjectForge v1</p>
      </div>
    </aside>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{label}</span>
    </button>
  );
}
