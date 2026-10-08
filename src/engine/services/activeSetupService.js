const IndicatorService = require('./indicatorService');
const PriceUtils = require('../utils/priceUtils');
const TimeUtils = require('../utils/timeUtils');
const CandleUtils = require('../utils/candleUtils');
const logger = require('../logger');

class ActiveSetupService {
  // Remaining open quantity = entry_qty minus every filled TP quantity.
  // Shared by the BE path, SL hit accounting and the manual close flow so the
  // size never drifts between them.
  static getRemainingQty(setup, orders = []) {
    const entryQty = Number(setup?.entry_qty) || 0;
    const filledTpQty = (orders || [])
      .filter(o => o.order_type.startsWith('tp') && o.status === 'filled')
      .reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
    return Math.max(0, entryQty - filledTpQty);
  }

  // The SL order that is actually live on the exchange. An SL replace leaves a
  // canceled row behind, and getOrdersBySetupId ranks all 'sl' rows equally, so
  // a plain find() can hand back the stale one.
  static findActiveSlOrder(orders = []) {
    const slOrders = (orders || []).filter(o => o.order_type === 'sl');
    return slOrders.find(o => o.status === 'pending') || slOrders.find(o => o.status === 'filled') || null;
  }

  static async processActiveSetup(ctx, setup) {
    logger.info(`Processing active setup #${setup.id}`);

    const exchangeService = await ctx.getExchangeService(setup.exchange_account_id, setup.exchange, setup.api_key_enc, setup.api_secret_enc, setup.is_testnet);

    const positions = await exchangeService.getPositions(setup.symbol);
    if (positions.length === 0 || positions.every(p => parseFloat(p.size) === 0)) {
      logger.info(`Position not found for setup #${setup.id}. Marking as closed.`);
      await this.closeSetup(ctx.db, ctx.telegramService, setup, 'Position not found');
      return;
    }


    await this.updateOrderStatuses(ctx, setup, exchangeService);

    const updatedSetup = await ctx.db.getSetupById(setup.id);
    if (!updatedSetup || updatedSetup.status !== 'active') {
      return;
    }

    await this.checkBreakEven(ctx, updatedSetup, exchangeService);
  }

