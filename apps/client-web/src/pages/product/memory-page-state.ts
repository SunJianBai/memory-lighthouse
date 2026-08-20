export type MemoryFormScope = Readonly<{
  key: string;
  householdId: string;
  recipientId: string;
}>;

export const createMemoryFormScope = (
  key: string,
  householdId: string,
  recipientId: string,
): MemoryFormScope => ({ key, householdId, recipientId });

export const isMemoryFormScopeCurrent = (
  formScope: MemoryFormScope | null,
  currentScopeKey: string,
): formScope is MemoryFormScope => formScope?.key === currentScopeKey;

export const mergeMemoryPage = <T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
  append: boolean,
): T[] => {
  const merged = append ? [...current] : [];
  const indexes = new Map(merged.map((item, index) => [item.id, index]));

  for (const item of incoming) {
    const existingIndex = indexes.get(item.id);
    if (existingIndex === undefined) {
      indexes.set(item.id, merged.length);
      merged.push(item);
    } else {
      merged[existingIndex] = item;
    }
  }

  return merged;
};
