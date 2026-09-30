export const TIMEFRAMES = [
  { value: 'm1', label: '1 Minute' },
  { value: 'm5', label: '5 Minutes' },
  { value: 'm15', label: '15 Minutes' },
  { value: 'm30', label: '30 Minutes' },
  { value: 'h1', label: '1 Hour' },
  { value: 'h2', label: '2 Hours' },
  { value: 'h4', label: '4 Hours' },
  { value: 'd1', label: '1 Day' },
  { value: 'w1', label: '1 Week' },
] as const;

export const INDICATORS = [
  { value: 'supertrend', label: 'SuperTrend' },
  { value: 'rollingsupertrend', label: 'Rolling SuperTrend' },
  { value: 'rollingsupertrend2', label: 'Rolling SuperTrend2' },
  { value: 'macd', label: 'MACD' },
  { value: 'ema', label: 'EMA Cross' },
  { value: 'ewt', label: 'EW Trading' },
  { value: 'pricelevel', label: 'Price Level' },
] as const;

export const DEFAULT_TP_RATIOS = [1, 2, 3, 4];

export const STATUS_STYLES: Record<string, string> = {
  pending: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  triggered: 'text-orange-400 bg-orange-900/20 border-orange-700/30',
  active: 'text-green-400 bg-green-900/20 border-green-700/30',
  closed: 'text-blue-400 bg-blue-900/20 border-blue-700/30',
  cancelled: 'text-red-400 bg-red-900/20 border-red-700/30',
};

export function parseTpPrices(tpPrices: string): number[] {
  try {
    return JSON.parse(tpPrices || '[1,2,3,4]') as number[];
  } catch {
    return [1, 2, 3, 4];
  }
}