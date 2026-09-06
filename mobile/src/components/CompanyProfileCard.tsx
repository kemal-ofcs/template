"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type CompanyProfile,
  getCompanyProfile,
  MAX_IMAGE_BASE64_LENGTH,
  saveCompanyProfile,
} from "@/lib/gateways/company-profile";

/**
 * Identitas perusahaan pemakai aplikasi.
 *
 * Bagian PLATFORM, bukan domain contoh — jangan hapus bersama halaman Item dan
 * Aktivitas. Nilai-nilai di sini muncul di kop dokumen, cetakan, dan ekspor
 * yang dihasilkan aplikasi turunan.
 *
 * Logo dan tanda tangan disimpan sebagai data URI di dalam baris yang IKUT
 * sinkronisasi, bukan sebagai path berkas. Path yang sah di satu perangkat
 * tidak berarti apa-apa di perangkat lain, sedangkan aplikasi ini berjalan di
 * Web, Desktop, dan Android dengan sistem berkas yang berbeda-beda.
 */

/** Kolom teks bebas, dirender dari satu daftar supaya tidak ada yang terlewat. */
const TEXT_FIELDS = [
  { key: "branch_name", label: "Cabang / Unit", placeholder: "Kantor Pusat" },
  { key: "address", label: "Alamat", placeholder: "Jl. Contoh No. 1" },
  { key: "phone", label: "Telepon", placeholder: "021-0000000" },
  { key: "email", label: "Email", placeholder: "info@perusahaan.id" },
  { key: "website", label: "Situs web", placeholder: "https://perusahaan.id" },
  { key: "leader_name", label: "Nama penanda tangan", placeholder: "Nama" },
  { key: "leader_title", label: "Jabatan", placeholder: "Direktur" },
] as const;

type TextFieldKey = (typeof TEXT_FIELDS)[number]["key"];

type ImageFieldKey = "logo_url" | "signature_url";

const IMAGE_FIELDS: { key: ImageFieldKey; label: string; hint: string }[] = [
  { key: "logo_url", label: "Logo", hint: "Tampil di kop dokumen." },
  {
    key: "signature_url",
    label: "Tanda tangan",
    hint: "Tampil di kaki dokumen.",
  },
];

const EMPTY: CompanyProfile = {
  id: "default_company",
  company_name: "",
  branch_name: null,
  logo_url: null,
  signature_url: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  leader_name: null,
  leader_title: null,
  timezone: "Asia/Jakarta",
  updated_at: "",
};

export function CompanyProfileCard() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getCompanyProfile()
      .then((value) => {
        if (!cancelled) setProfile(value);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFeedback({
          tone: "error",
          text:
            error instanceof Error
              ? error.message
              : "Profil perusahaan tidak dapat dimuat.",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = (key: TextFieldKey | "company_name" | "timezone") => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setProfile((current) => ({ ...current, [key]: value }));
    };
  };

  /**
   * Baca berkas gambar menjadi data URI.
   *
   * Batas ukurannya ditegakkan SETELAH pengodean base64, karena itulah yang
   * benar-benar disimpan dan disinkronkan — bukan ukuran berkas aslinya.
   */
  const pickImage = (key: ImageFieldKey) => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result ?? "");
        if (value.length > MAX_IMAGE_BASE64_LENGTH) {
          setFeedback({
            tone: "error",
            text: "Gambar terlalu besar. Perkecil dulu — berkas ini ikut disinkronkan ke setiap perangkat.",
          });
          return;
        }
        setProfile((current) => ({ ...current, [key]: value }));
        setFeedback(null);
      };
      reader.onerror = () => {
        setFeedback({ tone: "error", text: "Gambar tidak dapat dibaca." });
      };
      reader.readAsDataURL(file);
    };
  };

  const clearImage = (key: ImageFieldKey) => {
    setProfile((current) => ({ ...current, [key]: null }));
    if (key === "logo_url" && logoInput.current) logoInput.current.value = "";
    if (key === "signature_url" && signatureInput.current) {
      signatureInput.current.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const { id: _id, updated_at: _updatedAt, ...draft } = profile;
      setProfile(await saveCompanyProfile(draft));
      setFeedback({ tone: "success", text: "Profil perusahaan tersimpan." });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Profil perusahaan tidak dapat disimpan.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
          <Icon name="tools" className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-black text-white">
            Identitas Perusahaan
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Dipakai sebagai kop pada dokumen, cetakan, dan ekspor. Baris ini
            tunggal dan ikut disinkronkan, sehingga setiap perangkat memakai
            identitas yang sama.
          </p>
        </div>
      </div>

      {feedback ? (
        <p
          className={`mt-4 rounded-xl border p-3 text-sm ${
            feedback.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">Memuat…</p>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-xs font-bold text-slate-300">
            Nama perusahaan
            <input
              required
              minLength={2}
              maxLength={120}
              value={profile.company_name}
              onChange={setField("company_name")}
              placeholder="Nama Perusahaan"
              className="app-input"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((field) => (
              <label
                key={field.key}
                className="grid gap-1.5 text-xs font-bold text-slate-300"
              >
                {field.label}
                <input
                  maxLength={200}
                  value={profile[field.key] ?? ""}
                  onChange={setField(field.key)}
                  placeholder={field.placeholder}
                  className="app-input"
                />
              </label>
            ))}
            <label className="grid gap-1.5 text-xs font-bold text-slate-300">
              Zona waktu
              <input
                maxLength={64}
                value={profile.timezone}
                onChange={setField("timezone")}
                placeholder="Asia/Jakarta"
                className="app-input"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {IMAGE_FIELDS.map((field) => (
              <div
                key={field.key}
                className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/40 p-3"
              >
                <p className="text-xs font-bold text-slate-300">
                  {field.label}
                </p>
                <p className="text-[11px] leading-4 text-slate-500">
                  {field.hint}
                </p>
                {profile[field.key] ? (
                  <div className="flex items-center gap-3">
                    {/* Data URI, bukan URL jarak jauh — `next/image` tidak
                        memberi keuntungan apa pun di sini dan build
                        `output: "export"` tidak mengoptimalkannya. */}
                    {/** biome-ignore lint/performance/noImgElement: data URI lokal */}
                    <img
                      src={profile[field.key] as string}
                      alt={field.label}
                      className="h-12 w-auto rounded-lg bg-white/90 object-contain p-1"
                    />
                    <button
                      type="button"
                      onClick={() => clearImage(field.key)}
                      className="min-h-9 rounded-lg bg-white/10 px-3 text-[11px] font-black text-slate-200 transition hover:bg-white/20"
                    >
                      Hapus
                    </button>
                  </div>
                ) : null}
                <input
                  ref={field.key === "logo_url" ? logoInput : signatureInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={pickImage(field.key)}
                  className="block w-full text-[11px] text-slate-300 file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:text-[11px] file:font-bold file:text-slate-200"
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-sky-500 text-xs font-black text-slate-950 transition hover:bg-sky-400 disabled:opacity-50 sm:w-auto sm:px-6"
          >
            {busy ? "Menyimpan…" : "Simpan identitas"}
          </button>
        </form>
      )}
    </section>
  );
}
