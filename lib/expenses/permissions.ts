/**
 * Expense ownership is immutable: group roles and payment involvement
 * never confer permission to modify another person's invoice.
 */
export function canModifyExpense(createdBy: string, actorId: string): boolean {
  return createdBy.length > 0 && actorId.length > 0 && createdBy === actorId;
}
