'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PlusCircle, ExternalLink, XCircle, Trash2 } from 'lucide-react';
import engineFetch from '@/lib/api';
import { parseTpPrices } from '@/lib/constants';
import type { TradingSetup, SetupListSummary } from '@/lib/types';

type TabType = 'pending' | 'triggered' | 'active' | 'closed';
type SortType = 'symbol_asc' | 'symbol_desc';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'Pending',    color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/30' },
  triggered:  { label: 'Triggered',  color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/30' },
  active:     { label: 'Active',     color: 'text-green-400',  bg: 'bg-green-900/20 border-green-700/30' },
  closed:     { label: 'Closed',     color: 'text-blue-400',   bg: 'bg-blue-900/20 border-blue-700/30' },
  cancelled:   { label: 'cancelled',   color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/30' },
};

function SetupCardRaw({ setup, onCancel, onDelete }: {
  setup: TradingSetup;
  onCancel: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const tpArr = parseTpPrices(setup.tp_prices);
  const statusCfg = STATUS_CONFIG[setup.status] || STATUS_CONFIG.pending;

  return (
    <div className={`rounded-xl border ${statusCfg.bg} p-4 sm:p-5 transition-colors hover:border-slate-600`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white">{setup.symbol}</h3>
            <span className="text-xs text-slate-500">{setup.account_label ? `${setup.account_label} (${setup.exchange})` : `Account #${setup.exchange_account_id}`}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.color} bg-slate-800/80`}>
              {statusCfg.label}
            </span>
            <span className={`text-xs font-medium ${setup.side === 'long' ? 'text-green-400' : 'text-red-400'}`}>
              {setup.side.toUpperCase()}
            </span>
          </div>
        </div>
        <Link href={`/dashboard/setups/${setup.id}`}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-white">
          <ExternalLink className="h-3.5 w-3.5" />
          Details
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-sm">
        <div>
          <p className="text-xs text-slate-500">Activation</p>
          <p className="font-mono text-white text-xs sm:text-sm">{setup.activation_price}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Risk</p>
          <p className="font-mono text-white text-xs sm:text-sm">{setup.risk_type === 'percent' ? `${setup.risk_value}%` : `${setup.risk_value}`}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Ignore Box</p>
          <p className="font-mono text-white text-xs sm:text-sm">{setup.ignore_box_lower} - {setup.ignore_box_upper}</p>
        </div>
        <div className="col-span-2 sm:col-span-2">
          <p className="text-xs text-slate-500">TP Levels</p>
          <p className="text-white text-xs sm:text-sm">{tpArr.length > 0 ? `${tpArr.length}x RR: ${tpArr.join(':')}` : '—'}</p>
        </div>
        {(setup.status === 'active' || setup.status === 'closed' || setup.status === 'cancelled') && (
          <>
            <div>
              <p className="text-xs text-slate-500">Open Price</p>
              <p className="font-mono text-white text-xs sm:text-sm">
                {setup.entry_price != null ? setup.entry_price : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Profit</p>
              <p className={`font-mono text-xs sm:text-sm ${setup.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {setup.profit >= 0 ? `+${setup.profit.toFixed(2)}` : setup.profit.toFixed(2)}
              </p>
            </div>
          </>
        )}
      </div>

      {(setup.status === 'pending' || setup.status === 'triggered' || setup.status === 'active') && (
        <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Stop Loss</p>
            <p className="font-mono text-white text-xs sm:text-sm">
              {setup.sl_price > 0 ? setup.sl_price : 'Auto'}
            </p>
          </div>

          {setup.be_enabled && (
            <>
              <div>
                <p className="text-xs text-slate-500">BE Price</p>
                <p className="font-mono text-white text-xs sm:text-sm">{setup.be_trigger_price}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">BE Activated</p>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  setup.be_activated
                    ? 'text-green-400 bg-green-900/20'
                    : 'text-amber-400 bg-amber-900/20'
                }`}>
                  {setup.be_activated ? 'Active' : 'Pending'}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{setup.entry_indicator_type} ({setup.entry_indicator_tf})</span>
          {setup.exit_indicator_type && <span>→ Exit: {setup.exit_indicator_type} ({setup.exit_indicator_tf})</span>}
        </div>
        <div className="flex gap-2">
          {(setup.status === 'pending' || setup.status === 'triggered' || setup.status === 'active') && (
            <button onClick={() => onCancel(setup.id)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/30">
              <XCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}
          {(setup.status === 'closed' || setup.status === 'cancelled') && (
            <button onClick={() => onDelete(setup.id)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/30">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
          <Link href={setup.status === 'active' ? `/dashboard/setups/${setup.id}/edit` : `/dashboard/setups/${setup.id}/edit`}
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              setup.status === 'closed' || setup.status === 'cancelled'
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-blue-400 hover:bg-blue-900/30'
            }`}>
            {setup.status === 'active' ? 'Edit' : setup.status === 'closed' || setup.status === 'cancelled' ? 'Read-only' : 'Edit'}
          </Link>
        </div>
      </div>

      {setup.memo && (
        <p className="mt-2 text-xs text-slate-500 line-clamp-1">{setup.memo}</p>
      )}
    </div>
  );
}

const SetupCard = SetupCardRaw;

export default function DashboardPage() {
  const [tab, setTab] = useState<TabType>('pending');
  const [setups, setSetups] = useState<TradingSetup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('symbol_asc');
  const [closedPage, setClosedPage] = useState(1);
  const [totalClosed, setTotalClosed] = useState(0);
  const [summary, setSummary] = useState<SetupListSummary | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchDebounced, setSearchDebounced] = useState('');
  const PER_PAGE = 10;

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setSummary(null);
      try {
        const statusMap: Record<string, string> = { pending: 'pending', triggered: 'triggered', active: 'active', closed: 'closed,cancelled' };
        const params = new URLSearchParams({ status: statusMap[tab] || tab, page: String(closedPage), limit: String(PER_PAGE) });
        if (searchDebounced) params.set('search', searchDebounced);
        if (tab !== 'closed') params.set('sort', sortBy);
        const data = await engineFetch(`/api/setups?${params}`);
        if (!active) return;
        if (data.success) {
          setSetups(data.data);
          setTotalClosed(data.total || 0);
          setSummary(data.summary ?? null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [tab, closedPage, searchDebounced, sortBy, reloadKey]);

  const handleCancel = useCallback(async (id: number) => {
    const data = await engineFetch(`/api/setups/${id}`, { method: 'DELETE' });
    if (data.success) setReloadKey((k) => k + 1);
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm('Permanently delete this setup? This cannot be undone.')) return;
    const data = await engineFetch(`/api/setups/${id}?hard=true`, { method: 'DELETE' });
    if (data.success) setReloadKey((k) => k + 1);
  }, []);

  const totalPages = Math.ceil(totalClosed / PER_PAGE);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">Trading Setups</h1>
        <Link href="/dashboard/setups/new"
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 w-full sm:w-auto">
          <PlusCircle className="h-4 w-4" />
          New Setup
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-1 sm:gap-2 border-b border-slate-700/50 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
        {(['pending', 'triggered', 'active', 'closed'] as TabType[]).map((t) => (
          <button key={t} onClick={() => { setTab(t); setClosedPage(1); }}
            className={`whitespace-nowrap px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium transition-colors border-b-2 ${
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            {t === 'pending' ? 'Pending' : t === 'triggered' ? 'Triggered' : t === 'active' ? 'Active' : 'Closed / cancelled'}
          </button>
        ))}
      </div>

      {tab !== 'closed' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Total risk (fixed)</p>
              <p className="font-mono text-lg sm:text-xl text-white">
                {summary ? `$${summary.totalFixedRisk.toFixed(2)}` : '—'}
              </p>
              {summary && (
                <p className="text-xs text-slate-500">
                  {summary.fixedCount} fixed setup(s)
                  {summary.percentCount > 0 && ` · ${summary.percentCount} percent-risk setup(s) not counted`}
                </p>
              )}
            </div>
            {tab === 'active' && (
              <div>
                <p className="text-xs text-slate-500">Floating PnL</p>
                <p className={`font-mono text-lg sm:text-xl ${summary && summary.totalFloatingPnl < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {summary
                    ? `${summary.totalFloatingPnl >= 0 ? '+' : '-'}$${Math.abs(summary.totalFloatingPnl).toFixed(2)}`
                    : '—'}
                </p>
                {summary && <p className="text-xs text-slate-500">{summary.totalCount} active position(s)</p>}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by symbol or memo..."
          className="w-full sm:max-w-md rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500" />
        {tab !== 'closed' && (
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value as SortType); setClosedPage(1); }}
            aria-label="Sort by"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500">
            <option value="symbol_asc">Symbol A→Z</option>
            <option value="symbol_desc">Symbol Z→A</option>
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : setups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <p className="text-lg">No setups found</p>
          <Link href="/dashboard/setups/new" className="mt-2 text-sm text-blue-400 hover:text-blue-300">
            Create your first setup
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {setups.map((setup) => (
              <SetupCard key={setup.id} setup={setup} onCancel={handleCancel} onDelete={handleDelete} />
            ))}
          </div>
          {tab === 'closed' && totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setClosedPage(p)}
                  className={`h-8 w-8 rounded-lg text-sm transition-colors ${
                    p === closedPage ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}>{p}</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}