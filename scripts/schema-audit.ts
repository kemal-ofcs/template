/**
 * Audit Konsistensi Skema 4-Layer — diff yang dieksekusi, bukan pencocokan teks.
 *
 * Versi sebelumnya membandingkan kode sumber dengan berkas referensi
 * `absensi-sppg.db` dan hanya memeriksa apakah nama tabel *disebut* di dalam
 * berkas sumber. Dua kelemahannya membuat audit itu tidak pernah bisa menangkap
 * drift yang sebenarnya: pemeriksaan substring lolos meskipun sebuah kolom
 * hilang, dan ketika berkas referensinya tidak ada lagi seluruh audit berubah
 * menjadi lolos-palsu — melaporkan "100% KONSISTEN" sambil memeriksa nol tabel.
 *
 * Versi ini menjalankan DDL setiap lapisan ke database sementara lalu
 * membandingkan tabel dan kolom yang NYATA terbentuk. Tidak ada lagi artefak
 * yang harus dipelihara manusia di samping kode.
 */

import fs from "node:fs";
import path from "node:path";
import {
	buildCloudSchema,
	buildLocalSchema,
	buildRepairSchema,
	diffSchema,
	isDiffClean,
	type SchemaDiff,
	schemaFromJson,
	type TableSchema,
} from "./lib/cloud-schema";
import { parseSnapshotTables } from "./lib/snapshot-tables";

const rootDir = path.resolve(__dirname, "..");

/**
 * Tabel yang memang hanya lahir di salah satu jalur provisioning.
 *
 * `sync_pulse` dibuat `ensure_sync_pulse` di Rust dan tidak pernah dibuat jalur
 * Web: penghitung perubahannya digerakkan trigger SQLite, dan Web menulis
 * langsung ke Turso sehingga trigger yang sama sudah ikut menaikkannya. Setiap
 * penambahan pada daftar ini WAJIB disertai alasan seperti ini — tanpa itu,
 * daftar ini akan pelan-pelan berubah menjadi tempat menyembunyikan drift.
 */
const CLOUD_ONLY_IN_RUST = new Set(["sync_pulse"]);

let failures = 0;
let warnings = 0;

function heading(text: string) {
	console.log(`\n${"─".repeat(70)}\n${text}\n${"─".repeat(70)}`);
}

function renderDiff(diff: SchemaDiff, leftLabel: string, rightLabel: string) {
	for (const table of diff.missingTables) {
		console.log(
			`    • tabel '${table}' ada di ${leftLabel}, TIDAK ada di ${rightLabel}`,
		);
	}
	for (const table of diff.extraTables) {
		console.log(
			`    • tabel '${table}' ada di ${rightLabel}, TIDAK ada di ${leftLabel}`,
		);
	}
	for (const entry of diff.columnDiffs) {
		if (entry.missing.length > 0) {
			console.log(
				`    • ${entry.table}: kolom [${entry.missing.join(", ")}] ada di ${leftLabel}, hilang di ${rightLabel}`,
			);
		}
		if (entry.extra.length > 0) {
			console.log(
				`    • ${entry.table}: kolom [${entry.extra.join(", ")}] ada di ${rightLabel}, hilang di ${leftLabel}`,
			);
		}
	}
}

function check(
	name: string,
	diff: SchemaDiff,
	leftLabel: string,
	rightLabel: string,
	severity: "fatal" | "warning" = "fatal",
) {
	if (isDiffClean(diff)) {
		console.log(`  ✅ ${name}`);
		return;
	}
	if (severity === "fatal") {
		failures++;
		console.log(`  ❌ ${name}`);
	} else {
		warnings++;
		console.log(`  ⚠️  ${name}`);
	}
	renderDiff(diff, leftLabel, rightLabel);
}

function readSource(relativePath: string): string {
	const fullPath = path.join(rootDir, relativePath);
	if (!fs.existsSync(fullPath)) {
		throw new Error(`Berkas sumber tidak ditemukan: ${relativePath}`);
	}
	return fs.readFileSync(fullPath, "utf8");
}

/** Bangun skema jalur Web dengan benar-benar menjalankan `initDatabaseSchema`. */
async function buildWebSchema(): Promise<TableSchema> {
	const process_ = Bun.spawnSync({
		cmd: ["bun", "scripts/dump-web-schema.ts"],
		cwd: path.join(rootDir, "web-desktop"),
		stdout: "pipe",
		stderr: "pipe",
	});

	if (process_.exitCode !== 0) {
		throw new Error(
			`dump-web-schema.ts gagal:\n${process_.stderr.toString().trim()}`,
		);
	}

	return schemaFromJson(JSON.parse(process_.stdout.toString()));
}

