/**
 * Pembacaan `SNAPSHOT_TABLES` dari `sync.rs`.
 *
 * Daftar inilah yang menentukan kolom mana yang benar-benar melintasi batas
 * sinkronisasi. Sebuah kolom yang ikut sync tetapi hanya ada di salah satu sisi
 * bukan sekadar rapi-tidaknya dokumentasi: push akan gagal dengan "no such
 * column" pada perangkat yang tidak memilikinya, atau — lebih buruk — pull
 * menuliskan nilai ke kolom yang artinya berbeda.
 */

export interface SnapshotTableSpec {
	payloadKey: string;
	table: string;
	columns: string[];
}

/**
 * Ambil daftar tabel snapshot beserta kolom yang disinkronkan.
 *
 * Dibaca dari sumber Rust apa adanya supaya tidak ada daftar kedua yang harus
 * dipelihara manusia — daftar kedua persis cara drift dimulai.
 */
export function parseSnapshotTables(syncSource: string): SnapshotTableSpec[] {
	const start = syncSource.indexOf("const SNAPSHOT_TABLES");
	if (start === -1) {
		throw new Error("SNAPSHOT_TABLES tidak ditemukan di sync.rs");
	}
	const end = syncSource.indexOf("\n];", start);
	if (end === -1) {
		throw new Error("Akhir SNAPSHOT_TABLES tidak ditemukan di sync.rs");
	}

	const block = syncSource.slice(start, end);
	const specs: SnapshotTableSpec[] = [];

	for (const chunk of block.split("SnapshotTable {").slice(1)) {
		const payloadKey = chunk.match(/payload_key:\s*"([^"]+)"/)?.[1];
		const table = chunk.match(/table:\s*"([^"]+)"/)?.[1];
		const columnsBlock = chunk.match(/columns:\s*&\[([\s\S]*?)\]/)?.[1];

		if (!payloadKey || !table || columnsBlock === undefined) continue;

		const columns = [...columnsBlock.matchAll(/"([^"]+)"/g)].map(
			(match) => match[1],
		);
		specs.push({ payloadKey, table, columns });
	}

	if (specs.length === 0) {
		throw new Error(
			"Tidak ada satu pun entri SNAPSHOT_TABLES yang terbaca — bentuk sumbernya berubah.",
		);
	}

	return specs;
}
