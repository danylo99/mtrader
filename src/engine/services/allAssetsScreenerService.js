const logger = require('../logger');
const IndicatorService = require('./indicatorService');
const CandleUtils = require('../utils/candleUtils');
const { _calculateSuperTrendAligned } = require('./indicators/helpers');

const METAL_SYMBOLS = new Set([
  'PAXG/USDT:USDT',
  'XAU/USDT:USDT',
  'XAG/USDT:USDT',
  'XAUT/USDT:USDT',
  'XAGUSD/USD:USD',
  'GOLD/USDT:USDT',
  'PAXG/USDC:USDC',
  'XAU/USDC:USDC',
  'XAG/USDC:USDC',
  'XAUT/USDC:USDC',
  'GOLD/USDC:USDC',
]);

class AllAssetsScreenerService {
  static db = null;
  static telegramService = null;
  static lastEWSignals = new Map();
  static lastSTWritten = new Map();
  static ewSubscribersCache = null;
  static ewSubscribersCacheTs = 0;
  static EW_SUBSCRIBERS_CACHE_MS = 30 * 1000;
  static ewFastBreakSubscribersCache = null;
  static ewFastBreakSubscribersCacheTs = 0;
  static EW_FAST_BREAK_SUBSCRIBERS_CACHE_MS = 30 * 1000;
  static SUPERTREND_ASSET_CACHE_MS = 30 * 1000;
  static supertrendAssetSubscribersCache = null;
  static supertrendAssetSubscribersCacheTs = 0;
  static lastSupertrendSignals = new Map();
  static currentExchange = 'hyperliquid'; // Default exchange

  static setDeps(db, telegramService) {
    this.db = db;
    this.telegramService = telegramService;
    this.ewSubscribersCache = null;
    this.ewSubscribersCacheTs = 0;
    this.ewFastBreakSubscribersCache = null;
    this.ewFastBreakSubscribersCacheTs = 0;
    this.supertrendAssetSubscribersCache = null;
    this.supertrendAssetSubscribersCacheTs = 0;
  }

  static setExchange(exchange) {
    this.currentExchange = exchange;
  }

  static invalidateEwSubscribersCache() {
    this.ewSubscribersCache = null;
    this.ewSubscribersCacheTs = 0;
  }

  static invalidateEwFastBreakSubscribersCache() {
    this.ewFastBreakSubscribersCache = null;
    this.ewFastBreakSubscribersCacheTs = 0;
  }

  static invalidateSupertrendSubscribersCache() {
    this.supertrendAssetSubscribersCache = null;
    this.supertrendAssetSubscribersCacheTs = 0;
  }

  static _stMinTimeframes = new Set(['m5', 'm15', 'm30', 'h1', 'h2', 'h4', 'd1', 'w1']);

   static async processClosedCandle(symbol, timeframe, closedBars) {
    if (closedBars.length < 30) return;

    const parsedBars = CandleUtils.parseExchangeCandles(closedBars);
    if (parsedBars.length < 30) return;

    try {
      if (this._stMinTimeframes.has(timeframe)) {
        await this._updateSTDirection(symbol, timeframe, parsedBars);
      }
      setImmediate(() => {
        this._computeEW(symbol, timeframe, parsedBars).catch(err => {
          logger.error(`EW computation error for ${symbol} ${timeframe}:`, err.message);
        });
      });
    } catch (error) {
      logger.error(`AllAssetsScreenerService error for ${symbol} ${timeframe}:`, error.message);
    }
  }

  static async _getSubscribersForTimeframe(timeframe) {
    if (!this.db) return { userIds: [], hasAnySubscriptions: false };
    const now = Date.now();
    if (!this.ewSubscribersCache || now - this.ewSubscribersCacheTs > this.EW_SUBSCRIBERS_CACHE_MS) {
      try {
        const rows = await this.db.getEnabledEwSubscribers();
        this.ewSubscribersCache = rows;
        this.ewSubscribersCacheTs = now;
      } catch (err) {
        logger.error('Failed to load EW subscribers:', err.message);
        return { userIds: [], hasAnySubscriptions: false };
      }
    }
    const userIds = new Set();
    let hasAny = false;
    for (const row of this.ewSubscribersCache) {
      hasAny = true;
      if (row.timeframe === timeframe) userIds.add(row.user_id);
    }
    return { userIds: Array.from(userIds), hasAnySubscriptions: hasAny };
  }

