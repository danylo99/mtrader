const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDatabaseManager } = require('../../db');
const auth = require('../middleware/auth');

const TF_ORDER = ['m5', 'm15', 'h1', 'h4', 'd1', 'w1'];
const VALID_DIRECTIONS = ['cross_above', 'cross_below'];

function loadSymbols(exchange = 'bybit') {
  const candidates = [
    path.resolve(__dirname, `../../../config/symbols/${exchange}.json`),
    path.resolve(__dirname, `../../../../config/symbols/${exchange}.json`),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return { symbols: [] };
}

function getExchangeFromRequest(req) {
  // Try to get exchange from query param, body, or default to hyperliquid
  return req.query.exchange || req.body.exchange || 'hyperliquid';
}

function validateAlarmPayload(body, exchange) {
  const errors = [];
  const { symbol, timeframe, direction, price_level } = body || {};

  const symbolsConfig = loadSymbols(exchange);
  const validSymbols = new Set(symbolsConfig.symbols.map(s => s.symbol));
  
  if (!symbol || !validSymbols.has(symbol)) errors.push(`symbol is invalid or not supported on ${exchange}`);
  if (!timeframe || !TF_ORDER.includes(timeframe)) errors.push(`timeframe must be one of ${TF_ORDER.join(', ')}`);
  if (!direction || !VALID_DIRECTIONS.includes(direction)) errors.push(`direction must be one of ${VALID_DIRECTIONS.join(', ')}`);

  const level = Number(price_level);
  if (!Number.isFinite(level) || level <= 0) errors.push('price_level must be a positive number');

  return { errors, value: { symbol, timeframe, direction, price_level: level, exchange } };
}

router.get('/', auth, async (req, res) => {
  try {
    const db = getDatabaseManager();
    let rows = await db.getPriceAlarmsByUser(req.user.id);
    
    // Optional: filter by exchange if query parameter is provided
    const exchangeFilter = req.query.exchange;
    if (exchangeFilter) {
      rows = rows.filter(alarm => alarm.exchange === exchangeFilter);
    }
    
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const exchange = getExchangeFromRequest(req);
    const { errors, value } = validateAlarmPayload(req.body, exchange);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join('; ') });
    }
    const db = getDatabaseManager();
    const created = await db.createPriceAlarm(req.user.id, value);
    res.json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/', auth, async (req, res) => {
  try {
    const db = getDatabaseManager();
    await db.deleteAllPriceAlarmsByUser(req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    const db = getDatabaseManager();
    const result = await db.deletePriceAlarm(id, req.user.id);
    if (!result || result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    const db = getDatabaseManager();
    const existing = await db.getPriceAlarmById(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    const exchange = getExchangeFromRequest(req);
    const { errors, value } = validateAlarmPayload(req.body, exchange);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join('; ') });
    }
    await db.updatePriceAlarm(id, req.user.id, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;