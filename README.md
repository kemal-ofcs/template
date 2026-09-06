# App Template — Kerangka Aplikasi 2-Tier (Web + Desktop + Android)

Template siap pakai untuk membangun aplikasi offline-first yang berjalan di
**Web**, **Desktop** (Windows/macOS/Linux), dan **Android** dari satu basis kode,
dengan satu database LibSQL bersama.

Yang sudah jadi dan tidak perlu Anda bangun ulang:

- **Provisioning database sekali-pakai** — layar yang memeriksa database dulu,
  lalu membuat Superadmin pertama dalam satu transaksi atomik. Tanpa akun bawaan,
  tanpa password default.
- **Dua provider database** — Turso Cloud, atau server libSQL milik Anda sendiri
  (`sqld`) di komputer kantor, NAS, atau VPS.
- **Vault kredensial terenkripsi** — AES-256-GCM dengan kunci turunan Argon2id,
  terikat ke perangkat. Auth Token tidak pernah tersimpan sebagai teks biasa dan
  tidak pernah dikirim balik ke frontend.
- **Login online dan offline** — snapshot kredensial berumur terbatas membuat
  aplikasi tetap bisa dipakai saat jaringan mati.
- **RBAC dinamis** — role, matriks permission, dan pencabutan sesi otomatis
  begitu hak akses berubah, di Web maupun di perangkat.
- **Pemulihan password mandiri ("Lupa Password"), tiga jalur** — pencarian
  akun, konfirmasi identitas, verifikasi wajah tanpa dependensi dan tanpa berkas
  model, lalu token sekali-pakai berumur 30 menit. Tokennya bisa sampai lewat
  **email**, lewat **persetujuan seorang peninjau di dalam aplikasi** (untuk
  pemasangan tanpa penyedia email), atau dilewati sama sekali lewat **kode
  pemulihan cetak** yang diterbitkan saat provisioning. Setiap pengajuan
  menyimpan foto pemohon sebagai bukti audit.
- **Ekspor & pemulihan database** — satu berkas cadangan lewat `VACUUM INTO`
  (aman terhadap WAL), opsional terenkripsi dengan frasa sandi. Pemulihan
  memvalidasi berkasnya lebih dulu dan menyimpan database lama berdampingan,
  sehingga salah pilih berkas masih bisa dibatalkan. Di Android berkasnya
  diserahkan lewat dialog **Simpan ke…** milik sistem (Storage Access
  Framework), bukan ditulis ke folder Unduhan — sejak Android 10 penulisan itu
  ditolak dan berkasnya berakhir di folder privat yang tidak pernah ditemukan
  penggunanya.
- **Identitas perusahaan** — nama, cabang, logo, tanda tangan, alamat, kontak,
  dan penanda tangan dokumen, tersinkronisasi ke seluruh perangkat. Sekaligus
  contoh pola **baris tunggal** dan **aset biner** di dalam tabel yang ikut
  sinkronisasi.
- **Verifikasi dua langkah (2FA TOTP)** — RFC 6238, kompatibel dengan Google
  Authenticator/Authy, lengkap dengan kode cadangan sekali-pakai dan opsi
  `require_totp` per role. Implementasi TypeScript dan Rust menguji vektor RFC
  yang sama supaya kode yang diterima Web pasti diterima perangkat.
- **Pengiriman email lewat HTTP API** — Resend atau Brevo, dikonfigurasi dari
  dalam aplikasi (bukan variabel lingkungan), dengan tombol kirim email uji dan
  diagnosis kegagalan yang menyebut penyebab sebenarnya.
- **Mesin sinkronisasi dua arah** — outbox dengan backoff, snapshot inkremental
  berbasis penghitung perubahan per tabel, pelewatan baris yang tidak berubah,
  dan proteksi terhadap penghapusan data lokal oleh cloud yang masih kosong.

---

## 1. Cara memakai

