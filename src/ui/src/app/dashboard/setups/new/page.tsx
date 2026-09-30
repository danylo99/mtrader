'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Info } from 'lucide-react';
import engineFetch from '@/lib/api';
import { TIMEFRAMES, INDICATORS, DEFAULT_TP_RATIOS } from '@/lib/constants';
import type { ExchangeAccount, SetupFormData, Side, EntryIndicatorType, Timeframe, RiskType } from '@/lib/types';
import SymbolPicker from '@/components/SymbolPicker';

export default function SetupFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');

  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [showNoAccountModal, setShowNoAccountModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState<SetupFormData>({
    exchange_account_id: 0,
    symbol: '',
    side: 'long',
    memo: '',
    activation_price: 0,
    ignore_box_upper: 0,
    ignore_box_lower: 0,
    entry_indicator_type: 'supertrend',
    entry_indicator_tf: 'h1',
    entry_pricelevel_value: 0,
    risk_type: 'fixed',
    risk_value: 0,
    sl_price: 0,
    tp_prices: [...DEFAULT_TP_RATIOS],
    be_enabled: false,
    be_trigger_price: 0,
    exit_indicator_type: undefined,
    exit_indicator_tf: undefined,
    exit_pricelevel_value: 0,
  });

  async function fetchAccounts() {
    setLoading(true);
    try {
      const data = await engineFetch('/api/accounts');
      if (data.success) {
        setAccounts(data.data);
        if (!data.data || data.data.length === 0) {
          setShowNoAccountModal(true);
        }
        if (data.data.length > 0 && formData.exchange_account_id === 0) {
          updateField('exchange_account_id', data.data[0].id);
        }
      }
    } catch {
      // fetch failed — accounts will remain empty
    }
    setLoading(false);
  }

  useEffect(() => { fetchAccounts(); }, []);

  const [rawNums, setRawNums] = useState<Record<string, string>>({});
  const [rawTp, setRawTp] = useState<Record<number, string>>({});
  const [startRr, setStartRr] = useState('0.6');
  const [endRr, setEndRr] = useState('3');
  const [tpLength, setTpLength] = useState('20');

  function updateField<K extends keyof SetupFormData>(key: K, value: SetupFormData[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function handleNum(key: keyof SetupFormData, raw: string) {
    setRawNums((prev) => ({ ...prev, [key]: raw }));
    if (raw === '' || raw === '-' || raw === '.') return;
    const num = parseFloat(raw);
    if (!isNaN(num)) updateField(key as any, num);
  }

  function numVal(key: keyof SetupFormData): string | number {
    return rawNums[key] !== undefined ? rawNums[key] : (formData as any)[key];
  }

  function showZeroWarning(key: keyof SetupFormData): React.ReactNode {
    if (rawNums[key] !== undefined && (formData as any)[key] === 0) {
      const hints: Record<string, string> = {
        activation_price: 'Set to 0 for auto-detection',
        ignore_box_upper: 'Set to 0 to disable',
        ignore_box_lower: 'Set to 0 to disable',
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    // Determine status based on activation price
    const status = formData.activation_price === 0 ? 'triggered' : 'pending';

    const payload = {
      ...formData,
      status,
      be_enabled: formData.be_enabled,
      be_trigger_price: formData.be_enabled ? formData.be_trigger_price : 0,
    };

    const data = await engineFetch('/api/setups', { method: 'POST', body: JSON.stringify(payload) });
    setSubmitting(false);

    if (data.success) {
      router.push(`/dashboard/setups/${data.data.id}`);
    } else {
      setError(data.error || 'Failed to create setup');
    }
  }

  return (
    <div>
      {showNoAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-slate-800 border border-slate-700/50 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">No Bybit Account Found</h3>
            <p className="text-sm text-slate-300 mb-4">You must add a Bybit account before creating a trading setup.</p>
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

      <h1 className="text-2xl font-bold text-white mb-6">New Trading Setup</h1>

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
                placeholder="Notes about this setup..."
                rows={1}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Activation & Ignore Box */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">2</span>
            Activation & Ignore Box
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Activation Price</label>
<input
type="number"
                  step="any"
                  value={numVal('activation_price')}
                  onChange={(e) => handleNum('activation_price', e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                  required
                />
                {showZeroWarning('activation_price')}
                {formData.activation_price === 0 && (
                  <div className="mt-2 p-2 rounded bg-green-900/30 border border-green-800">
                    <p className="text-xs text-green-400">Setup will be <span className="font-semibold">immediately triggered</span> when created.</p>
                  </div>
                )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Ignore Box Upper</label>
<input
type="number"
                  step="any"
                  value={numVal('ignore_box_upper')}
                  onChange={(e) => handleNum('ignore_box_upper', e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                  required
                />
                {showZeroWarning('ignore_box_upper')}
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Ignore Box Lower</label>
<input
                  type="number"
                  step="any"
                  value={numVal('ignore_box_lower')}
                  onChange={(e) => handleNum('ignore_box_lower', e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                  required
                />
                {showZeroWarning('ignore_box_lower')}
            </div>
          </div>
        </div>

        {/* Section 3: Entry Conditions */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">3</span>
            Entry Conditions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Indicator Type</label>
              <select
                value={formData.entry_indicator_type}
                onChange={(e) => updateField('entry_indicator_type', e.target.value as EntryIndicatorType)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
              >
                {INDICATORS.map((ind) => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Timeframe</label>
              <select
                value={formData.entry_indicator_tf}
                onChange={(e) => updateField('entry_indicator_tf', e.target.value as Timeframe)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>{tf.label}</option>
                ))}
              </select>
            </div>
          </div>
          {formData.entry_indicator_type === 'pricelevel' && (
            <div className="mt-4">
              <label className="mb-1 block text-sm text-slate-400">Price Level</label>
              <input
                type="number"
                step="any"
                value={numVal('entry_pricelevel_value')}
                onChange={(e) => handleNum('entry_pricelevel_value', e.target.value)}
                className="w-full sm:max-w-xs rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                required
              />
            </div>
          )}
        </div>

        {/* Section 4: Risk Management */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">4</span>
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
              <label className="mb-1 block text-sm text-slate-400">Risk Value</label>
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
                SL Price
                <span className="ml-1 text-xs text-slate-500">(0 for auto)</span>
              </label>
<input
                  type="number"
                  step="any"
                  value={numVal('sl_price')}
                  onChange={(e) => handleNum('sl_price', e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                />
            </div>
          </div>
        </div>

        {/* Section 5: Take Profit */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">5</span>
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
                    {formData.side === 'long' && formData.sl_price > 0
                      ? `Target: ${formData.activation_price + Math.abs(formData.activation_price - formData.sl_price) * rr}`
                      : formData.side === 'short' && formData.sl_price > 0
                      ? `Target: ${formData.activation_price - Math.abs(formData.activation_price - formData.sl_price) * rr}`
                      : 'Enter SL to calculate'}
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

        {/* Section 6: Break Even */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">6</span>
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

        {/* Section 7: Exit Conditions */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">7</span>
            Exit Conditions
            <span className="text-xs text-slate-500 font-normal">(optional)</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Indicator Type</label>
              <select
                value={formData.exit_indicator_type ?? ''}
                onChange={(e) => updateField('exit_indicator_type', (e.target.value || undefined) as EntryIndicatorType | undefined)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
              >
                <option value="">Not set</option>
                {INDICATORS.map((ind) => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Timeframe</label>
              <select
                value={formData.exit_indicator_tf ?? ''}
                onChange={(e) => updateField('exit_indicator_tf', (e.target.value || undefined) as Timeframe | undefined)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
              >
                <option value="">Not set</option>
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>{tf.label}</option>
                ))}
              </select>
            </div>
          </div>
          {formData.exit_indicator_type === 'pricelevel' && (
            <div className="mt-4">
              <label className="mb-1 block text-sm text-slate-400">Price Level</label>
              <input
                type="number"
                step="any"
                value={numVal('exit_pricelevel_value')}
                onChange={(e) => handleNum('exit_pricelevel_value', e.target.value)}
                className="w-full sm:max-w-xs rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                required
              />
            </div>
          )}
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
            {submitting ? 'Creating...' : 'Create Setup'}
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
