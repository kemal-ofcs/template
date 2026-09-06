/**
 * Satu perintah yang menyatakan apakah template ini layak diserahkan.
 *
 * `check:quick` berhenti pada kegagalan pertama, dan itu memang yang diinginkan
 * saat sedang menulis kode. Tetapi saat MEMERIKSA template — sebelum menyalinnya
 * menjadi produk baru, atau setelah membawa perubahan dari produk turunan
 * kembali ke sini — berhenti di gerbang pertama menyembunyikan berapa banyak
 * yang sebenarnya rusak. Skrip ini menjalankan SEMUANYA, lalu melaporkan
 * seluruh kegagalannya sekaligus.
 *
 * Pemeriksaan identitas diperlakukan khusus. `verify-identity.ts` sengaja keluar
 * dengan kode 1 pada template yang belum di-rename — itu pengingat bagi
 * pemakainya, bukan cacat template. Di sini kedua keadaan itu dibedakan:
 * "belum di-rename" dilaporkan sebagai catatan, sementara sisa identitas produk
 * LAIN tetap dihitung sebagai kegagalan.
 *
 * `--rust` menambahkan `cargo test` kedua workspace. Dipisahkan karena
 * kompilasi Rust dingin memakan menit, sementara sisanya selesai dalam detik —
 * dan pemeriksaan yang terlalu lambat akan berhenti dijalankan orang.
 */

import { join } from "node:path";

const rootDir = join(__dirname, "..");
const withRust = process.argv.includes("--rust");

interface Gate {
	name: string;
	/** Perintah dan argumennya. */
	cmd: readonly string[];
	/** Direktori kerja, relatif terhadap akar template. */
	cwd?: string;
	/** Apa artinya bila gerbang ini gagal. */
	meaning: string;
	/**
	 * Penerjemah keluar-kode khusus, untuk gerbang yang keluar tidak-nol karena
	 * alasan yang bukan kegagalan.
	 */
	interpret?: (code: number, output: string) => Result;
}

type Result =
	| { status: "lulus"; note?: string }
	| { status: "catatan"; note: string }
	| { status: "gagal"; note?: string };

const GATES: readonly Gate[] = [
	{
		name: "Identitas produk",
		cmd: ["bun", "scripts/verify-identity.ts"],
		meaning:
			"Ada identitas produk lain yang bocor ke dalam template — sebuah tempat belum ikut digeneralisasi.",
		// Keluar-kode 1 punya DUA arti di skrip itu. Yang membedakan hanyalah
		// kalimatnya, jadi kalimat itulah yang dibaca. Menyamakan keduanya berarti
		// template yang bersih selamanya dilaporkan gagal, dan laporan yang selalu
		// merah berhenti dibaca orang.
		interpret: (code, output) => {
			if (code === 0) return { status: "lulus" };
			if (output.includes("BELUM DI-RENAME")) {
				return {
					status: "catatan",
					note: "Belum di-rename — wajar untuk template bersih. Jalankan `bun run rename` di salinan produknya.",
				};
			}
			return { status: "gagal" };
		},
	},
	{
		// Folder ini tidak dicakup biome.json workspace mana pun, sehingga selama
		// ini tidak pernah diperiksa apa pun — dan sebuah galat parse di
		// rename-project.ts sempat hidup di sana tanpa terdeteksi, membuat
		// `bun run rename` (pintu masuk utama template) mati total.
		name: "Skrip perkakas",
		cmd: ["bunx", "--bun", "biome", "check", "scripts/"],
		meaning:
			"Skrip di scripts/ tidak lolos parse atau lint. Perkakas yang rusak membuat template tidak bisa dipakai sama sekali.",
	},
	{
		name: "Audit skema empat lapis",
		cmd: ["bun", "scripts/schema-audit.ts"],
		meaning:
			"Definisi tabel/kolom berbeda antara storage.rs, turso.rs, dan db-schema.ts. Baris akan tersimpan di perangkat lalu ditolak cloud selamanya.",
	},
	{
		name: "Audit kontrak sinkronisasi",
		cmd: ["bun", "scripts/audit-sync-contract.ts"],
		meaning:
			"Route kanonik, tabel snapshot, permission, atau pendaftaran command tidak konsisten antar-workspace.",
	},
	{
		name: "web-desktop: lint + typecheck + test",
		cmd: ["bun", "run", "check:quick"],
		cwd: "web-desktop",
		meaning: "Workspace sumber kebenaran tidak lulus gerbang mutunya sendiri.",
	},
	{
		name: "mobile: lint + typecheck + test",
		cmd: ["bun", "run", "check:quick"],
		cwd: "mobile",
		meaning:
			"Workspace mobile tidak lulus. Bila penyebabnya kode bersama, perbaiki di web-desktop lalu `bun run sync:mobile`.",
	},
];

const RUST_GATES: readonly Gate[] = [
	{
		name: "web-desktop: cargo test",
		cmd: ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"],
		cwd: "web-desktop",
		meaning: "Uji Rust gagal di workspace sumber kebenaran.",
	},
	{
		name: "mobile: cargo test",
		cmd: ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"],
		cwd: "mobile",
		meaning: "Uji Rust gagal di workspace mobile.",
	},
];

function heading(title: string) {
	console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

const gates = withRust ? [...GATES, ...RUST_GATES] : GATES;
const failures: { gate: Gate; output: string }[] = [];
const notes: { gate: Gate; note: string }[] = [];

heading(
	`Verifikasi template — ${gates.length} gerbang${withRust ? "" : " (tanpa Rust; tambahkan --rust)"}`,
);

for (const gate of gates) {
	const started = Date.now();
	const spawned = Bun.spawnSync({
		cmd: [...gate.cmd],
		cwd: gate.cwd ? join(rootDir, gate.cwd) : rootDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = `${spawned.stdout.toString()}${spawned.stderr.toString()}`;
	const seconds = ((Date.now() - started) / 1000).toFixed(1);

	const result: Result = gate.interpret
		? gate.interpret(spawned.exitCode, output)
		: spawned.exitCode === 0
			? { status: "lulus" }
			: { status: "gagal" };

	if (result.status === "lulus") {
		console.log(`  ✅ ${gate.name}  (${seconds}s)`);
	} else if (result.status === "catatan") {
		console.log(`  ⚠️  ${gate.name}  (${seconds}s)`);
		console.log(`      ${result.note}`);
		notes.push({ gate, note: result.note });
	} else {
		console.log(`  ❌ ${gate.name}  (${seconds}s)`);
		failures.push({ gate, output });
	}
}

if (failures.length === 0) {
	heading("Hasil");
	console.log("🎉 Template siap dipakai sebagai dasar produk baru.");
	if (notes.length > 0) {
		console.log("\nCatatan:");
		for (const { gate, note } of notes) {
			console.log(`  • ${gate.name}: ${note}`);
		}
	}
	console.log(
		withRust
			? ""
			: "\nUji Rust belum dijalankan. Sebelum menyerahkan template, jalankan:\n  bun scripts/verify-template.ts --rust",
	);
	process.exit(0);
}

heading(`Hasil — ${failures.length} gerbang gagal`);
for (const { gate, output } of failures) {
	console.log(`\n❌ ${gate.name}`);
	console.log(`   ${gate.meaning}`);
	// Ekor keluarannya saja: pesan kegagalan yang berguna hampir selalu di akhir,
	// dan menumpahkan seluruh log build membuat ringkasan ini tidak terbaca.
	const tail = output.trimEnd().split("\n").slice(-25);
	console.log(tail.map((line) => `   │ ${line}`).join("\n"));
}
console.log("");
process.exit(1);
