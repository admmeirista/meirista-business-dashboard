import { describe, expect, it } from 'vitest';
import { buildIndex, emptyDataset } from '../src/lib/metrics/dataset';
import { monthlyCoverage, monthsWithData } from '../src/lib/coverage';
import type { ImportedFile } from '../src/lib/db';

const file = (kind: string, from: string, to: string, part: number | null = null, total: number | null = null): ImportedFile =>
  ({ hash: `${kind}${from}${part}`, name: 'x', kind, batchId: 1, importedAt: '', part, partsTotal: total, periodFrom: from, periodTo: to });

describe('kelengkapan data per bulan', () => {
  it('membaca periode file: retur bulanan, pesanan multi-part, penghasilan', () => {
    const ds = emptyDataset();
    ds.files = [
      // Shopee: retur "20250101_20250201" = Januari (1 hari Februari tidak dihitung).
      file('returns', '2025-01-01', '2025-02-01'),
      file('all', '2026-08-01', '2026-08-31', 1, 2), file('all', '2026-08-01', '2026-08-31', 2, 2),
      file('all', '2026-07-01', '2026-07-31', 1, 2), // part 2 belum ada
      file('completed', '2026-06-01', '2026-06-30'),
      file('income', '2026-07-01', '2026-07-31'),
    ];
    const rows = monthlyCoverage(buildIndex(ds), '2026-09');
    const by = Object.fromEntries(rows.map((r) => [r.month, r]));
    expect(rows[0].month).toBe('2026-09'); // terbaru di atas, sampai bulan berjalan
    expect(by['2025-01'].returns.status).toBe('full');
    expect(by['2025-02'].returns.status).toBe('none');
    expect(by['2026-08'].orders).toMatchObject({ status: 'full', source: 'all', missingParts: false });
    expect(by['2026-07'].orders).toMatchObject({ status: 'partial', missingParts: true });
    expect(by['2026-06'].orders).toMatchObject({ status: 'full', source: 'completed' });
    expect(by['2026-07'].income.status).toBe('full');
    expect(by['2026-09'].orders.status).toBe('none');
  });

  it('bulan dengan data retur saja tetap bisa dipilih di filter', () => {
    const ds = emptyDataset();
    ds.returns = [{ returnNo: 'R1', orderNo: 'O1', requestedAt: '2025-03-10 10:00' } as never];
    expect([...monthsWithData(buildIndex(ds))]).toEqual(['2025-03']);
  });
});
