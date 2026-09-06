import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

/**
 * Audit kontrak sinkronisasi.
 *
 * Berbeda dari `schema-audit.ts` yang membandingkan BENTUK tabel, audit ini
 * memeriksa KONTRAK di sekelilingnya: rute outbox yang sah, kesetaraan salinan
 * Mobile, kelengkapan pendaftaran command Tauri, dan kesesuaian katalog
 * permission antara Rust dan TypeScript.
 *
 * Prinsip yang membedakannya dari versi di aplikasi turunan: sebisa mungkin
 * harapannya DITURUNKAN dari kode, bukan ditulis sebagai daftar tetap. Daftar
 * tetap memaksa setiap produk baru memelihara salinan kedua yang cepat atau
 * lambat berselisih dengan kenyataan — persis kelas kesalahan yang ingin
 * dicegah audit ini. Daftar tetap hanya dipakai di tempat yang memang berupa
 * KEPUTUSAN, misalnya tabel yang sengaja tidak ikut disinkronkan.
 */

const projectRoot = resolve(import.meta.dir, "..");
const errors: string[] = [];
const notes: string[] = [];

/**
 * Tabel yang SENGAJA hanya ada di satu sisi.
 *
 * Ini keputusan, bukan turunan — jadi memang ditulis tangan. Setiap penambahan
 * WAJIB disertai alasannya di sini, agar daftar ini tidak pelan-pelan berubah
 * menjadi tempat menyembunyikan drift.
 */
const RUST_ONLY_CLOUD_TABLES = [
	// Penghitung perubahan per tabel, dibuat `ensure_sync_pulse` dan digerakkan
	// trigger SQLite. Jalur Web menulis langsung ke database yang sama, sehingga
	// trigger yang sama sudah ikut menaikkannya.
	"sync_pulse",
];

const WEB_ONLY_CLOUD_TABLES: string[] = [];

function fail(message: string) {
	errors.push(message);
}

function read(relativePath: string) {
	const path = resolve(projectRoot, relativePath);
	if (!existsSync(path)) {
		fail(`Berkas wajib tidak ditemukan: ${relativePath}`);
		return "";
	}
	return readFileSync(path, "utf8");
}

function sameSet(
	label: string,
	actual: Iterable<string>,
	expected: Iterable<string>,
) {
	const left = [...new Set(actual)].sort();
	const right = [...new Set(expected)].sort();
	if (JSON.stringify(left) === JSON.stringify(right)) return;

	const onlyLeft = left.filter((item) => !right.includes(item));
	const onlyRight = right.filter((item) => !left.includes(item));
	const detail = [
		onlyLeft.length > 0 ? `hanya di kiri: ${onlyLeft.join(", ")}` : "",
		onlyRight.length > 0 ? `hanya di kanan: ${onlyRight.join(", ")}` : "",
	]
		.filter(Boolean)
		.join(" · ");
	fail(`${label} — ${detail}`);
}

// ── Pembaca sumber ──────────────────────────────────────────────────────────

function canonicalRoutes(source: string) {
	const block = source.match(
		/const CANONICAL_SYNC_ROUTES:[\s\S]*?=\s*&\[([\s\S]*?)\n\];/,
	)?.[1];
	if (!block) return [];
	return [...block.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map(
		(match) => `${match[1]}/${match[2]}`,
	);
}

function snapshotTriples(source: string) {
	const block = source
		.match(/const SNAPSHOT_TABLES:[\s\S]*?=\s*&\[([\s\S]*?)\n\];/)?.[1]
		?.replace(/\s+/g, " ")
		.trim();
	if (!block) return [];
	return [
		...block.matchAll(
			/payload_key:\s*"([^"]+)"[\s\S]*?domain:\s*"([^"]+)"[\s\S]*?table:\s*"([^"]+)"/g,
		),
	].map((match) => `${match[1]}|${match[2]}|${match[3]}`);
}

