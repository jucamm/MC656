import type { legislativeBills } from '../../db/schema';

export const freshnessMs = 24 * 60 * 60_000;
export type LegislativeBill = typeof legislativeBills.$inferSelect;
export type OfficialBill = Omit<LegislativeBill, 'id' | 'verified_at'>;
export type BillStatus = LegislativeBill['status'];
export const ufs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] as const;

export type KnownBill = Pick<OfficialBill, 'external_id' | 'number' | 'year'>;

export interface LegislativeSource {
  key: string;
  collect: (knownBills: KnownBill[], now: Date, signal?: AbortSignal, observeCacheAge?: (ms: number) => void) => Promise<OfficialBill[]>;
}

export function billIsSelectable(bill: Pick<LegislativeBill, 'status' | 'verified_at'>, now: Date) {
  const age = now.getTime() - bill.verified_at.getTime();
  return bill.status === 'in_progress' && age >= 0 && age <= freshnessMs;
}
