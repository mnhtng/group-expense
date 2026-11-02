/**
 * Exact currency math for VND (1 minor unit = 1 dong).
 * Keep bigint in domain logic; use decimal strings across JSON boundaries.
 */
export function sumMinorUnits(amounts: readonly bigint[]): bigint {
  return amounts.reduce((sum, amount) => sum + amount, 0n);
}

/** Allocate without floating-point errors, with stable tie-breaking by user ID. */
export function allocateEvenly(
  totalMinor: bigint,
  participantIds: readonly string[],
): ReadonlyMap<string, bigint> {
  if (typeof totalMinor !== "bigint" || totalMinor < 0n) {
    throw new RangeError("Total must be a non-negative bigint amount.");
  }
  if (participantIds.length === 0) {
    throw new RangeError("At least one participant is required.");
  }
  if (
    participantIds.some((id) => typeof id !== "string" || id.trim().length === 0) ||
    new Set(participantIds).size !== participantIds.length
  ) {
    throw new RangeError("Participant IDs must be nonempty and unique.");
  }
  const sortedIds = [...participantIds].sort();
  const count = BigInt(sortedIds.length);
  const base = totalMinor / count;
  const remainder = totalMinor % count;
  return new Map(
    sortedIds.map((id, index) => [
      id,
      base + (BigInt(index) < remainder ? 1n : 0n),
    ]),
  );
}