```bash
# 1. Salin folder template ini menjadi proyek baru
cp -r Template ~/proyek/smart-pos
cd ~/proyek/smart-pos

# 2. Ganti identitas proyek (nama crate, bundle id, judul aplikasi)
bun scripts/rename-project.ts smart-pos "Smart POS" id.tokoanda.smartpos

# 3. Pasang dependensi kedua workspace
bun run setup

# 4. Jalankan
cd web-desktop
bun run tauri dev     # aplikasi Desktop
bun dev               # aplikasi Web di http://localhost:3000
```

Saat pertama dijalankan, aplikasi menampilkan layar provisioning. Pilih jenis
database, isi alamatnya, tekan **Cek database**, lalu buat Superadmin pertama.

---

## 2. Struktur

```
web-desktop/            Sumber kebenaran untuk seluruh kode bersama
  src/                  Next.js: halaman, komponen, gateway, RBAC
  src-tauri/src/desktop Rust: config, vault, storage, klien database, sync
mobile/                 Build Android/iOS
  src/lib, src/types    SALINAN dari web-desktop (dihasilkan skrip sinkronisasi)
  src/app, src/components  Layar khusus mobile
  src-tauri/src/mobile  SALINAN modul Rust + config/secrets khusus mobile
scripts/rename-project.ts
```

**`web-desktop` adalah satu-satunya sumber kebenaran** untuk kode bersama.
Berkas di `mobile/src/lib`, `mobile/src/types`, dan sebagian
`mobile/src-tauri/src/mobile` dihasilkan oleh skrip sinkronisasi dan akan
**ditimpa tanpa peringatan**. Edit aslinya di `web-desktop`, lalu:

```bash
bun run sync:mobile
```

---

## 3. Dua provider database

| | Turso Cloud | Server Database Sendiri |
| :-- | :-- | :-- |
| Alamat | `libsql://nama-db.turso.io` | `http://192.168.1.10:8080` atau `https://db.kantor-anda.com` |
| Transport | Selalu HTTPS | HTTP polos boleh untuk alamat jaringan privat |
| Auth Token | Selalu wajib | Opsional bila server tanpa autentikasi |

Aturan transport ditegakkan di `normalize_database_url` (`turso.rs`) dan
dicerminkan di `src/lib/validations/database-endpoint.ts` agar formulir bisa
menjelaskan lebih awal:

- Alamat jaringan privat (loopback, `10.x`, `192.168.x`, `172.16–31.x`,
  link-local, `*.local`) boleh HTTP polos pada build rilis — paket tidak pernah
  meninggalkan LAN.
- Alamat publik ber-HTTP **ditolak**, kecuali pengguna mencentang izin eksplisit.
  Tanpa TLS, Auth Token dan seluruh data melintas internet sebagai teks biasa.
- Klien Android memverifikasi TLS dengan `webpki-roots`, jadi server sendiri
  ber-HTTPS wajib memakai sertifikat dari CA publik (misalnya lewat Caddy).
  Sertifikat self-signed belum didukung.

Menjalankan server libSQL sendiri:

```bash
# Docker, di komputer kantor / NAS / VPS
docker run -p 8080:8080 -v $PWD/data:/var/lib/sqld ghcr.io/tursodatabase/libsql-server:latest
```

Untuk build **Web**, database ditentukan lewat environment server:

```bash
TURSO_DATABASE_URL=libsql://nama-db.turso.io
TURSO_AUTH_TOKEN=...
SPPG_DATABASE_PROVIDER=turso          # atau self_hosted
SPPG_ALLOW_INSECURE_DATABASE=0        # 1 hanya bila Anda menerima risikonya
```

---

## 4. Mengganti domain contoh

Template membawa dua tabel peraga: `master_item` (master data) dan
`log_aktivitas` (log transaksional append-only). Keduanya memperagakan pola
lengkap dari UI sampai cloud.

`company_profile` **bukan** salah satunya — itu bagian platform. Jangan hapus
bersama kedua tabel di atas: hampir setiap aplikasi bisnis memerlukan identitas
pemakainya, dan bentuknya (baris tunggal ber-kunci konstanta, plus aset biner
sebagai data URI) adalah pola yang tidak diperagakan kedua domain contoh.

