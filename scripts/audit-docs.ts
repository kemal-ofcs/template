import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Audit penyimpangan dokumen terhadap kode.
 *
 * `audit:schema` dan `audit:contract` membandingkan KODE dengan KODE. Tidak ada
 * satu pun gerbang yang membandingkan DOKUMEN dengan kode, sehingga klaim
 * seperti "lima langkah" bisa bertahan lama setelah langkahnya menjadi delapan —
 * dan dokumen yang bertentangan dengan kode lebih berbahaya daripada dokumen
 * yang diam, karena ia menuntun orang berikutnya mengulang bug yang sudah
 * diperbaiki.
 *
 * Prinsipnya sama seperti audit lain di repo ini: angka dan daftar DITURUNKAN
 * dari kode, lalu dokumen diwajibkan menyebut nilai yang sama. Tidak ada daftar
 * kedua yang harus dipelihara manusia.
 */

const projectRoot = resolve(import.meta.dir, "..");
const errors: string[] = [];
const notes: string[] = [];

function read(relativePath: string) {
	const path = resolve(projectRoot, relativePath);
	if (!existsSync(path)) {
		errors.push(`Berkas wajib tidak ditemukan: ${relativePath}`);
		return "";
	}
	return readFileSync(path, "utf8");
}

/** Dokumen yang wajib ikut mutakhir. */
const DOCS = ["CLAUDE.md", "AGENTS.md", "README.md"] as const;

const docText = new Map<string, string>();
for (const doc of DOCS) docText.set(doc, read(doc));

// ── Nilai yang diturunkan dari kode ────────────────────────────────────────

const syncRs = read("web-desktop/src-tauri/src/desktop/sync.rs");
const catalogTs = read("web-desktop/src/lib/rbac/catalog.ts");
const tursoRs = read("web-desktop/src-tauri/src/desktop/turso.rs");
const resetRoute = read("web-desktop/src/app/api/password-reset/route.ts");

function canonicalRouteCount() {
	const block = syncRs.match(
		/const CANONICAL_SYNC_ROUTES:[\s\S]*?=\s*&\[([\s\S]*?)\n\];/,
	)?.[1];
	return block ? [...block.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].length : 0;
}

function snapshotTableCount() {
	const block = syncRs.match(
		/const SNAPSHOT_TABLES:[\s\S]*?=\s*&\[([\s\S]*?)\n\];/,
	)?.[1];
	return block ? [...block.matchAll(/payload_key:/g)].length : 0;
}

function resetStepNames() {
	const block = resetRoute.match(/type ResetStep =([\s\S]*?);/)?.[1];
	return block
		? [...block.matchAll(/"([a-z-]+)"/g)].map((match) => match[1] as string)
		: [];
}

function sensitivePermissions() {
	const block = catalogTs.match(
		/SENSITIVE_MUTATION_PERMISSIONS = new Set<PermissionKey>\(\[([\s\S]*?)\n\]\)/,
	)?.[1];
	return block
		? [...block.matchAll(/"([a-z_.]+)"/g)].map((match) => match[1] as string)
		: [];
}

function databaseProviders() {
	const block = tursoRs.match(
		/pub enum DatabaseProvider \{([\s\S]*?)\n\}/,
	)?.[1];
	return block
		? [...block.matchAll(/^\s{4}([A-Z]\w+),/gm)].map(
				(match) => match[1] as string,
			)
		: [];
}

// ── Pemeriksaan ────────────────────────────────────────────────────────────

function fail(message: string) {
	errors.push(message);
}

/**
 * Dokumen yang MENGKLAIM sebuah angka wajib mengklaim angka yang benar.
 *
 * Dokumen yang hanya menyebut topiknya tanpa angka TIDAK disalahkan: memaksa
 * setiap dokumen mengulang angka yang sama justru memperbanyak tempat yang bisa
 * menyimpang. Yang berbahaya adalah angka yang salah, bukan angka yang absen.
 */
function assertCount(label: string, actual: number, claim: RegExp) {
	if (actual === 0) {
		fail(
			`${label}: tidak terbaca dari kode — ekstraktor audit ini perlu diperbarui.`,
		);
		return;
	}
	let checked = 0;
	for (const [doc, text] of docText) {
		for (const match of text.matchAll(claim)) {
			checked += 1;
			const stated = Number(match[1]);
			if (stated !== actual) {
				fail(
					`${doc}: menyebut "${match[0].trim()}" padahal kode punya ${actual}.`,
				);
			}
		}
	}
	if (checked > 0) {
		notes.push(`${label} = ${actual}, ${checked} klaim di dokumen cocok.`);
	} else {
		notes.push(`${label} = ${actual} (belum diklaim dokumen mana pun).`);
	}
}

assertCount(
	"jumlah rute kanonik",
	canonicalRouteCount(),
	/(\d+)\s+(?:[\w-]+\s+){0,3}(?:canonical[\w -]*routes?|route kanonik|rute kanonik)/gi,
);

assertCount(
	"jumlah tabel snapshot",
	snapshotTableCount(),
	/(\d+)\s+(?:[\w-]+\s+){0,2}(?:tabel snapshot|snapshot tables?)/gi,
);