console.log(
	"══════════════════════════════════════════════════════════════════════",
);
console.log("   Audit Konsistensi Skema 4-Layer");
console.log(
	"══════════════════════════════════════════════════════════════════════",
);

const desktopTurso = readSource("web-desktop/src-tauri/src/desktop/turso.rs");
const desktopStorage = readSource(
	"web-desktop/src-tauri/src/desktop/storage.rs",
);
const desktopSync = readSource("web-desktop/src-tauri/src/desktop/sync.rs");
const mobileTurso = readSource("mobile/src-tauri/src/mobile/turso.rs");
const mobileStorage = readSource("mobile/src-tauri/src/mobile/storage.rs");

const cloudDesktop = buildCloudSchema(desktopTurso);
const localDesktop = buildLocalSchema(desktopStorage);
const cloudMobile = buildCloudSchema(mobileTurso);
const localMobile = buildLocalSchema(mobileStorage);
const web = await buildWebSchema();

console.log(
	`\n📦 Skema terbangun — cloud Rust: ${cloudDesktop.size} tabel · lokal Rust: ${localDesktop.size} tabel · Web: ${web.size} tabel`,
);

// ── 1. Rust cloud vs Web ────────────────────────────────────────────────────
// Keduanya membangun database Turso YANG SAMA. `CREATE TABLE IF NOT EXISTS`
// tidak pernah memperbaiki tabel yang sudah ada, sehingga satu perbedaan di
// sini akan merusak permanen sisi mana pun yang tidak sempat membuat tabelnya.
heading("1. Jalur provisioning Rust (turso.rs) vs jalur Web (db-schema.ts)");
const cloudWithoutRustOnly: TableSchema = new Map(
	[...cloudDesktop].filter(([table]) => !CLOUD_ONLY_IN_RUST.has(table)),
);
check(
	"Tabel dan kolom cloud identik di kedua jalur provisioning",
	diffSchema(cloudWithoutRustOnly, web),
	"Rust",
	"Web",
);
for (const table of CLOUD_ONLY_IN_RUST) {
	console.log(
		`  ℹ️  '${table}' sengaja hanya dibuat jalur Rust (lihat CLOUD_ONLY_IN_RUST).`,
	);
}

// ── 2. Definisi repair vs definisi utama ────────────────────────────────────
// `repair_web_owned_tables` membangun ulang tabel milik Web setelah DROP.
// Kalau definisinya berbeda dari `ensure_schema`, database baru dan database
// yang dipulihkan akan punya bentuk yang berlainan.
heading("2. repair_web_owned_tables vs ensure_schema");
const repairSchema = buildRepairSchema(desktopTurso);
check(
	"Definisi tabel milik Web sama di jalur pembuatan dan jalur perbaikan",
	diffSchema(repairSchema, cloudDesktop, new Set(repairSchema.keys())),
	"repair",
	"ensure_schema",
);

// ── 3. Paritas Desktop ↔ Mobile ─────────────────────────────────────────────
// `mobile/src-tauri/src/mobile/*.rs` adalah salinan hasil generate. Perbedaan
// apa pun berarti script sync belum dijalankan, atau berkasnya disunting tangan.
heading("3. Paritas salinan Mobile terhadap Desktop");
check(
	"Skema cloud Desktop = skema cloud Mobile",
	diffSchema(cloudDesktop, cloudMobile),
	"Desktop",
	"Mobile",
);
check(
	"Skema SQLite lokal Desktop = skema SQLite lokal Mobile",
	diffSchema(localDesktop, localMobile),
	"Desktop",
	"Mobile",
);

// ── 4. Kolom yang benar-benar disinkronkan ──────────────────────────────────
// Pemeriksaan terpenting untuk mencegah error sinkronisasi: setiap kolom di
// `SNAPSHOT_TABLES` melintasi batas jaringan, jadi ia WAJIB ada di sisi lokal
// maupun cloud. Kolom yang hanya ada di satu sisi membuat push gagal dengan
// "no such column" pada perangkat yang tidak memilikinya.
heading("4. Kolom SNAPSHOT_TABLES tersedia di sisi lokal DAN cloud");
const snapshotTables = parseSnapshotTables(desktopSync);
let syncedColumnCount = 0;
let syncIssues = 0;