  static async _getEwFastBreakSubscribers(symbol, timeframe) {
    if (!this.db) return { userIds: [], hasAnySubscriptions: false };
    const now = Date.now();
    if (!this.ewFastBreakSubscribersCache || now - this.ewFastBreakSubscribersCacheTs > this.EW_FAST_BREAK_SUBSCRIBERS_CACHE_MS) {
      try {
        const rows = await this.db.getEnabledEwFastBreakSubscribers();
        this.ewFastBreakSubscribersCache = rows;
        this.ewFastBreakSubscribersCacheTs = now;
      } catch (err) {
        logger.error('Failed to load EW Fast Break subscribers:', err.message);
        return { userIds: [], hasAnySubscriptions: false };
      }
    }
    const userIds = new Set();
    let hasAny = false;
    for (const row of this.ewFastBreakSubscribersCache) {
      hasAny = true;
      if (row.symbol === symbol && row.timeframe === timeframe) userIds.add(row.user_id);
    }
    return { userIds: Array.from(userIds), hasAnySubscriptions: hasAny };
  }

  static async _getSupertrendSubscribers(symbol, timeframe) {
    if (!this.db) return { userIds: [], hasAnySubscriptions: false };
    const now = Date.now();
    if (!this.supertrendAssetSubscribersCache || now - this.supertrendAssetSubscribersCacheTs > this.SUPERTREND_ASSET_CACHE_MS) {
      try {
        const rows = await this.db.getEnabledSupertrendAssetSubscribers();
        this.supertrendAssetSubscribersCache = rows;
        this.supertrendAssetSubscribersCacheTs = now;
      } catch (err) {
        logger.error('Failed to load SuperTrend asset subscribers:', err.message);
        return { userIds: [], hasAnySubscriptions: false };
      }
    }
    const userIds = new Set();
    let hasAny = false;
    for (const row of this.supertrendAssetSubscribersCache) {
      hasAny = true;
      if (row.symbol === symbol && row.timeframe === timeframe) userIds.add(row.user_id);
    }
    return { userIds: Array.from(userIds), hasAnySubscriptions: hasAny };
  }

static async _updateSTDirection(symbol, timeframe, bars) {
    const result = IndicatorService.checkCondition('rollingsupertrend2', bars, { period: 10, multiplier: 3, rollingPeriod: 16 });

    if (result.error) {
      logger.warn(`RollingSuperTrend2 error for ${symbol} ${timeframe}: ${result.error}`);
      return;
    }

    const trend = result.details.trend;

    const key = `${symbol}:${timeframe}`;
    const lastWritten = this.lastSTWritten.get(key);
    const lastSignal = this.lastSupertrendSignals.get(key);

    if (trend !== lastWritten) {
      await this.db.upsertScreenerSnapshot(symbol, timeframe, 'rollingsupertrend2', trend);
      this.lastSTWritten.set(key, trend);
    }

    // Send alert if trend changed (including to/from null)
    if (lastSignal !== undefined && trend !== lastSignal && trend !== null && this.telegramService) {
      const { userIds: subscribers, hasAnySubscriptions } = await this._getSupertrendSubscribers(symbol, timeframe);

      if (subscribers.length > 0) {
        const lastBar = bars[bars.length - 1];
        const price = lastBar ? lastBar.close : 0;
        const timestamp = lastBar && lastBar.timestamp ? lastBar.timestamp : new Date().toISOString();

        const payload = {
          symbol,
          timeframe,
          indicatorType: 'ROLLINGSUPERTREND2',
          signal: trend,
          price,
          exchange: 'bybit',
          isTestnet: false,
          timestamp,
        };

        for (const userId of subscribers) {
          await this.telegramService.sendNotification(userId, 'screener_reversal', payload);
        }

        logger.info(`RollingSuperTrend2 alert sent: ${symbol} ${timeframe} ${trend}, price=${price}`);
      }

      this.lastSupertrendSignals.set(key, trend);
    } else if (trend !== lastSignal) {
      // Update last signal even if no alert sent (for null transitions)
      this.lastSupertrendSignals.set(key, trend);
    }
  }

