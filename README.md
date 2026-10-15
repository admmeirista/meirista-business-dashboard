# Meirista Business Dashboard — Shopee BI

Dashboard Business Intelligence untuk toko Shopee **meirista_shop**. Laporan Excel asli Shopee diimport langsung (tanpa konversi JSON),
dinormalisasi, divalidasi terhadap total di laporan asli, lalu dianalisis. Tampilan memakai sistem visual yang sama dengan
**Meirista Fulfillment System** (Nunito, sidebar gelap, aksen oranye).

**Arsitektur:** aplikasi statis (React + Vite + TypeScript) di **GitHub Pages**. Semua data diproses dan disimpan **di browser pengguna**
(IndexedDB), jadi tidak ada server, dan file Shopee tidak pernah masuk ke GitHub. Laporan Pengembalian memuat nomor telepon & alamat pembeli
tanpa disamarkan, jadi kolom tersebut juga tidak disimpan di database lokal.

| Menu | Isi |
|---|---|
| Ringkasan Eksekutif | GMV, pesanan, AOV, pembeli, dana dilepas, biaya marketplace, refund, laba kotor + peringatan kelengkapan data |
| Penjualan | per Produk / Listing & variasi / Brand / Kategori / Pelanggan |
| Pelanggan & RFM | pembeli baru vs kembali, kohort retensi, segmen RFM |
| Geografi · Metode Pembayaran | distribusi provinsi/kota, metode bayar & tingkat pengembalian per metode |
| Pengembalian | per pengajuan (No. Pengembalian) & baris produk, status, alasan, produk |
| Biaya Marketplace | breakdown per jenis biaya (struktur = Summary Shopee), penyesuaian terpisah |
| Rekonsiliasi | Summary vs detail, Penjualan ↔ Penghasilan lintas periode, laporan pengecualian, jejak per No. Pesanan |
| Profitabilitas | laba kotor per produk/brand/kategori (HPP berlaku per tanggal; HPP kosong ≠ 0) |
| Insight & Anomali | lonjakan/penurunan, produk tumbuh/turun, fee ekstrem, dana negatif, provinsi retur tinggi |
| Data | import multi-file, riwayat & log kesalahan, master produk/brand/kategori/pemetaan/HPP, rumus, backup |

Semua basis tanggal bisa dipilih: **Pesanan dibuat · Pembayaran · Pesanan selesai · Dana dilepas**. Rumus setiap metrik ada di menu
*Rumus & Validasi* (dan ikon ⓘ di setiap KPI).

---

## 1. Struktur proyek

```
src/lib/parse/         parser murni (dipakai browser & uji)
  util.ts              angka Rupiah Indonesia, tanggal, header berulang, hash
  detect.ts            deteksi jenis laporan dari nama file + isi, periode, part_n_of_m
  completed.ts         Order.completed.*.xlsx → header pesanan + item (multi-part digabung)
  returns.ts           Order.return_refund.*.xls(x) → pengajuan + baris produk
  income.ts            Income.sudah dilepas.*.xlsx → 6 sheet; Order vs Sku; validasi Summary/Adjustment
src/lib/pipeline.ts    parse semua unggahan per jenis laporan (berjalan di Web Worker)
src/lib/importer.ts    simpan ke IndexedDB: dedup file (SHA-256), upsert per No. Pesanan / No. Pengembalian, audit
src/lib/db.ts          skema IndexedDB (Dexie)
src/lib/fees.ts        pemetaan Summary Shopee ↔ kolom detail (grup biaya)
src/lib/metrics/       kalkulasi: analytics.ts, reconcile.ts, insights.ts, dataset.ts (basis tanggal, HPP)
src/pages/             halaman dashboard
tests/                 uji Vitest
fixtures/              file Shopee asli untuk uji lokal — DIABAIKAN git (.gitignore)
```

## 2. Pengembangan lokal

```bash
npm install
```

```bash
npm run dev
```

Buka http://localhost:5173.

## 3. Uji validasi (wajib sebelum mengubah logika keuangan)

Letakkan file Shopee asli di folder `fixtures/` (tidak ikut di-commit), lalu:

```bash
npm test
```

Uji memastikan data ternormalisasi mereproduksi total laporan Shopee, contoh periode Juli 2026:

| Pemeriksaan | Laporan Shopee | Hasil |
|---|---|---|
| 3. Total yang Dilepas | Rp 702.523.353 | sama |
| 1. Total Pendapatan / 2. Total Pengeluaran | Rp 819.948.804 / −Rp 117.425.451 | sama |
| Setiap baris biaya Summary (Administrasi, Proses Pesanan, XTRA, Layanan Promo XTRA, …) | — | sama |
| Total Penyesuaian (49 transaksi) | Rp 3.091.263 | sama |
| Pesanan Selesai Juni (2 part) | 10.799 baris → 9.322 pesanan, 706 multi-item | tanpa hitung ganda |
| Pengembalian | 65 baris → 59 pengajuan / 53 pesanan | granularitas terjaga |
| Lintas periode | 2.557 pesanan selesai Juni dilepas di laporan Juli; Harga Produk = Σ subtotal item | 0 selisih |

