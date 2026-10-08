'use client';

import { useState, useEffect } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import SymbolPicker from '@/components/SymbolPicker';
import { getAssets } from '@/lib/symbols';
import type { Asset } from '@/lib/symbols';
import engineFetch from '@/lib/api';

const TIMEFRAMES = ['m1', 'm5', 'm15', 'h1', 'h4', 'd1'];

export default function ChatPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState('m15');
  const [price, setPrice] = useState<{
    price: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    timestamp: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getAssets().then(setAssets);
  }, []);

  async function fetchPrice() {
    if (!selectedSymbol) return;
    setLoading(true);
    setError('');
    try {
      const data = await engineFetch(`/api/candles/quote/${encodeURIComponent(selectedSymbol)}?timeframe=${selectedTimeframe}`);
      setPrice(data);
    } catch {
      setError('Failed to fetch price. Ensure the engine API is running.');
      setPrice(null);
    } finally {
      setLoading(false);
    }
  }

  const selectedAsset = assets.find(a => a.symbol_ccxt === selectedSymbol);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-white">Live Asset Prices</h1>
          <p className="text-sm text-slate-400 mt-1">Select an asset and timeframe to view live prices</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Asset</label>
          <SymbolPicker
            value={selectedSymbol}
            onChange={(val) => {
              setSelectedSymbol(val);
              setPrice(null);
              setError('');
            }}
            assets={assets}
            placeholder="Search asset..."
            showDisplayOnly={true}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Timeframe</label>
          <div className="flex flex-wrap gap-2">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setSelectedTimeframe(tf);
                  setPrice(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  tf === selectedTimeframe
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={fetchPrice}
        disabled={!selectedSymbol || loading}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed mb-6"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Fetching...' : 'Fetch Live Price'}
      </button>

      {error && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-400 mb-4">
          {error}
        </div>
      )}

      {price && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Activity className="h-6 w-6 text-blue-400" />
              <div>
                <p className="text-base font-bold text-white">{selectedAsset?.display || selectedSymbol}</p>
                <p className="text-xs text-slate-500">
                via {selectedAsset?.provider === 'twelvedata' ? 'TwelveData' : 'Bybit'} &middot; {selectedTimeframe}
              </p>
              </div>
            </div>
            <p className="text-2xl font-bold text-white">
              {price.close !== null ? price.close.toLocaleString() : 'N/A'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-700/30 px-3 py-2">
              <p className="text-xs text-slate-500">Open</p>
              <p className="text-white font-mono">{price.open?.toLocaleString() || 'N/A'}</p>
            </div>
            <div className="rounded-lg bg-slate-700/30 px-3 py-2">
              <p className="text-xs text-slate-500">Close</p>
              <p className="text-white font-mono">{price.close?.toLocaleString() || 'N/A'}</p>
            </div>
            <div className="rounded-lg bg-slate-700/30 px-3 py-2">
              <p className="text-xs text-slate-500">High</p>
              <p className="text-white font-mono">{price.high?.toLocaleString() || 'N/A'}</p>
            </div>
            <div className="rounded-lg bg-slate-700/30 px-3 py-2">
              <p className="text-xs text-slate-500">Low</p>
              <p className="text-white font-mono">{price.low?.toLocaleString() || 'N/A'}</p>
            </div>
            <div className="rounded-lg bg-slate-700/30 px-3 py-2">
              <p className="text-xs text-slate-500">Volume</p>
              <p className="text-white font-mono">{price.volume?.toLocaleString() || 'N/A'}</p>
            </div>
            <div className="rounded-lg bg-slate-700/30 px-3 py-2">
              <p className="text-xs text-slate-500">Updated</p>
              <p className="text-white font-mono text-xs">
                {price.timestamp ? new Date(price.timestamp).toLocaleString() : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      )}

      {!price && !error && selectedSymbol && (
        <p className="text-center text-slate-500 py-8">Click &ldquo;Fetch Live Price&rdquo; to load data</p>
      )}
    </div>
  );
}