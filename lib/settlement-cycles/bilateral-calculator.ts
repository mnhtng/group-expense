/**
 * BN-001 — PURE bilateral, two-member, one-cycle noncash set-off calculator.
 *
 * Zero dependencies: NO server-only, DB, network, clock, random values,
 * hashes, persistence, authorization, payments or proposal approval.
 * This is NOT authority to settle money. BN-002+ must fetch AND revalidate
 * these source values under the existing group/cycle/obligation locks.
 *
 * All financial inputs/outputs are canonical decimal strings. Computation
 * uses only bigint; aggregates can exceed PostgreSQL bigint even when each
 * original obligation (which is stored as bigint) cannot.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_MINOR = /^(0|[1-9][0-9]*)$/;
const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MAX_POSTGRES_MINOR = 9_223_372_036_854_775_807n;

export type BilateralCalculationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SCOPE"
  | "STALE_OR_INELIGIBLE_SOURCE"
  | "DUPLICATE_OBLIGATION"
  | "INVALID_MONEY";

export class BilateralCalculationError extends Error {
  readonly code: BilateralCalculationErrorCode;
  constructor(code: BilateralCalculationErrorCode, message: string) {
    super(message);
    this.name = "BilateralCalculationError";
    this.code = code;
  }
}

export type BilateralEligibleObligation = Readonly<{
  /** Original obligations.id, never an invoice ID or aggregate debt ID. */
  obligationId: string;
  groupId: string;
  cycleId: string;
  currency: "VND";
  debtorId: string;
  creditorId: string;
  /** Invoice local calendar day, already selected by the locked cycle. */
  occurredOn: string;
  /** Fail closed if the live invoice version differs from its source. */
  snapshotExpenseVersion: number;
  currentExpenseVersion: number;
  /** Must be proven from locked snapshot eligibility by the caller. */
  inLockedCycleSnapshot: boolean;
  /** Both the original obligation and invoice must still be active. */
  obligationVoided: boolean;
  expenseDeleted: boolean;
  originalMinor: string;
  confirmedCashMinor: string;
  pendingCashMinor: string;
  confirmedSetoffMinor: string;
  pendingSetoffMinor: string;
}>;

export type BilateralCalculatorInput = Readonly<{
  groupId: string;
  cycleId: string;
  cycleState: "locked";
  currency: "VND";
  partyAId: string;
  partyBId: string;
  obligations: readonly BilateralEligibleObligation[];
}>;

export type BilateralAllocation = Readonly<{
  obligationId: string;
  occurredOn: string;
  expenseVersion: number;
  availableBeforeMinor: string;
  setoffMinor: string;
  availableAfterMinor: string;
}>;

export type BilateralDirection = Readonly<{
  debtorId: string;
  creditorId: string;
  obligationCount: number;
  /** Includes pending reservations: pending is NOT paid. */
  outstandingMinor: string;
  pendingReservedMinor: string;
  availableBeforeMinor: string;
  hypotheticalSetoffMinor: string;
  availableAfterMinor: string;
  outstandingAfterHypotheticalSetoffMinor: string;
  /** Positive set-off lines only, in stable occurredOn/obligationId order. */
  allocations: BilateralAllocation[];
}>;

export type BilateralCalculation = Readonly<{
  kind: "BN-001_CALCULATION_ONLY";
  groupId: string;
  cycleId: string;
  currency: "VND";
  partyAId: string;
  partyBId: string;
  hasOffset: boolean;
  offsetMinor: string;
  /** Read-only, theoretical values, NEVER confirmed financial ledger. */
  aOwesB: BilateralDirection;
  bOwesA: BilateralDirection;
}>;

type CheckedObligation = {
  obligationId: string;
  occurredOn: string;
  expenseVersion: number;
  debtorId: string;
  creditorId: string;
  outstanding: bigint;
  reserved: bigint;
  available: bigint;
};

function invalid(code: BilateralCalculationErrorCode, detail: string): never {
  throw new BilateralCalculationError(code, detail);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}