  static async _computeEW(symbol, timeframe, bars) {
    if (bars.length < 500) return;

    const ewParams = { ...IndicatorService.getIndicatorParameters('ewt'), symbol, timeframe };

    const ewResult = IndicatorService.checkCondition('ewt', bars, ewParams);

    if (ewResult.signal && ewResult.signal !== 'none' && ewResult.met === true) {
      await this.db.upsertScreenerSnapshot(
        symbol,
        timeframe,
        'ewt',
        ewResult.signal
      );

      const key = `${symbol}:${timeframe}`;
      const lastEWSignal = this.lastEWSignals.get(key);

      if (ewResult.signal !== lastEWSignal) {
        const lastBar = bars[bars.length - 1];
        const price = lastBar ? lastBar.close : 0;
        const timestamp = lastBar && lastBar.timestamp ? lastBar.timestamp : new Date().toISOString();

        const isFastBreak = ewResult.signal.startsWith('fast_break_');
        let subscribers = [];
        let hasAnySubscriptions = false;
        let indicatorType = 'EW';
        let notificationType = 'screener_reversal';

        if (isFastBreak) {
          const result = await this._getEwFastBreakSubscribers(symbol, timeframe);
          subscribers = result.userIds;
          hasAnySubscriptions = result.hasAnySubscriptions;
          indicatorType = 'EWT_FAST_BREAK';
          notificationType = 'screener_fast_break';
        } else {
          const result = await this._getSubscribersForTimeframe(timeframe);
          subscribers = result.userIds;
          hasAnySubscriptions = result.hasAnySubscriptions;
        }

        const payload = {
          symbol,
          timeframe,
          indicatorType,
          signal: ewResult.signal,
          price,
          exchange: this.currentExchange,
          isTestnet: false,
          timestamp,
        };

        if (subscribers.length > 0) {
          for (const userId of subscribers) {
            await this.telegramService.sendNotification(userId, notificationType, payload);
          }
        }

        this.lastEWSignals.set(key, ewResult.signal);
      }
    }
  }

  static async populateInitialSnapshot(candleProvider) {
    const allCandles = candleProvider.getAllClosedCandles();
    let count = 0;

    for (const [key, candles] of allCandles.entries()) {
      if (candles.length < 30) continue;
      const parsed = CandleUtils.parseExchangeCandles(candles);
      if (parsed.length < 30) continue;

      const colonIdx = key.lastIndexOf(':');
      const symbol = key.slice(0, colonIdx);
      const timeframe = key.slice(colonIdx + 1);

      // Skip m1 screener to avoid excessive noise
      if (timeframe === 'm1') continue;

      await this._updateSTDirection(symbol, timeframe, parsed);
      count++;
    }

    logger.info(`Initialized RollingSuperTrend2 directions for ${count} symbol/timeframe combinations`);

    await this._populateEWNulls();
  }

  static async _populateEWNulls() {
    if (!this.db) return;

    try {
      const existing = await this.db.getScreenerSnapshots('ewt');
      if (existing && existing.length > 0) {
        logger.info('EW snapshot already populated, skipping');
        return;
      }

      const path = require('path');
      const fs = require('fs');
      const { getProjectRoot } = require('../config');
      const symbolsConfigPath = path.resolve(getProjectRoot(), 'src/config/symbols/assets.json');
      const symbolsConfig = JSON.parse(fs.readFileSync(symbolsConfigPath, 'utf8'));
      const intervals = symbolsConfig.intervals;
      const symbols = symbolsConfig.assets
        .filter(a => a.provider === 'bybit')
        .map(a => a.symbol_ccxt);

      logger.info(`Populating initial EW snapshot for ${symbols.length} symbols x ${intervals.length} timeframes...`);

      for (const symbol of symbols) {
        for (const timeframe of intervals) {
          await this.db.upsertScreenerSnapshot(symbol, timeframe, 'ewt', null);
        }
      }

      logger.info('Initial EW snapshot populated');
    } catch (error) {
      logger.error('Failed to populate initial EW snapshot:', error.message);
    }
  }

}

module.exports = AllAssetsScreenerService;

module.exports = AllAssetsScreenerService;