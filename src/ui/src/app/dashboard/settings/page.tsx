'use client';

import { useState, useEffect } from 'react';
import { Plus, Key, Pencil, Trash2, Check, X, Send, Save, Shield } from 'lucide-react';
import type { ExchangeAccount } from '@/lib/types';
import engineFetch from '@/lib/api';

interface AccountFormData {
  exchange: string;
  label: string;
  api_key: string;
  api_secret: string;
  is_testnet: boolean;
}

const emptyForm: AccountFormData = { exchange: 'bybit', label: '', api_key: '', api_secret: '', is_testnet: true };

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Account form state
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ExchangeAccount | null>(null);
  const [accountForm, setAccountForm] = useState<AccountFormData>(emptyForm);
  const [deletingAccountId, setDeletingAccountId] = useState<number | null>(null);

  // Telegram state
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Sections
  const [activeSection, setActiveSection] = useState<'bybit' | 'telegram' | 'password'>('bybit');

  async function fetchAccounts() {
    setLoading(true);
    try {
      const data = await engineFetch('/api/accounts');
      if (data.success) setAccounts(data.data);
    } catch {
      // ignore
    }
    setLoading(false);
  }

  useEffect(() => {
    void (async () => {
      await fetchAccounts();
      try {
        const data = await engineFetch('/api/auth/me');
        if (data.success && data.data?.telegram_chat_id) {
          setTelegramChatId(data.data.telegram_chat_id);
        }
      } catch {}
    })();
  }, []);

  function clearMessages() {
    setError('');
    setSuccessMessage('');
  }

  function resetAccountForm() {
    setAccountForm(emptyForm);
    setEditingAccount(null);
    setShowAccountForm(false);
  }

  function startEditAccount(acc: ExchangeAccount) {
    setEditingAccount(acc);
    setAccountForm({ exchange: acc.exchange, label: acc.label, api_key: '', api_secret: '', is_testnet: !!acc.is_testnet });
    setShowAccountForm(true);
    clearMessages();
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();

    const url = editingAccount ? `/api/accounts/${editingAccount.id}` : '/api/accounts';
    const method = editingAccount ? 'PUT' : 'POST';

    const data = await engineFetch(url, { method, body: JSON.stringify(accountForm) });
    if (data.success) {
      resetAccountForm();
      fetchAccounts();
      setSuccessMessage(editingAccount ? 'Account updated successfully' : 'Account created successfully');
    } else {
      setError(data.error || 'Failed to save account');
    }
  }

  async function handleDeleteAccount(accountId: number) {
    clearMessages();
    const data = await engineFetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
    if (data.success) {
      setDeletingAccountId(null);
      fetchAccounts();
      setSuccessMessage('Account and associated trades deleted successfully');
    } else {
      setError(data.error || 'Failed to delete account');
    }
  }

  async function handleTelegramSave() {
    clearMessages();
    setTelegramSaving(true);
    const data = await engineFetch('/api/users/telegram', { method: 'PATCH', body: JSON.stringify({ telegram_chat_id: telegramChatId || null }) });
    setTelegramSaving(false);
    if (data.success) {
      setSuccessMessage('Telegram user ID saved successfully');
    } else {
      setError(data.error || 'Failed to save Telegram user ID');
    }
  }

  async function handleTelegramTest() {
    clearMessages();
    setTelegramTesting(true);
    try {
      const data = await engineFetch('/api/users/telegram/test', { method: 'POST', body: JSON.stringify({ chatId: telegramChatId }) });
      if (data.success) {
        setSuccessMessage('Test message sent successfully! Check your Telegram.');
      } else {
        setError(data.error || 'Failed to send test message');
      }
    } catch {
      setError('Failed to connect to Telegram service');
    }
    setTelegramTesting(false);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    setPasswordSaving(true);
    const data = await engineFetch('/api/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
    setPasswordSaving(false);
    if (data.success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccessMessage('Password changed successfully');
    } else {
      setError(data.error || 'Failed to change password');
    }
  }

  const sectionClass = (section: string) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      activeSection === section
        ? 'bg-blue-600 text-white'
        : 'bg-slate-700/50 text-slate-400 hover:text-white'
    }`;

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">Settings</h1>

      {/* Section Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button onClick={() => { setActiveSection('bybit'); clearMessages(); }} className={sectionClass('bybit')}>
          Exchange Accounts
        </button>
        <button onClick={() => { setActiveSection('telegram'); clearMessages(); }} className={sectionClass('telegram')}>
          Telegram
        </button>
        <button onClick={() => { setActiveSection('password'); clearMessages(); }} className={sectionClass('password')}>
          Password
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="mb-4 rounded-lg bg-green-900/30 border border-green-700/50 px-4 py-3 text-sm text-green-400">
          {successMessage}
        </div>
      )}

      {/* === BYBIT ACCOUNTS SECTION === */}
      {activeSection === 'bybit' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Exchange Accounts</h2>
            <button
              onClick={() => { resetAccountForm(); setShowAccountForm(!showAccountForm); clearMessages(); }}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Link Account
            </button>
          </div>

          {/* Account Form (Add/Edit) */}
          {showAccountForm && (
            <div className="mb-6 rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 font-semibold text-white">
                {editingAccount ? 'Edit Exchange Account' : 'Link Exchange Account'}
              </h2>
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Exchange</label>
                  <select
                    value={accountForm.exchange}
                    onChange={(e) => setAccountForm({ ...accountForm, exchange: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                    required
                    disabled={!!editingAccount}
                  >
                    <option value="bybit">Bybit</option>
                    <option value="hyperliquid">Hyperliquid</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">Label</label>
                  <input
                    type="text"
                    value={accountForm.label}
                    onChange={(e) => setAccountForm({ ...accountForm, label: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                    placeholder="Main Account"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">API Key</label>
                  <input
                    type="password"
                    value={accountForm.api_key}
                    onChange={(e) => setAccountForm({ ...accountForm, api_key: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                    placeholder={editingAccount ? 'Leave blank to keep existing' : ''}
                    required={!editingAccount}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-400">API Secret</label>
                  <input
                    type="password"
                    value={accountForm.api_secret}
                    onChange={(e) => setAccountForm({ ...accountForm, api_secret: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                    placeholder={editingAccount ? 'Leave blank to keep existing' : ''}
                    required={!editingAccount}
                  />
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={accountForm.is_testnet}
                    onChange={(e) => setAccountForm({ ...accountForm, is_testnet: e.target.checked })}
                    className="rounded border-slate-600"
                  />
                  <span className="text-sm text-slate-400">Testnet</span>
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                    {editingAccount ? 'Update Account' : 'Save Account'}
                  </button>
                  <button type="button" onClick={resetAccountForm} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Accounts List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <Key className="mb-2 h-10 w-10" />
              <p>No accounts linked</p>
              <p className="text-sm">Click &quot;Link Account&quot; to add an exchange account</p>
            </div>
          ) : (
            <div className="space-y-4">
              {accounts.map((acc) => (
                <div key={acc.id} className="rounded-xl border border-slate-700/50 bg-slate-800 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{acc.label}</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {acc.exchange.toUpperCase()} &bull; {acc.is_testnet ? 'Testnet' : 'Mainnet'} &bull; Created {new Date(acc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        acc.is_testnet ? 'bg-yellow-900/30 text-yellow-400' : 'bg-green-900/30 text-green-400'
                      }`}>
                        {acc.is_testnet ? 'Testnet' : 'Live'}
                      </span>
                      <button
                        onClick={() => startEditAccount(acc)}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 transition-colors"
                        title="Edit account"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {deletingAccountId === acc.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDeleteAccount(acc.id)}
                            className="rounded-lg p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
                            title="Confirm delete"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeletingAccountId(null)}
                            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                            title="Cancel delete"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setDeletingAccountId(acc.id); clearMessages(); }}
                          className="rounded-lg p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                          title="Delete account (this will also delete all associated trades)"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {deletingAccountId === acc.id && (
                    <p className="mt-2 text-xs text-red-400">
                      Are you sure? This will permanently delete this account and all associated setups and orders.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === TELEGRAM SECTION === */}
      {activeSection === 'telegram' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <Send className="h-5 w-5 text-blue-400" />
            Telegram Settings
          </h2>
          <p className="mb-4 text-sm text-slate-400">
            Set your Telegram user ID (chat ID) to receive trading notifications.
            If this is not set, no Telegram messages will be sent.
          </p>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Telegram User ID (Chat ID)</label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                placeholder="Enter your Telegram chat ID (e.g., 123456789)"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleTelegramSave}
                disabled={telegramSaving}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {telegramSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleTelegramTest}
                disabled={telegramTesting || !telegramChatId}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {telegramTesting ? 'Sending...' : 'Send Test Message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === PASSWORD SECTION === */}
      {activeSection === 'password' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-4 sm:p-6 max-w-md">
          <h2 className="mb-4 font-semibold text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-400" />
            Change Password
          </h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-white outline-none focus:border-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={passwordSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {passwordSaving ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}