Tanpa folder `fixtures/` (mis. di GitHub Actions) uji file asli otomatis dilewati; uji sintetis (format angka, multi-part,
duplikat, kolom hilang) tetap berjalan.

## 4. Deploy ke GitHub Pages

Deploy otomatis lewat GitHub Actions (`.github/workflows/deploy.yml`): setiap push ke `main` → `npm ci` → `npm test` → `npm run build` → Pages.

Sekali saja:

1. Buat repo baru di GitHub (mis. `admmeirista/meirista-business-dashboard`). Repo **publik** aman karena tidak ada data di dalamnya;
   repo privat dengan Pages butuh GitHub Pro/Team.
2. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Hubungkan & push (login GitHub ditangani Git Credential Manager):
   ```bash
   git remote add origin https://github.com/admmeirista/meirista-business-dashboard.git
   ```
   ```bash
   git push -u origin main
   ```
4. Tab **Actions** → tunggu workflow hijau → URL: `https://admmeirista.github.io/meirista-business-dashboard/`.

Update berikutnya cukup `git push`.

> URL Pages bisa dibuka siapa pun, tetapi pengunjung hanya melihat dashboard kosong: data hanya ada di browser yang mengimportnya.
> Untuk memindahkan data ke komputer lain gunakan *Pengaturan & Backup → Unduh backup* lalu *Pulihkan* di komputer tujuan.
> File backup berisi transaksi & username pembeli — simpan aman, jangan di-commit.

## 5. Alur kerja bulanan (folder + data terenkripsi)

Data resmi dashboard berasal dari folder `data-inbox/` di komputer ini, dipublikasikan **terenkripsi** ke GitHub Pages.

| Folder | File |
|---|---|
| `data-inbox/order/` | `Order.all.*.xlsx` — Pesanan Saya › **Semua** › Export (semua part) |
| `data-inbox/retur/` | `Order.return_refund.*.xls(x)` |
| `data-inbox/income/` | `Income.sudah dilepas.*.xlsx` |

1. Sekali di awal, tentukan password data (disimpan di `.data-password`, hanya di komputer ini, tidak di-push):
   ```bash
   npm run data:password
   ```
2. Drop file export ke folder yang sesuai (simpan semua bulan, jangan dihapus).
3. Publikasikan — membaca semua file, memvalidasi total terhadap laporan Shopee, membuang data pribadi,
   mengenkripsi (AES-256-GCM, kunci PBKDF2-SHA256 600.000 iterasi), lalu commit & push **hanya** `public/data/bundle.bin`:
   ```bash
   npm run publish-data
   ```
   Publikasi dibatalkan bila ada total yang tidak cocok atau file salah folder (`-- --force` untuk tetap lanjut, `-- --no-push` untuk uji).
4. Buka dashboard → masukkan password sekali per perangkat (centang *Ingat di perangkat ini* agar paket berikutnya terbuka otomatis).
5. Petakan listing baru & isi HPP di *Produk & HPP* (master produk & HPP tersimpan per perangkat, tidak ikut paket).

Keamanan: file Excel di `data-inbox/` dan `.data-password` diabaikan git. Tanpa password, `bundle.bin` hanya berisi data acak.
Password tidak bisa dipulihkan — bila lupa, buat password baru (`npm run data:password`) lalu `npm run publish-data` ulang;
setiap perangkat cukup memasukkan password baru.

Import lewat halaman *Import & Backup* tetap tersedia untuk percobaan, tetapi akan diganti saat paket data berikutnya dimuat.

## 6. Keputusan desain penting

- **No. Pesanan** = kunci lintas laporan. Tidak diasumsikan bulan dibuat = bulan selesai = bulan dana dilepas = bulan refund.
- Nilai level pesanan (Total Pembayaran, voucher, ongkir) yang diulang di setiap baris item dihitung **sekali per pesanan**.
- Penghasilan: baris `Order` = total resmi; baris `Sku` = alokasi per produk (tidak dijumlahkan ke total). Tanda asli dipertahankan.
- `SKU Induk` & `Nomor Referensi SKU` kosong di seluruh export toko ini → pemetaan produk memakai **nama listing + variasi**.
- HPP tidak pernah diestimasi 0: item tanpa HPP tampil `n/a` dan cakupan HPP selalu ditampilkan.
- Tidak ada angka simulasi; semua angka berasal dari file yang diimport.
