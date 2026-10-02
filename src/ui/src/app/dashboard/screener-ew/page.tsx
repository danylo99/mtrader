'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, BellOff, Save } from 'lucide-react';
import engineFetch from '@/lib/api';

const TF_ORDER = ['m5', 'm15', 'h1', 'h4', 'd1', 'w1'];

function SignalDot({ signal }: { signal: string | null }) {
  if (!signal) {
    return <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-700/50 text-slate-500 text-xs">—</span>;
  }
  const isBullish = signal.startsWith('bullish');
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${isBullish ? 'bg-green-500' : 'bg-red-500'} shadow-sm`}
      title={signal}
    />
  );
}

export default function EWScreenerPage() {
  const [data, setData] = useState<Record<string, Record<string, string | null>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subs, setSubs] = useState<Record<string, boolean>>({});
  const [subsLoaded, setSubsLoaded] = useState(false);
  const [subsSaving, setSubsSaving] = useState(false);
  const [subsMessage, setSubsMessage] = useState<string | null>(null);
  const [telegramConfigured, setTelegramConfigured] = useState<boolean | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await engineFetch('/api/screener-status/ew');
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
      const res = await engineFetch('/api/ew-subscriptions');
      if (res.success && Array.isArray(res.data)) {
        const map: Record<string, boolean> = {};
        for (const row of res.data) map[row.timeframe] = !!row.enabled;
        setSubs(map);
      }
    } catch {}
    setSubsLoaded(true);
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const res = await engineFetch('/api/auth/me');
      if (res.success && res.data) {
        setTelegramConfigured(!!(res.data as { telegram_chat_id?: string }).telegram_chat_id);
      }
    } catch {}
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchData(), fetchSubs(), fetchMe()]);
    })();
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, [fetchData, fetchSubs, fetchMe]);

  async function saveSubs() {
    setSubsSaving(true);
    setSubsMessage(null);
    try {
      const timeframes = TF_ORDER.filter(tf => subs[tf]);
      const res = await engineFetch('/api/ew-subscriptions', {
        method: 'PUT',
        body: JSON.stringify({ timeframes }),
      });
      if (!res.success) throw new Error(res.error || 'Failed to save');
      const map: Record<string, boolean> = {};
      for (const row of res.data || []) map[row.timeframe] = !!row.enabled;
      setSubs(map);
      setSubsMessage('Saved');
    } catch (err: unknown) {
      setSubsMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubsSaving(false);
    }
  }

  const symbols = Object.keys(data).sort();
  const anySubscribed = TF_ORDER.some(tf => subs[tf]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-lg">Loading EW signals...</div>
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
          EW Signal Screener
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

      {telegramConfigured === false && (
        <div className="mb-4 rounded-lg bg-yellow-900/30 border border-yellow-700/50 px-4 py-3 text-sm text-yellow-300">
          Set Telegram chat ID in <a href="/dashboard/settings" className="underline">Settings</a> to receive alerts.
        </div>
      )}

      <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-800 p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-medium text-white">Telegram alerts per timeframe</div>
            <div className="text-xs text-slate-400">Get notified on every EW reversal for the selected timeframes.</div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {TF_ORDER.map(tf => (
              <label key={tf} className="flex items-center gap-1.5 text-sm text-slate-300 select-none">
                <input
                  type="checkbox"
                  checked={!!subs[tf]}
                  onChange={(e) => setSubs({ ...subs, [tf]: e.target.checked })}
                  className="rounded border-slate-600"
                  disabled={!subsLoaded}
                />
                <span className="uppercase font-mono text-xs">{tf}</span>
              </label>
            ))}
            <button
              onClick={saveSubs}
              disabled={subsSaving || !subsLoaded}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {subsSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {subsMessage && (
          <div className={`mt-2 text-xs ${subsMessage === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>
            {subsMessage}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="sticky left-0 bg-slate-900 z-10 px-3 py-2 text-slate-400 font-medium">Symbol</th>
              {TF_ORDER.map((tf) => (
                <th key={tf} className="px-3 py-2 text-slate-400 font-medium text-center uppercase">{tf}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => {
              const display = symbol.replace('/USDT:USDT', '');
              return (
                <tr key={symbol} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="sticky left-0 bg-slate-900 z-10 px-3 py-2 text-white font-mono text-xs">{display}</td>
                  {TF_ORDER.map((tf) => (
                    <td key={tf} className="px-3 py-2 text-center">
                      <SignalDot signal={data[symbol]?.[tf] ?? null} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}