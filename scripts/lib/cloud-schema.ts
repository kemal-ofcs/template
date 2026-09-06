/**
 * Ekstraksi dan eksekusi DDL, untuk audit skema empat lapis.
 *
 * Audit versi lama membandingkan kode sumber dengan sebuah berkas referensi
 * `absensi-sppg.db` dan hanya memeriksa apakah nama tabel *disebut* di dalam
 * berkas sumber. Dua kelemahannya fatal: pemeriksaan substring lolos meskipun
 * sebuah kolom hilang atau hanya ada di satu sisi, dan begitu berkas referensi
 * itu hilang seluruh audit berubah menjadi lolos-palsu tanpa memeriksa apa pun.
 *
 * Modul ini menggantinya dengan diff yang benar-benar dieksekusi. DDL diambil
 * langsung dari kode (`turso.rs` untuk cloud, `storage.rs` untuk SQLite lokal),
 * dijalankan ke database sementara, lalu strukturnya dibaca lewat PRAGMA. Yang
 * dibandingkan adalah tabel dan kolom yang NYATA terbentuk — dan tidak ada lagi
 * artefak yang perlu dipelihara manusia di samping kode.
 */

import Database from "bun:sqlite";

export type TableSchema = Map<string, Set<string>>;

/** Statement DDL yang layak dijalankan ulang di SQLite lokal. */
const DDL_PREFIX =
	/^\s*(CREATE\s+TABLE|CREATE\s+INDEX|CREATE\s+UNIQUE\s+INDEX|ALTER\s+TABLE)\b/i;

/** Batch yang memuat DDL di tengahnya, misalnya diawali `PRAGMA`. */
const DDL_ANYWHERE = /\b(CREATE\s+TABLE|ALTER\s+TABLE)\b/i;

/**
 * Placeholder template Rust (`{table}`, `{suffix}`).
 *
 * Sengaja menuntut ada isi di dalam kurung: SQL yang sah bisa memuat `'{}'`
 * sebagai nilai DEFAULT JSON kosong — `sync_operation_receipt.receipt_json`
 * memakainya — dan membuang statement itu akan menghilangkan sebuah tabel dari
 * hasil audit tanpa satu pun pesan kesalahan.
 */
const RUST_TEMPLATE_PLACEHOLDER = /\{\s*\w+\s*\}/;

/**
 * Ambil seluruh literal string Rust, DALAM URUTAN SUMBER.
 *
 * Urutan penting: `ALTER TABLE` penyembuh ditulis sebagai string biasa
 * sementara `CREATE TABLE` memakai raw string, dan menjalankan ALTER sebelum
 * tabelnya lahir akan gagal dengan "no such table". Satu regex bergantian
 * memastikan keduanya keluar sesuai posisi aslinya di berkas.
 */
