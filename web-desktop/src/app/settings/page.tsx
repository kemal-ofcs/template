"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CompanyProfileCard } from "@/components/CompanyProfileCard";
import { DatabaseBackupCard } from "@/components/DatabaseBackupCard";
import { MailSettingsCard } from "@/components/MailSettingsCard";
import { PasswordRecoveryCard } from "@/components/PasswordRecoveryCard";
import { TwoFactorCard } from "@/components/TwoFactorCard";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getSyncStatus,
  type SyncStatus,
  syncNow,
} from "@/lib/gateways/sync-status";
import {
  clearTursoConfig,
  type DatabaseConfigView,
  getDatabaseConfig,
  saveTursoConfig,
  type TursoConnectionStatus,
  testTursoConnection,
} from "@/lib/gateways/turso-config";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import {
  DATABASE_PROVIDER_OPTIONS,
  type DatabaseProvider,
  describeProvider,
  providerNeedsEndpoint,
  reviewDatabaseEndpoint,
} from "@/lib/validations/database-endpoint";

type Feedback = { type: "success" | "error"; message: string } | null;

export default function SettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "settings.manage");
  const isDesktop = isDesktopRuntime();

  const [provider, setProvider] = useState<DatabaseProvider>("turso");
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<TursoConnectionStatus | null>(
    null,
  );
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const providerInfo = describeProvider(provider);
  // Cermin sisi klien dari `normalize_database_url` di Rust. Backend tetap
  // penjaga sebenarnya; ini hanya supaya formulir menjelaskan lebih awal.
  const endpoint = reviewDatabaseEndpoint(databaseUrl, provider, allowInsecure);

  const loadConfig = useCallback(async () => {
    const config: DatabaseConfigView = await getDatabaseConfig();
    if (!config.configured) return;
    setDatabaseUrl(config.databaseUrl);
    setProvider(config.provider);
    setAllowInsecure(config.allowInsecureTransport);
    setTokenSaved(config.authTokenSaved);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    void loadConfig().catch(() => undefined);
    void getSyncStatus()
      .then(setSync)
      .catch(() => undefined);
  }, [isDesktop, loadConfig]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const needsEndpoint = providerNeedsEndpoint(provider);
    if (needsEndpoint && !endpoint.valid) {
      setFeedback({
        type: "error",
        message: endpoint.issue?.message ?? "URL database tidak dapat dipakai.",
      });
      return;
    }
    if (
      needsEndpoint &&
      endpoint.tokenRequired &&
      !authToken.trim() &&
      !tokenSaved
    ) {
      setFeedback({
        type: "error",
        message: "Auth Token wajib diisi untuk alamat database ini.",
      });
      return;
    }
    setBusy(true);
    try {
      await saveTursoConfig(
        needsEndpoint ? databaseUrl.trim() : "",
        needsEndpoint ? authToken.trim() : "",
        {
          provider,
          allowInsecureTransport: allowInsecure,
        },
      );
      if (authToken.trim()) setTokenSaved(true);
      setAuthToken("");
      setFeedback({
        type: "success",
        message: `Konfigurasi ${providerInfo.label} tersimpan di vault terenkripsi.`,
      });
      setConnection(
        await testTursoConnection(databaseUrl.trim(), "", {
          provider,
          allowInsecureTransport: allowInsecure,
        }),
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Konfigurasi database gagal disimpan.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const status = await testTursoConnection(
        databaseUrl.trim() || undefined,
        authToken.trim() || undefined,
        { provider, allowInsecureTransport: allowInsecure },
      );
      setConnection(status);
      setFeedback({
        type: status.connected ? "success" : "error",
        message: status.connected
          ? `Koneksi berhasil. Latensi ${status.latency_ms ?? 0} ms.`
          : `Koneksi gagal: ${status.error_message ?? "tidak dapat terhubung"}`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Uji koneksi gagal dijalankan.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Hapus konfigurasi database dari perangkat ini?")) return;
    setBusy(true);
    try {
      await clearTursoConfig();
      setDatabaseUrl("");
      setAuthToken("");
      setProvider("turso");
      setAllowInsecure(false);
      setTokenSaved(false);
      setConnection(null);
      setFeedback({
        type: "success",
        message: "Konfigurasi database berhasil direset.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Reset konfigurasi gagal.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      setSync(await syncNow());
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Sinkronisasi gagal dijalankan.",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <AppShell>
      <header>
        <h1 className="text-xl font-black text-white">Pengaturan</h1>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Konfigurasi koneksi database dan status sinkronisasi perangkat ini.
        </p>
      </header>

      {feedback ? (
        <div
          className={`rounded-2xl border p-4 text-xs leading-5 ${
            feedback.type === "success"
              ? "border-emerald-400/30 bg-emerald-950/40 text-emerald-100"
              : "border-rose-500/30 bg-rose-950/50 text-rose-100"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      {!isDesktop ? (
        <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
          <h2 className="text-base font-black text-white">
            Konfigurasi Database
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Pada build Web, database ditentukan lewat environment server (
            <code className="text-slate-300">APP_DATABASE_PROVIDER</code>,{" "}
            <code className="text-slate-300">TURSO_DATABASE_URL</code>,{" "}
            <code className="text-slate-300">TURSO_AUTH_TOKEN</code>), bukan
            lewat layar ini. Vault kredensial hanya ada di aplikasi Desktop dan
            Mobile.
          </p>
        </section>
      ) : null}

      {isDesktop && canManage ? (
        <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
          <h2 className="text-base font-black text-white">
            Konfigurasi Database (LibSQL)
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Aplikasi terhubung langsung ke database LibSQL lewat HTTP Pipeline —
            baik Turso Cloud maupun server libSQL milik Anda sendiri di kantor,
            rumah, atau VPS. Kredensial disimpan di vault terenkripsi
            AES-256-GCM pada perangkat ini.
          </p>

          <form onSubmit={handleSave} className="mt-5 space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold text-slate-300">
                Jenis Database
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {DATABASE_PROVIDER_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`grid min-w-0 cursor-pointer gap-1 rounded-xl border p-3 text-xs leading-4 transition ${
                      provider === option.value
                        ? "border-sky-400/60 bg-sky-400/10 text-sky-100"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:border-white/25"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-black">
                      <input
                        type="radio"
                        name="database-provider"
                        value={option.value}
                        checked={provider === option.value}
                        onChange={() => {
                          setProvider(option.value);
                          setAllowInsecure(false);
                          setConnection(null);
                        }}
                        className="size-4 shrink-0 accent-sky-400"
                      />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </span>
                    <span className="font-normal opacity-80">
                      {option.description}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {providerNeedsEndpoint(provider) ? (
              <>
                <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                  {provider === "turso"
                    ? "URL Database Turso"
                    : "Alamat Server Database Anda"}
                  <input
                    type="text"
                    inputMode="url"
                    value={databaseUrl}
                    onChange={(event) => {
                      setDatabaseUrl(event.target.value);
                      setConnection(null);
                    }}
                    placeholder={providerInfo.urlPlaceholder}
                    className="min-h-11 rounded-xl border border-white/15 bg-slate-950 px-3 font-mono text-xs text-white outline-none focus:border-sky-400"
                  />
                  {databaseUrl.trim().length > 0 && endpoint.issue ? (
                    <span className="font-normal leading-5 text-amber-300">
                      {endpoint.issue.message}
                    </span>
                  ) : null}
                </label>

                <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                  {endpoint.tokenRequired
                    ? "Auth Token"
                    : "Auth Token (opsional untuk server tanpa autentikasi)"}
                  <div className="relative">
                    <input
                      type={showToken ? "text" : "password"}
                      value={authToken}
                      onChange={(event) => setAuthToken(event.target.value)}
                      placeholder={
                        tokenSaved
                          ? "•••••••••••••••• (tersimpan di vault)"
                          : providerInfo.tokenPlaceholder
                      }
                      autoComplete="off"
                      className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 pr-24 font-mono text-xs text-white outline-none focus:border-sky-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((value) => !value)}
                      className="absolute right-2 top-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:text-white"
                    >
                      {showToken ? "Sembunyikan" : "Tampilkan"}
                    </button>
                  </div>
                  <span className="font-normal leading-5 text-slate-500">
                    Token yang sudah tersimpan tidak pernah ditampilkan kembali.
                    Biarkan kosong untuk mempertahankannya.
                  </span>
                </label>
              </>
            ) : (
              <p className="rounded-2xl border border-sky-400/30 bg-sky-400/5 p-3 text-[11px] font-bold leading-4 text-sky-100">
                Seluruh data disimpan pada berkas SQLite di perangkat ini. Tidak
                ada alamat server maupun Auth Token yang perlu diisi, dan
                aplikasi berjalan penuh tanpa internet.
              </p>
            )}

            {provider === "self_hosted" &&
            (endpoint.issue?.code === "INSECURE_PUBLIC" || allowInsecure) ? (
              <label className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-[11px] font-bold leading-4 text-rose-200">
                <input
                  type="checkbox"
                  checked={allowInsecure}
                  onChange={(event) => {
                    setAllowInsecure(event.target.checked);
                    setConnection(null);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-rose-400"
                />
                <span>
                  Izinkan koneksi tanpa enkripsi ke alamat publik. Auth Token
                  dan seluruh data akan dikirim sebagai teks biasa dan dapat
                  dibaca siapa pun di jalur jaringan. Jalur yang aman adalah
                  memasang HTTPS di server atau memakai alamat LAN/VPN.
                </span>
              </label>
            ) : null}

            {connection ? (
              <div
                className={`rounded-2xl border p-4 text-xs font-semibold ${
                  connection.connected
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-300"
                }`}
              >
                {connection.connected
                  ? `Terhubung ke ${providerInfo.label} (latensi ${connection.latency_ms ?? 0} ms)`
                  : `Gagal terhubung: ${connection.error_message ?? "periksa URL dan token"}`}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy || testing}
                className="min-h-11 rounded-xl bg-sky-400 px-5 text-xs font-black text-slate-950 disabled:opacity-50"
              >
                {busy ? "Menyimpan..." : "Simpan Konfigurasi"}
              </button>
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={busy || testing}
                className="min-h-11 rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 text-xs font-bold text-sky-200 disabled:opacity-50"
              >
                {testing ? "Menguji..." : "Uji Koneksi"}
              </button>
              {databaseUrl ? (
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={busy || testing}
                  className="min-h-11 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-xs font-bold text-rose-300 disabled:opacity-50"
                >
                  Reset Konfigurasi
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      {/* Keamanan akun sendiri: tidak dijaga izin apa pun, karena setiap
          operator berhak mengamankan akunnya — termasuk role paling terbatas. */}
      <TwoFactorCard />
      <PasswordRecoveryCard />
      <DatabaseBackupCard provider={provider} />

      {/* Identitas perusahaan dibaca siapa pun yang punya sesi — nilainya
          muncul di kop dokumen — tetapi hanya pemegang settings.manage yang
          boleh menyuntingnya, dan itulah gerbang di sini. */}
      {hasPermission(user, "settings.manage") ? <CompanyProfileCard /> : null}

      {hasPermission(user, "settings.manage") ? <MailSettingsCard /> : null}

      {isDesktop ? (
        <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-white">Sinkronisasi</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Antrean lokal dikirim ke cloud, lalu perubahan cloud ditarik ke
                perangkat.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSyncNow()}
              disabled={syncing}
              className="min-h-10 rounded-xl border border-white/15 px-4 text-xs font-bold text-slate-300 hover:border-sky-400/40 hover:text-sky-200 disabled:opacity-50"
            >
              {syncing ? "Menyinkronkan..." : "Sinkronkan Sekarang"}
            </button>
          </div>
          {sync ? (
            <dl className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-4">
              {[
                { label: "Menunggu", value: sync.pending },
                { label: "Terkirim", value: sync.synced },
                { label: "Gagal", value: sync.failed },
                { label: "Konflik", value: sync.conflict },
              ].map((entry) => (
                <div key={entry.label}>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {entry.label}
                  </dt>
                  <dd className="font-mono text-lg text-white">
                    {String(entry.value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {sync?.pushError ? (
            <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-950/40 p-3 text-xs leading-5 text-amber-100">
              Push terakhir gagal: {sync.pushError}. Data cloud tetap ditarik
              dan antrean lokal akan dicoba ulang otomatis.
            </p>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
