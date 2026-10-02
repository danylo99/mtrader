const express = require('express');
const router = express.Router();
const Database = require('../../db/database');
const auth = require('../middleware/auth');

const db = new Database();
db.connect().catch(() => {});

function normalizeIndicatorType(type) {
  if (!type) return type;
  return type.toLowerCase().replace('ewtrading', 'ewt');
}

// List setups with optional status, pagination, search
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 50, search } = req.query;

    let rows = [];
    if (status) {
      // support comma-separated statuses
      const statuses = String(status).split(',').map(s => s.trim());
      rows = await db.getSetupsByStatus(statuses);
      // filter by user
      rows = rows.filter(r => r.user_id === userId);
    } else {
      // default: get pending/triggered/active
      rows = await db.getSetupsByStatus(['pending', 'triggered', 'active']);
      rows = rows.filter(r => r.user_id === userId);
    }

    // Totals over the full user-scoped status set, before the search filter,
    // so search affects neither total.
    // BE-activated setups are risk-free: SL already moved to entry price.
    // be_activated is only ever set for active setups, so this is a no-op on
    // the pending/triggered tabs.
    const counted = rows.filter(r => r.risk_type === 'fixed' && !Number(r.be_activated));
    const totalFixedRisk = counted.reduce((sum, r) => sum + (Number(r.risk_value) || 0), 0);
    // Stored profit column; only meaningful on active setups (0 elsewhere).
    const totalFloatingPnl = rows.reduce((sum, r) => sum + (Number(r.profit) || 0), 0);
    const summary = {
      totalFixedRisk: Math.round(totalFixedRisk * 100) / 100,
      totalFloatingPnl: Math.round(totalFloatingPnl * 100) / 100,
      fixedCount: counted.length,
      percentCount: rows.filter(r => r.risk_type !== 'fixed').length,
      totalCount: rows.length,
    };

    // basic search
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter(r => (r.symbol && r.symbol.toLowerCase().includes(q)) || (r.memo && r.memo.toLowerCase().includes(q)));
    }

    // pagination
    const p = Math.max(1, parseInt(String(page), 10));
    const lim = Math.max(1, parseInt(String(limit), 10));
    const start = (p - 1) * lim;
    const paged = rows.slice(start, start + lim);

    res.json({ success: true, data: paged, total: rows.length, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create setup
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const payload = req.body || {};

    const sql = `INSERT INTO trading_setups (
      user_id, exchange_account_id, symbol, side, memo, activation_price, ignore_box_upper, ignore_box_lower,
      entry_indicator_type, entry_indicator_tf, entry_pricelevel_value,
      risk_type, risk_value, sl_price, tp_prices,
      be_enabled, be_trigger_price,
      exit_indicator_type, exit_indicator_tf, exit_pricelevel_value,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

    const params = [
      userId,
      payload.exchange_account_id || null,
      payload.symbol || null,
      payload.side || 'long',
      payload.memo || null,
      payload.activation_price || 0,
      payload.ignore_box_upper || 0,
      payload.ignore_box_lower || 0,
      normalizeIndicatorType(payload.entry_indicator_type) || null,
      payload.entry_indicator_tf || null,
      payload.entry_pricelevel_value || 0,
      payload.risk_type || null,
      payload.risk_value || 0,
      payload.sl_price || 0,
      JSON.stringify(payload.tp_prices || []),
      payload.be_enabled ? 1 : 0,
      payload.be_trigger_price || 0,
      normalizeIndicatorType(payload.exit_indicator_type) || null,
      payload.exit_indicator_tf || null,
      payload.exit_pricelevel_value || 0,
      payload.status || 'pending'
    ];

    const result = await db.run(sql, params);
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific setup (with orders)
router.get('/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const setup = await db.getSetupById(id);
    if (!setup) return res.status(404).json({ error: 'Not found' });
    if (setup.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const orders = await db.getOrdersBySetupId(id);
    res.json({ success: true, data: { ...setup, orders } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update setup
router.put('/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const setup = await db.getSetupById(id);
    if (!setup) return res.status(404).json({ error: 'Not found' });
    if (setup.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const updates = [];
    const params = [];
    Object.entries(req.body || {}).forEach(([k, v]) => {
      if (['exchange_account_id','symbol','side','memo','activation_price','ignore_box_upper','ignore_box_lower','entry_indicator_type','entry_indicator_tf','entry_pricelevel_value','risk_type','risk_value','sl_price','tp_prices','be_enabled','be_trigger_price','exit_indicator_type','exit_indicator_tf','exit_pricelevel_value','status'].includes(k)) {
        updates.push(`${k} = ?`);
        params.push(k === 'tp_prices' ? JSON.stringify(v) : (k === 'entry_indicator_type' || k === 'exit_indicator_type') ? normalizeIndicatorType(v) : v);
      }
    });

    if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE trading_setups SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`;
    await db.run(sql, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete setup (soft cancel or hard delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hard = req.query.hard === 'true' || req.query.hard === true;
    const setup = await db.getSetupById(id);
    if (!setup) return res.status(404).json({ error: 'Not found' });
    if (setup.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    if (hard) {
      await db.run('DELETE FROM orders WHERE setup_id = ?', [id]);
      await db.run('DELETE FROM trading_setups WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    // Soft cancel: update status to canceled
    await db.updateSetupStatus(id, 'canceled', { reason: 'Cancelled by user' });
    const updated = await db.getSetupById(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
