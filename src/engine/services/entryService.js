const IndicatorService = require('./indicatorService');
const PriceUtils = require('../utils/priceUtils');
const CandleUtils = require('../utils/candleUtils');
const TimeUtils = require('../utils/timeUtils');
const PendingSetupService = require('./pendingSetupService');
const logger = require('../logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class EntryService {
  static db = null;
  static telegramService = null;
  static stats = {
    ordersPlaced: 0,
    setupsActivated: 0,
    errors: 0
  };
  
  static setDeps(db, telegramService) {
    this.db = db;
    this.telegramService = telegramService;
  }

  static async processTriggeredSetup(setup, candles) {
    logger.info(`Checking triggered setup #${setup.id} for entry conditions`);
    
    if (!TimeUtils.isTriggerTime(setup.entry_indicator_tf)) {
      logger.debug(`Not trigger time for ${setup.entry_indicator_tf}. Skipping setup #${setup.id}`);
      return;
    }
    
    const parsedCandles = CandleUtils.parseExchangeCandles(candles);
    const closedBars = CandleUtils.filterClosedBars(parsedCandles, setup.entry_indicator_tf);
    
    if (closedBars.length === 0) {
      logger.warn(`No closed bars available for setup #${setup.id}`);
      return;
    }
    
    const lastCandle = closedBars[closedBars.length - 1];
    const ignoreBoxCheck = TimeUtils.isWithinIgnoreBox(lastCandle, setup.ignore_box_lower, setup.ignore_box_upper);
    if (!ignoreBoxCheck.within) {
      logger.info(`Triggered setup #${setup.id} canceled: ${ignoreBoxCheck.reason}`);
      await PendingSetupService.cancelSetup(setup, ignoreBoxCheck.reason);
      return;
    }
    
    const indicatorParams = IndicatorService.getIndicatorParameters(setup.entry_indicator_type);
    
    if (setup.entry_indicator_type === 'pricelevel') {
      indicatorParams.priceLevel = setup.entry_pricelevel_value;
    }
    
    const indicatorResult = IndicatorService.checkCondition(
      setup.entry_indicator_type,
      closedBars,
      indicatorParams
    );
    
    if (indicatorResult.met) {
      const isValidDirection = (setup.side === 'long' && indicatorResult.signal === 'bullish_crossover') ||
                             (setup.side === 'short' && indicatorResult.signal === 'bearish_crossover');
      
      if (!isValidDirection) {
        logger.info(`Signal direction mismatch for setup #${setup.id}: expected ${setup.side} but got ${indicatorResult.signal}`);
        return;
      }
      
      logger.info(`Entry condition met for setup #${setup.id}: ${indicatorResult.signal}`);
      await this.placeEntryOrderModern(setup, closedBars);
    } else {
      logger.info(`Entry condition not met for setup #${setup.id}: ${indicatorResult.error || 'No signal'}`,indicatorResult);
    }
  }

  

  

  static async processItemFromCandle(symbol, timeframe, candles) {
    try {
      if (!this.db || !this.telegramService) {
        logger.warn('EntryService deps not set, skipping triggered setup processing');
        return;
      }
      
      const setups = await this.db.getTriggeredSetupsForSymbolTimeframe(symbol, timeframe);
      if (!setups || setups.length === 0) {
        return;
      }
      
      logger.info(`Processing ${setups.length} triggered setups for ${symbol} ${timeframe}`);
      
      for (const setup of setups) {
        await this.processTriggeredSetup(setup, candles);
      }
    } catch (error) {
      logger.error(`Error processing triggered setups for ${symbol} ${timeframe}:`, error);
      this.stats.errors++;
    }
  }

  static async placeEntryOrderModern(setup, candles) {
    try {
      const lastCandle = candles[candles.length - 1];
      const entryPrice = lastCandle.close;

      const indicatorParams = IndicatorService.getIndicatorParameters(setup.entry_indicator_type);

      let slPrice = setup.sl_price > 0 ? setup.sl_price : null;
      if (!slPrice) {
        slPrice = PriceUtils.calculateSLPrice(
          entryPrice,
          0,
          0,
          setup.side,
          setup.entry_indicator_type,
          candles,
          indicatorParams
        );
      }
      
      const exchangeService = await this._getExchangeServiceForSetup(setup);
      const symbolInfo = await exchangeService.getSymbolInfo(setup.symbol);
      const qtyStepSize = parseFloat(symbolInfo.qtyStep) || 0.001;

      slPrice = exchangeService.roundPrice(setup.symbol, slPrice);

      const accountBalance = await exchangeService.getAccountBalance();
      const riskType = setup.risk_type || 'percent';
      const positionSize = PriceUtils.calculatePositionSize(
        setup.risk_value,
        accountBalance,
        entryPrice,
        slPrice,
        setup.side,
        riskType
      );
      const roundedPositionSize = exchangeService.roundAmount(setup.symbol, positionSize);
      if (roundedPositionSize <= 0) {
        throw new Error(`Calculated position size for setup #${setup.id} is too small after rounding`);
      }
      const rrRatios = PriceUtils.parseTpPricesJson(setup.tp_prices);
      const tpPrices = PriceUtils.calculateTPPrices(entryPrice, slPrice, rrRatios)
        .map(price => exchangeService.roundPrice(setup.symbol, price));
      const tpQtys = PriceUtils.splitQuantity(
        roundedPositionSize,
        tpPrices.length,
        qtyStepSize
      );

      const entryOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'buy' : 'sell',
        orderType: 'Market',
        qty: roundedPositionSize,
        price: entryPrice,
        timeInForce: 'GTC'
      });

      await this.db.createOrder({
        setup_id: setup.id,
        order_type: 'entry',
        side: setup.side === 'long' ? 'buy' : 'sell',
        price: entryPrice,
        qty: roundedPositionSize,
        exchange_order_id: entryOrder.orderId,
        status: 'pending'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const slOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'sell' : 'buy',
        orderType: 'Market',
        qty: roundedPositionSize,
        triggerPrice: slPrice,
        triggerDirection: setup.side === 'long' ? 'descending' : 'ascending',
        triggerBy: 'MarkPrice',
        reduceOnly: true
      });

      await this.db.createOrder({
        setup_id: setup.id,
        order_type: 'sl',
        side: setup.side === 'long' ? 'sell' : 'buy',
        price: slPrice,
        qty: roundedPositionSize,
        exchange_order_id: slOrder.orderId,
        status: 'pending'
      });

      for (let i = 0; i < tpPrices.length; i++) {
        const tpOrder = await exchangeService.exchange.createOrder(
          setup.symbol,
          'limit',
          setup.side === 'long' ? 'sell' : 'buy',
          tpQtys[i],
          tpPrices[i],
          {
              reduceOnly: true,
              positionIdx: 0
          }
        );
        await this.db.createOrder({
          setup_id: setup.id,
          order_type: `tp${i + 1}`,
          side: setup.side === 'long' ? 'sell' : 'buy',
          price: tpPrices[i],
          qty: tpQtys[i],
          exchange_order_id: tpOrder.id,
          status: 'pending'
        });
        await sleep(200);
      }

      await this.db.updateSetupStatus(setup.id, 'active', {
        entry_price: entryPrice,
        entry_qty: roundedPositionSize,
        sl_price: slPrice
      });

      this.stats.setupsActivated++;
      this.stats.ordersPlaced += (2 + tpPrices.length);

      await this.telegramService.sendNotification(setup.user_id, 'order_placed', {
        setupId: setup.id,
        symbol: setup.symbol,
        orderType: 'entry',
        side: setup.side,
        price: entryPrice,
        quantity: roundedPositionSize,
        timestamp: new Date().toISOString()
      });

      logger.orderPlaced(setup.id, 'entry', setup.symbol, entryPrice, positionSize);
    } catch (error) {
      logger.error(`Error placing entry order for setup #${setup.id}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  static async _getExchangeServiceForSetup(setup) {
    const ExchangeServiceManager = require('./exchangeServiceManager');
    return ExchangeServiceManager.getOrCreate(
      setup.exchange_account_id,
      setup.exchange,
      setup.api_key_enc,
      setup.api_secret_enc,
      setup.is_testnet
    );
  }

  static async webhookPlaceOrder(payload, db, telegramService) {
    try {
      const Config = require('../config');
      const ExchangeServiceManager = require('./exchangeServiceManager');

      const riskAmount = Config.getWebhookRiskAmount();
      const rrList = Config.getWebhookRRList();
      const accountIndex = Config.getWebhookExchangeAccountIndex();

      const exchangeAccount = await db.getExchangeAccountByIndex(accountIndex - 1);
      if (!exchangeAccount) {
        throw new Error(`No exchange account found at index ${accountIndex}`);
      }

      const side = payload.side === 1 ? 'long' : 'short';
      const symbol = payload.asset;
      const timeframe = payload.timeframe || 'm15';
      const entryPrice = payload.entry_price;
      const slOverride = payload.sl;

      const exchangeService = await ExchangeServiceManager.getOrCreate(
        exchangeAccount.id,
        exchangeAccount.exchange,
        exchangeAccount.api_key_enc,
        exchangeAccount.api_secret_enc,
        exchangeAccount.is_testnet
      );

      const symbolInfo = await exchangeService.getSymbolInfo(symbol);
      const qtyStepSize = parseFloat(symbolInfo.qtyStep) || 0.001;

      let slPrice = slOverride && slOverride > 0 ? slOverride : null;
      if (!slPrice) {
        const candles = await exchangeService.getCandles(symbol, timeframe, 50);
        const parsedCandles = CandleUtils.parseExchangeCandles(candles);
        slPrice = PriceUtils.calculateSLPrice(
          entryPrice,
          0,
          0,
          side,
          'supertrend',
          parsedCandles,
          { period: 10, multiplier: 3 }
        );
      }
      slPrice = exchangeService.roundPrice(symbol, slPrice);

      const accountBalance = await exchangeService.getAccountBalance();
      const positionSize = PriceUtils.calculatePositionSize(
        riskAmount,
        accountBalance,
        entryPrice,
        slPrice,
        side,
        'fixed'
      );
      const roundedPositionSize = exchangeService.roundAmount(symbol, positionSize);
      if (roundedPositionSize <= 0) {
        throw new Error(`Calculated position size for webhook signal is too small after rounding`);
      }

      const tpPrices = PriceUtils.calculateTPPrices(entryPrice, slPrice, rrList)
        .map(price => exchangeService.roundPrice(symbol, price));
      const tpQtys = PriceUtils.splitQuantity(roundedPositionSize, tpPrices.length, qtyStepSize);

      const setupResult = await db.run(`
        INSERT INTO trading_setups (
          user_id, exchange_account_id, symbol, side, status,
          activation_price, ignore_box_upper, ignore_box_lower,
          entry_indicator_type, entry_indicator_tf,
          risk_type, risk_value, sl_price, tp_prices,
          be_enabled, be_trigger_price,
          entry_price, entry_qty,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'triggered',
          0, 0, 0,
          'webhook', ?,
          'fixed', ?, ?, ?,
          1, 0,
          ?, ?,
          datetime('now'), datetime('now'))
      `, [
        exchangeAccount.user_id,
        exchangeAccount.id,
        symbol,
        side,
        timeframe,
        riskAmount,
        slPrice,
        JSON.stringify(rrList),
        entryPrice,
        roundedPositionSize
      ]);

      const setupId = setupResult.lastID;

      const entryOrder = await exchangeService.placeOrder({
        symbol,
        side: side === 'long' ? 'buy' : 'sell',
        orderType: 'Market',
        qty: roundedPositionSize,
        price: entryPrice,
        timeInForce: 'GTC'
      });

      await db.createOrder({
        setup_id: setupId,
        order_type: 'entry',
        side: side === 'long' ? 'buy' : 'sell',
        price: entryPrice,
        qty: roundedPositionSize,
        exchange_order_id: entryOrder.orderId,
        status: 'pending'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const slOrder = await exchangeService.placeOrder({
        symbol,
        side: side === 'long' ? 'sell' : 'buy',
        orderType: 'Market',
        qty: roundedPositionSize,
        triggerPrice: slPrice,
        triggerDirection: side === 'long' ? 'descending' : 'ascending',
        triggerBy: 'MarkPrice',
        reduceOnly: true
      });

      await db.createOrder({
        setup_id: setupId,
        order_type: 'sl',
        side: side === 'long' ? 'sell' : 'buy',
        price: slPrice,
        qty: roundedPositionSize,
        exchange_order_id: slOrder.orderId,
        status: 'pending'
      });

      for (let i = 0; i < tpPrices.length; i++) {
        const tpOrder = await exchangeService.exchange.createOrder(
          symbol,
          'limit',
          side === 'long' ? 'sell' : 'buy',
          tpQtys[i],
          tpPrices[i],
          { reduceOnly: true, positionIdx: 0 }
        );
        await db.createOrder({
          setup_id: setupId,
          order_type: `tp${i + 1}`,
          side: side === 'long' ? 'sell' : 'buy',
          price: tpPrices[i],
          qty: tpQtys[i],
          exchange_order_id: tpOrder.id,
          status: 'pending'
        });
      }

      await db.updateSetupStatus(setupId, 'active', {
        entry_price: entryPrice,
        entry_qty: roundedPositionSize,
        sl_price: slPrice
      });

      this.stats.setupsActivated++;
      this.stats.ordersPlaced += (2 + tpPrices.length);

      if (telegramService) {
        await telegramService.sendNotification(exchangeAccount.user_id, 'order_placed', {
          setupId,
          symbol,
          orderType: 'entry',
          side,
          price: entryPrice,
          quantity: roundedPositionSize,
          timestamp: new Date().toISOString()
        });
      }

      logger.orderPlaced(setupId, 'entry', symbol, entryPrice, roundedPositionSize);

      return { setupId, entryPrice, slPrice, positionSize: roundedPositionSize, tpPrices };
    } catch (error) {
      logger.error(`Error in webhook place order:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  static async placeManualOrder(setup) {
    try {
      const exchangeService = await this._getExchangeServiceForSetup(setup);
      const ticker = await exchangeService.getTicker(setup.symbol);
      const entryPrice = parseFloat(ticker.lastPrice);

      const slPrice = exchangeService.roundPrice(setup.symbol, setup.sl_price);
      const symbolInfo = await exchangeService.getSymbolInfo(setup.symbol);
      const qtyStepSize = parseFloat(symbolInfo.qtyStep) || 0.001;

      const accountBalance = await exchangeService.getAccountBalance();
      const riskType = setup.risk_type || 'percent';
      const positionSize = PriceUtils.calculatePositionSize(
        setup.risk_value,
        accountBalance,
        entryPrice,
        slPrice,
        setup.side,
        riskType
      );
      const roundedPositionSize = exchangeService.roundAmount(setup.symbol, positionSize);
      if (roundedPositionSize <= 0) {
        throw new Error(`Calculated position size for manual order #${setup.id} is too small after rounding`);
      }

      const rrRatios = PriceUtils.parseTpPricesJson(setup.tp_prices);
      const tpPrices = PriceUtils.calculateTPPrices(entryPrice, slPrice, rrRatios)
        .map(price => exchangeService.roundPrice(setup.symbol, price));
      const tpQtys = PriceUtils.splitQuantity(
        roundedPositionSize,
        tpPrices.length,
        qtyStepSize
      );

      const entryOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'buy' : 'sell',
        orderType: 'Market',
        qty: roundedPositionSize,
        price: entryPrice,
        timeInForce: 'GTC'
      });

      await this.db.createOrder({
        setup_id: setup.id,
        order_type: 'entry',
        side: setup.side === 'long' ? 'buy' : 'sell',
        price: entryPrice,
        qty: roundedPositionSize,
        exchange_order_id: entryOrder.orderId,
        status: 'pending'
      });

      await sleep(500);

      const slOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'sell' : 'buy',
        orderType: 'Market',
        qty: roundedPositionSize,
        triggerPrice: slPrice,
        triggerDirection: setup.side === 'long' ? 'descending' : 'ascending',
        triggerBy: 'MarkPrice',
        reduceOnly: true
      });

      await this.db.createOrder({
        setup_id: setup.id,
        order_type: 'sl',
        side: setup.side === 'long' ? 'sell' : 'buy',
        price: slPrice,
        qty: roundedPositionSize,
        exchange_order_id: slOrder.orderId,
        status: 'pending'
      });

      for (let i = 0; i < tpPrices.length; i++) {
        const tpOrder = await exchangeService.exchange.createOrder(
          setup.symbol,
          'limit',
          setup.side === 'long' ? 'sell' : 'buy',
          tpQtys[i],
          tpPrices[i],
          { reduceOnly: true, positionIdx: 0 }
        );
        await this.db.createOrder({
          setup_id: setup.id,
          order_type: `tp${i + 1}`,
          side: setup.side === 'long' ? 'sell' : 'buy',
          price: tpPrices[i],
          qty: tpQtys[i],
          exchange_order_id: tpOrder.id,
          status: 'pending'
        });
        await sleep(200);
      }

      await this.db.updateSetupStatus(setup.id, 'active', {
        entry_price: entryPrice,
        entry_qty: roundedPositionSize,
        sl_price: slPrice
      });

      this.stats.setupsActivated++;
      this.stats.ordersPlaced += (2 + tpPrices.length);

      await this.telegramService.sendNotification(setup.user_id, 'order_placed', {
        setupId: setup.id,
        symbol: setup.symbol,
        orderType: 'entry',
        side: setup.side,
        price: entryPrice,
        quantity: roundedPositionSize,
        timestamp: new Date().toISOString()
      });

      logger.orderPlaced(setup.id, 'entry', setup.symbol, entryPrice, roundedPositionSize);

      return { entryPrice, slPrice, positionSize: roundedPositionSize, tpPrices };
    } catch (error) {
      logger.error(`Error placing manual order for setup #${setup.id}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  static async placeEntryOrder(ctx, setup, exchangeService, candles) {
    try {
      const lastCandle = candles[candles.length - 1];
      const entryPrice = lastCandle.close;

      const indicatorParams = IndicatorService.getIndicatorParameters(setup.entry_indicator_type);

      let slPrice = setup.sl_price > 0 ? setup.sl_price : null;
      if (!slPrice) {
        slPrice = PriceUtils.calculateSLPrice(
          entryPrice,
          0,
          0,
          setup.side,
          setup.entry_indicator_type,
          candles,
          indicatorParams
        );
      }
      const symbolInfo = await exchangeService.getSymbolInfo(setup.symbol);
      const qtyStepSize = parseFloat(symbolInfo.qtyStep) || 0.001;

      slPrice = exchangeService.roundPrice(setup.symbol, slPrice);

      const accountBalance = await exchangeService.getAccountBalance();
      const riskType = setup.risk_type || 'percent';
      const positionSize = PriceUtils.calculatePositionSize(
        setup.risk_value,
        accountBalance,
        entryPrice,
        slPrice,
        setup.side,
        riskType
      );
      const roundedPositionSize = exchangeService.roundAmount(setup.symbol, positionSize);
      if (roundedPositionSize <= 0) {
        throw new Error(`Calculated position size for setup #${setup.id} is too small after rounding`);
      }
      const rrRatios = PriceUtils.parseTpPricesJson(setup.tp_prices);
      const tpPrices = PriceUtils.calculateTPPrices(entryPrice, slPrice, rrRatios)
        .map(price => exchangeService.roundPrice(setup.symbol, price));
      const tpQtys = PriceUtils.splitQuantity(
        roundedPositionSize,
        tpPrices.length,
        qtyStepSize
      );

      const entryOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'buy' : 'sell',
        orderType: 'Market',
        price: entryPrice,
        qty: roundedPositionSize,
        timeInForce: 'GTC'
      });

      await ctx.db.createOrder({
        setup_id: setup.id,
        order_type: 'entry',
        side: setup.side === 'long' ? 'buy' : 'sell',
        price: entryPrice,
        qty: roundedPositionSize,
        exchange_order_id: entryOrder.orderId,
        status: 'pending'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const slOrder = await exchangeService.placeOrder({
        symbol: setup.symbol,
        side: setup.side === 'long' ? 'sell' : 'buy',
        orderType: 'Market',
        qty: roundedPositionSize,
        triggerPrice: slPrice,
        triggerDirection: setup.side === 'long' ? 'descending' : 'ascending',
        triggerBy: 'MarkPrice',
        reduceOnly: true
      });

      await ctx.db.createOrder({
        setup_id: setup.id,
        order_type: 'sl',
        side: setup.side === 'long' ? 'sell' : 'buy',
        price: slPrice,
        qty: roundedPositionSize,
        exchange_order_id: slOrder.orderId,
        status: 'pending'
      });

      for (let i = 0; i < tpPrices.length; i++) {
        const tpOrder = await exchangeService.exchange.createOrder(
          setup.symbol,
          'limit',
          setup.side === 'long' ? 'sell' : 'buy',
          tpQtys[i],
          tpPrices[i],
          {
              reduceOnly: true,
              positionIdx: 0
          }
        );
        await ctx.db.createOrder({
          setup_id: setup.id,
          order_type: `tp${i + 1}`,
          side: setup.side === 'long' ? 'sell' : 'buy',
          price: tpPrices[i],
          qty: tpQtys[i],
          exchange_order_id: tpOrder.id,
          status: 'pending'
        });
      }

      await ctx.db.updateSetupStatus(setup.id, 'active', {
        entry_price: entryPrice,
        entry_qty: roundedPositionSize,
        sl_price: slPrice
      });

      ctx.stats.setupsActivated++;
      ctx.stats.ordersPlaced += (2 + tpPrices.length);

      await ctx.telegramService.sendNotification(setup.user_id, 'order_placed', {
        setupId: setup.id,
        symbol: setup.symbol,
        orderType: 'entry',
        side: setup.side,
        price: entryPrice,
        quantity: roundedPositionSize,
        timestamp: new Date().toISOString()
      });

      logger.orderPlaced(setup.id, 'entry', setup.symbol, entryPrice, positionSize);
    } catch (error) {
      logger.error(`Error placing entry order for setup #${setup.id}:`, error);
      throw error;
    }
  }
}

module.exports = EntryService;