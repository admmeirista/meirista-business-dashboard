// Pembatalan & angka "Penjualan" versi Shopee Seller Centre.
// Definisi Seller Centre (2026): Penjualan = Harga Produk − Voucher/Diskon Penjual dari pesanan siap dikirim
// (non-COD sudah dibayar, COD dikonfirmasi) pada periode, TERMASUK pesanan yang kemudian dibatalkan/dikembalikan.
// "Siap dikirim" ≈ kolom Waktu Pembayaran Dilakukan (terisi juga untuk COD).
import type { Order } from '../types';
import { day, inRange, orderDate, type Filter, type Index } from './dataset';

const orderValue = (ix: Index, o: Order, cancelled: boolean) =>
  (cancelled ? ix.cancelledItems.get(o.orderNo) : ix.itemsByOrder.get(o.orderNo))?.reduce((t, i) => t + i.subtotal, 0) ?? 0;
/** Nilai versi Seller Centre: subtotal item − voucher penjual − paket diskon penjual. */
const shopeeValue = (ix: Index, o: Order, cancelled: boolean) => orderValue(ix, o, cancelled) - o.voucherSeller - o.bundleDiscountSeller;

export type CancelActor = 'Pembeli' | 'Sistem Shopee' | 'Penjual' | 'Lainnya';
const actorOf = (reason: string): CancelActor =>
  /oleh Pembeli/i.test(reason) ? 'Pembeli' : /sistem Shopee/i.test(reason) ? 'Sistem Shopee' : /oleh Penjual/i.test(reason) ? 'Penjual' : 'Lainnya';
const detailOf = (reason: string) => reason.replace(/^.*?Alasan:\s*/i, '').replace(/\.?\s*Kompensasi.*$/i, '').trim() || '(tanpa keterangan)';

/** Apakah seluruh periode tercakup export Semua Pesanan (tanpa itu pembatalan tidak diketahui). */
export function hasCancellationData(ix: Index, f: Filter) {
  return ix.allExportRanges.some((r) => r.from <= f.to && r.to >= f.from);
}

export interface Bridge { label: string; orders: number; value: number; note: string }

