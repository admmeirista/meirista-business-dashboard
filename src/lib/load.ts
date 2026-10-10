import type { BizDb } from './db';
import type { Dataset } from './metrics/dataset';

export async function loadDataset(db: BizDb): Promise<Dataset> {
  const [orders, items, returns, returnLines, reports, income, adjustments, sellerFees, discrepancies, products, mappings, costs, batches, files, checks] = await Promise.all([
    db.orders.toArray(), db.items.toArray(), db.returns.toArray(), db.returnLines.toArray(), db.reports.toArray(), db.income.toArray(),
    db.adjustments.toArray(), db.sellerFees.toArray(), db.discrepancies.toArray(), db.products.toArray(), db.mappings.toArray(), db.costs.toArray(),
    db.batches.orderBy('importedAt').reverse().toArray(), db.files.toArray(), db.checks.toArray(),
  ]);
  return { orders, items, returns, returnLines, reports, income, adjustments, sellerFees, discrepancies, products, mappings, costs, batches, files, checks };
}