function registeredCommands(libSource: string) {
	const block = libSource.match(
		/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\n\s*\]\)/,
	)?.[1];
	if (!block) return [];
	return [
		...block.matchAll(/([a-z_][a-z0-9_]*(?:::[a-z_][a-z0-9_]*)+)\s*,/g),
	].map((match) => match[1].split("::").pop() as string);
}

function definedCommands(source: string) {
	return [
		...source.matchAll(
			/#\[tauri::command\][\s\S]{0,200}?\bfn\s+([a-z_][a-z0-9_]*)/g,
		),
	].map((match) => match[1] as string);
}

function buildRsCommands(source: string) {
	const block = source.match(/=\s*&?\[([\s\S]*?)\];/)?.[1];
	if (!block) return [];
	return [...block.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map(
		(match) => match[1] as string,
	);
}

function capabilityCommands(source: string) {
	return (
		[...source.matchAll(/"allow-([a-z0-9-]+)"/g)]
			.map((match) => (match[1] as string).replace(/-/g, "_"))
			// `mobile_` ikut: perintah yang hanya ada di biner Mobile memakai awalan
			// itu, dan menyaringnya di sini akan membuat audit melaporkan
			// "tanpa izin di capabilities" untuk izin yang sebenarnya ada.
			.filter(
				(name) => name.startsWith("desktop_") || name.startsWith("mobile_"),
			)
	);
}

/** Kunci permission dari seed SQL Rust. */
function seededPermissions(source: string) {
	const block = source.match(
		/INSERT OR IGNORE INTO app_permission[\s\S]*?VALUES([\s\S]*?);/,
	)?.[1];
	if (!block) return [];
	return [...block.matchAll(/\(\s*'([a-z_]+\.[a-z_.]+)'/g)].map(
		(match) => match[1] as string,
	);
}

/** Kunci permission dari katalog TypeScript. */
function catalogPermissions(source: string) {
	return [...source.matchAll(/key:\s*"([a-z_]+\.[a-z_.]+)"/g)].map(
		(match) => match[1] as string,
	);
}

function walk(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(directory)) {
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) {
			files.push(...walk(full));
			continue;
		}
		if ([".ts", ".tsx"].includes(extname(entry))) files.push(full);
	}
	return files;
}

