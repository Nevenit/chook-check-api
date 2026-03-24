export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function promoFrequency(
  promoTypes: (string | null)[],
): Record<string, number> {
  if (promoTypes.length === 0) return {};
  const counts: Record<string, number> = {};
  for (const type of promoTypes) {
    const key = type ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const total = promoTypes.length;
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    result[key] = count / total;
  }
  return result;
}

export function trendChange(
  currentMedian: number,
  previousMedian: number,
): { changePercent: number; direction: "up" | "down" } {
  if (previousMedian === 0) {
    return { changePercent: 0, direction: "up" };
  }
  const changePercent =
    ((currentMedian - previousMedian) / previousMedian) * 100;
  return {
    changePercent,
    direction: changePercent >= 0 ? "up" : "down",
  };
}
