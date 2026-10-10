import Dexie, { type Table } from 'dexie';
import type {
  Adjustment, CostEntry, ImportBatch, IncomeRecord, IncomeReport, Order, OrderItem, Product, RawRow,
  ReturnLine, ReturnRequest, SellerFee, ShippingDiscrepancy, SkuMapping,
} from './types';
import type { Rejected, TotalCheck } from './parse/common';

export interface ImportedFile { hash: string; name: string; kind: string; batchId: number; importedAt: string; part: number | null; partsTotal: number | null; periodFrom: string | null; periodTo: string | null }
export interface StoredCheck extends TotalCheck { id?: number; batchId: number }
export interface StoredRejected extends Rejected { id?: number; batchId: number }
export interface Setting { key: string; value: unknown }

/** Database lokal di browser (IndexedDB). Data tidak pernah dikirim ke server. */
export class BizDb extends Dexie {
  batches!: Table<ImportBatch, number>;
  files!: Table<ImportedFile, string>;
  raw!: Table<RawRow, number>;
  checks!: Table<StoredCheck, number>;
  rejected!: Table<StoredRejected, number>;
  orders!: Table<Order, string>;
  items!: Table<OrderItem, string>;
  returns!: Table<ReturnRequest, string>;
  returnLines!: Table<ReturnLine, string>;
  reports!: Table<IncomeReport, string>;
  income!: Table<IncomeRecord, string>;
  adjustments!: Table<Adjustment, string>;
  sellerFees!: Table<SellerFee, string>;
  discrepancies!: Table<ShippingDiscrepancy, string>;
  products!: Table<Product, number>;
  mappings!: Table<SkuMapping, string>;
  costs!: Table<CostEntry, number>;
  settings!: Table<Setting, string>;

  constructor(name = 'meirista-bi') {
    super(name);
    this.version(1).stores({
      batches: '++id, kind, importedAt',
      files: 'hash, kind, batchId',
      raw: '++id, batchId',
      checks: '++id, batchId',
      rejected: '++id, batchId',
      orders: 'orderNo, createdAt, completedAt, buyer, batchId',
      items: 'id, orderNo, productKey',
      returns: 'returnNo, orderNo, requestedAt, batchId',
      returnLines: 'id, returnNo, orderNo',
      reports: 'id, batchId',
      income: 'id, recordType, orderNo, releaseDate, reportId, batchId',
      adjustments: 'id, orderNo, reportId, batchId',
      sellerFees: 'id, orderNo, reportId, batchId',
      discrepancies: 'id, orderNo, reportId, batchId',
      products: '++id, name, brand, category',
      mappings: 'listingKey, productId',
      costs: '++id, productId, effectiveFrom',
      settings: 'key',
    });
  }
}

export const DATA_TABLES = ['orders', 'items', 'returns', 'returnLines', 'reports', 'income', 'adjustments', 'sellerFees', 'discrepancies'] as const;
export const MASTER_TABLES = ['products', 'mappings', 'costs'] as const;
export const AUDIT_TABLES = ['batches', 'files', 'raw', 'checks', 'rejected'] as const;

let _db: BizDb | null = null;
export const db = () => (_db ??= new BizDb());
export const setDb = (d: BizDb) => { _db = d; };