function extractStringLiterals(source: string): string[] {
	const literals: string[] = [];
	const pattern = /r#"([\s\S]*?)"#|"((?:[^"\\\n]|\\.)*)"/g;

	for (const match of source.matchAll(pattern)) {
		if (match[1] !== undefined) {
			literals.push(match[1]);
		} else if (match[2] !== undefined) {
			literals.push(match[2].replace(/\\"/g, '"'));
		}
	}

	return literals;
}

/**
 * Potong wilayah sumber antara dua penanda.
 *
 * Membatasi ekstraksi pada fungsi provisioning saja, supaya SQL dari fungsi
 * lain (query operasional, laporan) tidak ikut terbawa dan mengarang tabel yang
 * sebenarnya tidak pernah dibuat.
 */
function sliceRegion(
	source: string,
	startMarker: string,
	endMarkers: string | readonly string[],
) {
	const start = source.indexOf(startMarker);
	if (start === -1) {
		throw new Error(`Penanda awal tidak ditemukan: ${startMarker}`);
	}

	// Fungsi yang mengikuti sebuah wilayah berbeda antar basis kode — template
	// tidak memiliki setiap fungsi penyembuh yang ada di aplikasi turunannya.
	// Kandidat pertama yang ditemukan dipakai, sehingga menambah atau menghapus
	// fungsi yang tidak berkaitan tidak merusak ekstraksi.
	const candidates = typeof endMarkers === "string" ? [endMarkers] : endMarkers;
	let end = -1;
	for (const marker of candidates) {
		const found = source.indexOf(marker, start + startMarker.length);
		if (found !== -1 && (end === -1 || found < end)) end = found;
	}
	if (end === -1) {
		throw new Error(
			`Penanda akhir tidak ditemukan (dicoba: ${candidates.join(", ")})`,
		);
	}
	return source.slice(start, end);
}

function collectDdlFromRegion(region: string, allowBatch = false): string[] {
	const statements: string[] = [];
	for (const literal of extractStringLiterals(region)) {
		const isDdl = allowBatch
			? DDL_PREFIX.test(literal) || DDL_ANYWHERE.test(literal)
			: DDL_PREFIX.test(literal);
		if (!isDdl) continue;
		if (RUST_TEMPLATE_PLACEHOLDER.test(literal)) continue;
		statements.push(literal.trim());
	}
	return statements;
}

/**
 * DDL provisioning cloud (`turso.rs`).
 *
 * Dua wilayah: `ensure_schema` (seluruh tabel, indeks, dan ALTER penyembuh) dan
 * `ensure_sync_pulse` (tabel penghitung perubahan). `repair_web_owned_tables`
 * SENGAJA tidak ikut — ia membuat ulang tabel yang sama tanpa `IF NOT EXISTS`
 * setelah DROP, sehingga menjalankannya di sini hanya menghasilkan "table
 * already exists". Definisinya diperiksa terpisah lewat `collectRepairDdl`.
 */
export function collectCloudDdl(tursoSource: string): string[] {
	const statements = [
		...collectDdlFromRegion(
			sliceRegion(tursoSource, "pub async fn ensure_schema(", [
				"async fn repair_web_owned_tables(",
				"async fn ensure_sync_pulse(",
			]),
		),
		...collectDdlFromRegion(
			sliceRegion(tursoSource, "async fn ensure_sync_pulse(", [
				"async fn heal_schema(",
				"async fn ensure_schema_current(",
			]),
		),
	];

	if (statements.length === 0) {
		throw new Error(
			"Tidak ada satu pun statement DDL yang terbaca dari ensure_schema(). " +
				"Bentuk sumbernya kemungkinan berubah — perbarui ekstraktor ini.",
		);
	}

	return statements;
}

/**
 * DDL pembangunan ulang tabel milik Web (`repair_web_owned_tables`).
 *
 * `CREATE TABLE IF NOT EXISTS` tidak pernah memperbaiki tabel yang sudah ada,
 * jadi jalur repair inilah yang menentukan bentuk akhir `app_session` dan
 * `auth_login_rate_limit` pada database yang pernah salah di-provisioning. Bila
 * definisi di sini berbeda dari definisi di `ensure_schema`, database yang baru
 * dan database yang dipulihkan akan punya bentuk yang berlainan.
 */
export function collectRepairDdl(tursoSource: string): string[] {
	return collectDdlFromRegion(
		sliceRegion(tursoSource, "async fn repair_web_owned_tables(", [
			"async fn purge_legacy_rate_rows(",
			"async fn ensure_sync_pulse(",
		]),
	);
}

/**
 * DDL SQLite lokal perangkat (`storage.rs::initialize`).
 *
 * Berbeda dari `turso.rs`, DDL lokal ditulis sebagai batch multi-statement di
 * dalam `execute_batch`, sering diawali `PRAGMA`. Karena itu batch diterima apa
 * adanya dan dijalankan utuh — SQLite sendiri yang memisahkan statement-nya,
 * jauh lebih aman daripada memecah teks SQL pada tanda titik koma.
 */
export function collectLocalDdl(storageSource: string): string[] {
	const statements = collectDdlFromRegion(
		sliceRegion(
			storageSource,
			"pub fn initialize(",
			"pub fn reset_cloud_linked_data(",
		),
		true,
	);

	if (statements.length === 0) {
		throw new Error(
			"Tidak ada satu pun statement DDL yang terbaca dari storage.rs::initialize().",
		);
	}

	return statements;
}

/** Bangun struktur skema dengan benar-benar menjalankan DDL-nya. */
export function buildSchemaFromDdl(
	statements: string[],
	label: string,
): TableSchema {
	const db = new Database(":memory:");
	const failures: string[] = [];

	for (const statement of statements) {
		try {
			db.run(statement);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// `ADD COLUMN` untuk kolom yang sudah lahir dari `CREATE TABLE` ditolak
			// SQLite. Itu bukan kesalahan: di produksi `ensure_column` memeriksa
			// keberadaan kolom lebih dulu dan melewatinya.
			if (/duplicate column name/i.test(message)) continue;
			const preview = statement.slice(0, 110).replace(/\s+/g, " ");
			failures.push(`${message}\n        SQL: ${preview}…`);
		}
	}

	if (failures.length > 0) {
		db.close();
		throw new Error(
			`DDL ${label} gagal dijalankan di SQLite:\n      - ${failures.join("\n      - ")}`,
		);
	}

	const schema = readSchema(db);
	db.close();
	return schema;
}

export function buildCloudSchema(tursoSource: string): TableSchema {
	return buildSchemaFromDdl(collectCloudDdl(tursoSource), "cloud (turso.rs)");
}

export function buildRepairSchema(tursoSource: string): TableSchema {
	return buildSchemaFromDdl(collectRepairDdl(tursoSource), "repair (turso.rs)");
}

export function buildLocalSchema(storageSource: string): TableSchema {
	return buildSchemaFromDdl(
		collectLocalDdl(storageSource),
		"lokal (storage.rs)",
	);
}

/** Baca tabel dan kolom sebuah database lewat PRAGMA. */
export function readSchema(db: Database): TableSchema {
	const tables = db
		.query(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
		)
		.all() as { name: string }[];

	const schema: TableSchema = new Map();
	for (const table of tables) {
		const columns = db.query(`PRAGMA table_info("${table.name}");`).all() as {
			name: string;
		}[];
		schema.set(table.name, new Set(columns.map((column) => column.name)));
	}
	return schema;
}

/** Ubah JSON {tabel: [kolom]} menjadi struktur skema. */
export function schemaFromJson(raw: Record<string, string[]>): TableSchema {
	return new Map(
		Object.entries(raw).map(([table, columns]) => [table, new Set(columns)]),
	);
}

export interface SchemaDiff {
	missingTables: string[];
	extraTables: string[];
	columnDiffs: { table: string; missing: string[]; extra: string[] }[];
}

/**
 * Bandingkan dua struktur skema.
 *
 * "missing" berarti ada di `expected` tapi tidak di `actual`. Tabel yang hanya
 * dimiliki salah satu sisi dilaporkan terpisah dari selisih kolom, supaya satu
 * tabel yang belum dibuat tidak menenggelamkan laporan dengan puluhan kolom
 * yang "hilang". `onlyTables` membatasi perbandingan pada himpunan tabel yang
 * memang dimiliki kedua sisi.
 */
export function diffSchema(
	expected: TableSchema,
	actual: TableSchema,
	onlyTables?: Set<string>,
): SchemaDiff {
	const relevant = (name: string) => !onlyTables || onlyTables.has(name);

	const missingTables = [...expected.keys()]
		.filter((table) => relevant(table) && !actual.has(table))
		.sort();
	const extraTables = [...actual.keys()]
		.filter((table) => relevant(table) && !expected.has(table))
		.sort();

	const columnDiffs: SchemaDiff["columnDiffs"] = [];
	for (const [table, expectedColumns] of expected) {
		if (!relevant(table)) continue;
		const actualColumns = actual.get(table);
		if (!actualColumns) continue;

		const missing = [...expectedColumns]
			.filter((column) => !actualColumns.has(column))
			.sort();
		const extra = [...actualColumns]
			.filter((column) => !expectedColumns.has(column))
			.sort();
		if (missing.length > 0 || extra.length > 0) {
			columnDiffs.push({ table, missing, extra });
		}
	}

	return { missingTables, extraTables, columnDiffs };
}

export function isDiffClean(diff: SchemaDiff): boolean {
	return (
		diff.missingTables.length === 0 &&
		diff.extraTables.length === 0 &&
		diff.columnDiffs.length === 0
	);
}