Mengganti keduanya berarti menyentuh **empat lapisan yang WAJIB identik**:

| Lapisan | Berkas |
| :-- | :-- |
| SQLite lokal | `web-desktop/src-tauri/src/desktop/storage.rs` |
| DDL cloud + handler push | `web-desktop/src-tauri/src/desktop/turso.rs` |
| Registri snapshot + route kanonik | `web-desktop/src-tauri/src/desktop/sync.rs` |
| Skema jalur Web | `web-desktop/src/lib/db-schema.ts` |

Satu nama kolom yang berbeda ejaan membuat tabel itu gagal disinkronkan secara
permanen: baris tersimpan mulus di perangkat, masuk antrean, lalu ditolak cloud
dan dicoba ulang selamanya.

Setelah itu, sesuaikan lapisan aplikasinya:

1. `src/lib/rbac/catalog.ts` — katalog permission (harus sama dengan seed di
   `turso.rs` dan `db-schema.ts`).
2. `src/lib/auth/access.ts` — pemetaan area navigasi ke permission.
3. `src/lib/gateways/*.ts` — satu modul per domain.
4. `src-tauri/src/desktop/commands.rs` — perintah IPC, lalu daftarkan di
   `src-tauri/src/lib.rs` dan `mobile/src-tauri/src/lib.rs`.

### Tiga jalur pemulihan password

Jalur yang dipakai **ditentukan otomatis, bukan dipaksakan**: nilai eksplisit di
`setting_gex_system.password_reset_route` menang lebih dulu, baru status
`app_mail_config.is_active` dipakai sebagai bawaan. Pemasangan yang sudah
menyalakan email tetap memakai email; sisanya memakai persetujuan di aplikasi.
Urutan itu tidak boleh dibalik — satu database bisa dilayani Web dan Desktop
bergantian, dan bila keduanya menyimpulkan jalur yang berbeda sebuah permintaan
akan menunggu persetujuan yang tidak pernah diminta.

| Jalur | Kapan dipakai | Yang menjadi faktor kedua |
| :-- | :-- | :-- |
| `email` | `app_mail_config.is_active = 1` | Penguasaan kotak masuk |
| `in_app` | Bawaan bila email mati | Peninjau manusia yang melihat foto wajah pemohon |
| Kode cetak | Kapan saja, tanpa menunggu siapa pun | Kertas yang dipegang pemilik akun |

**Jalur `in_app`** menahan permintaan di status `Menunggu Persetujuan`. Tidak
ada token yang dibuat saat verifikasi wajah — ia baru lahir di layar peninjau
saat disetujui, karena token yang dibuat lebih dulu harus disimpan dalam bentuk
aslinya sampai disetujui, sedangkan database hanya boleh memegang hash-nya.
Peninjau butuh izin `password_reset.approve`, yang masuk
`SENSITIVE_MUTATION_PERMISSIONS` sehingga tidak ikut paket bawaan Admin.

**Kode pemulihan cetak** diterbitkan delapan sekaligus saat Superadmin pertama
dibuat, dan bisa diterbitkan ulang dari **Pengaturan → Kode Pemulihan**.
Disimpan hanya sebagai hash SHA-256 dan dihapus begitu dipakai. Ini satu-satunya
jalan pulih bagi Superadmin pada pemasangan tanpa jaringan: akun itu tidak punya
siapa pun di atasnya yang bisa menyetujui permintaannya, dan tidak ada email
yang bisa dikirim. Menerbitkan ulang MEMBATALKAN seluruh kode lama — daftar yang
sebagiannya sudah tercetak di kertas lama tidak boleh tetap berlaku bersamaan
dengan yang baru.

### Menyalakan email pemulihan password

Jalur email mengirim link lewat **HTTP API penyedia email**, bukan SMTP, dan
kuncinya disimpan di tabel `app_mail_config` — bukan variabel lingkungan —
supaya pemilik aplikasi bisa menggantinya tanpa build ulang.

