'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Info } from 'lucide-react';
import engineFetch from '@/lib/api';
import { DEFAULT_TP_RATIOS } from '@/lib/constants';
import type { ExchangeAccount, Side, RiskType } from '@/lib/types';
import SymbolPicker from '@/components/SymbolPicker';

export default function ManualOrderFormPage() {
  const router = useRouter();

  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [showNoAccountModal, setShowNoAccountModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    exchange_account_id: 0,
    symbol: '',
    side: 'long' as Side,
    memo: '',
    risk_type: 'fixed' as RiskType,
    risk_value: 0,
    sl_price: 0,
    tp_prices: [...DEFAULT_TP_RATIOS],
    be_enabled: false,
    be_trigger_price: 0,
    exit_indicator_type: undefined as string | undefined,
    exit_indicator_tf: undefined as string | undefined,
  });

  const [slTouched, setSlTouched] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await engineFetch('/api/accounts');
        if (!active || !data.success) return;
        setAccounts(data.data);
        if (!data.data || data.data.length === 0) {
          setShowNoAccountModal(true);
          return;
        }
        setFormData((prev) => (
          prev.exchange_account_id === 0 ? { ...prev, exchange_account_id: data.data[0].id } : prev
        ));
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  const [rawNums, setRawNums] = useState<Record<string, string>>({});
  const [rawTp, setRawTp] = useState<Record<number, string>>({});
  const [startRr, setStartRr] = useState('0.6');
  const [endRr, setEndRr] = useState('3');
  const [tpLength, setTpLength] = useState('20');

  function updateField<K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  type NumericFormKey = 'exchange_account_id' | 'risk_value' | 'sl_price' | 'be_trigger_price';

  function handleNum(key: NumericFormKey, raw: string) {
    setRawNums((prev) => ({ ...prev, [key]: raw }));
    if (raw === '' || raw === '-' || raw === '.') return;
    const num = parseFloat(raw);
    if (!isNaN(num)) updateField(key, num);
  }

  function numVal(key: NumericFormKey): string | number {
    return rawNums[key] !== undefined ? rawNums[key] : formData[key];
  }

  function showZeroWarning(key: NumericFormKey): React.ReactNode {
    if (rawNums[key] !== undefined && formData[key] === 0) {
      const hints: Record<string, string> = {
        be_trigger_price: 'Price will trigger immediately if BE is enabled',
      };
      return <p className="mt-1 text-xs text-yellow-400">{hints[key] || 'Value cannot be zero'}</p>;
    }
    return null;
  }

  function addTpLevel() {
    if (formData.tp_prices.length < 100) {
      const nextRr = formData.tp_prices.length > 0 ? +(Math.max(...formData.tp_prices) + 1).toFixed(1) : 1;
      updateField('tp_prices', [...formData.tp_prices, nextRr]);
    }
  }

  function removeTpLevel(index: number) {
    const updated = formData.tp_prices.filter((_, i) => i !== index);
    updateField('tp_prices', updated);
  }

  function updateTpLevel(index: number, value: number) {
    const updated = [...formData.tp_prices];
    updated[index] = value;
    updateField('tp_prices', updated);
  }

  function handleTpRaw(index: number, raw: string) {
    setRawTp((prev) => ({ ...prev, [index]: raw }));
    if (raw === '' || raw === '-' || raw === '.') return;
    const num = parseFloat(raw);
    if (!isNaN(num)) updateTpLevel(index, num);
  }

  function tpVal(index: number): string | number {
    return rawTp[index] !== undefined ? rawTp[index] : formData.tp_prices[index];
  }

  function generateTpList() {
    const start = parseFloat(startRr);
    const end = parseFloat(endRr);
    const len = parseInt(tpLength, 10);
    if (isNaN(start) || isNaN(end) || isNaN(len) || len < 1) return;
    const step = (end - start) / (len - 1);
    const values = Array.from({ length: len }, (_, i) => +(start + step * i).toFixed(1));
    updateField('tp_prices', values);
  }

  const slError = slTouched && formData.sl_price <= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (formData.sl_price <= 0) {
      setSlTouched(true);
      setError('Stop Loss is mandatory for manual orders');
      return;
    }

    if (formData.risk_value <= 0) {
      setError('Risk value must be greater than 0');
      return;
    }

    setSubmitting(true);

    const payload = {
      exchange_account_id: formData.exchange_account_id,
      symbol: formData.symbol,
      side: formData.side,
      memo: formData.memo || undefined,
      entry_indicator_type: 'manual',
      entry_indicator_tf: 'manual',
      risk_type: formData.risk_type,
      risk_value: formData.risk_value,
      sl_price: formData.sl_price,
      tp_prices: formData.tp_prices,
      be_enabled: formData.be_enabled,
      be_trigger_price: formData.be_enabled ? formData.be_trigger_price : 0,
      exit_indicator_type: formData.exit_indicator_type || undefined,
      exit_indicator_tf: formData.exit_indicator_tf || undefined,
    };

    const data = await engineFetch('/api/orders/place', { method: 'POST', body: JSON.stringify(payload) });
    setSubmitting(false);

    if (data.success) {
      router.push(`/dashboard/setups/${data.data.id}`);
    } else {
      setError(data.error || 'Failed to place order');
    }
  }

  return (
    <div>
      {showNoAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-slate-800 border border-slate-700/50 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">No Bybit Account Found</h3>
            <p className="text-sm text-slate-300 mb-4">You must add a Bybit account before placing a manual order.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNoAccountModal(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
              >
                Close
              </button>
              <button
                onClick={() => router.push('/dashboard/settings')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Go to Bybit Accounts
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="text-2xl font-bold text-white mb-6">Place Manual Order</h1>

      <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 max-w-3xl">
        {/* Section 1: Account & Basic Info */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">1</span>
            Account & Basic Info
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Account</label>
              <select
                value={formData.exchange_account_id}
                onChange={(e) => updateField('exchange_account_id', Number(e.target.value))}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                required
              >
                <option value={0} disabled>Select account</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.label} ({acc.is_testnet ? 'Testnet' : 'Mainnet'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Symbol</label>
              <SymbolPicker
                value={formData.symbol}
                onChange={(val) => updateField('symbol', val.toUpperCase())}
                exchange={accounts.find(a => a.id === formData.exchange_account_id)?.exchange || 'bybit'}
                placeholder="Select symbol..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Side</label>
              <div className="flex gap-4">
                {(['long', 'short'] as Side[]).map((s) => (
                  <label key={s} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="side"
                      value={s}
                      checked={formData.side === s}
                      onChange={(e) => updateField('side', e.target.value as Side)}
                      className="text-blue-600"
                    />
                    <span className={`text-sm font-medium ${s === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Memo (optional)</label>
              <textarea
                value={formData.memo}
                onChange={(e) => updateField('memo', e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500"
                placeholder="Notes about this order..."
                rows={1}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Entry Type (static — manual) */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">2</span>
            Entry
          </h2>
          <div className="inline-flex items-center gap-2 rounded-lg bg-green-900/30 border border-green-800 px-4 py-2">
            <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Entry Type:</span>
            <span className="text-sm font-medium text-green-300">Manual</span>
            <span className="text-xs text-green-500">— Order placed immediately at market price</span>
          </div>
        </div>

        {/* Section 3: Risk Management */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">3</span>
            Risk Management
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Risk Type</label>
              <div className="flex gap-4 mt-2">
                {(['percent', 'fixed'] as RiskType[]).map((rt) => (
                  <label key={rt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="risk_type"
                      value={rt}
                      checked={formData.risk_type === rt}
                      onChange={(e) => updateField('risk_type', e.target.value as RiskType)}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-slate-300">{rt === 'percent' ? '% Risk' : 'Fixed $'}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Risk Value <span className="text-red-400">*</span></label>
              <input
                type="number"
                step="any"
                value={numVal('risk_value')}
                onChange={(e) => handleNum('risk_value', e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">
                SL Price <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="any"
                value={numVal('sl_price')}
                onChange={(e) => { handleNum('sl_price', e.target.value); setSlTouched(true); }}
                className={`w-full rounded-lg border px-4 py-2.5 text-white outline-none focus:border-blue-500 ${
                  slError ? 'border-red-500 bg-red-900/20' : 'border-slate-600 bg-slate-700/50'
                }`}
                required
              />
              {slError && (
                <p className="mt-1 text-xs text-red-400">Stop Loss is mandatory for manual orders</p>
              )}
            </div>
          </div>
        </div>

        {/* Section 4: Take Profit */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">4</span>
            Take Profit Settings
          </h2>

          <div className="mb-4 flex flex-wrap items-end gap-3 p-3 rounded-lg bg-slate-700/30 border border-slate-600/50">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Start RR</label>
              <input type="number" step="0.1" min="0.1" value={startRr}
                onChange={(e) => setStartRr(e.target.value)}
                className="w-20 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">End RR</label>
              <input type="number" step="0.1" min="0.1" value={endRr}
                onChange={(e) => setEndRr(e.target.value)}
                className="w-20 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Length</label>
              <input type="number" min="1" max="100" value={tpLength}
                onChange={(e) => setTpLength(e.target.value)}
                className="w-20 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
            </div>
            <button type="button" onClick={generateTpList}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
              Generate
            </button>
          </div>

          <div className="space-y-3">
            {formData.tp_prices.map((rr, index) => (
              <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <span className="w-full sm:w-24 text-sm text-slate-400">TP{index + 1} (RR):</span>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={tpVal(index)}
                    onChange={(e) => handleTpRaw(index, e.target.value)}
                    className="w-20 sm:w-24 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-white outline-none focus:border-blue-500"
                  />
                  <span className="text-xs text-slate-500 break-all">
                    Target RR
                  </span>
                  {formData.tp_prices.length > 0 && (
                    <button
                      type="button"
                      onClick={() => removeTpLevel(index)}
                      className="p-1 text-red-400 hover:text-red-300 transition-colors shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {formData.tp_prices.length < 100 && (
              <button
                type="button"
                onClick={addTpLevel}
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add TP Level
              </button>
            )}
          </div>
        </div>

        {/* Section 5: Break Even */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">5</span>
            Break-Even Settings
          </h2>
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.be_enabled}
                onChange={(e) => updateField('be_enabled', e.target.checked)}
                className="rounded border-slate-600 text-blue-600"
              />
              <span className="text-sm text-slate-300">Enable Break-Even</span>
              <Info className="h-4 w-4 text-slate-500" />
            </label>
            {formData.be_enabled && (
              <div>
                <label className="mb-1 block text-sm text-slate-400">BE Trigger Price</label>
                <input
                  type="number"
                  step="any"
                  value={numVal('be_trigger_price')}
                  onChange={(e) => handleNum('be_trigger_price', e.target.value)}
                  className="w-full sm:max-w-xs rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                  required
                />
                {showZeroWarning('be_trigger_price')}
                <p className="mt-1 text-xs text-slate-500">SL moves to entry price when TP1 is hit</p>
              </div>
            )}
          </div>
        </div>

        {/* Section 6: Exit Conditions */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">6</span>
            Exit Conditions
            <span className="text-xs text-slate-500 font-normal">(optional)</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Indicator Type</label>
              <select
                value={formData.exit_indicator_type ?? ''}
                onChange={(e) => updateField('exit_indicator_type', e.target.value || undefined)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
              >
                <option value="">Not set</option>
                <option value="supertrend">SuperTrend</option>
                <option value="rollingsupertrend">Rolling SuperTrend</option>
                <option value="rollingsupertrend2">Rolling SuperTrend2</option>
                <option value="macd">MACD</option>
                <option value="ema">EMA Cross</option>
                <option value="ewt">EW Trading</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Timeframe</label>
              <select
                value={formData.exit_indicator_tf ?? ''}
                onChange={(e) => updateField('exit_indicator_tf', e.target.value || undefined)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
              >
                <option value="">Not set</option>
                <option value="m1">1 Minute</option>
                <option value="m5">5 Minutes</option>
                <option value="m15">15 Minutes</option>
                <option value="m30">30 Minutes</option>
                <option value="h1">1 Hour</option>
                <option value="h2">2 Hours</option>
                <option value="h4">4 Hours</option>
                <option value="d1">1 Day</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="submit"
            disabled={submitting || accounts.length === 0}
            className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 w-full sm:w-auto"
          >
            {submitting ? 'Placing Order...' : 'Place Order'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-slate-600 px-6 py-2.5 font-medium text-slate-300 transition-colors hover:bg-slate-700 w-full sm:w-auto"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}