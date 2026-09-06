import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Menyalin modul Rust bersama dari workspace `web-desktop` ke `mobile`.
 *
 * `web-desktop` adalah SATU-SATUNYA sumber kebenaran untuk berkas di daftar ini.
 * Berkas hasil salinan di `mobile/src-tauri/src/mobile/` akan ditimpa tanpa
 * peringatan pada eksekusi berikutnya — edit yang aslinya, lalu jalankan skrip
 * ini dari direktori `mobile/`.
 *
 * Yang TIDAK disalin dan dipelihara terpisah:
 * - `config.rs`  — Mobile memasang TLS `webpki-roots` sendiri.
 * - `secrets.rs` — sama isinya, tetapi dibiarkan terpisah agar penyesuaian
 *                  penyimpanan kredensial per platform tetap mungkin.
 * - `mod.rs`, `lib.rs`, `main.rs` — daftar perintah tiap platform berbeda.
 */
const desktopDir = join(__dirname, "../../web-desktop/src-tauri/src/desktop");
const mobileDir = join(__dirname, "../src-tauri/src/mobile");

const filesToSync = [
  "models.rs",
  "storage.rs",
  "sync.rs",
  "turso.rs",
  "commands.rs",
];

for (const file of filesToSync) {
  const srcPath = join(desktopDir, file);
  let content = readFileSync(srcPath, "utf-8");

  // Sesuaikan nama tipe Desktop menjadi Mobile. Nama PERINTAH sengaja tidak
  // diubah: gateway frontend memanggil nama yang sama pada kedua target.
  content = content
    .replaceAll("DesktopState", "MobileState")
    .replaceAll("DesktopSyncStatus", "MobileSyncStatus")
    .replaceAll("DesktopLoginResult", "MobileLoginResult")
    .replaceAll("DesktopRuntimeStatus", "MobileRuntimeStatus")
    .replaceAll("DesktopSession", "MobileSession")
    .replaceAll("desktop-security.db", "mobile-security.db")
    .replaceAll("crate::desktop::", "crate::mobile::")
    .replaceAll("use crate::desktop", "use crate::mobile")
    .replaceAll("super::super::desktop", "super::super::mobile");

  const destPath = join(mobileDir, file);
  writeFileSync(destPath, content, "utf-8");
  console.log(`Synced ${file} -> ${destPath}`);
}