for (const spec of snapshotTables) {
	const localColumns = localDesktop.get(spec.table);
	const cloudColumns = cloudDesktop.get(spec.table);
	const problems: string[] = [];

	if (!localColumns) problems.push("tabel tidak ada di storage.rs");
	if (!cloudColumns) problems.push("tabel tidak ada di turso.rs");

	for (const column of spec.columns) {
		syncedColumnCount++;
		if (localColumns && !localColumns.has(column)) {
			problems.push(`kolom '${column}' hilang di storage.rs`);
		}
		if (cloudColumns && !cloudColumns.has(column)) {
			problems.push(`kolom '${column}' hilang di turso.rs`);
		}
	}

	if (problems.length > 0) {
		syncIssues++;
		failures++;
		console.log(`  ❌ ${spec.payloadKey} → ${spec.table}`);
		for (const problem of problems) console.log(`    • ${problem}`);
	}
}

if (syncIssues === 0) {
	console.log(
		`  ✅ ${syncedColumnCount} kolom pada ${snapshotTables.length} tabel snapshot hadir di kedua sisi`,
	);
}

// ── 5. Drift di luar jalur sync ─────────────────────────────────────────────
// Kolom yang berbeda antara lokal dan cloud TAPI tidak ikut disinkronkan tidak
// merusak sync. Tetap dilaporkan sebagai peringatan supaya selisihnya terlihat
// dan disengaja, bukan ditemukan bertahun-tahun kemudian.
heading("5. Selisih lokal ↔ cloud di luar kolom yang disinkronkan");
const sharedTables = new Set(
	[...localDesktop.keys()].filter((table) => cloudDesktop.has(table)),
);
check(
	"Tabel yang ada di kedua sisi punya kolom yang sama",
	diffSchema(localDesktop, cloudDesktop, sharedTables),
	"storage.rs",
	"turso.rs",
	"warning",
);

// ── 6. Kelengkapan daftar isDatabaseSchemaReady ─────────────────────────────
// `isDatabaseSchemaReady` menghitung tabel untuk memutuskan apakah database
// sudah siap. Kalau ia menyebut tabel yang tidak pernah dibuat jalur mana pun,
// aplikasi akan menganggap database selamanya belum siap.
heading("6. Tabel yang dituntut isDatabaseSchemaReady benar-benar dibuat");
const schemaTs = readSource("web-desktop/src/lib/db-schema.ts");
/**
 * Baca daftar tabel wajib, apa pun bentuk penulisannya.
 *
 * Dua bentuk yang sah: sebuah konstanta `REQUIRED_TABLES` (lebih baik — panjang
 * daftarnya menjadi sumber `REQUIRED_TABLE_COUNT`, sehingga keduanya tidak
 * mungkin berselisih), atau daftar nama yang ditanam langsung di dalam SQL.
 * Keduanya diterima supaya audit ini tidak memaksa satu gaya penulisan.
 */
function readRequiredTables(source: string): string[] {
	const named = source.match(/REQUIRED_TABLES = \[([\s\S]*?)\] as const;/);
	if (named) {
		return [...named[1].matchAll(/"([a-z_]+)"/g)].map(
			(match) => match[1] as string,
		);
	}

	const inline = source.match(
		/WHERE type = 'table' AND name IN \(([\s\S]*?)\)\s*\)/,
	);
	return inline
		? [...inline[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1] as string)
		: [];
}

const requiredTables = readRequiredTables(schemaTs);

if (requiredTables.length === 0) {
	failures++;
	console.log("  ❌ Daftar tabel di isDatabaseSchemaReady tidak terbaca.");
} else {
	const notInRust = requiredTables.filter((table) => !cloudDesktop.has(table));
	const notInWeb = requiredTables.filter((table) => !web.has(table));

	if (notInRust.length === 0 && notInWeb.length === 0) {
		console.log(
			`  ✅ ${requiredTables.length} tabel wajib dibuat oleh kedua jalur`,
		);
	} else {
		failures++;
		console.log(`  ❌ Tabel wajib tidak terbentuk`);
		if (notInRust.length > 0)
			console.log(`    • tidak dibuat turso.rs: ${notInRust.join(", ")}`);
		if (notInWeb.length > 0)
			console.log(`    • tidak dibuat jalur Web: ${notInWeb.join(", ")}`);
	}

	const declaredCount = Number(
		schemaTs.match(/REQUIRED_TABLE_COUNT\s*=\s*(\d+)/)?.[1] ?? 0,
	);
	const derivedCount =
		/REQUIRED_TABLE_COUNT\s*=\s*REQUIRED_TABLES\.length/.test(schemaTs);

	if (derivedCount) {
		console.log(
			"  ✅ REQUIRED_TABLE_COUNT diturunkan dari panjang daftarnya — tidak mungkin berselisih",
		);
	} else if (declaredCount !== requiredTables.length) {
		failures++;
		console.log(
			`  ❌ REQUIRED_TABLE_COUNT = ${declaredCount} tetapi daftarnya berisi ${requiredTables.length} tabel`,
		);
	} else {
		console.log(
			`  ✅ REQUIRED_TABLE_COUNT cocok dengan panjang daftarnya (${declaredCount})`,
		);
	}
}

