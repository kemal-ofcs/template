/**
 * Ganti seluruh identitas template menjadi identitas proyek baru.
 *
 * Pemakaian (dari direktori root template, setelah folder disalin):
 *
 *   bun scripts/rename-project.ts smart-pos "Smart POS" id.tokoanda.smartpos
 *
 * Argumen:
 *   1. slug        — nama paket/produk, huruf kecil dan tanda hubung (smart-pos)
 *   2. displayName — nama yang dilihat pengguna ("Smart POS")
 *   3. bundleId    — identifier aplikasi (id.tokoanda.smartpos)
 *
 * Skrip ini hanya menyentuh identitas: nama crate Rust, nama paket Bun,
 * `productName`/`identifier` Tauri, dan judul jendela. Skema database, nama
 * tabel, dan logika aplikasi TIDAK disentuh — itu keputusan Anda, bukan
 * keputusan skrip.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [slugArg, displayArg, bundleArg] = process.argv.slice(2);

if (!slugArg || !displayArg || !bundleArg) {
	console.error(
		'Pemakaian: bun scripts/rename-project.ts <slug> "<Nama Tampilan>" <bundle.id>',
	);
	console.error(
		'Contoh   : bun scripts/rename-project.ts smart-pos "Smart POS" id.tokoanda.smartpos',
	);
	process.exit(1);
}

const slug = slugArg.trim().toLowerCase();
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
	console.error(
		"Slug harus diawali huruf dan hanya berisi huruf kecil, angka, atau tanda hubung.",
	);
	process.exit(1);
}
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(bundleArg)) {
	console.error(
		"Bundle id harus berbentuk reverse-domain, misalnya id.tokoanda.smartpos.",
	);
	process.exit(1);
}

const displayName = displayArg.trim();
const crateBase = slug.replace(/-/g, "_");

/** Pasangan pencarian dan pengganti, diurutkan dari yang paling spesifik. */
const REPLACEMENTS: readonly (readonly [string, string])[] = [
	// Nama crate Rust
	["app_template_desktop_lib", `${crateBase}_desktop_lib`],
	["app_template_desktop", `${crateBase}_desktop`],
	["app_template_mobile_lib", `${crateBase}_mobile_lib`],
	["app_template_mobile", `${crateBase}_mobile`],
	// Identifier aplikasi
	["id.example.apptemplate.mobile", `${bundleArg}.mobile`],
	["id.example.apptemplate", bundleArg],
	// Nama paket dan produk
	["app-template-root", `${slug}-root`],
	["app-template-mobile", `${slug}-mobile`],
	["app-template", slug],
	// Nama yang dilihat pengguna
	["App Template", displayName],
];

const SKIP_DIRS = new Set([
	"node_modules",
	"target",
	"gen",
	"out",
	".next",
	".git",
]);

const EXTENSIONS = new Set([
	".ts",
	".tsx",
	".rs",
	".json",
	".toml",
	".md",
	".html",
	".css",
	".kts",
	".gradle",
	".pro",
	".xml",
]);

function* walk(directory: string): Generator<string> {
	for (const entry of readdirSync(directory)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) {
			yield* walk(full);
			continue;
		}
		const dot = entry.lastIndexOf(".");
		if (dot < 0 || !EXTENSIONS.has(entry.slice(dot))) continue;
		yield full;
	}
}

let changedFiles = 0;
let changedOccurrences = 0;

for (const file of walk(process.cwd())) {
	const original = readFileSync(file, "utf-8");
	let updated = original;
	for (const [needle, replacement] of REPLACEMENTS) {
		if (!updated.includes(needle)) continue;
		changedOccurrences += updated.split(needle).length - 1;
		updated = updated.replaceAll(needle, replacement);
	}
	if (updated !== original) {
		writeFileSync(file, updated, "utf-8");
		changedFiles += 1;
	}
}

console.log(
	`Selesai. ${changedOccurrences} penggantian di ${changedFiles} berkas.`,
);
console.log("");
// Verifikasi otomatis. Rename yang "berhasil" tetapi menyisakan identitas
// produk lain jauh lebih berbahaya daripada rename yang gagal terang-terangan:
// yang tertinggal justru pemisah domain kriptografi dan nama cookie, dan tidak
// ada yang akan menyadarinya sampai dua produk saling menimpa sesinya.
const verification = Bun.spawnSync({
	cmd: ["bun", "scripts/verify-identity.ts"],
	cwd: join(__dirname, ".."),
	stdout: "inherit",
	stderr: "inherit",
});
if (verification.exitCode !== 0) {
	console.error(
		"\nRename BELUM tuntas — masih ada sisa identitas di dalam sumber.",
	);
	process.exit(1);
}

console.log("Langkah berikutnya:");
console.log("  1. bun run setup");
console.log(
	"  2. cd web-desktop && bun run tauri dev   (atau: bun dev untuk Web)",
);
console.log("  3. Jalankan aplikasi, lalu isi layar provisioning database.");
console.log("");
console.log(
	"Ganti domain contoh (master_item / log_aktivitas) di empat lapisan sekaligus:",
);
console.log(
	"  - web-desktop/src-tauri/src/desktop/storage.rs   (SQLite lokal)",
);
console.log(
	"  - web-desktop/src-tauri/src/desktop/turso.rs     (DDL cloud + handler push)",
);
console.log(
	"  - web-desktop/src-tauri/src/desktop/sync.rs      (SNAPSHOT_TABLES + route)",
);
console.log(
	"  - web-desktop/src/lib/db-schema.ts               (skema jalur Web)",
);
console.log("");
// Keempat lapisan itu tidak dijaga oleh typecheck maupun compiler — satu nama
// kolom yang berbeda ejaan baru terlihat saat baris pertama gagal disinkronkan
// di lapangan. Audit inilah yang menangkapnya, jadi ia disebut di sini, bukan
// dikubur di README.
console.log("Setelah mengubah keempatnya, jalankan:");
console.log(
	"  bun run audit:schema        (bandingkan hasil DDL keempat lapisan)",
);
console.log(
	"  bun run verify:template     (semua gerbang; --rust ikut cargo test)",
);
