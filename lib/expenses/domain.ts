import { allocateEvenly } from "@/lib/money";

export const MAX_VND = 9_223_372_036_854_775_807n;
export type ShareInput = { userId: string; amountMinor: string };
export type ItemInput = {
  name: string;
  quantity: number;
  unitPriceMinor: string;
  participants: string[];
  shares?: ShareInput[]; // exact override; omit for equal split
};
export type ExpenseInput = {
  title: string;
  notes?: string;
  occurredOn: string;
  payerId: string;
  items: ItemInput[];
};
export type PreparedItem = {
  name: string;
  quantity: number;
  unitPriceMinor: string;
  amountMinor: string;
  shares: { userId: string; amountMinor: string }[];
};
export type PreparedExpense = {
  title: string;
  notes: string;
  occurredOn: string;
  payerId: string;
  totalMinor: string;
  items: PreparedItem[];
};

export class ExpenseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpenseValidationError";
  }
}

export function parseVnd(value: unknown, label: string, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ExpenseValidationError(`${label} phải là số nguyên VND không âm.`);
  }
  const amount = BigInt(value);
  if (amount > MAX_VND || (!allowZero && amount === 0n)) {
    throw new ExpenseValidationError(`${label} không hợp lệ hoặc vượt giới hạn PostgreSQL BIGINT.`);
  }
  return amount;
}

function validDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const date = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === input;
}

export function prepareExpense(input: ExpenseInput, members: readonly string[]): PreparedExpense {
  if (!input || typeof input !== "object") throw new ExpenseValidationError("Hóa đơn không hợp lệ.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (!title || title.length > 160) throw new ExpenseValidationError("Tiêu đề phải dài 1–160 ký tự.");
  if (notes.length > 1000) throw new ExpenseValidationError("Ghi chú tối đa 1000 ký tự.");
  if (typeof input.occurredOn !== "string" || !validDate(input.occurredOn)) {
    throw new ExpenseValidationError("Ngày chi tiêu không hợp lệ.");
  }
  if (!Array.isArray(members) || members.length === 0 || !members.includes(input.payerId)) {
    throw new ExpenseValidationError("Người thanh toán không thuộc nhóm.");
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    throw new ExpenseValidationError("Hóa đơn cần từ 1 đến 50 món.");
  }
  const memberSet = new Set(members);
  const prepared: PreparedItem[] = [];
  let total = 0n;
  for (const [index, item] of input.items.entries()) {
    const label = `Món ${index + 1}`;
    if (!item || typeof item !== "object") throw new ExpenseValidationError(`${label} không hợp lệ.`);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || name.length > 160) throw new ExpenseValidationError(`${label} cần tên từ 1 đến 160 ký tự.`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) {
      throw new ExpenseValidationError(`${label}: số lượng không hợp lệ.`);
    }
    const price = parseVnd(item.unitPriceMinor, `${label}: đơn giá`);
    const amount = price * BigInt(item.quantity);
    if (amount > MAX_VND) throw new ExpenseValidationError(`${label} vượt giới hạn số tiền.`);
    if (!Array.isArray(item.participants) || !item.participants.length ||
        item.participants.length > members.length ||
        item.participants.some(id => typeof id !== "string" || !memberSet.has(id)) ||
        new Set(item.participants).size !== item.participants.length) {
      throw new ExpenseValidationError(`${label}: danh sách người chia không hợp lệ.`);
    }
    let shares: ShareInput[];
    if (item.shares !== undefined) {
      if (!Array.isArray(item.shares) || item.shares.length !== item.participants.length ||
          new Set(item.shares.map(x => x.userId)).size !== item.shares.length ||
          item.shares.some(x => !item.participants.includes(x.userId))) {
        throw new ExpenseValidationError(`${label}: các phần chia không khớp người tham gia.`);
      }
      let allocated = 0n;
      shares = item.shares.map(s => {
        const share = parseVnd(s.amountMinor, `${label}: phần chia`, true);
        allocated += share;
        return { userId: s.userId, amountMinor: share.toString() };
      });
      if (allocated !== amount) throw new ExpenseValidationError(`${label}: tổng phần chia phải đúng bằng tiền món.`);
      shares.sort((a,b) => a.userId.localeCompare(b.userId, "en"));
    } else {
      shares = [...allocateEvenly(amount, item.participants)].map(([userId, minor]) => ({
        userId, amountMinor: minor.toString()
      }));
    }
    total += amount;
    if (total > MAX_VND) throw new ExpenseValidationError("Tổng hóa đơn vượt giới hạn số tiền.");
    prepared.push({
      name, quantity: item.quantity, unitPriceMinor: price.toString(),
      amountMinor: amount.toString(), shares
    });
  }
  return { title, notes, occurredOn: input.occurredOn, payerId: input.payerId,
    totalMinor: total.toString(), items: prepared };
}
