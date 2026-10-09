'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit3, XCircle, Trash2, SlidersHorizontal, Plus } from 'lucide-react';
import engineFetch from '@/lib/api';
import type { TradingSetup, Order } from '@/lib/types';
import { TIMEFRAMES, INDICATORS, STATUS_STYLES, parseTpPrices } from '@/lib/constants';
import Modal from '@/components/Modal';

const ORDER_TYPE_LABELS: Record<string, string> = {
  entry: 'Entry',
  tp1: 'TP 1', tp2: 'TP 2', tp3: 'TP 3', tp4: 'TP 4',
  sl: 'Stop Loss',
  manual_close: 'Manual Close',
};

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500';

function formatTf(tf: string) {
  return TIMEFRAMES.find(t => t.value === tf)?.label || tf;
}

function formatIndicator(ind: string) {
  return INDICATORS.find(i => i.value === ind)?.label || ind;
}

export default function SetupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [setup, setSetup] = useState<TradingSetup | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [closeOpen, setCloseOpen] = useState(false);
  const [closeQty, setCloseQty] = useState('0');
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState('');

  const [slOpen, setSlOpen] = useState(false);
  const [slValue, setSlValue] = useState('');
  const [slSubmitting, setSlSubmitting] = useState(false);
  const [slError, setSlError] = useState('');
  const [slWarning, setSlWarning] = useState('');

  const [tpEditOrder, setTpEditOrder] = useState<Order | null>(null);
  const [tpEditPrice, setTpEditPrice] = useState('');
  const [tpEditQty, setTpEditQty] = useState('');
  const [tpEditSubmitting, setTpEditSubmitting] = useState(false);
  const [tpEditError, setTpEditError] = useState('');

  const [tpAddOpen, setTpAddOpen] = useState(false);
  const [tpAddPrice, setTpAddPrice] = useState('');
  const [tpAddQty, setTpAddQty] = useState('');
  const [tpAddSubmitting, setTpAddSubmitting] = useState(false);
  const [tpAddError, setTpAddError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await engineFetch(`/api/setups/${id}`);
      if (data.success) {
        const { orders: ords, ...rest } = data.data;
        setSetup(rest);
        setOrders(ords || []);
      }
    } catch {}
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  function openCloseModal() {
    setCloseQty('0');
    setCloseError('');
    setCloseOpen(true);
  }

  function openSlModal() {
    setSlValue(setup ? String(setup.sl_price) : '');
    setSlError('');
    setSlWarning('');
    setSlOpen(true);
  }

  async function handleCancel() {
    const warning = setup?.status === 'active'
      ? '\n\nThis only changes the status in the database. The real position and its stop order stay open on the exchange.'
      : '';
    if (!confirm(`Cancel this trading setup?${warning}`)) return;
    const data = await engineFetch(`/api/setups/${id}`, { method: 'DELETE' });
    if (data.success) {
      setSetup(data.data);
    }
  }

  async function handleDelete() {
    if (!confirm('Permanently delete this setup? This cannot be undone.')) return;
    const data = await engineFetch(`/api/setups/${id}?hard=true`, { method: 'DELETE' });
    if (data.success) {
      router.push('/dashboard');
    }
  }

  async function submitClose() {
    const raw = closeQty.trim();
    const qty = raw === '' ? 0 : Number(raw);

    if (!Number.isFinite(qty)) {
      setCloseError('Quantity must be a number');
      return;
    }
    if (qty < 0) {
      setCloseError('Quantity cannot be negative');
      return;
    }

    setCloseSubmitting(true);
    setCloseError('');
    try {
      await engineFetch(`/api/setups/${id}/close`, {
        method: 'POST',
        body: JSON.stringify({ qty }),
      });
      setCloseOpen(false);
      await load();
    } catch (err: unknown) {
      const e = err as { error?: string; message?: string };
      setCloseError(e?.error || e?.message || 'Failed to close position');
    } finally {
      setCloseSubmitting(false);
    }
  }

  async function submitSl() {
    const price = Number(slValue.trim());

    if (slValue.trim() === '' || !Number.isFinite(price)) {
      setSlError('Stop loss price must be a number');
      return;
    }
    if (price <= 0) {
      setSlError('Stop loss price must be greater than 0');
      return;
    }

    setSlSubmitting(true);
    setSlError('');
    setSlWarning('');
    try {
      const data = await engineFetch(`/api/setups/${id}/sl`, {
        method: 'PATCH',
        body: JSON.stringify({ sl_price: price }),
      });
      const stale: string[] = data?.data?.warnings || [];
      if (stale.length > 0) {
        setSlWarning(`New stop is live, but the previous stop order (${stale.join(', ')}) could not be cancelled on the exchange. Cancel it manually.`);
      }
      setSlOpen(false);
      await load();
    } catch (err: unknown) {
      const e = err as { error?: string; message?: string };
      setSlError(e?.error || e?.message || 'Failed to modify stop loss');
    } finally {
      setSlSubmitting(false);
    }
  }

  function openTpEditModal(order: Order) {
    setTpEditOrder(order);
    setTpEditPrice(String(order.price));
    setTpEditQty(String(order.qty));
    setTpEditError('');
  }

  async function handleCancelOrder(orderId: number) {
    if (!confirm('Cancel this order?')) return;
    try {
      await engineFetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
      await load();
    } catch (err: unknown) {
      const e = err as { error?: string; message?: string };
      alert(e?.error || e?.message || 'Failed to cancel order');
    }
  }

  async function submitTpEdit() {
    if (!tpEditOrder) return;
    const price = Number(tpEditPrice);
    const qty = Number(tpEditQty);
    if (!Number.isFinite(price) || price <= 0) {
      setTpEditError('Price must be a positive number');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setTpEditError('Quantity must be a positive number');
      return;
    }

    setTpEditSubmitting(true);
    setTpEditError('');
    try {
      await engineFetch(`/api/orders/${tpEditOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify({ price, qty }),
      });
      setTpEditOrder(null);
      await load();
    } catch (err: unknown) {
      const e = err as { error?: string; message?: string };
      setTpEditError(e?.error || e?.message || 'Failed to modify TP order');
    } finally {
      setTpEditSubmitting(false);
    }
  }

  function calculateRisk(): { amount: number; label: string; isEstimated: boolean } | null {
    if (!setup) return null;
    
    // Active trade: calculate from live position
    if (setup.status === 'active' && setup.entry_price && setup.sl_price && setup.sl_price > 0) {
      const remainingQty = setup.remaining_qty ?? setup.entry_qty ?? 0;
      if (remainingQty <= 0) return { amount: 0, label: 'Risk', isEstimated: false };
      const riskPerUnit = Math.abs(setup.entry_price - setup.sl_price);
      const amount = riskPerUnit * remainingQty;
      return { amount, label: 'Risk', isEstimated: false };
    }
    
    // Pending/triggered: use configured risk
    if ((setup.status === 'pending' || setup.status === 'triggered') && setup.risk_value > 0) {
      if (setup.risk_type === 'fixed') {
        return { amount: setup.risk_value, label: 'Risk (Fixed $)', isEstimated: false };
      } else {
        return { amount: setup.risk_value, label: 'Risk (%)', isEstimated: true };
      }
    }
    
    return null;
  }

  function getSuggestedTpPrice(): number | null {
    if (!setup || !setup.entry_price || !setup.sl_price || setup.sl_price <= 0) return null;
    const tpRatios = parseTpPrices(setup.tp_prices);
    const existingTpNumbers = new Set();
    for (const o of orders) {
      const match = o.order_type.match(/^tp(\d+)$/);
      if (match) existingTpNumbers.add(parseInt(match[1], 10));
    }
    let nextTpNumber = 1;
    while (existingTpNumbers.has(nextTpNumber) && nextTpNumber <= 4) {
      nextTpNumber++;
    }
    if (nextTpNumber > 4 || nextTpNumber > tpRatios.length) return null;
    const rr = tpRatios[nextTpNumber - 1];
    const riskPerUnit = Math.abs(setup.entry_price - setup.sl_price);
    if (riskPerUnit === 0) return null;
    const targetPrice = setup.side === 'long'
      ? setup.entry_price + riskPerUnit * rr
      : setup.entry_price - riskPerUnit * rr;
    return targetPrice;
  }

  function openTpAddModal() {
    const suggested = getSuggestedTpPrice();
    setTpAddPrice(suggested ? String(suggested) : '');
    setTpAddQty('');
    setTpAddError('');
    setTpAddOpen(true);
  }

  async function submitTpAdd() {
    if (!setup) return;
    const price = Number(tpAddPrice);
    const qty = Number(tpAddQty);
    if (!Number.isFinite(price) || price <= 0) {
      setTpAddError('Price must be a positive number');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setTpAddError('Quantity must be a positive number');
      return;
    }

    setTpAddSubmitting(true);
    setTpAddError('');
    try {
      await engineFetch(`/api/orders/add-tp`, {
        method: 'POST',
        body: JSON.stringify({ setup_id: setup.id, price, qty }),
      });
      setTpAddOpen(false);
      await load();
    } catch (err: unknown) {
      const e = err as { error?: string; message?: string };
      setTpAddError(e?.error || e?.message || 'Failed to add TP order');
    } finally {
      setTpAddSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!setup) {
    return <div className="text-slate-500 py-20 text-center">Setup not found</div>;
  }

  const tpArr = parseTpPrices(setup.tp_prices);

  return (
    <div>
      {slWarning && (
        <div className="mb-4 rounded-lg border border-amber-900/50 bg-amber-900/20 px-3 py-2 text-sm text-amber-300">
          {slWarning}
        </div>
      )}
      <button
        onClick={() => router.push('/dashboard')}
        className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-white">{setup.symbol}</h1>
            <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium ${STATUS_STYLES[setup.status] || ''}`}>
              {setup.status.charAt(0).toUpperCase() + setup.status.slice(1)}
            </span>
            <span className={`text-sm font-medium ${setup.side === 'long' ? 'text-green-400' : 'text-red-400'}`}>
              {setup.side.toUpperCase()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 mt-1">
            <span>{setup.account_label ? `${setup.account_label} (${setup.exchange})` : `Account #${setup.exchange_account_id}`}</span>
            <span>&bull;</span>
            <span>Created {new Date(setup.created_at).toLocaleString()}</span>
            {(setup.status === 'active' || setup.status === 'closed' || setup.status === 'cancelled') && (
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${setup.profit >= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                Profit {setup.profit >= 0 ? `+${setup.profit.toFixed(2)}` : setup.profit.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(setup.status === 'pending' || setup.status === 'triggered' || setup.status === 'active') && (
            <>
              <button onClick={() => router.push(`/dashboard/setups/${id}/edit`)}
                className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600">
                <Edit3 className="h-4 w-4" />
                Edit
              </button>
              {setup.status === 'active' && (
                <>
                  <button onClick={openCloseModal}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-900/30 px-3 py-2 text-sm text-amber-300 hover:bg-amber-900/50">
                    <XCircle className="h-4 w-4" />
                    Close Position
                  </button>
                  <button onClick={openSlModal}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600">
                    <SlidersHorizontal className="h-4 w-4" />
                    Modify SL
                  </button>
                  <button onClick={openTpAddModal}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600">
                    <Plus className="h-4 w-4" />
                    Add TP
                  </button>
                </>
              )}
              <button onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400 hover:bg-red-900/50">
                <XCircle className="h-4 w-4" />
                Cancel
              </button>
            </>
          )}
          {(setup.status === 'closed' || setup.status === 'cancelled') && (
            <button onClick={handleDelete}
              className="flex items-center gap-1.5 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400 hover:bg-red-900/50">
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Entry Configuration</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Activation Price</dt>
              <dd className="text-sm font-mono text-white">{setup.activation_price}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Ignore Box</dt>
              <dd className="text-sm font-mono text-white">{setup.ignore_box_lower} &mdash; {setup.ignore_box_upper}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Indicator</dt>
              <dd className="text-sm text-white">{formatIndicator(setup.entry_indicator_type)} ({formatTf(setup.entry_indicator_tf)})</dd>
            </div>
            {setup.entry_indicator_type === 'pricelevel' && setup.entry_pricelevel_value !== undefined && (
              <div className="flex justify-between">
                <dt className="text-sm text-slate-500">Price Level</dt>
                <dd className="text-sm font-mono text-white">{setup.entry_pricelevel_value}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Risk & TP</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Risk</dt>
              <dd className="text-sm text-white">
                {(() => {
                  const risk = calculateRisk();
                  if (!risk) return '—';
                  if (risk.label === 'Risk (%)') return `${risk.amount}%`;
                  const suffix = risk.isEstimated ? ' (est.)' : '';
                  return `$${risk.amount.toFixed(2)}${suffix}`;
                })()}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-sm text-slate-500">Stop Loss</dt>
              <dd className="flex items-center gap-2 text-sm font-mono text-white">
                {setup.sl_price > 0 ? setup.sl_price : 'Auto'}
                {setup.status === 'active' && (
                  <button onClick={openSlModal}
                    className="rounded border border-slate-600 px-1.5 py-0.5 text-xs font-sans text-slate-400 transition-colors hover:border-blue-500 hover:text-blue-400">
                    Modify
                  </button>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">TP Levels (RR)</dt>
              <dd className="text-sm font-mono text-white">{tpArr.join(' : ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Break Even</dt>
              <dd className="text-sm text-white">{setup.be_enabled ? `Yes (${setup.be_trigger_price})` : 'No'}</dd>
            </div>
          </dl>
        </div>

        {setup.exit_indicator_type && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Exit Condition</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-slate-500">Indicator</dt>
                <dd className="text-sm text-white">{formatIndicator(setup.exit_indicator_type)} ({formatTf(setup.exit_indicator_tf || '')})</dd>
              </div>
              {setup.exit_indicator_type === 'pricelevel' && setup.exit_pricelevel_value !== undefined && (
                <div className="flex justify-between">
                  <dt className="text-sm text-slate-500">Price Level</dt>
                  <dd className="text-sm font-mono text-white">{setup.exit_pricelevel_value}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {setup.memo && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Memo</h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{setup.memo}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Orders</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-slate-500">No orders yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-500 font-medium">Type</th>
                  <th className="text-left py-2 px-3 text-slate-500 font-medium">Side</th>
                  <th className="text-right py-2 px-3 text-slate-500 font-medium">Price</th>
                  <th className="text-right py-2 px-3 text-slate-500 font-medium">Qty</th>
                  <th className="text-right py-2 px-3 text-slate-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-700/50">
                    <td className="py-2.5 px-3 text-white">{ORDER_TYPE_LABELS[order.order_type] || order.order_type}</td>
                    <td className={`py-2.5 px-3 font-medium ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                      {order.side.toUpperCase()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">{order.price}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">{order.qty}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        order.status === 'filled' ? 'text-green-400 bg-green-900/20' :
                        order.status === 'pending' ? 'text-yellow-400 bg-yellow-900/20' :
                        'text-red-400 bg-red-900/20'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {order.status === 'pending' && order.order_type.startsWith('tp') && (
                        <div className="flex gap-1">
                          <button onClick={() => openTpEditModal(order)}
                            className="rounded border border-slate-600 px-1.5 py-0.5 text-xs text-slate-400 hover:border-blue-500 hover:text-blue-400">
                            Edit
                          </button>
                          <button onClick={() => handleCancelOrder(order.id)}
                            className="rounded border border-slate-600 px-1.5 py-0.5 text-xs text-red-400 hover:border-red-500">
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={closeOpen}
        title="Close Position"
        onClose={() => !closeSubmitting && setCloseOpen(false)}
        footer={
          <>
            <button onClick={() => setCloseOpen(false)} disabled={closeSubmitting}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={submitClose} disabled={closeSubmitting}
              className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300 hover:bg-red-900/60 disabled:opacity-50">
              {closeSubmitting ? 'Closing…' : 'Close'}
            </button>
          </>
        }
      >
        <label className="mb-1 block text-sm text-slate-400">Quantity</label>
        <input type="number" step="any" min="0" value={closeQty}
          onChange={e => setCloseQty(e.target.value)}
          className={INPUT_CLASS} />
        <p className="mt-2 text-xs text-slate-500">
          0 or empty closes the entire remaining position ({setup.remaining_qty ?? 0}).
        </p>
        <button onClick={() => setCloseQty('0')}
          className="mt-2 text-xs text-blue-400 transition-colors hover:text-blue-300">
          Close full position
        </button>
        {closeError && (
          <div className="mt-3 rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
            {closeError}
          </div>
        )}
      </Modal>

      <Modal
        open={slOpen}
        title="Modify Stop Loss"
        onClose={() => !slSubmitting && setSlOpen(false)}
        footer={
          <>
            <button onClick={() => setSlOpen(false)} disabled={slSubmitting}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={submitSl} disabled={slSubmitting}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              {slSubmitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <label className="mb-1 block text-sm text-slate-400">New Stop Loss Price</label>
        <input type="number" step="any" value={slValue}
          onChange={e => setSlValue(e.target.value)}
          className={INPUT_CLASS} />
        <p className="mt-2 text-xs text-slate-500">
          {setup.side === 'long'
            ? 'Must be below the current market price. The existing stop is replaced on the exchange.'
            : 'Must be above the current market price. The existing stop is replaced on the exchange.'}
        </p>
        {slError && (
          <div className="mt-3 rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
            {slError}
          </div>
        )}
      </Modal>

      {tpEditOrder && (
        <Modal
          open={!!tpEditOrder}
          title={`Edit ${ORDER_TYPE_LABELS[tpEditOrder.order_type] || tpEditOrder.order_type}`}
          onClose={() => !tpEditSubmitting && setTpEditOrder(null)}
          footer={
            <>
              <button onClick={() => setTpEditOrder(null)} disabled={tpEditSubmitting}
                className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitTpEdit} disabled={tpEditSubmitting}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {tpEditSubmitting ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <label className="mb-1 block text-sm text-slate-400">Price</label>
          <input type="number" step="any" value={tpEditPrice}
            onChange={e => setTpEditPrice(e.target.value)}
            className={INPUT_CLASS} />
          <label className="mt-3 mb-1 block text-sm text-slate-400">Quantity</label>
          <input type="number" step="any" min="0" value={tpEditQty}
            onChange={e => setTpEditQty(e.target.value)}
            className={INPUT_CLASS} />
          {tpEditError && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
              {tpEditError}
            </div>
          )}
        </Modal>
      )}

      {tpAddOpen && (
        <Modal
          open={tpAddOpen}
          title="Add Take Profit"
          onClose={() => !tpAddSubmitting && setTpAddOpen(false)}
          footer={
            <>
              <button onClick={() => setTpAddOpen(false)} disabled={tpAddSubmitting}
                className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitTpAdd} disabled={tpAddSubmitting}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {tpAddSubmitting ? 'Adding…' : 'Add'}
              </button>
            </>
          }
        >
          <label className="mb-1 block text-sm text-slate-400">Price</label>
          <input type="number" step="any" value={tpAddPrice}
            onChange={e => setTpAddPrice(e.target.value)}
            className={INPUT_CLASS} />
          <label className="mt-3 mb-1 block text-sm text-slate-400">Quantity</label>
          <input type="number" step="any" min="0" value={tpAddQty}
            onChange={e => setTpAddQty(e.target.value)}
            className={INPUT_CLASS} />
          {tpAddError && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
              {tpAddError}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