  static async checkExitCondition(db, telegramService, setup, exchangeService, closedBars = null) {
    try {
      if (!closedBars) {
        const candles = await exchangeService.getCandles(setup.symbol, setup.exit_indicator_tf, 1500);
        const parsedCandles = CandleUtils.parseExchangeCandles(candles);
        closedBars = CandleUtils.filterClosedBars(parsedCandles, setup.exit_indicator_tf);
      } else {
        closedBars = CandleUtils.parseExchangeCandles(closedBars);
      }

      if (!closedBars || closedBars.length === 0) return;

      const currentPrice = closedBars[closedBars.length - 1].close;
      logger.info(`Checking exit condition for setup #${setup.id} at price ${currentPrice}`);

      const exitParams = IndicatorService.getIndicatorParameters(setup.exit_indicator_type);
      
      if (setup.exit_indicator_type === 'pricelevel') {
        exitParams.priceLevel = setup.exit_pricelevel_value;
      }

      const exitResult = IndicatorService.checkCondition(
        setup.exit_indicator_type,
        closedBars,
        exitParams
      );

      if (exitResult.met) {
        const shouldExit = (setup.side === 'long' && exitResult.signal === 'bearish_crossover') ||
          (setup.side === 'short' && exitResult.signal === 'bullish_crossover');

        if (!shouldExit) {
          logger.info(`Exit signal mismatch for setup #${setup.id}: side=${setup.side}, signal=${exitResult.signal}`);
          return;
        }

        const isInProfit = setup.side === 'long'
          ? currentPrice > setup.entry_price
          : currentPrice < setup.entry_price;

        if (!isInProfit) {
          logger.info(`Exit signal triggered but trade is not in profit for setup #${setup.id}: side=${setup.side}, entry=${setup.entry_price}, current=${currentPrice}`);
          return;
        }

        logger.info(`Exit condition met for setup #${setup.id}`);
        await this.closePosition(db, telegramService, setup, exchangeService, 'exit_condition');
      }
    } catch (error) {
      logger.error(`Error checking exit condition for setup #${setup.id}:`, error);
    }
  }

static async checkBreakEven(ctx, setup, exchangeService) {
    try {
      if (!setup.be_enabled) return;
      
      // NEW: Check if BE already activated
      if (setup.be_activated) {
        logger.info(`BE already activated for setup #${setup.id}`);
        return;
      }
      
      const orders = await ctx.db.getOrdersBySetupId(setup.id);
      const tp1Order = orders.find(o => o.order_type === 'tp1');
      

      // FIX: Find active SL order (pending or filled)
      const slOrder = this.findActiveSlOrder(orders);
      if (!slOrder) {
        logger.warn(`No active SL order found for setup #${setup.id}`);
        return;
      }
      // FIX: Use float tolerance comparison
      if (Math.abs(slOrder.price - setup.entry_price) < 0.000001) {
        logger.info(`BE already active for setup #${setup.id} (SL at entry price)`);
        // Also update be_activated flag for consistency
        if (!setup.be_activated) {
          await ctx.db.updateSetupStatus(setup.id, setup.status, { 
            be_activated: 1 
          });
        }
        return;
      }
      
      // Check if we should trigger BE based on be_trigger_price
      if (setup.be_trigger_price > 0) {
        const ticker = await exchangeService.getTicker(setup.symbol);
        const currentPrice = parseFloat(ticker.lastPrice);
        
        const shouldTriggerBE = setup.side === 'long' 
          ? currentPrice >= setup.be_trigger_price
          : currentPrice <= setup.be_trigger_price;
        
        if (!shouldTriggerBE) {
          logger.info(`BE trigger price not reached for setup #${setup.id}: side=${setup.side}, current=${currentPrice}, trigger=${setup.be_trigger_price}`);
          return;
        }
      }else{
        if (!tp1Order || tp1Order.status !== 'filled') return;
      }

      let cancelSucceeded = false;
      try {
        await exchangeService.cancelOrder(slOrder.exchange_order_id, setup.symbol, { 'trigger': true });
        cancelSucceeded = true;
      } catch (error) {
        logger.warn(`BE cancel failed for setup #${setup.id} order ${slOrder.exchange_order_id}, proceeding: ${error.message}`);
      }

      const newSlOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'Sell' : 'Buy',
        orderType: 'Market',
        qty: setup.entry_qty,
        triggerPrice: setup.entry_price,
        triggerDirection: setup.side === 'long' ? 2 : 1,
        triggerBy: 'MarkPrice',
        reduceOnly: true
      });

      if (cancelSucceeded) {
        await ctx.db.updateOrderStatus(slOrder.id, 'canceled');
      }
      await ctx.db.createOrder({
        setup_id: setup.id,
        order_type: 'sl',
        side: setup.side === 'long' ? 'sell' : 'buy',
        price: setup.entry_price,
        qty: setup.entry_qty,
        exchange_order_id: newSlOrder.orderId,
        status: 'pending'
      });

      await ctx.telegramService.sendNotification(setup.user_id, 'be_activated', {
        setupId: setup.id,
        symbol: setup.symbol,
        entryPrice: setup.entry_price,
        timestamp: new Date().toISOString()
      });

      // After successful BE activation
      await ctx.db.updateSetupStatus(setup.id, setup.status, { 
        be_activated: 1 
      });
      