// Langkah alur reset: dokumen yang menyebut jumlahnya wajib benar.
{
	const steps = resetStepNames();
	if (steps.length === 0) {
		fail("Langkah alur reset tidak terbaca dari route handler.");
	} else {
		const ANGKA: Record<number, string> = {
			5: "lima",
			6: "enam",
			7: "tujuh",
			8: "delapan",
			9: "sembilan",
		};
		const benar = ANGKA[steps.length] ?? String(steps.length);
		for (const [doc, text] of docText) {
			const klaim = text.match(
				/Alur "Lupa Password"\s*\((\w+)\s+langkah/i,
			)?.[1];
			if (!klaim) continue;
			if (klaim.toLowerCase() !== benar) {
				fail(
					`${doc}: menyebut alur "Lupa Password" ${klaim} langkah, padahal route handler punya ${steps.length} (${steps.join(", ")}).`,
				);
			}
		}
		notes.push(`Alur reset ${steps.length} langkah: ${steps.join(", ")}.`);
	}
}

// Izin sensitif: setiap kunci wajib disebut minimal di satu dokumen aturan.
{
	const keys = sensitivePermissions();
	if (keys.length === 0) {
		fail("SENSITIVE_MUTATION_PERMISSIONS tidak terbaca dari catalog.ts.");
	} else {
		const gabungan = [...docText.values()].join("\n");
		const hilang = keys.filter((key) => !gabungan.includes(key));
		if (hilang.length > 0) {
			fail(
				`Izin sensitif tidak terdokumentasi di dokumen aturan mana pun: ${hilang.join(", ")}`,
			);
		} else {
			notes.push(`${keys.length} izin sensitif seluruhnya terdokumentasi.`);
		}
	}
}

// Provider database: dokumen yang membahas provider wajib menyebut ketiganya.
{
	const providers = databaseProviders();
	if (providers.length === 0) {
		fail("DatabaseProvider tidak terbaca dari turso.rs.");
	} else {
		const wire = providers.map((name) =>
			name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(),
		);
		// Pemicunya BUKAN frasa "provider database": dokumen bisa mengklaim
		// jumlah provider tanpa pernah memakai frasa itu, dan versi pertama
		// audit ini meloloskannya. Yang dipakai sekarang: dokumen yang menyebut
		// DUA nama provider dianggap sedang membahas daftarnya, jadi wajib
		// menyebut ketiganya.
		const ANGKA: Record<string, number> = {
			satu: 1,
			dua: 2,
			tiga: 3,
			empat: 4,
		};
		// Dicari dalam BACKTICK, bukan sebagai teks bebas: "turso.rs" dan
		// "Turso Cloud" bukan penyebutan nilai provider, dan menghitungnya
		// membuat dokumen yang hanya merujuk berkasnya ikut dituduh.
		const menyebut = (text: string, name: string) =>
			text.includes(`\`${name}\``);
		for (const [doc, text] of docText) {
			const disebut = wire.filter((name) => menyebut(text, name));
			if (disebut.length >= 2 && disebut.length < wire.length) {
				const hilang = wire.filter((name) => !menyebut(text, name));
				fail(
					`${doc}: menyebut ${disebut.join(", ")} tetapi tidak ${hilang.join(", ")} — daftar provider tidak lengkap.`,
				);
			}
			// Klaim jumlah yang dieja huruf maupun angka.
			for (const match of text.matchAll(
				/[Pp]rovider(?:\s+\w+){0,2}\s+(satu|dua|tiga|empat|\d+)\b|\b(satu|dua|tiga|empat|\d+)\s+provider/gi,
			)) {
				const ejaan = (match[1] ?? match[2] ?? "").toLowerCase();
				const jumlah = ANGKA[ejaan] ?? Number(ejaan);
				if (Number.isFinite(jumlah) && jumlah !== wire.length) {
					fail(
						`${doc}: mengklaim ${jumlah} provider ("${match[0].trim()}"), padahal kode punya ${wire.length}.`,
					);
				}
			}
		}
		notes.push(`${wire.length} provider database: ${wire.join(", ")}.`);
	}
}

// Berkas yang dirujuk dokumen harus benar-benar ada.
{
	const RUJUKAN =
		/`((?:src|web-desktop|mobile|scripts|\.agents)[\w./-]*\.(?:ts|tsx|rs|md|json|toml))`/g;
	for (const [doc, text] of docText) {
		const hilang = new Set<string>();
		for (const match of text.matchAll(RUJUKAN)) {
			const rujukan = match[1] as string;
			// Rujukan relatif terhadap workspace juga sah; coba ketiga bentuknya.
			const kandidat = [rujukan, `web-desktop/${rujukan}`, `mobile/${rujukan}`];
			if (!kandidat.some((path) => existsSync(resolve(projectRoot, path)))) {
				hilang.add(rujukan);
			}
		}
		if (hilang.size > 0) {
			fail(`${doc}: merujuk berkas yang tidak ada — ${[...hilang].join(", ")}`);
		}
	}
}

// ── Laporan ────────────────────────────────────────────────────────────────

console.log("Audit Penyimpangan Dokumen\n");
if (errors.length > 0) {
	console.log("AUDIT DOCS: GAGAL");
	for (const error of errors) console.log(`- ${error}`);
	process.exit(1);
}
console.log("AUDIT DOCS: LULUS");
for (const note of notes) console.log(`- ${note}`);