1. Buat akun di **Resend** atau **Brevo**, lalu salin API key-nya.
2. Buka **Pengaturan → Email Sistem** di aplikasi (butuh izin
   `settings.manage`), isi penyedia, API key, email pengirim, nama pengirim,
   dan URL halaman reset.
3. Tekan **Kirim Email Uji**. Bila gagal, pesannya menyebut penyebab
   sebenarnya — domain belum diverifikasi, IP belum terdaftar, kunci ditolak,
   atau kuota habis — bukan sekadar "gagal mengirim".

Catatan penyedia: **Resend** menolak pengiriman ke alamat selain milik Anda
sendiri sampai domainnya diverifikasi (HTTP 403). **Brevo** bisa dipakai dengan
satu alamat pengirim terverifikasi tanpa domain sendiri, tetapi menolak
permintaan dari IP yang belum terdaftar di daftar IP resmi akun (HTTP 401).

Tanpa konfigurasi ini, alur "Lupa Password" **tidak** buntu: ia otomatis
memakai jalur `in_app`. Versi pertama fitur ini memang buntu — pengiriman
selalu gagal, dan kegagalan itu MEMBATALKAN permintaannya, sehingga "Lupa
Password" mati total di setiap pemasangan yang tidak memakai email.

---

## 5. Aturan yang menjaga template ini tetap benar

Aturan berikut bukan gaya penulisan, melainkan hasil dari kegagalan nyata.

1. **UI tidak pernah memanggil `invoke()` atau `fetch("/api/...")` langsung.**
   Semua akses data lewat `src/lib/gateways/*`, yang bercabang pada
   `isDesktopRuntime()`. Ini yang membuat satu halaman berjalan di tiga target.
2. **Route handler tidak boleh mengekspor `GET`.** Build Desktop dan Mobile
   memakai `output: "export"` yang tidak dapat melayani GET dinamis. Pakai
   `POST /api/<domain>/query` untuk pembacaan.
3. **Setiap mutasi lokal menulis baris DAN event outbox dalam satu transaksi.**
   Terpisah berarti perubahan bisa hidup di perangkat tanpa pernah sampai ke
   cloud, tanpa ada yang menyadarinya.
4. **Hanya pasangan (domain, operation) kanonik yang boleh diproduksi outbox.**
   Daftarnya ada di `CANONICAL_SYNC_ROUTES` (`sync.rs`) dan
   `canonical_sync_route` (`turso.rs`) — keduanya wajib sama.
5. **Event yang tidak menghasilkan mutasi wajib menjadi konflik, bukan
   `applied`.** Menandainya sukses membuat sinkronisasi tampak berhasil padahal
   data server tidak berubah.
6. **Kunci payload yang absen dari snapshot berarti "tidak berubah", bukan
   "kosong".** `apply_table` berhenti lebih awal untuk kunci yang absen,
   termasuk melewatkan blok `delete_missing`.
7. **Snapshot hanya boleh menghapus baris yang terbukti berasal dari server**
   (punya jejak `desktop_entity_revision`) dan tidak sedang mengantre di outbox.
8. **Kunci koneksi perangkat tidak ikut sinkronisasi.** `turso_database_url`,
   `turso_auth_token`, `turso_database_provider`, dan
   `turso_allow_insecure_transport` terdaftar di `DEVICE_LOCAL_SETTING_KEYS`.
   Tanpa itu, satu perangkat bisa mendorong alamat database-nya ke perangkat
   lain.
9. **Kegagalan push tidak boleh membatalkan pull.** Satu event bermasalah pernah
   membuat perangkat berhenti menerima data cloud sama sekali.
10. **Guard permission wajib ada di backend Rust, bukan hanya di UI.** Perintah
    IPC dapat dipanggil tanpa melewati UI.
11. **Android: `isMinifyEnabled = false`.** R8 memotong reflection JNI Tauri dan
    aplikasi crash saat dibuka.