// ── 7. Handler domain di turso.rs ───────────────────────────────────────────
// Pemeriksaan warisan dari audit versi sebelumnya, dipertahankan apa adanya:
// setiap pasangan nama domain/tabel harus tetap disebut di `turso.rs`. Jauh
// lebih lemah daripada enam pemeriksaan di atas, tetapi ia menangkap kasus
// berbeda — handler yang terhapus seluruhnya, bukan kolom yang bergeser.
heading("7. Handler domain masih terdaftar di turso.rs");
// Perbarui daftar ini setiap kali sebuah domain baru ditambahkan — ia
// memastikan handler-nya tidak pernah terhapus diam-diam dari `turso.rs`.
const expectedDomains: [string, string][] = [
	["item", "master_item"],
	["activity", "log_aktivitas"],
	["setting", "setting_gex_system"],
];

const missingDomains = expectedDomains.filter(
	([first, second]) =>
		!desktopTurso.includes(`"${first}"`) &&
		!desktopTurso.includes(`"${second}"`),
);

if (missingDomains.length === 0) {
	console.log(`  ✅ ${expectedDomains.length} handler domain masih terdaftar`);
} else {
	failures++;
	console.log("  ❌ Handler domain hilang dari turso.rs");
	for (const [first, second] of missingDomains) {
		console.log(`    • '${first}' / '${second}'`);
	}
}

// ── 8. Seam transport tidak boleh mengarang SQL sendiri ─────────────────────
// Mode lokal bekerja karena SQL-nya SATU: `ensure_schema()` yang sama membangun
// database cloud maupun berkas lokal. Begitu modul transport mulai menulis DDL
// atau menyusun `Statement` sendiri, jaminan itu hilang — akan ada dua sumber
// kebenaran, dan drift antara keduanya hanya soal waktu. Modul transport hanya
// boleh MEMINDAHKAN pernyataan, tidak pernah mengarangnya.
heading("8. Modul transport hanya memindahkan SQL, tidak mengarangnya");

/** Buang blok `#[cfg(test)]` — kode uji memang boleh membuat tabelnya sendiri. */
function productionCode(source: string): string {
	const testIndex = source.indexOf("#[cfg(test)]");
	return testIndex === -1 ? source : source.slice(0, testIndex);
}

const transportModules = [
	"web-desktop/src-tauri/src/desktop/sql_backend.rs",
	"mobile/src-tauri/src/mobile/sql_backend.rs",
];

let transportViolations = 0;
let transportChecked = 0;
for (const relativePath of transportModules) {
	// Seam transport datang pada tahap berikutnya. Audit yang gagal karena
	// sesuatu yang memang belum dibangun mengajari orang untuk mengabaikannya,
	// jadi ketidakhadirannya dilaporkan sebagai catatan — bukan pelanggaran.
	if (!fs.existsSync(path.join(rootDir, relativePath))) {
		console.log(`  ℹ️   belum ada di template — dilewati.`);
		continue;
	}
	transportChecked++;
	const code = productionCode(readSource(relativePath));
	const problems: string[] = [];

	if (/\bCREATE\s+TABLE\b/i.test(code)) {
		problems.push(
			"memuat CREATE TABLE — DDL hanya boleh lahir dari ensure_schema()",
		);
	}
	if (code.includes("Statement::new")) {
		problems.push(
			"menyusun Statement sendiri — transport hanya boleh meneruskannya",
		);
	}
	if (/DatabaseProvider::/.test(code)) {
		problems.push(
			"bercabang pada provider — pilihan transport ditentukan pemanggil, bukan di sini",
		);
	}

	if (problems.length > 0) {
		transportViolations++;
		failures++;
		console.log(`  ❌ ${relativePath}`);
		for (const problem of problems) console.log(`    • ${problem}`);
	}
}

if (transportViolations === 0 && transportChecked > 0) {
	console.log(
		`  ✅ ${transportChecked} modul transport bersih dari DDL dan penyusunan Statement`,
	);
}

// ── Ringkasan ───────────────────────────────────────────────────────────────
heading("Hasil");
if (failures === 0) {
	console.log(
		warnings === 0
			? "🎉 Seluruh lapisan skema konsisten.\n"
			: `✅ Tidak ada pelanggaran fatal. ${warnings} peringatan di atas perlu ditinjau.\n`,
	);
} else {
	console.error(
		`❌ ${failures} pelanggaran skema ditemukan${warnings > 0 ? `, ditambah ${warnings} peringatan` : ""}.\n`,
	);
	process.exit(1);
}
