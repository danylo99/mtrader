const express = require('express');
const router = express.Router();
const Database = require('../../db/database');
const EntryService = require('../../services/entryService');
const ExchangeServiceManager = require('../../services/exchangeServiceManager');
const TelegramService = require('../../services/telegramService');
const auth = require('../middleware/auth');

const db = new Database();
db.connect().catch(() => {});
const telegramService = new TelegramService(db);

EntryService.setDeps(db, telegramService);

// Get orders by setup id (or all for user)
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const setupId = req.query.setup_id ? Number(req.query.setup_id) : null;

    if (setupId) {
      const setup = await db.getSetupById(setupId);
      if (!setup) return res.status(404).json({ error: 'Setup not found' });
      if (setup.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
      const orders = await db.getOrdersBySetupId(setupId);
      return res.json({ success: true, data: orders });
    }

    return res.json({ success: true, data: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Place manual order (immediate entry without indicator signals)
router.post('/place', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const payload = req.body || {};

    if (!payload.sl_price || payload.sl_price <= 0) {
      return res.status(400).json({ error: 'Stop Loss price is mandatory and must be greater than 0' });
    }

    if (!payload.risk_value || payload.risk_value <= 0) {
      return res.status(400).json({ error: 'Risk value must be greater than 0' });
    }

    if (!payload.exchange_account_id) {
      return res.status(400).json({ error: 'Exchange account is required' });
    }

    if (!payload.symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    const sql = `INSERT INTO trading_setups (
      user_id, exchange_account_id, symbol, side, memo,
      activation_price, ignore_box_upper, ignore_box_lower,
      entry_indicator_type, entry_indicator_tf,
      risk_type, risk_value, sl_price, tp_prices,
      be_enabled, be_trigger_price,
      exit_indicator_type, exit_indicator_tf,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?,
      0, 0, 0,
      'manual', 'manual',
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      'triggered', datetime('now'), datetime('now'))`;

    const params = [
      userId,
      payload.exchange_account_id || null,
      payload.symbol || null,
      payload.side || 'long',
      payload.memo || null,
      payload.risk_type || null,
      payload.risk_value || 0,
      payload.sl_price || 0,
      JSON.stringify(payload.tp_prices || []),
      payload.be_enabled ? 1 : 0,
      payload.be_trigger_price || 0,
      payload.exit_indicator_type || null,
      payload.exit_indicator_tf || null,
    ];

    const result = await db.run(sql, params);
    const setupId = result.lastID;
    const setup = await db.getSetupById(setupId);

    if (!setup) {
      await db.run('DELETE FROM trading_setups WHERE id = ?', [setupId]);
      return res.status(500).json({ error: 'Failed to retrieve created setup' });
    }

    try {
      const orderResult = await EntryService.placeManualOrder(setup);
      return res.json({
        success: true,
        data: {
          id: setupId,
          entryPrice: orderResult.entryPrice,
          slPrice: orderResult.slPrice,
          positionSize: orderResult.positionSize,
          tpPrices: orderResult.tpPrices
        }
      });
    } catch (orderError) {
      await db.run('DELETE FROM orders WHERE setup_id = ?', [setupId]);
      await db.run('DELETE FROM trading_setups WHERE id = ?', [setupId]);
      return res.status(500).json({ error: orderError.message || 'Failed to place order' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Cancel a pending order
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const order = await db.getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const setup = await db.getSetupById(order.setup_id);
    if (!setup || setup.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Only pending orders can be cancelled' });

    const exchangeService = await ExchangeServiceManager.getOrCreateFromSetup(setup);
    if (order.exchange_order_id) {
      await exchangeService.cancelOrder(order.exchange_order_id, setup.symbol);
    }
    await db.updateOrderStatus(orderId, 'canceled');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modify a pending TP order (cancel + place new)
router.put('/:id', auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const order = await db.getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.order_type.startsWith('tp')) return res.status(400).json({ error: 'Only TP orders can be modified' });

    const setup = await db.getSetupById(order.setup_id);
    if (!setup || setup.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Only pending orders can be modified' });

    const { price, qty } = req.body || {};
    if (!price || !qty) return res.status(400).json({ error: 'price and qty are required' });

    const exchangeService = await ExchangeServiceManager.getOrCreateFromSetup(setup);
    if (order.exchange_order_id) {
      await exchangeService.cancelOrder(order.exchange_order_id, setup.symbol);
    }

    const newOrder = await exchangeService.placeOrder({
      symbol: setup.symbol,
      side: order.side,
      orderType: 'limit',
      qty: qty,
      price: price,
      reduceOnly: true,
      positionIdx: 0,
    });

    await db.updateOrder(order.id, {
      price: price,
      qty: qty,
      exchange_order_id: newOrder.orderId,
    });

    res.json({ success: true, data: { orderId: newOrder.orderId, price, qty } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new TP limit order to an active setup
router.post('/add-tp', auth, async (req, res) => {
  try {
    const { setup_id, price, qty } = req.body || {};
    if (!setup_id || !price || !qty) {
      return res.status(400).json({ error: 'setup_id, price, and qty are required' });
    }

    const setup = await db.getSetupById(setup_id);
    if (!setup) return res.status(404).json({ error: 'Setup not found' });
    if (setup.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (setup.status !== 'active') return res.status(400).json({ error: 'Only active setups can have TP orders added' });

    // Validate price is on correct side of entry
    if (!setup.entry_price || setup.entry_price <= 0) {
      return res.status(400).json({ error: 'Setup has no entry price yet' });
    }
    const isValidPrice = setup.side === 'long' ? price > setup.entry_price : price < setup.entry_price;
    if (!isValidPrice) {
      return res.status(400).json({ 
        error: setup.side === 'long' 
          ? 'TP price must be above entry price for long positions' 
          : 'TP price must be below entry price for short positions'
      });
    }

    // Check existing TP orders to find next available slot (tp1-tp4)
    const orders = await db.getOrdersBySetupId(setup_id);
    const existingTpNumbers = new Set();
    for (const o of orders) {
      const match = o.order_type.match(/^tp(\d+)$/);
      if (match) existingTpNumbers.add(parseInt(match[1], 10));
    }
    let nextTpNumber = 1;
    while (existingTpNumbers.has(nextTpNumber) && nextTpNumber <= 4) {
      nextTpNumber++;
    }
    if (nextTpNumber > 4) {
      return res.status(400).json({ error: 'Maximum of 4 TP orders allowed' });
    }
    const newOrderType = `tp${nextTpNumber}`;

    // Validate and round price/qty
    const exchangeService = await ExchangeServiceManager.getOrCreateFromSetup(setup);
    const roundedPrice = exchangeService.roundPrice(setup.symbol, price);
    const roundedQty = exchangeService.roundAmount(setup.symbol, qty);
    if (!(roundedQty > 0)) {
      return res.status(400).json({ error: 'Quantity is below exchange minimum' });
    }

    // Place limit order on exchange
    const newOrder = await exchangeService.placeOrder({
      symbol: setup.symbol,
      side: setup.side === 'long' ? 'sell' : 'buy',
      orderType: 'limit',
      qty: roundedQty.toString(),
      price: roundedPrice,
      reduceOnly: true,
      positionIdx: 0,
    });

    // Create order record in DB
    const createdOrder = await db.createOrder({
      setup_id: setup.id,
      order_type: newOrderType,
      side: setup.side === 'long' ? 'sell' : 'buy',
      price: roundedPrice,
      qty: roundedQty,
      exchange_order_id: newOrder.orderId,
      status: 'pending'
    });

    res.json({ success: true, data: createdOrder });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;