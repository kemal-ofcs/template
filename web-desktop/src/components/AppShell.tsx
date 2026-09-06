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

/**
 * Menu aplikasi.
 *
 * Setiap entri dijaga oleh `area`-nya, sehingga menu, guard halaman, dan
 * pemeriksaan permission di backend Rust merujuk daftar permission yang sama.
 * Menyembunyikan menu saja tidak pernah cukup: backend tetap wajib memeriksa.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { area: "home", href: "/", label: "Beranda" },
  { area: "items", href: "/items", label: "Item" },
  { area: "activity", href: "/activity", label: "Aktivitas" },
  { area: "operators", href: "/operators", label: "Operator" },
  {
    area: "password_reset",
    href: "/riwayat-reset-password",
    label: "Riwayat Reset",
  },
  { area: "settings", href: "/settings", label: "Pengaturan" },
];

interface AppShellProps {
  children: ReactNode;
  contentClassName?: string;
}

export function AppShell({ children, contentClassName = "" }: AppShellProps) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter((item) => canAccessArea(user, item.area));

  return (
    <div className="app-shell flex min-h-dvh flex-col text-slate-100">
      {/* Sinkronisasi latar wajib selalu terpasang: mutasi lokal baru sampai ke
          cloud lewat siklus ini, bukan lewat aksi pengguna. */}
      <AutoSyncRunner />
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-950 shadow-xl transition-transform focus:translate-y-0"
      >
        Lewati ke konten utama
      </a>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-sm font-black tracking-tight text-white"
          >
            App Template
          </Link>
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
                  className={`min-h-9 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    active
                      ? "bg-sky-400/15 text-sky-200"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-[12rem] truncate text-xs text-slate-400 sm:block">
                {user.nama_operator}
              </span>
              <button
                type="button"
                onClick={logout}
                className="min-h-9 rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-300 hover:border-rose-400/40 hover:text-rose-200"
              >
                Keluar
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main
        id="main-content"
        className={`mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-6 px-4 py-6 ${contentClassName}`}
      >
        {children}
      </main>
    </div>
  );
}
