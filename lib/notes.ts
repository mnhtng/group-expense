/** Shared optional note validation for domain workflows. */
export function optionalNote(value: unknown, maxLength = 1000): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Ghi chú tối đa ${maxLength} ký tự.`);
  }
  const note = value.trim();
  return note || null;
}
