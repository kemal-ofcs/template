"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { type AppArea, canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { getSyncStatus, type SyncStatus } from "@/lib/gateways/sync-status";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";

interface ModuleCard {
  readonly area: AppArea;
  readonly href: string;
  readonly title: string;
  readonly description: string;
}

const MODULES: readonly ModuleCard[] = [
  {
    area: "items",
    href: "/items",
    title: "Master Item",
    description:
      "Contoh master data yang tersinkronisasi dua arah dengan database cloud.",
  },
  {
    area: "activity",
    href: "/activity",
    title: "Log Aktivitas",
    description:
      "Contoh log transaksional append-only dengan kunci idempotensi per baris.",
  },
  {
    area: "operators",
    href: "/operators",
    title: "Operator & Role",
    description:
      "Kelola akun operator dan matriks hak akses. Perubahan langsung mencabut sesi terkait.",
  },
  {
    area: "settings",
    href: "/settings",
    title: "Pengaturan",
    description:
      "Konfigurasi koneksi database (Turso Cloud atau server sendiri) dan status sinkronisasi.",
  },
];

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const hydrated = useHydrated();
  const online = useOnlineStatus();
  const [sync, setSync] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void getSyncStatus()
      .then(setSync)
      .catch(() => undefined);
  }, []);

  // Hindari mismatch hidrasi: status online dan sesi hanya diketahui di klien.
  if (!hydrated || isLoading) {
    return (
      <MobileAppShell>
        <p className="text-sm text-slate-400">Memuat...</p>
      </MobileAppShell>
    );
  }

  const visible = MODULES.filter((module) => canAccessArea(user, module.area));

  return (
    <MobileAppShell>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white">
            Selamat datang{user ? `, ${user.nama_operator}` : ""}
          </h1>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Template aplikasi 2-tier: Web, Desktop, dan Android berbagi satu
            database LibSQL dan satu basis kode.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider ${
            online
              ? "bg-emerald-400/15 text-emerald-300"
              : "bg-amber-400/15 text-amber-300"
          }`}
        >
          {online ? "Online" : "Offline"}
        </span>
      </header>

      {sync ? (
        <section className="grid gap-3 rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:grid-cols-4">
          {[
            { label: "Antrean", value: sync.pending },
            { label: "Terkirim", value: sync.synced },
            { label: "Gagal", value: sync.failed },
            { label: "Konflik", value: sync.conflict },
          ].map((entry) => (
            <div key={entry.label}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {entry.label}
              </p>
              <p className="font-mono text-lg text-white">
                {String(entry.value)}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        {visible.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="group rounded-3xl border border-white/10 bg-slate-900/60 p-5 transition hover:border-sky-400/40"
          >
            <h2 className="text-base font-black text-white group-hover:text-sky-200">
              {module.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {module.description}
            </p>
          </Link>
        ))}
      </section>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs leading-5 text-slate-400">
          Akun Anda belum memiliki hak akses ke modul mana pun. Hubungi
          Superadmin untuk penyesuaian role.
        </p>
      ) : null}
    </MobileAppShell>
  );
}