export function cancellationAnalysis(ix: Index, f: Filter) {
  const inPaid = (o: Order) => inRange(day(o.paidAt), f);
  const paidValid = ix.ds.orders.filter(inPaid);
  const paidCancelled = ix.cancelled.filter(inPaid);
  const failed = paidCancelled.filter((o) => !!o.shippedAt); // dibatalkan setelah dikirim = gagal kirim / ditolak
  const beforeShip = paidCancelled.filter((o) => !o.shippedAt);
  const unpaidCancelled = ix.cancelled.filter((o) => !o.paidAt && inRange(day(o.createdAt), f));
  const sum = (a: Order[], c: boolean) => a.reduce((t, o) => t + shopeeValue(ix, o, c), 0);

  const sellerCentre = { orders: paidValid.length + paidCancelled.length, value: sum(paidValid, false) + sum(paidCancelled, true) };
  const cancelled = { orders: paidCancelled.length, value: sum(paidCancelled, true) };

  // Jembatan ke omzet bersih (pesanan tidak batal). Bila basis omzet = Seller Centre, pembandingnya per tanggal kirim.
  const netBasis = f.basis === 'sc' ? 'shipped' : f.basis;
  const omzetOrders = ix.ds.orders.filter((o) => inRange(orderDate(ix, o, netBasis), f));
  const omzet = { orders: omzetOrders.length, value: omzetOrders.reduce((t, o) => t + orderValue(ix, o, false), 0) };
  const paidSet = new Set(paidValid.map((o) => o.orderNo));
  const omzetSet = new Set(omzetOrders.map((o) => o.orderNo));
  const inOnly = omzetOrders.filter((o) => !paidSet.has(o.orderNo));
  const outOnly = paidValid.filter((o) => !omzetSet.has(o.orderNo));
  const vouchers = paidValid.reduce((t, o) => t + o.voucherSeller + o.bundleDiscountSeller, 0);
  const bridge: Bridge[] = [
    { label: 'Penjualan Seller Centre', orders: sellerCentre.orders, value: sellerCentre.value, note: 'Pesanan dibayar/dikonfirmasi di periode ini, termasuk yang dibatalkan' },
    { label: 'Dibatalkan sebelum dikirim', orders: -beforeShip.length, value: -sum(beforeShip, true), note: 'Dibatalkan pembeli/sistem sebelum paket dikirim' },
    { label: 'Gagal kirim (batal setelah dikirim)', orders: -failed.length, value: -sum(failed, true), note: 'Paket sudah dikirim lalu dibatalkan, mis. COD ditolak / pengiriman gagal' },
    ...(vouchers ? [{ label: 'Voucher & paket diskon penjual', orders: 0, value: vouchers, note: 'Seller Centre mengurangi voucher penjual; omzet dashboard memakai subtotal item' }] : []),
    { label: 'Beda tanggal: masuk periode ini', orders: inOnly.length, value: inOnly.reduce((t, o) => t + orderValue(ix, o, false), 0), note: 'Dibayar sebelum periode, tetapi dikirim di periode ini' },
    { label: 'Beda tanggal: keluar periode ini', orders: -outOnly.length, value: -outOnly.reduce((t, o) => t + orderValue(ix, o, false), 0), note: 'Dibayar di periode ini, tetapi dikirim setelahnya (atau belum dikirim)' },
  ];
  const bridgeTotal = bridge.reduce((t, b) => ({ orders: t.orders + b.orders, value: t.value + b.value }), { orders: 0, value: 0 });

  // Alasan pembatalan
  const byReason = new Map<string, { actor: CancelActor; detail: string; orders: number; value: number; afterShip: number }>();
  for (const o of paidCancelled) {
    const k = o.cancelReason || '(tanpa keterangan)';
    const e = byReason.get(k) ?? { actor: actorOf(k), detail: detailOf(k), orders: 0, value: 0, afterShip: 0 };
    e.orders++; e.value += shopeeValue(ix, o, true); if (o.shippedAt) e.afterShip++;
    byReason.set(k, e);
  }
  const byActor = new Map<CancelActor, { orders: number; value: number }>();
  for (const r of byReason.values()) { const e = byActor.get(r.actor) ?? { orders: 0, value: 0 }; e.orders += r.orders; e.value += r.value; byActor.set(r.actor, e); }
  // Per metode pembayaran
  const byPay = new Map<string, { total: number; cancelled: number; failed: number }>();
  for (const o of [...paidValid, ...paidCancelled]) {
    const k = o.paymentMethod || '(kosong)';
    const e = byPay.get(k) ?? { total: 0, cancelled: 0, failed: 0 };
    e.total++;
    if (paidCancelled.includes(o)) { e.cancelled++; if (o.shippedAt) e.failed++; }
    byPay.set(k, e);
  }

  return {
    covered: hasCancellationData(ix, f), netBasis,
    sellerCentre, cancelled,
    cancelRate: sellerCentre.orders ? cancelled.orders / sellerCentre.orders : null,
    failed: { orders: failed.length, value: sum(failed, true) },
    beforeShip: { orders: beforeShip.length, value: sum(beforeShip, true) },
    unpaidCancelled: { orders: unpaidCancelled.length, value: sum(unpaidCancelled, true) },
    omzet, bridge, bridgeTotal, bridgeMatches: bridgeTotal.orders === omzet.orders && Math.abs(bridgeTotal.value - omzet.value) < 1,
    reasons: [...byReason.values()].sort((a, b) => b.orders - a.orders),
    actors: [...byActor.entries()].map(([actor, v]) => ({ actor, ...v })).sort((a, b) => b.orders - a.orders),
    payments: [...byPay.entries()].map(([method, v]) => ({ method, ...v, rate: v.total ? v.cancelled / v.total : 0 })).sort((a, b) => b.total - a.total),
  };
}
