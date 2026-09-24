const IndicatorService = require('./indicatorService');
const PriceUtils = require('../utils/priceUtils');
const TimeUtils = require('../utils/timeUtils');
const CandleUtils = require('../utils/candleUtils');
const logger = require('../logger');

class ActiveSetupService {
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
      }

      if (closedBars.length === 0) return;

      const ticker = await exchangeService.getTicker(setup.symbol);
      const currentPrice = parseFloat(ticker.lastPrice);
      logger.info(`Checking exit condition for setup #${setup.id} at price ${currentPrice}`);

      const exitResult = IndicatorService.checkCondition(
        setup.exit_indicator_type,
        closedBars,
        IndicatorService.getIndicatorParameters(setup.exit_indicator_type)
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
      const slOrder = orders.find(o => 
        o.order_type === 'sl' && 
        (o.status === 'pending' || o.status === 'filled')
      );
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

      await exchangeService.cancelOrder(slOrder.exchange_order_id, setup.symbol, { 'trigger': true });

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

      await ctx.db.updateOrderStatus(slOrder.id, 'canceled');
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

      const slOrder = orders.find(o => o.order_type === 'sl');
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
                const currentSlOrder = orders.find(o => o.order_type === 'sl');
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
      const slOrder = orders.find(o => o.order_type === 'sl');
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

      const filledTpOrders = orders.filter(o => o.order_type.startsWith('tp') && o.status === 'filled');
      const filledQty = filledTpOrders.reduce((sum, o) => sum + (o.qty || 0), 0);
      const remainingQty = (setup.entry_qty || 0) - filledQty;
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

  static async closePosition(db, telegramService, setup, exchangeService, reason) {
    try {
      const orders = await db.getOrdersBySetupId(setup.id);
      
      // Calculate filled TP quantity
      const filledTpOrders = orders.filter(o => o.order_type.startsWith('tp') && o.status === 'filled');
      const filledQty = filledTpOrders.reduce((sum, o) => sum + (o.qty || 0), 0);
      const remainingQty = (setup.entry_qty || 0) - filledQty;
      
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
        
        const closeOrder = {
          symbol: setup.symbol,
          side: setup.side === 'long' ? 'Sell' : 'Buy',
          orderType: 'Market',
          qty: remainingQty.toString(),
          reduceOnly: true,
          timeInForce: 'IOC'
        };
        
        if (closePrice !== null) {
          closeOrder.price = closePrice;
        }
        
        await exchangeService.placeOrder(closeOrder);
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
    } catch (error) {
      logger.error(`Error closing position for setup #${setup.id}:`, error);
      throw error;
    }
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