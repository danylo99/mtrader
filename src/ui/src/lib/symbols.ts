import { engineFetch } from './api';

export interface SymbolOption {
  symbol: string;
  display: string;
}

export interface SymbolsMap {
  [exchange: string]: {
    symbols: SymbolOption[];
    assets: Asset[];
    intervals: string[];
  };
}

export interface Asset {
  id: string;
  display: string;
  symbol_ccxt: string;
  symbol_hyperliquid: string;
  provider: 'bybit' | 'twelvedata';
  symbol_twelvedata?: string;
}

let cachedSymbols: SymbolsMap | null = null;

async function getSymbolsMap(): Promise<SymbolsMap> {
  if (!cachedSymbols) {
    cachedSymbols = await engineFetch('/api/symbols') as SymbolsMap;
  }
  return cachedSymbols!;
}

export async function getSymbols(exchange: string): Promise<SymbolOption[]> {
  const map = await getSymbolsMap();
  return map[exchange]?.symbols || [];
}

export async function getExchanges(): Promise<string[]> {
  const map = await getSymbolsMap();
  return Object.keys(map);
}

export async function getAssets(): Promise<Asset[]> {
  const map = await getSymbolsMap();
  return ((map['hyperliquid']?.assets || []) as unknown) as Asset[];
}

export function assetFromSymbol(symbolCcxt: string, assets: Asset[]): Asset | undefined {
  return assets.find(a => a.symbol_ccxt === symbolCcxt);
}