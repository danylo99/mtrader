'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, BellOff, Save } from 'lucide-react';
import engineFetch from '@/lib/api';

const TF_ORDER = ['m5', 'm15', 'h1', 'h4', 'd1', 'w1'];

function SignalDot({ signal }: { signal: string | null }) {
  if (!signal) {
    return <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-slate-800/50 text-slate-500 text-[8px]">—</span>;
  }
  const isBullish = signal.startsWith('bullish');
  return (
    <span
      className={`inline-flex items-center justify-center w-3 h-3 rounded-full ${isBullish ? 'bg-green-800/40' : 'bg-red-800/40'} border ${isBullish ? 'border-green-600/30' : 'border-red-600/30'}`}
      title={signal}
    />
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) {
  if (!active) return <span className="text-slate-600 ml-1">⇅</span>;
  return direction === 'asc' ? <span className="text-blue-400 ml-1">↑</span> : <span className="text-blue-400 ml-1">↓</span>;
}

export default function RollingSuperTrend2ScreenerPage() {
  const [data, setData] = useState<Record<string, Record<string, string | null>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('symbol');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [tfSubs, setTfSubs] = useState<Record<string, boolean>>({});
  const [assetSubs, setAssetSubs] = useState<Record<string, boolean>>({});
  const [subsLoaded, setSubsLoaded] = useState(false);
  const [subsSaving, setSubsSaving] = useState(false);
  const [subsMessage, setSubsMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await engineFetch('/api/screener-status/supertrend');
      if (!res.success) throw new Error(res.error || 'Failed to fetch');
      const rows: { symbol: string; timeframe: string; signal: string | null }[] = res.data || [];
      const matrix: Record<string, Record<string, string | null>> = {};
      for (const row of rows) {
        if (!matrix[row.symbol]) matrix[row.symbol] = {};
        matrix[row.symbol][row.timeframe] = row.signal;
      }
      setData(matrix);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubs = useCallback(async () => {
    try {
      const res = await engineFetch('/api/supertrend-subscriptions');
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
      const res = await engineFetch('/api/supertrend-subscriptions', {
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
    return sortDir === 'desc' ? (aVal < bVal ? 1 : -1) : (aVal < bVal ? -1 : 1);
  };

  const allSymbols = Object.keys(data);
  const allSymbolsSorted = [...allSymbols].sort(sortSymbols);
  const anySubscribed = Object.values(tfSubs).some(Boolean) && Object.values(assetSubs).some(Boolean);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-lg">Loading RollingSuperTrend2 signals...</div>
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
          RollingSuperTrend2 Screener
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
            <div className="text-xs text-slate-400">Get notified on RollingSuperTrend2 reversals for the selected timeframes and assets.</div>
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
              <th className="sticky right-0 bg-slate-900 z-10 px-3 py-2 text-slate-400 font-medium text-center">
                <div className="flex items-center justify-center gap-1">
                  <span>Alert</span>
                  <input
                    type="checkbox"
                    checked={allSymbols.length > 0 && allSymbols.every(s => !!assetSubs[s])}
                    ref={el => { if (el) el.indeterminate = allSymbols.some(s => !!assetSubs[s]) && !allSymbols.every(s => !!assetSubs[s]); }}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAssetSubs(prev => {
                        const next = { ...prev };
                        for (const s of allSymbols) next[s] = checked;
                        return next;
                      });
                    }}
                    disabled={!subsLoaded}
                    className="h-4 w-4 rounded border-slate-600"
                    title="Toggle all assets"
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {allSymbolsSorted.map((symbol) => {
              const display = symbol.replace('/USDT:USDT', '');
              return (
                <tr key={symbol} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="sticky left-0 bg-slate-900 z-10 px-3 py-2 text-white font-mono text-xs">{display}</td>
                  {TF_ORDER.map((tf) => (
                    <td key={tf} className="px-3 py-2 text-center">
                      <SignalDot signal={data[symbol]?.[tf] ?? null} />
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