      logger.beActivated(setup.id);
    } catch (error) {
      logger.error(`Error checking break-even for setup #${setup.id}:`, error);
    }
  }

  static async updateOrderStatuses(ctx, setup, exchangeService) {
    try {
      const orders = await ctx.db.getOrdersBySetupId(setup.id);

      const slOrder = this.findActiveSlOrder(orders);
      if (slOrder && slOrder.status === 'pending') {
        const slHit = await this.checkSlCandleHit(ctx, setup, exchangeService, orders);
        if (slHit) {
          await this.processSlHit(ctx, setup, exchangeService, orders, slOrder);
          return;
        }
      }

      for (const order of orders) {
        if (order.status === 'pending' && order.exchange_order_id) {
          const isPendingSl = order.order_type === 'sl';
          if (isPendingSl) continue;

          const status = await exchangeService.getOrderStatus(order.exchange_order_id, setup.symbol);
          if (!status) {
            logger.warn(`Order status not found for order ${order.id} (Exchange ID: ${order.exchange_order_id})`);
            continue;
          }
          if (status.status === 'closed' && status.amount == status.filled) {
            await ctx.db.updateOrderStatus(order.id, 'filled');

            await ctx.telegramService.sendNotification(setup.user_id, 'order_filled', {
              setupId: setup.id,
              symbol: setup.symbol,
              orderType: order.order_type,
              side: order.side,
              price: order.price,
              quantity: order.qty,
              timestamp: new Date().toISOString()
            });

            logger.orderFilled(setup.id, order.order_type, order.price);

            if (order.order_type.startsWith('tp')) {
              const tpLevel = parseInt(order.order_type.replace('tp', ''));
              const pnl = PriceUtils.calculatePnl(setup.entry_price, order.price, order.qty, setup.side);

              await ctx.telegramService.sendNotification(setup.user_id, 'tp_hit', {
                setupId: setup.id,
                symbol: setup.symbol,
                tpLevel: tpLevel,
                price: order.price,
                quantity: order.qty,
                pnl: pnl,
                timestamp: new Date().toISOString()
              });

              logger.tpHit(setup.id, tpLevel, order.price, pnl.netPnl);

              const allTpOrders = orders.filter(o => o.order_type.startsWith('tp'));
              const allTpFilled = allTpOrders.length > 0 && allTpOrders.every(o => o.status === 'filled');
              if (allTpFilled) {
                const currentSlOrder = this.findActiveSlOrder(orders);
                if (currentSlOrder && currentSlOrder.status === 'pending' && currentSlOrder.exchange_order_id) {
                  try {
                    await exchangeService.cancelOrder(currentSlOrder.exchange_order_id, setup.symbol, { 'trigger': true });
                    await ctx.db.updateOrderStatus(currentSlOrder.id, 'canceled');
                  } catch (error) {
                    logger.error(`Error cancelling SL order after all TP filled for setup #${setup.id}:`, error);
                  }
                }
              }
            }
          } else if (status.status === 'canceled' || status.status === 'rejected') {
            await ctx.db.updateOrderStatus(order.id, 'canceled');
          }
        }
      }

      const updatedSetup = await ctx.db.getSetupById(setup.id);
      if (updatedSetup?.status === 'active') {
        await this.updateSetupProfit(ctx, updatedSetup, exchangeService);
      }
    } catch (error) {
      logger.error(`Error updating order statuses for setup #${setup.id}:`, error);
    }
  }

  static async checkSlCandleHit(ctx, setup, exchangeService, orders) {
    try {
      const slOrder = this.findActiveSlOrder(orders);
      if (!slOrder) return null;

      let candles = null;
      const cpManager = ctx.getCandleProviderManager();
      if (cpManager) {
        candles = await cpManager.getClosedCandles(setup.exchange, setup.symbol, 'm5');
      }
      if (!candles) {
        candles = await exchangeService.getCandles(setup.symbol, 'm5', 1500);
      }
      const parsedCandles = CandleUtils.parseExchangeCandles(candles);
      const closedBars = CandleUtils.filterClosedBars(parsedCandles, 'm5');

      if (closedBars.length === 0) return null;

      const lastCandle = closedBars[closedBars.length - 1];

      if (setup.side === 'long' && lastCandle.low <= slOrder.price) {
        return lastCandle;
      }
      if (setup.side === 'short' && lastCandle.high >= slOrder.price) {
        return lastCandle;
      }

      return null;
    } catch (error) {
      logger.error(`Error checking SL candle hit for setup #${setup.id}:`, error);
      return null;
    }
  }

  static async processSlHit(ctx, setup, exchangeService, orders, slOrder) {
    try {
      const pendingTpOrders = orders.filter(o => o.order_type.startsWith('tp') && o.status === 'pending' && o.exchange_order_id);
      for (const tpOrder of pendingTpOrders) {
        try {
          await exchangeService.cancelOrder(tpOrder.exchange_order_id, setup.symbol);
          await ctx.db.updateOrderStatus(tpOrder.id, 'canceled');
        } catch (error) {
          logger.error(`Error cancelling TP order ${tpOrder.id} after SL hit for setup #${setup.id}:`, error.message);
        }
      }

      const remainingQty = this.getRemainingQty(setup, orders);
      const qtyForPnl = remainingQty > 0 ? remainingQty : setup.entry_qty || 0;

      const pnl = PriceUtils.calculatePnl(setup.entry_price, slOrder.price, qtyForPnl, setup.side);

      await ctx.db.updateOrderStatus(slOrder.id, 'filled');

      await ctx.telegramService.sendNotification(setup.user_id, 'sl_hit', {
        setupId: setup.id,
        symbol: setup.symbol,
        price: slOrder.price,
        quantity: qtyForPnl,
        pnl: pnl,
        timestamp: new Date().toISOString()
      });

      logger.slHit(setup.id, slOrder.price, pnl.netPnl);

      await this.closeSetup(ctx.db, ctx.telegramService, setup, 'stop_loss_hit', pnl.netPnl);
    } catch (error) {
      logger.error(`Error processing SL hit for setup #${setup.id}:`, error);
    }
  }

  static async updateSetupProfit(ctx, setup, exchangeService, currentPrice = null) {
    if (!setup.entry_price || !setup.entry_qty) {
      return;
    }

    try {
      const price = currentPrice !== null ? currentPrice : parseFloat((await exchangeService.getTicker(setup.symbol)).lastPrice);
      const pnl = PriceUtils.calculatePnl(setup.entry_price, price, setup.entry_qty, setup.side);
      await ctx.db.updateSetupStatus(setup.id, setup.status, { profit: pnl.netPnl });
    } catch (error) {
      logger.error(`Error updating profit for setup #${setup.id}:`, error);
    }
  }

  static async closePosition(db, telegramService, setup, exchangeService, reason, options = {}) {
    try {
      const orders = await db.getOrdersBySetupId(setup.id);

      // Calculate filled TP quantity
      const remainingQty = this.getRemainingQty(setup, orders);

      let closeQty = 0;
      let closeOrder = null;
      // Place reduce-only market order for remaining quantity if any
      if (remainingQty > 0) {
        let closePrice = null;
        if (exchangeService.exchangeName === 'hyperliquid') {
          try {
            const ticker = await exchangeService.getTicker(setup.symbol);
            closePrice = parseFloat(ticker.lastPrice);
          } catch (error) {
            logger.error(`Failed to fetch price for Hyperliquid close order: ${error.message}`);
          }
        }

        const order = {
          symbol: setup.symbol,
          side: setup.side === 'long' ? 'Sell' : 'Buy',
          orderType: 'Market',
          qty: remainingQty.toString(),
          reduceOnly: true,
          timeInForce: 'IOC'
        };

        if (closePrice !== null) {
          order.price = closePrice;
        }

        closeOrder = await exchangeService.placeOrder(order);
        closeQty = remainingQty;
        logger.info(`Placed reduce-only close order for setup #${setup.id}: ${remainingQty} qty${closePrice !== null ? ` at price ${closePrice}` : ''}`);
      } else {
        logger.info(`No remaining qty to close for setup #${setup.id} (already fully closed by TP orders)`);
      }

      // Cancel pending orders (including SL)
      for (const order of orders) {
        if (order.status === 'pending' && order.exchange_order_id) {
          try {
            const params = order.order_type == 'sl' ? { 'trigger': true } : {}
            await exchangeService.cancelOrder(order.exchange_order_id, setup.symbol, params);
            await db.updateOrderStatus(order.id, 'canceled');
          } catch (error) {
            logger.error(`Error cancelling order ${order.id}:`, error);
          }
        }
      }

      // Calculate profit based on remaining qty (for partial close)
      const qtyForPnl = remainingQty > 0 ? remainingQty : 0;
      let pnl = null;
      let currentPrice = null;
      if (setup.entry_price && qtyForPnl > 0) {
        const ticker = await exchangeService.getTicker(setup.symbol);
        currentPrice = parseFloat(ticker.lastPrice);
        pnl = PriceUtils.calculatePnl(setup.entry_price, currentPrice, qtyForPnl, setup.side);
      }

      await this.closeSetup(db, telegramService, setup, reason, pnl ? pnl.netPnl : 0);
      logger.info(`Position closed for setup #${setup.id}: ${reason}`);

      // Manual closes need an order row so the trade log shows what happened;
      // automated closes have no such row today. orders.price is NOT NULL, so
      // fall back to the entry price if the ticker never came back.
      if (options.recordCloseOrder) {
        await db.createOrder({
          setup_id: setup.id,
          order_type: 'manual_close',
          side: setup.side === 'long' ? 'sell' : 'buy',
          price: currentPrice ?? setup.entry_price,
          qty: closeQty,
          exchange_order_id: closeOrder ? closeOrder.orderId : null,
          status: 'filled'
        });
      }

      return { closed: true, closedQty: closeQty, price: currentPrice };
    } catch (error) {
      logger.error(`Error closing position for setup #${setup.id}:`, error);
      throw error;
    }
  }

  // User-triggered close. requestedQty <= 0 (or omitted) closes the whole
  // remaining position; anything else reduces it and leaves TP/SL untouched.
  static async manualClosePosition(db, telegramService, setup, exchangeService, requestedQty) {
    const orders = await db.getOrdersBySetupId(setup.id);
    const remainingQty = this.getRemainingQty(setup, orders);

    const parsedQty = Number(requestedQty);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      return this.closePosition(db, telegramService, setup, exchangeService, 'manual_close', { recordCloseOrder: true });
    }

    const qty = exchangeService.roundAmount(setup.symbol, parsedQty);
    if (!(qty > 0)) {
      throw ActiveSetupService.badRequest(`Quantity ${parsedQty} is below the exchange minimum for ${setup.symbol}`);
    }
    if (qty > remainingQty + 1e-9) {
      throw ActiveSetupService.badRequest(`Quantity ${qty} exceeds remaining position ${remainingQty}`);
    }

    const newEntryQty = remainingQty - qty;

    let closePrice = null;
    if (exchangeService.exchangeName === 'hyperliquid') {
      try {
        const ticker = await exchangeService.getTicker(setup.symbol);
        closePrice = parseFloat(ticker.lastPrice);
      } catch (error) {
        logger.error(`Failed to fetch price for Hyperliquid close order: ${error.message}`);
      }
    }

    const order = {
      symbol: setup.symbol,
      side: setup.side === 'long' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty: qty.toString(),
      reduceOnly: true,
      timeInForce: 'IOC'
    };
    if (closePrice !== null) {
      order.price = closePrice;
    }

    const closeOrder = await exchangeService.placeOrder(order);
    logger.info(`Manually closed ${qty} of setup #${setup.id} (${remainingQty} -> ${newEntryQty})`);

    let currentPrice = closePrice;
    if (currentPrice === null) {
      try {
        currentPrice = parseFloat((await exchangeService.getTicker(setup.symbol)).lastPrice);
      } catch (error) {
        logger.error(`Failed to fetch price for manual close of setup #${setup.id}: ${error.message}`);
      }
    }

    let pnl = null;
    if (setup.entry_price && currentPrice !== null) {
      pnl = PriceUtils.calculatePnl(setup.entry_price, currentPrice, newEntryQty, setup.side);
    }

    await db.updateSetupStatus(setup.id, 'active', {
      entry_qty: newEntryQty,
      profit: pnl ? pnl.netPnl : undefined
    });

    await db.createOrder({
      setup_id: setup.id,
      order_type: 'manual_close',
      side: setup.side === 'long' ? 'sell' : 'buy',
      price: currentPrice ?? setup.entry_price,
      qty: qty,
      exchange_order_id: closeOrder ? closeOrder.orderId : null,
      status: 'filled'
    });

    await telegramService.sendNotification(setup.user_id, 'manual_close', {
      setupId: setup.id,
      symbol: setup.symbol,
      side: setup.side,
      price: currentPrice,
      quantity: qty,
      remainingQty: newEntryQty,
      pnl: pnl,
      timestamp: new Date().toISOString()
    });

    return { closed: false, closedQty: qty, remainingQty: newEntryQty, price: currentPrice };
  }

  // Replace the live stop with a new price: place the new trigger first, then
  // cancel the old one, so a placement failure leaves the position protected.
  static async modifyStopLoss(db, telegramService, setup, exchangeService, newSlPrice) {
    const price = Number(newSlPrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw ActiveSetupService.badRequest('Stop loss price must be a positive number');
    }

    const ticker = await exchangeService.getTicker(setup.symbol);
    const mark = parseFloat(ticker.lastPrice);
    if (!Number.isFinite(mark) || mark <= 0) {
      throw ActiveSetupService.badRequest(`Could not read a current market price for ${setup.symbol}`);
    }

    const slPrice = exchangeService.roundPrice(setup.symbol, price);
    // Re-check after rounding: the exchange tick size can move the price onto
    // or across the mark.
    const isValidSide = setup.side === 'long' ? slPrice < mark : slPrice > mark;
    if (!isValidSide) {
      throw ActiveSetupService.badRequest(
        setup.side === 'long'
          ? `Stop loss must be below the current market price (${mark})`
          : `Stop loss must be above the current market price (${mark})`
      );
    }

    const orders = await db.getOrdersBySetupId(setup.id);
    const remainingQty = this.getRemainingQty(setup, orders);
    if (remainingQty <= 0) {
      throw ActiveSetupService.badRequest('Position is already flat');
    }

    const slQty = exchangeService.roundAmount(setup.symbol, remainingQty);
    if (!(slQty > 0)) {
      throw ActiveSetupService.badRequest(`Remaining quantity is below the exchange minimum for ${setup.symbol}`);
    }

    const oldSlOrders = orders.filter(o => o.order_type === 'sl' && o.status === 'pending' && o.exchange_order_id);
    if (oldSlOrders.length === 0) {
      logger.warn(`No pending SL order found on the exchange for setup #${setup.id}; the new stop will be the only protection`);
    }

    const newOrder = await exchangeService.placeOrder({
      symbol: setup.symbol,
      side: setup.side === 'long' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty: slQty.toString(),
      triggerPrice: slPrice,
      triggerDirection: setup.side === 'long' ? 2 : 1,
      reduceOnly: true,
      timeInForce: 'GTC'
    });

    const warnings = [];
    for (const oldSlOrder of oldSlOrders) {
      try {
        await exchangeService.cancelOrder(oldSlOrder.exchange_order_id, setup.symbol, { trigger: true });
        await db.updateOrderStatus(oldSlOrder.id, 'canceled');
      } catch (error) {
        logger.error(`Failed to cancel old SL order ${oldSlOrder.exchange_order_id} for setup #${setup.id}:`, error);
        warnings.push(oldSlOrder.exchange_order_id);
      }
    }

    await db.createOrder({
      setup_id: setup.id,
      order_type: 'sl',
      side: setup.side === 'long' ? 'sell' : 'buy',
      price: slPrice,
      qty: slQty,
      exchange_order_id: newOrder ? newOrder.orderId : null,
      status: 'pending'
    });

    // be_activated is intentionally left alone: the dashboard uses it to keep
    // risk out of the open total once the stop sits at entry.
    await db.updateSetupStatus(setup.id, 'active', { sl_price: slPrice });

    await telegramService.sendNotification(setup.user_id, 'sl_modified', {
      setupId: setup.id,
      symbol: setup.symbol,
      side: setup.side,
      oldPrice: oldSlOrders[0] ? oldSlOrders[0].price : null,
      newPrice: slPrice,
      quantity: slQty,
      timestamp: new Date().toISOString()
    });

    logger.info(`Stop loss for setup #${setup.id} moved to ${slPrice} (qty ${slQty})`);

    return { slPrice, qty: slQty, warnings };
  }

  static badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
  }

  static async closeSetup(db, telegramService, setup, reason, profit = 0) {
    try {
      const closePayload = {
        closed_at: new Date().toISOString(),
        profit: profit
      };

      await db.updateSetupStatus(setup.id, 'closed', closePayload);

      if (reason === 'exit_condition' && setup.entry_price) {
        let currentPrice = null;
        let pnl = null;
        if (profit !== undefined) {
          const ExchangeServiceManager = require('./exchangeServiceManager');
          const exchangeService = await ExchangeServiceManager.getOrCreate(
            setup.exchange_account_id,
            setup.exchange,
            setup.api_key_enc,
            setup.api_secret_enc,
            setup.is_testnet
          );
          const ticker = await exchangeService.getTicker(setup.symbol);
          currentPrice = parseFloat(ticker.lastPrice);
          pnl = { netPnl: profit };
        }

        await telegramService.sendNotification(setup.user_id, 'exit_triggered', {
          setupId: setup.id,
          symbol: setup.symbol,
          exitIndicatorType: setup.exit_indicator_type,
          exitIndicatorTf: setup.exit_indicator_tf,
          price: currentPrice,
          pnl: pnl,
          timestamp: new Date().toISOString()
        });

        logger.exitTriggered(setup.id, reason);
      }
    } catch (error) {
      logger.error(`Error closing setup #${setup.id}:`, error);
      throw error;
    }
  }
}

module.exports = ActiveSetupService;