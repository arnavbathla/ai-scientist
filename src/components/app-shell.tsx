"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { FolderKanban, FlaskConical, Settings, LayoutDashboard, LogOut } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface AppShellProps {
  user: { name?: string | null; email?: string | null };
  children: React.ReactNode;
}

const NAV: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/settings/models", label: "Models", icon: Settings },
  { href: "/settings/sources", label: "Sources", icon: FlaskConical },
];

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 py-4 border-b border-border flex items-center gap-2">
          <div className="h-7 w-7 rounded-sm border border-border grid place-items-center mono text-[11px] tracking-wider">
            R/
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium tracking-tight">ResearchOS</div>
            <div className="text-[10px] text-muted-foreground mono">v0.1.0</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname?.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-secondary transition-colors",
                  active && "bg-secondary text-foreground",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-muted-foreground")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
          <div className="truncate text-foreground">{user.name || user.email}</div>
          <div className="mono text-[10px] truncate">{user.email}</div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
