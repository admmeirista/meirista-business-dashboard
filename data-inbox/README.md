# data-inbox — taruh file export Shopee di sini

| Folder | Isi | Export dari Seller Centre |
|---|---|---|
| `order/` | `Order.all.*.xlsx` (semua part) | Pesanan Saya › **Semua** › Export |
| `retur/` | `Order.return_refund.*.xls(x)` | Pesanan Saya › Pengembalian › Export |
| `income/` | `Income.sudah dilepas.*.xlsx` | Keuangan › Penghasilan Saya › Sudah Dilepas › Export |

- Simpan semua bulan (jangan dihapus) — paket data dibangun ulang dari seluruh isi folder setiap kali publish.
- Export ulang periode yang sama? Taruh saja file barunya; file yang paling baru diubah yang dipakai bila pesanannya sama.
- File di folder ini **tidak pernah di-commit/di-push** (diatur di `.gitignore`). Yang di-push hanya `public/data/bundle.bin` yang terenkripsi.

Publikasi:

```bash
npm run publish-data
```

Sekali saja di awal (menyimpan password di `.data-password`, hanya di komputer ini):

```bash
npm run data:password
```
