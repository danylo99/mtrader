'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { getAssets } from '@/lib/symbols';
import type { Asset } from '@/lib/symbols';

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAssets()
      .then(setAssets)
      .finally(() => setLoading(false));
  }, []);

  const filtered = assets.filter(a =>
    a.display.toLowerCase().includes(query.toLowerCase()) ||
    a.id.toLowerCase().includes(query.toLowerCase()) ||
    a.symbol_ccxt.toLowerCase().includes(query.toLowerCase()) ||
    a.provider.toLowerCase().includes(query.toLowerCase())
  );

  const bybitCount = assets.filter(a => a.provider === 'bybit').length;
  const twelvedataCount = assets.filter(a => a.provider === 'twelvedata').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-white">Universal Assets</h1>
          <p className="text-sm text-slate-400 mt-1">
            {assets.length} assets ({bybitCount} crypto via Bybit, {twelvedataCount} via TwelveData)
          </p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, id, symbol, or provider..."
          className="w-full rounded-lg border border-slate-600 bg-slate-800 px-10 py-2.5 text-sm text-white placeholder-slate-500 outline-none"
        />
      </div>

      {loading ? (
        <p className="text-slate-400">Loading assets...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Display</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">CCXT Symbol</th>
                <th className="px-3 py-2">Hyperliquid Symbol</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-3 py-2 text-white font-mono text-xs">{asset.id}</td>
                  <td className="px-3 py-2 text-white">{asset.display}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      asset.provider === 'bybit'
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-green-600/20 text-green-400'
                    }`}>
                      {asset.provider}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300 font-mono text-xs">{asset.symbol_ccxt}</td>
                  <td className="px-3 py-2 text-slate-300 font-mono text-xs">{asset.symbol_hyperliquid}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">No assets match your search</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}