/** Rute yang benar-benar diproduksi outbox di dalam sumber Rust. */
function producedRoutes(source: string) {
	return [
		...source.matchAll(
			/enqueue_outbox\(\s*[^,]+,\s*"([^"]+)"\s*,\s*"([^"]+)"/g,
		),
	].map((match) => `${match[1]}/${match[2]}`);
}

// ── Sumber ──────────────────────────────────────────────────────────────────

const desktopSync = read("web-desktop/src-tauri/src/desktop/sync.rs");
const mobileSync = read("mobile/src-tauri/src/mobile/sync.rs");
const desktopLib = read("web-desktop/src-tauri/src/lib.rs");
const mobileLib = read("mobile/src-tauri/src/lib.rs");
const desktopCommands = read("web-desktop/src-tauri/src/desktop/commands.rs");
// `commands.rs` DITAMBAH modul khusus Mobile. Perintah yang tidak punya
// padanan Desktop hidup di luar berkas yang disalin sync-rust-modules.ts, dan
// audit yang hanya membaca commands.rs akan menuduhnya "terdaftar tetapi
// fungsinya tidak ada".
const mobileCommands = [
	read("mobile/src-tauri/src/mobile/commands.rs"),
	read("mobile/src-tauri/src/mobile/device_storage.rs"),
].join("\n");
const desktopBuild = read("web-desktop/src-tauri/build.rs");
const mobileBuild = read("mobile/src-tauri/build.rs");
const desktopCapability = read(
	"web-desktop/src-tauri/capabilities/default.json",
);
const mobileCapability = read("mobile/src-tauri/capabilities/default.json");
const desktopTurso = read("web-desktop/src-tauri/src/desktop/turso.rs");
const desktopCatalog = read("web-desktop/src/lib/rbac/catalog.ts");

// ── 1. Rute kanonik ─────────────────────────────────────────────────────────
// Daftarnya DITURUNKAN dari sisi Desktop, lalu Mobile diwajibkan sama. Tidak
// ada daftar kedua yang harus dipelihara manusia.
const routes = canonicalRoutes(desktopSync);
if (routes.length === 0) {
	fail("CANONICAL_SYNC_ROUTES tidak terbaca dari sync.rs Desktop.");
} else {
	sameSet(
		"Rute kanonik Desktop vs Mobile",
		routes,
		canonicalRoutes(mobileSync),
	);
	notes.push(`${routes.length} rute kanonik konsisten di kedua workspace.`);
}

// Setiap rute yang benar-benar diproduksi outbox WAJIB ada di daftar kanonik.
// Rute karangan membuat event menggantung: ia terkirim, tetapi tidak ada
// pemroses yang mengenalinya.
for (const [label, source] of [
	["Desktop", desktopSync],
	["Mobile", mobileSync],
] as [string, string][]) {
	const produced = [...new Set(producedRoutes(source))];
	const unknown = produced.filter((route) => !routes.includes(route));
	if (unknown.length > 0) {
		fail(`Rute outbox ${label} di luar daftar kanonik: ${unknown.join(", ")}`);
	}
}

// ── 2. Tabel snapshot ───────────────────────────────────────────────────────
const triples = snapshotTriples(desktopSync);
if (triples.length === 0) {
	fail("SNAPSHOT_TABLES tidak terbaca dari sync.rs Desktop.");
} else {
	sameSet(
		"Tabel snapshot Desktop vs Mobile",
		triples,
		snapshotTriples(mobileSync),
	);
	notes.push(`${triples.length} tabel snapshot konsisten di kedua workspace.`);
}

// ── 3. Pendaftaran command Tauri ────────────────────────────────────────────
// Sebuah command hidup di empat tempat: definisinya, `invoke_handler`,
// `build.rs`, dan berkas capability. Melewatkan salah satunya membuat build
// gagal atau — lebih buruk — command terdaftar yang tidak punya izin.
for (const [label, lib, commands, build, capability] of [
	["web-desktop", desktopLib, desktopCommands, desktopBuild, desktopCapability],
	["mobile", mobileLib, mobileCommands, mobileBuild, mobileCapability],
] as [string, string, string, string, string][]) {
	const defined = new Set(definedCommands(commands));
	const registered = registeredCommands(lib);
	const declared = new Set(buildRsCommands(build));
	const allowed = new Set(capabilityCommands(capability));

	const missingDefinition = registered.filter((name) => !defined.has(name));
	if (missingDefinition.length > 0) {
		fail(
			`Command ${label} terdaftar tetapi fungsinya tidak ada: ${missingDefinition.join(", ")}`,
		);
	}

	const missingBuild = registered.filter((name) => !declared.has(name));
	if (missingBuild.length > 0) {
		fail(
			`Command ${label} tidak ada di daftar build.rs: ${missingBuild.join(", ")} — tauri_build gagal membuat izinnya dan build berhenti.`,
		);
	}

	const missingCapability = registered.filter((name) => !allowed.has(name));
	if (missingCapability.length > 0) {
		fail(
			`Command ${label} tanpa izin di capabilities/default.json: ${missingCapability.join(", ")}`,
		);
	}

	if (
		missingDefinition.length === 0 &&
		missingBuild.length === 0 &&
		missingCapability.length === 0
	) {
		notes.push(`${label}: ${registered.length} command terdaftar lengkap.`);
	}
}

// ── 4. Command yang dipanggil frontend benar-benar ada ──────────────────────
// Gateway yang memanggil command tidak dikenal hanya gagal saat dijalankan
// pengguna, bukan saat dibangun.
for (const [label, workspace, lib] of [
	["web-desktop", "web-desktop", desktopLib],
	["mobile", "mobile", mobileLib],
] as [string, string, string][]) {
	const registered = new Set(registeredCommands(lib));
	const invoked = new Set<string>();
	for (const file of walk(resolve(projectRoot, workspace, "src"))) {
		for (const match of readFileSync(file, "utf8").matchAll(
			/invokeDesktop(?:<[\s\S]*?>)?\(\s*"([a-z0-9_]+)"/g,
		)) {
			invoked.add(match[1] as string);
		}
	}
	// Command berawalan `mobile_` hanya dipanggil di balik
	// `if (isMobileRuntime()) { … }` pada gateway bersama, jadi wajar tidak
	// terdaftar di biner Desktop/Web. Pakai awalan itu untuk SETIAP perintah
	// yang hanya ada di Mobile — tanpa awalannya, audit ini akan menuduh
	// gateway bersama memanggil command hantu.
	const unknown = [...invoked].filter(
		(name) =>
			!registered.has(name) &&
			!(workspace === "web-desktop" && name.startsWith("mobile_")),
	);
	if (unknown.length > 0) {
		fail(
			`Frontend ${label} memanggil command yang tidak terdaftar: ${unknown.join(", ")}`,
		);
	}
}

// ── 5. Katalog permission Rust vs TypeScript ────────────────────────────────
// Seed Rust menanam permission ke database; katalog TypeScript yang menentukan
// apa yang tampil di layar Role & Akses. Selisihnya berarti ada izin yang tidak
// pernah bisa diberikan, atau yang diberikan tetapi tidak pernah ditanam.
const seeded = seededPermissions(desktopTurso);
const catalog = catalogPermissions(desktopCatalog);
if (seeded.length === 0 || catalog.length === 0) {
	fail("Katalog permission tidak terbaca dari salah satu sisi.");
} else {
	sameSet("Permission seed Rust vs katalog TypeScript", seeded, catalog);
	notes.push(`${catalog.length} permission konsisten di kedua sisi.`);
}

// ── 6. Tabel cloud yang sengaja hanya ada di satu sisi ──────────────────────
// Database yang sama dibangun DUA jalur: `turso.rs` (Desktop/Mobile) dan
// `db-schema.ts` + `db-migrations.ts` (Web). `CREATE TABLE IF NOT EXISTS` tidak
// pernah memperbaiki tabel yang sudah ada, sehingga selisih di sini merusak
// permanen jalur yang tidak sempat membuatnya.
function cloudTables(source: string) {
	return [...source.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(
		(match) => match[1] as string,
	);
}

{
	const rust = new Set(cloudTables(desktopTurso));
	const web = new Set(
		cloudTables(
			`${read("web-desktop/src/lib/db-schema.ts")}\n${read("web-desktop/src/lib/db-migrations.ts")}`,
		),
	);

	const rustOnly = [...rust].filter(
		(table) => !web.has(table) && !RUST_ONLY_CLOUD_TABLES.includes(table),
	);
	const webOnly = [...web].filter(
		(table) => !rust.has(table) && !WEB_ONLY_CLOUD_TABLES.includes(table),
	);

	if (rustOnly.length > 0) {
		fail(
			`Tabel cloud hanya dibuat jalur Rust: ${rustOnly.sort().join(", ")} — jalur Web tidak akan pernah memilikinya.`,
		);
	}
	if (webOnly.length > 0) {
		fail(
			`Tabel cloud hanya dibuat jalur Web: ${webOnly.sort().join(", ")} — jalur Desktop/Mobile tidak akan pernah memilikinya.`,
		);
	}
	if (rustOnly.length === 0 && webOnly.length === 0) {
		notes.push(
			`Kedua jalur provisioning membuat himpunan tabel yang sama (${RUST_ONLY_CLOUD_TABLES.length} pengecualian terdokumentasi).`,
		);
	}
}

// ── Hasil ───────────────────────────────────────────────────────────────────

console.log("Audit Kontrak Sinkronisasi\n");

if (errors.length === 0) {
	console.log("AUDIT SYNC CONTRACT: LULUS");
	for (const note of notes) console.log(`- ${note}`);
	console.log("");
	process.exit(0);
}

console.error("AUDIT SYNC CONTRACT: GAGAL");
for (const error of errors) console.error(`- ${error}`);
console.error("");
process.exit(1);
