import { describe, expect, it } from 'vitest';
import { monthRange, periodKind, previousPeriod, quarterRange, stepPeriod, yearAgo, yearRange } from '../src/data';
import { bucketize } from '../src/components/charts';

describe('periode multi-tahun', () => {
  it('mengenali bulan, kuartal, tahun, dan rentang bebas', () => {
    expect(periodKind(monthRange('2026-02'))).toEqual({ kind: 'month', y: 2026, m: 2 });
    expect(monthRange('2024-02').to).toBe('2024-02-29');
    expect(periodKind(quarterRange(2025, 4))).toEqual({ kind: 'quarter', y: 2025, q: 4 });
    expect(periodKind(yearRange(2025))).toEqual({ kind: 'year', y: 2025 });
    expect(periodKind({ from: '2026-01-05', to: '2026-03-01' })).toEqual({ kind: 'custom' });
  });
  it('periode sebelumnya mengikuti bentuknya, termasuk lintas tahun', () => {
    expect(previousPeriod(monthRange('2026-01'))).toEqual(monthRange('2025-12'));
    expect(previousPeriod(quarterRange(2026, 1))).toEqual(quarterRange(2025, 4));
    expect(previousPeriod(yearRange(2026))).toEqual(yearRange(2025));
    expect(previousPeriod({ from: '2026-03-11', to: '2026-03-20' })).toEqual({ from: '2026-03-01', to: '2026-03-10' });
    expect(stepPeriod(monthRange('2025-12'), 1)).toEqual(monthRange('2026-01'));
    expect(stepPeriod(quarterRange(2025, 4), 1)).toEqual(quarterRange(2026, 1));
  });
  it('tahun lalu (YoY) menangani 29 Februari', () => {
    expect(yearAgo(monthRange('2024-02'))).toEqual({ from: '2023-02-01', to: '2023-02-28' });
    expect(yearAgo(quarterRange(2026, 2))).toEqual(quarterRange(2025, 2));
  });
});

describe('pengelompokan grafik', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), v: 1 }));
  it('harian ≤ 62 hari, mingguan ≤ 190 hari, bulanan selebihnya — total tetap', () => {
    expect(bucketize(days(31), (r) => ({ v: r.v })).unit).toBe('harian');
    const w = bucketize(days(120), (r) => ({ v: r.v }));
    expect(w.unit).toBe('mingguan');
    expect(w.rows.reduce((t, r) => t + r.v, 0)).toBe(120);
    const m = bucketize(days(365), (r) => ({ v: r.v }));
    expect(m.unit).toBe('bulanan');
    expect(m.rows).toHaveLength(12);
    expect(m.rows[1]).toEqual({ d: 'Feb 2025', v: 28 });
  });
});
