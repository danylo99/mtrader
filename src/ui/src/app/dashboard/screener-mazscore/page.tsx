'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, BellOff, Save } from 'lucide-react';
import engineFetch from '@/lib/api';

const TF_ORDER = ['m5', 'm15', 'h1', 'h4', 'd1', 'w1'];

const METAL_SYMBOLS = new Set([
  'PAXG/USDT:USDT',
  'XAU/USDT:USDT',
  'XAG/USDT:USDT',
  'XAUT/USDT:USDT',
  'XAGUSD/USD:USD',
  'GOLD/USDT:USDT',
  'PAXG/USDC:USDC',
  'XAU/USDC:USDC',
  'XAG/USDC:USDC',
  'XAUT/USDC:USDC',
  'GOLD/USDC:USDC',
]);

function isMetal(symbol: string) {
  return METAL_SYMBOLS.has(symbol) || symbol.startsWith('XYZ');
}

function Dot({ extreme }: { extreme: string | null | undefined }) {
  if (!extreme) return null;
  const color = extreme === 'bullish' ? 'bg-green-400' : 'bg-red-400';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} ml-0.5`} />;
}

function ZScoreCell({ value, extreme }: { value: number | null; extreme?: string | null | undefined }) {
  if (value === null) {
    return <span className="text-slate-500 text-xs font-mono">—</span>;
  }
  const absVal = Math.abs(value);
  let color = 'text-slate-400';
  if (absVal >= 1.5) color = value > 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold';
  else if (absVal >= 1.0) color = value > 0 ? 'text-green-300' : 'text-red-300';
  else if (absVal >= 0.5) color = value > 0 ? 'text-green-200/70' : 'text-red-200/70';
  const bg = value > 0 ? (absVal >= 1.5 ? 'bg-green-500/10' : absVal >= 1.0 ? 'bg-green-500/5' : 'bg-green-500/[0.02]') : value < 0 ? (absVal >= 1.5 ? 'bg-red-500/10' : absVal >= 1.0 ? 'bg-red-500/5' : 'bg-red-500/[0.02]') : '';
  return (
    <span className={`${color} ${bg} text-xs font-mono px-1 py-0.5 rounded inline-flex items-center min-w-[3rem] justify-center`}>
      {value.toFixed(2)}
      <Dot extreme={extreme} />
    </span>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) {
  if (!active) return <span className="text-slate-600 ml-1">⇅</span>;
  return direction === 'asc' ? <span className="text-blue-400 ml-1">↑</span> : <span className="text-blue-400 ml-1">↓</span>;
}

function SectionRow({ label, values, bgColor, textColor }: { label: string; values: Record<string, number | null>; bgColor: string; textColor: string }) {
  return (
    <tr className="border-b border-slate-700/50">
      <td className={`sticky left-0 z-10 px-3 py-2 font-bold text-xs uppercase tracking-wider ${textColor}`} style={{ backgroundColor: bgColor }}>{label}</td>
      {TF_ORDER.map((tf) => {
        const val = values[tf];
        return (
          <td key={tf} className="px-3 py-2 text-center" style={{ backgroundColor: bgColor }}>
            <ZScoreCell value={val ?? null} />
          </td>
        );
      })}
    </tr>
  );
}

export default function MAZScoreScreenerPage() {
  const [data, setData] = useState<Record<string, Record<string, number | null>>>({});
  const [extremes, setExtremes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('d1');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [tfSubs, setTfSubs] = useState<Record<string, boolean>>({});
  const [assetSubs, setAssetSubs] = useState<Record<string, boolean>>({});
  const [subsLoaded, setSubsLoaded] = useState(false);
  const [subsSaving, setSubsSaving] = useState(false);
  const [subsMessage, setSubsMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [zRes, extRes] = await Promise.all([
        engineFetch('/api/screener-status/mazscore'),
        engineFetch('/api/screener-status/mazscore-extreme'),
      ]);
      if (!zRes.success) throw new Error(zRes.error || 'Failed to fetch');
      const rows: { symbol: string; timeframe: string; signal: string | null }[] = zRes.data || [];
      const matrix: Record<string, Record<string, number | null>> = {};
      for (const row of rows) {
        if (!matrix[row.symbol]) matrix[row.symbol] = {};
        matrix[row.symbol][row.timeframe] = row.signal !== null ? parseFloat(row.signal) : null;
      }
      setData(matrix);
      setExtremes(extRes.data || {});
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubs = useCallback(async () => {
    try {
      const res = await engineFetch('/api/mazscore-subscriptions');
      if (res.success) {
        const tfMap: Record<string, boolean> = {};
        for (const row of res.data.timeframes || []) tfMap[row.timeframe] = !!row.enabled;
        const assetMap: Record<string, boolean> = {};
        for (const row of res.data.symbols || []) assetMap[row.symbol] = !!row.enabled;
        setTfSubs(tfMap);
        setAssetSubs(assetMap);
      }
    } catch {}
    setSubsLoaded(true);
  }, []);

  useEffect(() => {
    fetchData();
    fetchSubs();
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, [fetchData, fetchSubs]);

  async function saveSubs() {
    setSubsSaving(true);
    setSubsMessage(null);
    try {
      const timeframes = TF_ORDER.filter(tf => tfSubs[tf]);
      const symbols = Object.keys(assetSubs).filter(s => assetSubs[s]);
      const res = await engineFetch('/api/mazscore-subscriptions', {
        method: 'PUT',
        body: JSON.stringify({ timeframes, symbols }),
      });
      if (!res.success) throw new Error(res.error || 'Failed to save');
      setSubsMessage('Saved');
    } catch (err: unknown) {
      setSubsMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubsSaving(false);
    }
  }

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const sortSymbols = (a: string, b: string) => {
    const aEnabled = !!assetSubs[a];
    const bEnabled = !!assetSubs[b];
    if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
    if (sortBy === 'symbol') {
      const cmp = a.localeCompare(b);
      return sortDir === 'desc' ? -cmp : cmp;
    }
    const aVal = data[a]?.[sortBy];
    const bVal = data[b]?.[sortBy];
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  };

  const cryptoSymbols = Object.keys(data)
    .filter(s => !isMetal(s))
    .sort(sortSymbols);

  const metalSymbols = Object.keys(data)
    .filter(s => isMetal(s))
    .sort(sortSymbols);

  const cryptoAvg = TF_ORDER.reduce<Record<string, number | null>>((acc, tf) => {
    const vals = cryptoSymbols.map(s => data[s]?.[tf]).filter((v): v is number => v !== null);
    acc[tf] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return acc;
  }, {});

  const metalAvg = TF_ORDER.reduce<Record<string, number | null>>((acc, tf) => {
    const vals = metalSymbols.map(s => data[s]?.[tf]).filter((v): v is number => v !== null);
    acc[tf] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return acc;
  }, {});

  const anySubscribed = Object.values(tfSubs).some(Boolean) || Object.values(assetSubs).some(Boolean);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-lg">Loading MA Z-Score signals...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400 text-lg">Error: {error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          MA Z-Score Screener
          {anySubscribed ? (
            <Bell className="h-4 w-4 text-blue-400" aria-label="Telegram alerts enabled" />
          ) : (
            <BellOff className="h-4 w-4 text-slate-500" aria-label="Telegram alerts disabled" />
          )}
        </h1>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-800 p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div>
            <div className="text-sm font-medium text-white">Telegram alerts per timeframe</div>
            <div className="text-xs text-slate-400">Get notified on MA Z-Score reversals for the selected timeframes and assets.</div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {TF_ORDER.map(tf => (
              <label key={tf} className="flex items-center gap-1.5 text-sm text-slate-300 select-none">
                <input
                  type="checkbox"
                  checked={!!tfSubs[tf]}
                  onChange={(e) => setTfSubs({ ...tfSubs, [tf]: e.target.checked })}
                  className="rounded border-slate-600"
                  disabled={!subsLoaded}
                />
                <span className="uppercase font-mono text-xs">{tf}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveSubs}
            disabled={subsSaving || !subsLoaded}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {subsSaving ? 'Saving…' : 'Save'}
          </button>
          {subsMessage && (
            <div className={`text-xs ${subsMessage === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>
              {subsMessage}
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th
              onClick={() => handleSort('symbol')}
              className={`sticky left-0 bg-slate-900 z-10 px-3 py-2 font-medium cursor-pointer select-none hover:text-white transition-colors ${sortBy === 'symbol' ? 'text-white' : 'text-slate-400'}`}
            >
              Symbol
              <SortIcon active={sortBy === 'symbol'} direction={sortDir} />
            </th>
              {TF_ORDER.map((tf) => (
                <th
                  key={tf}
                  onClick={() => handleSort(tf)}
                  className={`px-3 py-2 text-slate-400 font-medium text-center uppercase cursor-pointer select-none hover:text-white transition-colors ${sortBy === tf ? 'text-white' : ''}`}
                >
                  {tf}
                  <SortIcon active={sortBy === tf} direction={sortDir} />
                </th>
              ))}
              <th className="sticky right-0 bg-slate-900 z-10 px-3 py-2 text-slate-400 font-medium text-center">Alert</th>
            </tr>
          </thead>
          <tbody>
            <SectionRow label="-- CRYPTO --" values={cryptoAvg} bgColor="bg-orange-500/20" textColor="text-orange-200" />
            {cryptoSymbols.map((symbol) => {
              const display = symbol.replace('/USDT:USDT', '');
              return (
                <tr key={symbol} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="sticky left-0 bg-slate-900 z-10 px-3 py-2 text-white font-mono text-xs">{display}</td>
                  {TF_ORDER.map((tf) => (
                    <td key={tf} className="px-3 py-2 text-center">
                      <ZScoreCell value={data[symbol]?.[tf] ?? null} extreme={extremes[`${symbol}:${tf}`]} />
                    </td>
                  ))}
                <td className="sticky right-0 bg-slate-900 z-10 px-3 py-2 text-center">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!assetSubs[symbol]}
                        onChange={(e) => setAssetSubs({ ...assetSubs, [symbol]: e.target.checked })}
                        disabled={!subsLoaded}
                        className="h-4 w-4 rounded border-slate-600"
                        title={`Alert for ${display}`}
                      />
                    </label>
                  </td>
                </tr>
              );
            })}
            <SectionRow label="-- METALS --" values={metalAvg} bgColor="bg-teal-500/20" textColor="text-teal-200" />
            {metalSymbols.map((symbol) => {
              const display = symbol.replace('/USDT:USDT', '');
              return (
                <tr key={symbol} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="sticky left-0 bg-slate-900 z-10 px-3 py-2 text-white font-mono text-xs">{display}</td>
                  {TF_ORDER.map((tf) => (
                    <td key={tf} className="px-3 py-2 text-center">
                      <ZScoreCell value={data[symbol]?.[tf] ?? null} extreme={extremes[`${symbol}:${tf}`]} />
                    </td>
                  ))}
                <td className="sticky right-0 bg-slate-900 z-10 px-3 py-2 text-center">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!assetSubs[symbol]}
                        onChange={(e) => setAssetSubs({ ...assetSubs, [symbol]: e.target.checked })}
                        disabled={!subsLoaded}
                        className="h-4 w-4 rounded border-slate-600"
                        title={`Alert for ${display}`}
                      />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}