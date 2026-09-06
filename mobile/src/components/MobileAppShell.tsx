"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { type AppArea, canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { AutoSyncRunner } from "./AutoSyncRunner";

interface NavItem {
  readonly area: AppArea;
  readonly href: string;
  readonly label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { area: "home", href: "/", label: "Beranda" },
  { area: "items", href: "/items", label: "Item" },
  { area: "activity", href: "/activity", label: "Aktivitas" },
  { area: "settings", href: "/settings", label: "Atur" },
];

interface MobileAppShellProps {
  children: ReactNode;
  title?: string;
}

/**
 * Kerangka layar Mobile.
 *
 * Navigasi bawah dijaga permission yang sama dengan Desktop lewat
 * `canAccessArea`, sehingga satu perubahan role langsung berlaku di kedua
 * target. Menyembunyikan menu tetap bukan pengganti guard di backend Rust.
 */
export function MobileAppShell({ children, title }: MobileAppShellProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const visible = NAV_ITEMS.filter((item) => canAccessArea(user, item.area));

  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <AutoSyncRunner />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <p className="text-sm font-black text-white">
          {title ?? "App Template"}
        </p>
        {user ? (
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            {user.nama_operator} — {user.role}
          </p>
        ) : null}
      </header>

      <main
        id="main-content"
        className="flex min-h-0 flex-1 touch-pan-y flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 pb-24"
      >
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-stretch">
          {visible.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition ${
                  active ? "text-sky-300" : "text-slate-500"
                }`}
              >
                <span
                  className={`h-1 w-6 rounded-full ${
                    active ? "bg-sky-400" : "bg-transparent"
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
