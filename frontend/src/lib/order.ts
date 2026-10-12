/**
 * Sort items by a saved order of keys. Items in `order` come first, in that
 * order; the rest keep their original relative order after them, so newly
 * added things show up at the end.
 */
export function applyOrder<T>(items: T[], keyOf: (item: T) => string, order: readonly string[] = []): T[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