12. **Android: pakai `webpki-roots`, bukan `rustls-platform-verifier`**, dan
    pasang `rustls::crypto::ring::default_provider().install_default()` di awal
    `run()` sebelum builder Tauri dibuat.
13. **Nilai uang disimpan sebagai `INTEGER`**, tidak pernah sebagai float.
14. **Jalankan `bun run check` sekali di akhir**, setelah perubahan selesai utuh
    — bukan berulang kali di tengah penulisan.
15. **Aset visual di-bundle, tidak diunduh.** Berkas `.glb`, `.splinecode`,
    `.riv`, `.wasm`, decoder Draco, dan data benchmark `detect-gpu` wajib berada
    di `public/3d/`. Rive, `detect-gpu`, Draco, dan Spline semuanya menembak CDN
    bila dibiarkan default — aplikasi offline-first akan tampak rusak persis di
    lokasi yang paling membutuhkannya.
16. **Komponen 3D selalu client-only.** `"use client"` plus
    `dynamic(..., { ssr: false })`. Mengimpor `three`/R3F/Spline/Rive dari server
    component menggagalkan build `output: "export"`, dan mengimpornya dari
    `src/lib/**` menyeret dependensi berat itu ikut tersalin ke mobile.
17. **Kemampuan GPU dideteksi, tidak ditebak.** `detect-gpu` sekali saat start
    (default aman tier rendah bila deteksi gagal), guard WebGL nyata, fallback
    2D, satu konteks WebGL aktif, dan pelepasan resource saat unmount. Perangkat
    kelas bawah tidak boleh mendapat layar putih.
18. **Seluruh stempel waktu alur pemulihan password dan 2FA dihitung
    DATABASE**, lewat `datetime('now')` / `strftime('%s','now')` — tidak pernah
    `new Date()` di TypeScript maupun jam perangkat di Rust. Satu baris bisa
    ditulis Rust dan dibaca TypeScript, dan `new Date("2026-08-29 10:15:00")`
    diparsing sebagai waktu lokal, sehingga perbandingan kedaluwarsa akan
    meleset sejauh offset zona waktu perangkat. Untuk 2FA alasannya lebih tajam
    lagi: kode yang sah harus diterima sama di Web dan Desktop, sedangkan jam
    perangkat murah memang sering meleset.
19. **Indeks yang memakai kolom hasil migrasi dibuat SETELAH kolomnya
    dipastikan ada.** `idx_master_operator_email` memakai `LOWER(email)`; pada
    database yang sudah berjalan, kolom `email` belum ada saat pipeline DDL
    berjalan, dan satu statement yang gagal membatalkan seluruh pipeline —
    termasuk `ensure_column` yang justru akan menambahkan kolom itu. Database
    lama akan terkunci selamanya. Karena itu indeksnya berada setelah loop
    `ensure_column` di `turso.rs` dan di `INDEX_MIGRATIONS` (bukan DDL awal)
    di `db-migrations.ts`.
20. **Setiap penambahan kolom atau tabel menaikkan sentinel schema Rust DAN
    angka yang diperiksa `ensure_schema_current`.** Sentinel terakhir menentukan
    kapan `ensure_schema` dilewati; melewatkan salah satunya membuat database
    yang sudah pernah di-provisioning tidak pernah menerima kolom baru.
21. **Kegagalan 2FA bukan "cloud tidak terjangkau".** `TOTP_REQUIRED`,
    `TOTP_INVALID`, dan `TOTP_ENROLLMENT_REQUIRED` dikembalikan langsung dari
    `desktop_login`; kalau ketiganya jatuh ke lengan error umum, login
    diteruskan ke fallback offline yang hanya memeriksa username + password dan
    verifikasi dua langkah terlewati seluruhnya.
22. **Menghapus operator ditolak selama riwayat reset passwordnya masih ada.**
    `password_reset_request` ber-CASCADE ke `master_operator`, jadi menghapus
    akun ikut memusnahkan foto wajah pemohon — bukti audit yang justru paling
    perlu bertahan. Aturannya ada di jalur Web (`operator-admin.ts`) dan Rust
    (`delete_operator`), dan keduanya wajib sama.
