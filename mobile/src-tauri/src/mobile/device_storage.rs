//! Menyerahkan berkas yang dibuat aplikasi ke penyimpanan milik pengguna.
//!
//! Modul ini SENGAJA berada di luar daftar berkas yang disalin
//! `scripts/sync-rust-modules.ts`. Perintah di sini tidak punya padanan di
//! Desktop, jadi kalau ditaruh di `commands.rs` ia akan terhapus setiap kali
//! sinkronisasi dari `web-desktop` dijalankan.
//!
//! **Mengapa Storage Access Framework, bukan menulis ke folder Unduhan.**
//! Sejak Android 10 (scoped storage) aplikasi tidak boleh lagi menulis ke
//! `/storage/emulated/0/Download`. Penulisan itu gagal diam-diam: berkasnya
//! tetap dibuat di folder privat aplikasi, pemanggilnya melaporkan sukses, dan
//! pengguna tidak pernah menemukan hasilnya. SAF membalik keadaannya —
//! penggunalah yang memilih tujuannya lewat dialog sistem, izin diberikan per
//! berkas, dan tidak ada satu pun permission manifest yang perlu diminta.

use serde_json::{json, Value};
use tauri::State;

use super::config::MobileState;
use super::models::CommandError;
use super::{portability, storage};

/// Keluarkan cadangan database, lalu serahkan ke pemilih "Simpan ke…" Android.
///
/// Frontend TIDAK menyerahkan path apa pun ke sini. Perintah ini mengekspor
/// sendiri lalu langsung menyerahkan hasilnya, sehingga tidak ada jalan bagi
/// pemanggil untuk menunjuk berkas lain di dalam folder data aplikasi.
///
/// Balasan `savedToDevice: false` berarti pengguna MENUTUP dialognya. Itu
/// pembatalan, bukan kegagalan, dan UI wajib memperlakukannya begitu.
///
/// Namanya berawalan `mobile_`, bukan `desktop_`: konvensi itu yang dipakai
/// `audit:contract` untuk mengenali command yang memang hanya ada di biner
/// Mobile, sehingga gateway bersama boleh memanggilnya tanpa dianggap cacat.
#[tauri::command]
pub async fn mobile_export_database_to_device(
    app: tauri::AppHandle,
    state: State<'_, MobileState>,
    passphrase: Option<String>,
) -> Result<Value, CommandError> {
    let operator = super::commands::require_permission(&state, "database_backup.export")?;
    let report = portability::export_database(&state, passphrase.as_deref())?;

    let saved = simpan_ke_perangkat(&app, &report.path, &report.file_name).await?;

    storage::audit(
        &state.data_dir,
        Some(operator.id),
        if saved {
            "database-export-saved-to-device"
        } else {
            "database-export-save-cancelled"
        },
        Some(&report.file_name),
    );

    Ok(json!({
        "path": report.path,
        "fileName": report.file_name,
        "sizeBytes": report.size_bytes,
        "encrypted": report.encrypted,
        "savedToDevice": saved,
    }))
}

/// Buka dialog SAF lalu tulis isinya ke tujuan yang dipilih pengguna.
///
/// Dipisahkan supaya cabang non-Android hanya ada di satu tempat. Workspace ini
/// juga dikompilasi untuk host saat `cargo test`, jadi seluruh modul wajib
/// tetap dapat dibangun tanpa plugin Android-nya.
#[cfg(target_os = "android")]
async fn simpan_ke_perangkat(
    app: &tauri::AppHandle,
    source_path: &str,
    file_name: &str,
) -> Result<bool, CommandError> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let bytes = std::fs::read(source_path).map_err(|error| {
        CommandError::new(
            "BACKUP_READ_FAILED",
            format!("Berkas cadangan tidak dapat dibaca: {error}"),
        )
    })?;

    // Versi ASINKRON, bukan `android_fs()`. Dialognya menunggu interaksi
    // manusia — memblokir thread runtime selama itu akan membekukan seluruh
    // antarmuka, termasuk dialog yang sedang ditunggu.
    let api = app.android_fs_async();
    let uri = api
        .picker()
        .save_file(None, file_name, Some("application/octet-stream"), false)
        .await
        .map_err(|error| {
            CommandError::new(
                "BACKUP_SAVE_FAILED",
                format!("Pemilih lokasi tidak dapat dibuka: {error}"),
            )
        })?;

    let Some(uri) = uri else {
        // Pengguna menutup dialog. Bukan kegagalan.
        return Ok(false);
    };

    api.write(&uri, &bytes).await.map_err(|error| {
        CommandError::new(
            "BACKUP_SAVE_FAILED",
            format!("Berkas tidak dapat ditulis ke lokasi pilihan: {error}"),
        )
    })?;
    Ok(true)
}

#[cfg(not(target_os = "android"))]
async fn simpan_ke_perangkat(
    _app: &tauri::AppHandle,
    _source_path: &str,
    _file_name: &str,
) -> Result<bool, CommandError> {
    Err(CommandError::new(
        "BACKUP_SAVE_UNSUPPORTED",
        "Dialog simpan berkas hanya tersedia pada build Android.",
    ))
}
