export const CONDITION_OPERATORS: readonly string[] = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'ne',
  'crossing',
];

export function thresholdMet(
  op: string,
  reading: number,
  threshold: number,
  last: number | null,
): boolean {
  switch (op) {
    case 'gt':
      return reading > threshold;
    case 'gte':
      return reading >= threshold;
    case 'lt':
      return reading < threshold;
    case 'lte':
      return reading <= threshold;
    case 'eq':
      return reading === threshold;
    case 'ne':
      return reading !== threshold;
    case 'crossing':
      if (last == null) return false;
      return (
        (last <= threshold && reading > threshold) || (last >= threshold && reading < threshold)
      );
    default:
      return false;
  }
}