23. **`password_reset_request` dan `app_mail_config` cloud-only.** Keduanya
    TIDAK pernah masuk `SNAPSHOT_TABLES`: yang pertama berisi foto bukti dan
    hash token, yang kedua berisi kunci API penyedia email. Daftar riwayat juga
    tidak pernah membawa `photo_base64` — satu foto sekitar 40 KB, dan ratusan
    baris akan membuat balasannya puluhan megabyte.
24. **Canvas 3D tidak pernah dimount saat kamera aktif.** GPU decoding video plus
    render 3D memicu panas, frame drop, dan pada sebagian perangkat Android
    mematikan stream kamera — kegagalan yang sama dengan aturan siklus hidup
    kamera. Preferensi kualitas visual disimpan device-local di `localStorage`,
    tidak pernah di tabel yang ikut sinkronisasi.

Daftar stack visual yang disetujui (React Three Fiber, Spline, Motion, Rive,
Aceternity/Magic UI, `detect-gpu`, Draco/GLTF-Transform, Zustand) beserta
prasyarat CSP-nya ada di `CLAUDE.md`.

---

## 6. Perintah

```bash
bun run setup             # pasang dependensi kedua workspace
bun run sync:mobile       # salin kode bersama dari web-desktop ke mobile
bun run check:quick       # audit + lint + typecheck + test, kedua workspace
bun run check             # + cargo test
bun run rename            # ganti identitas proyek

bun run audit:schema      # jalankan DDL keempat lapisan lalu bandingkan hasilnya
bun run audit:contract    # route kanonik, tabel snapshot, permission, command
bun run verify:identity   # sisa identitas produk lain di dalam sumber
bun run verify:template   # SEMUA gerbang sekaligus, laporan satu halaman
```

`verify:template` ada karena `check:quick` berhenti pada kegagalan pertama —
tepat saat sedang menulis kode, tetapi menyesatkan saat sedang MEMERIKSA
template: berhenti di gerbang pertama menyembunyikan berapa banyak yang
sebenarnya rusak. Ia menjalankan semuanya lalu melaporkan seluruh kegagalannya
sekaligus. Tambahkan `--rust` untuk ikut menjalankan `cargo test` (beberapa
menit pada kompilasi dingin, karena itu dipisahkan).

`audit:schema` tidak membandingkan teks. Ia MENJALANKAN DDL dari `turso.rs`,
`storage.rs`, dan `db-schema.ts` ke dalam tiga SQLite sementara, lalu
membandingkan tabel dan kolom yang benar-benar terbentuk. Versi berbasis teks
sebelumnya pernah melaporkan "konsisten" sambil memeriksa NOL tabel.

Per workspace (`web-desktop/` atau `mobile/`):

```bash
bun dev                # Next.js dev server
bun run lint           # biome check
bun run format         # biome format --write
bunx tsc --noEmit      # typecheck
bun run test           # test Bun
bun run test:rust      # cargo test
```

---

## 7. Status verifikasi template

Jangan percayai daftar ini — jalankan sendiri:

```bash
bun run verify:template --rust
```

Kondisi saat template ini terakhir diperiksa, kedelapan gerbangnya hijau:

| Gerbang | Hasil |
| :-- | :-- |
| Identitas produk | Nol sisa identitas produk lain |
| Skrip perkakas | `scripts/` lolos parse dan lint |
| Audit skema empat lapis | Seluruh lapisan konsisten |
| Audit kontrak sinkronisasi | Route, tabel snapshot, permission, dan command konsisten |
| web-desktop: lint + typecheck + test | Lulus |
| mobile: lint + typecheck + test | Lulus |
| web-desktop: `cargo test` | 61 lulus |
| mobile: `cargo test` | 61 lulus |

Gerbang identitas melaporkan **peringatan**, bukan kegagalan, selama template
belum di-rename. Itu memang keadaan yang benar untuk template bersih; yang
dihitung sebagai kegagalan adalah sisa identitas produk LAIN di dalam sumber.