function identifier(value: unknown, label: string, requireUuid = false): string {
  if (typeof value !== "string" || !value.length || value.length > 256 ||
      value.trim() !== value || (requireUuid && !UUID.test(value))) {
    invalid("INVALID_INPUT", `Invalid ${label}.`);
  }
  return value;
}
function checkedMinor(value: unknown, label: string, positive = false): bigint {
  // PG bigint columns have a 19-digit bound; do not parse arbitrarily long
  // attacker-controlled numeric strings or unsafe JS numbers.
  if (typeof value !== "string" || value.length > 19 ||
      !CANONICAL_MINOR.test(value)) {
    invalid("INVALID_MONEY", `Invalid integer minor units for ${label}.`);
  }
  const n = BigInt(value);
  if (n > MAX_POSTGRES_MINOR || (positive && n === 0n)) {
    invalid("INVALID_MONEY", `Out-of-range minor units for ${label}.`);
  }
  return n;
}
function validDay(value: unknown): value is string {
  return typeof value === "string" && ISO_DAY.test(value) &&
    value !== "0000-00-00" && (() => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
    })();
}
function version(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
function sum(rows: readonly CheckedObligation[], key: "outstanding"|"reserved"|"available"): bigint {
  return rows.reduce((total, row) => total + row[key], 0n);
}

function direction(rows: readonly CheckedObligation[], debtorId: string,
  creditorId: string, target: bigint): BilateralDirection {
  const ordered = rows.filter(row =>
    row.debtorId === debtorId && row.creditorId === creditorId)
    .sort((a, b) => compareStrings(a.occurredOn, b.occurredOn) ||
      compareStrings(a.obligationId, b.obligationId));
  const outstanding = sum(ordered, "outstanding");
  const reserved = sum(ordered, "reserved");
  const available = sum(ordered, "available");
  if (target > available) invalid("INVALID_MONEY",
    "Set-off exceeds available non-reserved obligations.");
  let remaining = target;
  const allocations: BilateralAllocation[] = [];
  for (const row of ordered) {
    if (remaining === 0n) break;
    const applied = min(remaining, row.available);
    if (applied === 0n) continue;
    remaining -= applied;
    allocations.push({
      obligationId: row.obligationId,
      occurredOn: row.occurredOn,
      expenseVersion: row.expenseVersion,
      availableBeforeMinor: row.available.toString(),
      setoffMinor: applied.toString(),
      availableAfterMinor: (row.available - applied).toString(),
    });
  }
  if (remaining !== 0n) invalid("INVALID_MONEY",
    "Set-off allocations did not conserve the source amount.");
  return {
    debtorId, creditorId, obligationCount: ordered.length,
    outstandingMinor: outstanding.toString(),
    pendingReservedMinor: reserved.toString(),
    availableBeforeMinor: available.toString(),
    hypotheticalSetoffMinor: target.toString(),
    availableAfterMinor: (available - target).toString(),
    outstandingAfterHypotheticalSetoffMinor: (outstanding - target).toString(),
    allocations,
  };
}

/**
 * Calculate WITHOUT writing or changing any real obligation.
 *
 * Callers must obtain complete live, authenticated, locked-cycle source rows
 * from canonical SQL. A boolean asserting membership in the snapshot is
 * validated here but is NOT a substitute for DB provenance/authorization.
 * BN-002+ will re-read financial state under locks before any proposal.
 */
export function calculateBilateralSetoff(input: BilateralCalculatorInput): BilateralCalculation {
  if (!object(input)) invalid("INVALID_INPUT", "A calculation input object is required.");
  const groupId = identifier(input.groupId, "groupId", true);
  const cycleId = identifier(input.cycleId, "cycleId", true);
  const partyAId = identifier(input.partyAId, "partyAId");
  const partyBId = identifier(input.partyBId, "partyBId");
  if (partyAId === partyBId || input.currency !== "VND" ||
      input.cycleState !== "locked" || !Array.isArray(input.obligations)) {
    invalid("INVALID_SCOPE", "Only two distinct members in one locked VND cycle are supported.");
  }

  const seen = new Set<string>();
  const checked: CheckedObligation[] = [];
  for (const raw of input.obligations) {
    if (!object(raw)) invalid("INVALID_INPUT", "An obligation must be an object.");
    const obligationId = identifier(raw.obligationId, "obligationId", true);
    if (seen.has(obligationId)) invalid("DUPLICATE_OBLIGATION",
      `Obligation ${obligationId} occurs more than once.`);
    seen.add(obligationId);
    if (raw.groupId !== groupId || raw.cycleId !== cycleId ||
        raw.currency !== "VND" ||
        !((raw.debtorId === partyAId && raw.creditorId === partyBId) ||
          (raw.debtorId === partyBId && raw.creditorId === partyAId))) {
      invalid("INVALID_SCOPE",
        "Foreign group/cycle/currency, self debt or third-party obligation.");
    }
    if (raw.inLockedCycleSnapshot !== true ||
        raw.obligationVoided !== false || raw.expenseDeleted !== false ||
        !version(raw.snapshotExpenseVersion) ||
        !version(raw.currentExpenseVersion) ||
        raw.snapshotExpenseVersion !== raw.currentExpenseVersion ||
        !validDay(raw.occurredOn)) {
      invalid("STALE_OR_INELIGIBLE_SOURCE",
        `Obligation ${obligationId} has invalid/stale source provenance.`);
    }
    const original = checkedMinor(raw.originalMinor,
      `${obligationId}.originalMinor`, true);
    const confirmedCash = checkedMinor(raw.confirmedCashMinor,
      `${obligationId}.confirmedCashMinor`);
    const pendingCash = checkedMinor(raw.pendingCashMinor,
      `${obligationId}.pendingCashMinor`);
    const confirmedSetoff = checkedMinor(raw.confirmedSetoffMinor,
      `${obligationId}.confirmedSetoffMinor`);
    const pendingSetoff = checkedMinor(raw.pendingSetoffMinor,
      `${obligationId}.pendingSetoffMinor`);
    const confirmed = confirmedCash + confirmedSetoff;
    if (confirmed > original) invalid("INVALID_MONEY",
      `Confirmed cash/set-off exceeds original obligation ${obligationId}.`);
    const outstanding = original - confirmed;
    const reserved = pendingCash + pendingSetoff;
    if (reserved > outstanding) invalid("INVALID_MONEY",
      `Pending reservations exceed live outstanding obligation ${obligationId}.`);
    checked.push({
      obligationId, occurredOn: raw.occurredOn,
      expenseVersion: raw.currentExpenseVersion,
      debtorId: raw.debtorId, creditorId: raw.creditorId,
      outstanding, reserved, available: outstanding - reserved,
    });
  }

  const aRows = checked.filter(row =>
    row.debtorId === partyAId && row.creditorId === partyBId);
  const bRows = checked.filter(row =>
    row.debtorId === partyBId && row.creditorId === partyAId);
  const offset = min(sum(aRows, "available"), sum(bRows, "available"));
  const aOwesB = direction(aRows, partyAId, partyBId, offset);
  const bOwesA = direction(bRows, partyBId, partyAId, offset);
  return {
    kind: "BN-001_CALCULATION_ONLY",
    groupId, cycleId, currency: "VND",
    partyAId, partyBId, hasOffset: offset > 0n,
    offsetMinor: offset.toString(),
    aOwesB, bOwesA,
  };
}
