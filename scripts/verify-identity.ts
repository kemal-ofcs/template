/**
 * Pastikan tidak ada sisa identitas template di dalam sumber.
 *
 * Dijalankan otomatis di akhir `bun run rename`. Alasannya konkret: sebelum
 * pemeriksaan ini ada, `rename-project.ts` hanya mengganti identitas yang
 * terlihat — nama crate, paket Bun, bundle id — sementara nama cookie sesi,
 * kunci penyimpanan peramban, dan **pemisah domain kriptografi** di vault tetap
 * membawa nama produk lama. Tidak ada yang menyadarinya karena tidak ada yang
 * memeriksanya.
 *
 * Yang dicari adalah kata kunci milik template dan produk asalnya. Kalau masih
 * ada satu pun, skrip ini GAGAL dan menyebut berkas beserta barisnya.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const rootDir = join(__dirname, "..");

/**
 * Kata yang tidak boleh tersisa setelah rename.
 *
 * `app-template`/`app_template` ikut diperiksa: nilai bawaan template sendiri
 * juga bukan identitas yang sah untuk sebuah produk.
 */
const FORBIDDEN: readonly {
	pattern: RegExp;
	reason: string;
	kind: "foreign" | "template";
}[] = [
	// "foreign" — identitas produk LAIN yang bocor ke dalam template. Ini cacat:
	// artinya ada tempat yang belum ikut digeneralisasi.
	{
		pattern: /sppg/i,
		reason: "identitas produk asal template",
		kind: "foreign",
	},
	{
		pattern: /absensi/i,
		reason: "identitas produk asal template",
		kind: "foreign",
	},
	// "template" — nilai bawaan template itu sendiri. Wajar pada template yang
	// bersih; hanya menjadi masalah setelah rename dijalankan.
	{
		pattern: /app[-_]template/i,
		reason: "identitas bawaan template",
		kind: "template",
	},
];

/** Direktori yang tidak pernah berisi sumber yang kita tulis sendiri. */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"target",
	"out",
	".next",
	"gen",
	"dist",
	"build",
]);

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".rs",
	".json",
	".toml",
	".css",
	".html",
]);

/**
 * Berkas yang SENGAJA boleh menyebut kata terlarang.
 *
 * Hanya dokumen dan skrip yang memang membicarakan proses rename itu sendiri —
 * bukan kode yang berjalan.
 */
const ALLOWED_FILES = new Set([
	"scripts/verify-identity.ts",
	"scripts/rename-project.ts",
	"README.md",
	"CLAUDE.md",
	"AGENTS.md",
]);

interface Finding {
	file: string;
	line: number;
	text: string;
	reason: string;
	kind: "foreign" | "template";
}

function walk(directory: string, findings: Finding[]) {
	for (const entry of readdirSync(directory)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(directory, entry);
		const stats = statSync(full);

		if (stats.isDirectory()) {
			walk(full, findings);
			continue;
		}

		const dot = entry.lastIndexOf(".");
		if (dot === -1 || !SOURCE_EXTENSIONS.has(entry.slice(dot))) continue;

		const relativePath = relative(rootDir, full).replace(/\\/g, "/");
		if (ALLOWED_FILES.has(relativePath)) continue;

		const lines = readFileSync(full, "utf8").split("\n");
		lines.forEach((text, index) => {
			for (const { pattern, reason, kind } of FORBIDDEN) {
				if (pattern.test(text)) {
					findings.push({
						file: relativePath,
						line: index + 1,
						text: text.trim().slice(0, 110),
						reason,
						kind,
					});
					return;
				}
			}
		});
	}
}

console.log("Memeriksa sisa identitas template...\n");

const findings: Finding[] = [];
walk(join(rootDir, "web-desktop", "src"), findings);
walk(join(rootDir, "web-desktop", "src-tauri", "src"), findings);
walk(join(rootDir, "mobile", "src"), findings);
walk(join(rootDir, "mobile", "src-tauri", "src"), findings);

if (findings.length === 0) {
	console.log(
		"✅ Bersih — tidak ada sisa identitas template di dalam sumber.\n",
	);
	process.exit(0);
}

// Bila SATU-SATUNYA temuan ada di modul identitas, artinya template ini memang
// belum di-rename — bukan ada sisa yang terlewat. Membedakan keduanya penting:
// yang pertama keadaan normal sebuah template bersih, yang kedua cacat nyata.
const foreign = findings.filter((finding) => finding.kind === "foreign");

if (foreign.length === 0) {
	console.error("❌ Template ini BELUM DI-RENAME.\n");
	console.error("   Identitas produk masih bernilai bawaan template.");
	console.error(
		'   Jalankan: bun run rename <slug> "<Nama Tampilan>" <bundle.id>\n',
	);
	process.exit(1);
}

console.error(
	`❌ ${foreign.length} sisa identitas produk lain ditemukan di dalam template:\n`,
);
for (const finding of foreign.slice(0, 40)) {
	console.error(`  ${finding.file}:${finding.line}  (${finding.reason})`);
	console.error(`    ${finding.text}`);
}
if (foreign.length > 40) {
	console.error(`  … dan ${foreign.length - 40} lainnya.`);
}
console.error(
	"\nJalankan `bun run rename` terlebih dahulu, atau perbarui daftar penggantian\n" +
		"di scripts/rename-project.ts bila ada pola baru yang belum tercakup.\n",
);
process.exit(1);
