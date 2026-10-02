'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Info } from 'lucide-react';
import engineFetch from '@/lib/api';
import { TIMEFRAMES, INDICATORS, DEFAULT_TP_RATIOS } from '@/lib/constants';
import type { ExchangeAccount, TradingSetup, SetupFormData, Side, EntryIndicatorType, Timeframe, RiskType } from '@/lib/types';
import SymbolPicker from '@/components/SymbolPicker';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  triggered: 'Triggered',
  active: 'Active',
  closed: 'Closed',
  cancelled: 'cancelled',
};

export default function EditSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const mode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('mode')
    : null;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [originalSetup, setOriginalSetup] = useState<TradingSetup | null>(null);

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
    risk_type: 'percent',
    risk_value: 0,
    sl_price: 0,
    tp_prices: [...DEFAULT_TP_RATIOS],
    be_enabled: false,
    be_trigger_price: 0,
    exit_indicator_type: undefined,
    exit_indicator_tf: undefined,
    exit_pricelevel_value: 0,
  });

  const [rawNums, setRawNums] = useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [startRr, setStartRr] = useState('0.6');
  const [endRr, setEndRr] = useState('3');
  const [tpLength, setTpLength] = useState('20');

  useEffect(() => {
    (async () => {
      try {
        const accountsData = await engineFetch('/api/accounts');
        const setupData = await engineFetch(`/api/setups/${id}`);
        if (accountsData.success) setAccounts(accountsData.data);
        if (setupData.success) {
          const s = setupData.data;
          setOriginalSetup(s);
          setFormData({
            exchange_account_id: s.exchange_account_id,
            symbol: s.symbol,
            side: s.side,
            memo: s.memo || '',
            activation_price: s.activation_price,
            ignore_box_upper: s.ignore_box_upper,
            ignore_box_lower: s.ignore_box_lower,
            entry_indicator_type: s.entry_indicator_type,
            entry_indicator_tf: s.entry_indicator_tf,
            entry_pricelevel_value: s.entry_pricelevel_value || 0,
            risk_type: s.risk_type,
            risk_value: s.risk_value,
            sl_price: s.sl_price || 0,
            tp_prices: (() => { try { return JSON.parse(s.tp_prices); } catch { return DEFAULT_TP_RATIOS; } })(),
            be_enabled: !!s.be_enabled,
            be_trigger_price: s.be_trigger_price || 0,
            exit_indicator_type: s.exit_indicator_type || undefined,
            exit_indicator_tf: s.exit_indicator_tf || undefined,
            exit_pricelevel_value: s.exit_pricelevel_value || 0,
          });
        }
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, [id]);

  const status = originalSetup?.status || 'pending';
  const isReadOnly = status === 'closed' || status === 'cancelled';
  const isBeOnly = mode === 'be' && !isReadOnly;
  const isActive = status === 'active' && !isBeOnly && !isReadOnly;
  const isTriggered = status === 'triggered' && !isBeOnly && !isActive && !isReadOnly;
  const isPending = status === 'pending' && !isBeOnly && !isActive && !isReadOnly;

  function updateField<K extends keyof SetupFormData>(key: K, value: SetupFormData[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  type NumericFormKey =
    | 'exchange_account_id'
    | 'activation_price'
    | 'ignore_box_upper'
    | 'ignore_box_lower'
    | 'entry_pricelevel_value'
    | 'risk_value'
    | 'sl_price'
    | 'be_trigger_price'
    | 'exit_pricelevel_value';

  function handleNum(key: NumericFormKey, raw: string) {
    setRawNums((prev) => ({ ...prev, [key]: raw }));
    markTouched(key);
    if (raw === '' || raw === '-' || raw === '.') return;
    const num = parseFloat(raw);
    if (!isNaN(num)) updateField(key, num);
  }

  function numVal(key: NumericFormKey): string | number {
    if (rawNums[key] !== undefined) return rawNums[key];
    return formData[key] ?? 0;
  }

  function markTouched(key: string) {
    setTouchedFields((prev) => new Set(prev).add(key));
  }

  function showZeroWarning(key: NumericFormKey): React.ReactNode {
    if (touchedFields.has(key) && formData[key] === 0) {
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

  function updateTpLevel(index: number, value: number) {
    const updated = [...formData.tp_prices];
    updated[index] = value;
    updateField('tp_prices', updated);
  }

  function removeTpLevel(index: number) {
    const updated = formData.tp_prices.filter((_, i) => i !== index);
    updateField('tp_prices', updated);
  }

  function addTpLevel() {
    const maxTp = formData.tp_prices.length > 0 ? Math.max(...formData.tp_prices) : 1;
    if (formData.tp_prices.length < 100) {
      updateField('tp_prices', [...formData.tp_prices, +(maxTp + 1).toFixed(1)]);
    }
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

    const payload = isBeOnly
      ? { be_enabled: formData.be_enabled, be_trigger_price: formData.be_enabled ? formData.be_trigger_price : 0 }
      : {
          ...formData,
          be_enabled: formData.be_enabled,
          be_trigger_price: formData.be_enabled ? formData.be_trigger_price : 0,
          exit_indicator_type: formData.exit_indicator_type,
          exit_indicator_tf: formData.exit_indicator_tf,
          entry_pricelevel_value: formData.entry_pricelevel_value,
          exit_pricelevel_value: formData.exit_pricelevel_value,
        };

    const data = await engineFetch(`/api/setups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    setSubmitting(false);

    if (data.success) {
      router.push(`/dashboard/setups/${id}`);
    } else {
      setError(data.error || 'Failed to update setup');
    }
  }

if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!originalSetup) {
    return <div className="text-slate-500 py-20 text-center">Setup not found</div>;
  }

  if (isReadOnly) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-500 mb-4">This setup is {status} and cannot be edited.</p>
        <button onClick={() => router.push(`/dashboard/setups/${id}`)} className="text-blue-400 hover:text-blue-300">
          View details
        </button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => router.back()} className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

<div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          {isBeOnly ? 'Adjust Break-Even Price' : `Edit Setup \u2014 ${originalSetup.symbol}`}
        </h1>
        <span className="inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium text-yellow-400 bg-yellow-900/20 border-yellow-700/30">
          {STATUS_LABELS[status] || status}
        </span>
        <span className="text-xs text-slate-500">
          {originalSetup.account_label ? `${originalSetup.account_label} (${originalSetup.exchange})` : `Account #${originalSetup.exchange_account_id}`}
        </span>
      </div>

      {isBeOnly && <p className="text-sm text-slate-400 mb-6">Only BE trigger price can be adjusted for active setups.</p>}
      {isActive && <p className="text-sm text-slate-400 mb-6">BE trigger price and exit conditions can be adjusted.</p>}
      {isTriggered && <p className="text-sm text-slate-400 mb-6">Activation price cannot be changed for triggered setups. Ignore box upper and lower can still be edited.</p>}

      <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 max-w-3xl">
        {(isPending || isTriggered) && (
          <>
            <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">1</span>
                Account & Basic Info
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Account</label>
                  <select value={formData.exchange_account_id} onChange={(e) => updateField('exchange_account_id', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500" required>
                    <option value={0} disabled>Select account</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>{acc.label} ({acc.is_testnet ? 'Testnet' : 'Mainnet'})</option>
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
                        <input type="radio" name="side" value={s} checked={formData.side === s}
                          onChange={(e) => updateField('side', e.target.value as Side)} className="text-blue-600" />
                        <span className={`text-sm font-medium ${s === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Memo (optional)</label>
                  <textarea value={formData.memo} onChange={(e) => updateField('memo', e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500"
                    placeholder="Notes about this setup..." rows={1} />
                </div>
              </div>
            </div>

              <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
                <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">2</span>
                  Activation & Ignore Box
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Activation Price</label>
                    <input type="number" step="any" value={numVal('activation_price')}
                      onChange={(e) => handleNum('activation_price', e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                      disabled={isTriggered} required />
                    {showZeroWarning('activation_price')}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Ignore Box Upper</label>
                    <input type="number" step="any" value={numVal('ignore_box_upper')}
                      onChange={(e) => handleNum('ignore_box_upper', e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                      required />
                    {showZeroWarning('ignore_box_upper')}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Ignore Box Lower</label>
                    <input type="number" step="any" value={numVal('ignore_box_lower')}
                      onChange={(e) => handleNum('ignore_box_lower', e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500"
                      required />
                    {showZeroWarning('ignore_box_lower')}
                  </div>
                </div>
              </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">3</span>
                Entry Conditions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Indicator Type</label>
                  <select value={formData.entry_indicator_type}
                    onChange={(e) => updateField('entry_indicator_type', e.target.value as EntryIndicatorType)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500">
                    {INDICATORS.map((ind) => (<option key={ind.value} value={ind.value}>{ind.label}</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Timeframe</label>
                  <select value={formData.entry_indicator_tf}
                    onChange={(e) => updateField('entry_indicator_tf', e.target.value as Timeframe)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500">
                    {TIMEFRAMES.map((tf) => (<option key={tf.value} value={tf.value}>{tf.label}</option>))}
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
                        <input type="radio" name="risk_type" value={rt} checked={formData.risk_type === rt}
                          onChange={(e) => updateField('risk_type', e.target.value as RiskType)} className="text-blue-600" />
                        <span className="text-sm text-slate-300">{rt === 'percent' ? '% Risk' : 'Fixed $'}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Risk Value</label>
                  <input type="number" step="any" value={formData.risk_value}
                    onChange={(e) => updateField('risk_value', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500" required />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">SL Price<span className="ml-1 text-xs text-slate-500">(0 for auto)</span></label>
                  <input type="number" step="any" value={formData.sl_price}
                    onChange={(e) => updateField('sl_price', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>

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
                      <input type="number" step="0.1" min="0.1" value={rr}
                        onChange={(e) => updateTpLevel(index, Number(e.target.value))}
                        className="w-20 sm:w-24 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-white outline-none focus:border-blue-500" />
                      {formData.tp_prices.length > 0 && (
                        <button type="button" onClick={() => removeTpLevel(index)}
                          className="p-1 text-red-400 hover:text-red-300 transition-colors shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {formData.tp_prices.length < 100 && (
                  <button type="button" onClick={addTpLevel}
                    className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors">
                    <Plus className="h-4 w-4" /> Add TP Level
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">6</span>
                Break-Even Settings
              </h2>
              <div className="space-y-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.be_enabled}
                    onChange={(e) => updateField('be_enabled', e.target.checked)}
                    className="rounded border-slate-600 text-blue-600" />
                  <span className="text-sm text-slate-300">Enable Break-Even</span>
                  <Info className="h-4 w-4 text-slate-500" />
                </label>
                {formData.be_enabled && (
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">BE Trigger Price</label>
                    <input type="number" step="any" value={numVal('be_trigger_price')}
                      onChange={(e) => handleNum('be_trigger_price', e.target.value)}
                      className="w-full sm:max-w-xs rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500" required />
                    {showZeroWarning('be_trigger_price')}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">7</span>
                Exit Conditions<span className="text-xs text-slate-500 font-normal">(optional)</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Indicator Type</label>
                  <select value={formData.exit_indicator_type || ''}
                    onChange={(e) => updateField('exit_indicator_type', (e.target.value || undefined) as EntryIndicatorType | undefined)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500">
                    <option value="">Not set</option>
                    {INDICATORS.map((ind) => (<option key={ind.value} value={ind.value}>{ind.label}</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Timeframe</label>
                  <select value={formData.exit_indicator_tf || ''}
                    onChange={(e) => updateField('exit_indicator_tf', (e.target.value || undefined) as Timeframe | undefined)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500">
                    <option value="">Not set</option>
                    {TIMEFRAMES.map((tf) => (<option key={tf.value} value={tf.value}>{tf.label}</option>))}
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
          </>
        )}

        {isBeOnly && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 font-semibold text-white">Break-Even Trigger Price</h2>
              <label className="flex items-center gap-2 cursor-pointer mb-4">
                <input type="checkbox" checked={formData.be_enabled}
                  onChange={(e) => updateField('be_enabled', e.target.checked)}
                  className="rounded border-slate-600 text-blue-600" />
                <span className="text-sm text-slate-300">Enable Break-Even</span>
                <Info className="h-4 w-4 text-slate-500" />
              </label>
              {formData.be_enabled && (
                <>
                  <label className="mb-1 block text-sm text-slate-400">BE Trigger Price</label>
                  <input type="number" step="any" value={numVal('be_trigger_price')}
                    onChange={(e) => handleNum('be_trigger_price', e.target.value)}
                    className="w-full sm:max-w-xs rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500" required />
                  {showZeroWarning('be_trigger_price')}
                  <p className="mt-1 text-xs text-slate-500">SL will move to entry price when TP1 is hit</p>
                </>
              )}
            </div>
          )}

          {isActive && (
            <>
              <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
                <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">1</span>
                  Break-Even Settings
                </h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={formData.be_enabled}
                      onChange={(e) => updateField('be_enabled', e.target.checked)}
                      className="rounded border-slate-600 text-blue-600" />
                    <span className="text-sm text-slate-300">Enable Break-Even</span>
                    <Info className="h-4 w-4 text-slate-500" />
                  </label>
                  {formData.be_enabled && (
                    <div>
                      <label className="mb-1 block text-sm text-slate-400">BE Trigger Price</label>
                      <input type="number" step="any" value={numVal('be_trigger_price')}
                        onChange={(e) => handleNum('be_trigger_price', e.target.value)}
                        className="w-full sm:max-w-xs rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500" required />
                      {showZeroWarning('be_trigger_price')}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
                <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">2</span>
                  Exit Conditions<span className="text-xs text-slate-500 font-normal">(optional)</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Indicator Type</label>
                    <select value={formData.exit_indicator_type || ''}
                      onChange={(e) => updateField('exit_indicator_type', (e.target.value || undefined) as EntryIndicatorType | undefined)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500">
                      <option value="">Not set</option>
                      {INDICATORS.map((ind) => (<option key={ind.value} value={ind.value}>{ind.label}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Timeframe</label>
                    <select value={formData.exit_indicator_tf || ''}
                      onChange={(e) => updateField('exit_indicator_tf', (e.target.value || undefined) as Timeframe | undefined)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white outline-none focus:border-blue-500">
                      <option value="">Not set</option>
                      {TIMEFRAMES.map((tf) => (<option key={tf.value} value={tf.value}>{tf.label}</option>))}
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
            </>
          )}

{error && (
          <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="submit" disabled={submitting}
            className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 w-full sm:w-auto">
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-slate-600 px-6 py-2.5 font-medium text-slate-300 transition-colors hover:bg-slate-700 w-full sm:w-auto">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}