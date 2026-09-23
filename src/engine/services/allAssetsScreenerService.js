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
  static SUPERTREND_ASSET_CACHE_MS = 30 * 1000;
  static supertrendAssetSubscribersCache = null;
  static supertrendAssetSubscribersCacheTs = 0;
  static lastSupertrendSignals = new Map();
  static mazscoreTfSubscribersCache = null;
  static mazscoreTfSubscribersCacheTs = 0;
  static mazscoreAssetSubscribersCache = null;
  static mazscoreAssetSubscribersCacheTs = 0;
  static lastMAZScoreAvg = null;
  static MAZSCORE_ALERT_THRESHOLD = 0.5;
  static nonMetalSymbols = null;
  static m15ZScoreMap = new Map();
  static lastMAZScoreWritten = new Map();
  static MAZSCORE_PER_ASSET_THRESHOLD = 1.5;
  static lastMAZScorePerAsset = new Map();
  static lastMAZScoreExtreme = new Map();
  static lastMAZScoreAvgExtreme = null;
  static currentExchange = 'hyperliquid'; // Default exchange

  static setDeps(db, telegramService) {
    this.db = db;
    this.telegramService = telegramService;
    this.ewSubscribersCache = null;
    this.ewSubscribersCacheTs = 0;
    this.supertrendAssetSubscribersCache = null;
    this.supertrendAssetSubscribersCacheTs = 0;
  }

  static setExchange(exchange) {
    this.currentExchange = exchange;
    this.nonMetalSymbols = null; // Invalidate cache when exchange changes
  }

  static invalidateEwSubscribersCache() {
    this.ewSubscribersCache = null;
    this.ewSubscribersCacheTs = 0;
  }

  static invalidateMazscoreCaches() {
    this.mazscoreTfSubscribersCache = null;
    this.mazscoreTfSubscribersCacheTs = 0;
    this.mazscoreAssetSubscribersCache = null;
    this.mazscoreAssetSubscribersCacheTs = 0;
  }

  static invalidateSupertrendSubscribersCache() {
    this.supertrendAssetSubscribersCache = null;
    this.supertrendAssetSubscribersCacheTs = 0;
  }

  static _stMinTimeframes = new Set(['m15', 'm30', 'h1', 'h2', 'h4', 'd1', 'w1']);

   static async processClosedCandle(symbol, timeframe, closedBars) {
    if (closedBars.length < 20) return;

    const parsedBars = CandleUtils.parseExchangeCandles(closedBars);
    if (parsedBars.length < 20) return;

    try {
      if (this._stMinTimeframes.has(timeframe)) {
        await this._updateSTDirection(symbol, timeframe, parsedBars);
      }
      setImmediate(() => {
        this._computeEW(symbol, timeframe, parsedBars).catch(err => {
          logger.error(`EW computation error for ${symbol} ${timeframe}:`, err.message);
        });
      });
      setImmediate(() => {
        this._computeMAZScore(symbol, timeframe, parsedBars).catch(err => {
          logger.error(`MA Z-Score computation error for ${symbol} ${timeframe}:`, err.message);
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

  static async _getMazscoreTfSubscribers(timeframe) {
    if (!this.db) return { userIds: [], hasAnySubscriptions: false };
    const now = Date.now();
    if (!this.mazscoreTfSubscribersCache || now - this.mazscoreTfSubscribersCacheTs > this.MAZSCORE_SUBSCRIBERS_CACHE_MS) {
      try {
        const rows = await this.db.getEnabledMazscoreTfSubscribers();
        this.mazscoreTfSubscribersCache = rows;
        this.mazscoreTfSubscribersCacheTs = now;
      } catch (err) {
        logger.error('Failed to load MAZScore TF subscribers:', err.message);
        return { userIds: [], hasAnySubscriptions: false };
      }
    }
    const userIds = new Set();
    let hasAny = false;
    for (const row of this.mazscoreTfSubscribersCache) {
      hasAny = true;
      if (row.timeframe === timeframe) userIds.add(row.user_id);
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
    const highs = bars.map(c => c.high);
    const lows = bars.map(c => c.low);
    const closes = bars.map(c => c.close);

    const { direction } = _calculateSuperTrendAligned(highs, lows, closes, 10, 3);
    let lastDir = 0;
    for (let i = direction.length - 1; i >= 0; i--) {
      if (direction[i] !== 0) { lastDir = direction[i]; break; }
    }
    const trend = lastDir === -1 ? 'bullish' : lastDir === 1 ? 'bearish' : null;

    const key = `${symbol}:${timeframe}`;
    const lastWritten = this.lastSTWritten.get(key);
    const lastSignal = this.lastSupertrendSignals.get(key);

    if (trend !== lastWritten) {
      await this.db.upsertScreenerSnapshot(symbol, timeframe, 'supertrend', trend);
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
          indicatorType: 'SUPERTREND',
          signal: trend,
          price,
          exchange: 'bybit',
          isTestnet: false,
          timestamp,
        };

        for (const userId of subscribers) {
          await this.telegramService.sendNotification(userId, 'screener_reversal', payload);
        }

        logger.info(`SuperTrend alert sent: ${symbol} ${timeframe} ${trend}, price=${price}`);
      }

      this.lastSupertrendSignals.set(key, trend);
    } else if (trend !== lastSignal) {
      // Update last signal even if no alert sent (for null transitions)
      this.lastSupertrendSignals.set(key, trend);
    }
  }

  static async _computeEW(symbol, timeframe, bars) {
    if (bars.length < 500) return;

    const ewParams = {
      barsPerHour: 4,
      barsPerHour2: 16,
      macroAtrLen: 10,
      macroMult: 3.0,
      localAtrLen: 10,
      localMult: 3.0,
      zscoreLength: 500,
      zscoreMin: 1.8,
      zscoreMax: 10.0,
      useWickFilter: true,
      maxWickRatio: 0.3,
      maxLegsAllowed: 5,
      useExtFilter: true,
      extMultiplier: 1.27,
      tradeMode: 'First Change Only'
    };

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

        const { userIds: subscribers, hasAnySubscriptions } = await this._getSubscribersForTimeframe(timeframe);
        const payload = {
          symbol,
          timeframe,
          indicatorType: 'EW',
          signal: ewResult.signal,
          price,
          exchange: this.currentExchange,
          isTestnet: false,
          timestamp,
        };

        if (subscribers.length > 0) {
          for (const userId of subscribers) {
            await this.telegramService.sendNotification(userId, 'screener_reversal', payload);
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
      if (candles.length < 20) continue;
      const parsed = CandleUtils.parseExchangeCandles(candles);
      if (parsed.length < 20) continue;

      const colonIdx = key.lastIndexOf(':');
      const symbol = key.slice(0, colonIdx);
      const timeframe = key.slice(colonIdx + 1);

      await this._updateSTDirection(symbol, timeframe, parsed);
      count++;
    }

    logger.info(`Initialized SuperTrend directions for ${count} symbol/timeframe combinations`);

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
      const symbolsConfigPath = path.resolve(getProjectRoot(), `config/symbols/${this.currentExchange}.json`);
      const symbolsConfig = JSON.parse(fs.readFileSync(symbolsConfigPath, 'utf8'));
      const intervals = symbolsConfig.intervals;
      const symbols = symbolsConfig.symbols.map(s => s.symbol);

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

  static async _computeMAZScore(symbol, timeframe, bars) {
    if (bars.length < 20) return;

    const result = IndicatorService.checkCondition('mazscore', bars, { emaLength: 50, atrLength: 14, lookbackLength: 200 });

    if (result.met && result.signal && result.signal !== 'none') {
      const zScoreVal = parseFloat(result.signal);
      if (isNaN(zScoreVal)) return;

      const rounded = zScoreVal.toFixed(2);
      const key = `${symbol}:${timeframe}`;
      const lastWritten = this.lastMAZScoreWritten.get(key);

      if (rounded !== lastWritten) {
        await this.db.upsertScreenerSnapshot(symbol, timeframe, 'mazscore', rounded);
        this.lastMAZScoreWritten.set(key, rounded);
      }

      if (timeframe === 'm15') {
        this.m15ZScoreMap.set(symbol, zScoreVal);
        await this._checkAndSendMAZScoreAlert(symbol, timeframe, bars);
      }

      await this._checkAndSendPerAssetMAZScoreAlert(symbol, timeframe, zScoreVal, bars);
    }
  }

  static async _checkAndSendMAZScoreAlert(symbol, timeframe, bars) {
    if (!this.db || !this.telegramService) return;
    if (this.m15ZScoreMap.size === 0) return;

    try {
      const nonMetalSymbols = this._getNonMetalSymbols();
      const m15ZValues = [];
      for (const [sym, val] of this.m15ZScoreMap.entries()) {
        if (nonMetalSymbols.has(sym)) {
          m15ZValues.push(val);
        }
      }

      if (m15ZValues.length === 0) return;

      const avgZScore = m15ZValues.reduce((a, b) => a + b, 0) / m15ZValues.length;
      const prevAvg = this.lastMAZScoreAvg;

      this.lastMAZScoreAvg = avgZScore;

      const threshold = this.MAZSCORE_ALERT_THRESHOLD;

      if (prevAvg !== null) {
        let signalType = null;
        if (prevAvg <= threshold && avgZScore > threshold) {
          signalType = 'bullish';
        } else if (prevAvg >= -threshold && avgZScore < -threshold) {
          signalType = 'bearish';
        }

        if (signalType) {
          this.lastMAZScoreAvgExtreme = signalType;
          await this.db.upsertScreenerSnapshot('MARKET', 'm15', 'mazscore_avg_extreme', signalType);

          const lastBar = bars[bars.length - 1];
          const price = lastBar ? lastBar.close : 0;
          const timestamp = lastBar && lastBar.timestamp ? lastBar.timestamp : new Date().toISOString();

          const payload = {
            symbol: 'MARKET',
            timeframe,
            indicatorType: 'MAZSCORE',
            signal: signalType,
            price: avgZScore,
exchange: this.currentExchange,
            isTestnet: false,
            timestamp,
          };

          const { userIds: subscribers, hasAnySubscriptions } = await this._getMazscoreTfSubscribers(timeframe);

          if (subscribers.length > 0) {
            for (const userId of subscribers) {
              await this.telegramService.sendNotification(userId, 'screener_reversal', payload);
            }
          }

          logger.info(`MA Z-Score alert sent: ${signalType}, avg=${avgZScore.toFixed(4)}, prev=${prevAvg.toFixed(4)}`);
        }
      }
    } catch (error) {
      logger.error('MA Z-Score alert check error:', error.message);
    }
  }

  static async _checkAndSendPerAssetMAZScoreAlert(symbol, timeframe, zScoreVal, bars) {
    if (!this.db || !this.telegramService) return;

    try {
      const threshold = this.MAZSCORE_PER_ASSET_THRESHOLD;
      const key = `${symbol}:${timeframe}`;
      const prevZScore = this.lastMAZScorePerAsset.get(key);
      this.lastMAZScorePerAsset.set(key, zScoreVal);

      if (prevZScore === undefined) return;

      let signalType = null;
      if (prevZScore <= threshold && zScoreVal > threshold) {
        signalType = 'bullish';
      } else if (prevZScore >= -threshold && zScoreVal < -threshold) {
        signalType = 'bearish';
      }

      if (signalType) {
        this.lastMAZScoreExtreme.set(key, signalType);
        await this.db.upsertScreenerSnapshot(symbol, timeframe, 'mazscore_extreme', signalType);

        const lastBar = bars[bars.length - 1];
        const price = lastBar ? lastBar.close : 0;
        const timestamp = lastBar?.timestamp || new Date().toISOString();

        const payload = {
          symbol,
          timeframe,
          indicatorType: 'MAZSCORE',
          signal: signalType,
          price: zScoreVal,
          exchange: this.currentExchange,
          isTestnet: false,
          timestamp,
        };

        const { userIds: subscribers, hasAnySubscriptions } = await this._getMazscoreAssetSubscribers(symbol, timeframe);

        if (subscribers.length > 0) {
          for (const userId of subscribers) {
            await this.telegramService.sendNotification(userId, 'screener_reversal', payload);
          }
        }

        logger.info(`MA Z-Score per-asset alert: ${symbol} ${timeframe} ${signalType}, z=${zScoreVal.toFixed(4)}, prev=${prevZScore.toFixed(4)}`);
      }
    } catch (error) {
      logger.error(`MA Z-Score per-asset alert error for ${symbol} ${timeframe}:`, error.message);
    }
  }

  static _getNonMetalSymbols() {
    if (this.nonMetalSymbols) return this.nonMetalSymbols;

    const path = require('path');
    const fs = require('fs');
    const { getProjectRoot } = require('../config');
    const symbolsConfigPath = path.resolve(getProjectRoot(), `config/symbols/${this.currentExchange}.json`);
    const symbolsConfig = JSON.parse(fs.readFileSync(symbolsConfigPath, 'utf8'));
    const allSymbols = new Set(symbolsConfig.symbols.map(s => s.symbol));
    this.nonMetalSymbols = new Set([...allSymbols].filter(s => !METAL_SYMBOLS.has(s) && !s.startsWith('XYZ')));
    return this.nonMetalSymbols;
  }

  static async populateMAZScoreSnapshot(candleProvider) {
    if (!this.db) return;

    try {
      const allCandles = candleProvider.getAllClosedCandles();
      const symbolsConfigPath = require('path').resolve(
        require('../config').getProjectRoot(),
        `config/symbols/${this.currentExchange}.json`
      );
      const symbolsConfig = JSON.parse(require('fs').readFileSync(symbolsConfigPath, 'utf8'));
      const intervals = symbolsConfig.intervals;
      const allSymbols = symbolsConfig.symbols.map(s => s.symbol);

      this._getNonMetalSymbols();

      logger.info(`Populating initial MA Z-Score snapshot for ${allSymbols.length} symbols x ${intervals.length} timeframes...`);

      let count = 0;
      for (const symbol of allSymbols) {
        for (const timeframe of intervals) {
          const key = `${symbol}:${timeframe}`;
          const candles = allCandles.get(key);
          if (!candles || candles.length < 20) {
            await this.db.upsertScreenerSnapshot(symbol, timeframe, 'mazscore', null);
            continue;
          }

          const parsed = CandleUtils.parseExchangeCandles(candles);
          if (parsed.length < 20) {
            await this.db.upsertScreenerSnapshot(symbol, timeframe, 'mazscore', null);
            continue;
          }

          const result = IndicatorService.checkCondition('mazscore', parsed, { emaLength: 50, atrLength: 14, lookbackLength: 200 });
          if (result.met && result.signal && result.signal !== 'none') {
            const zScoreVal = parseFloat(result.signal);
            await this.db.upsertScreenerSnapshot(symbol, timeframe, 'mazscore', result.signal);
            this.lastMAZScorePerAsset.set(key, zScoreVal);
            if (timeframe === 'm15') {
              this.m15ZScoreMap.set(symbol, zScoreVal);
            }
          } else {
            await this.db.upsertScreenerSnapshot(symbol, timeframe, 'mazscore', null);
          }
          count++;
        }
      }

      const m15Values = [...this.m15ZScoreMap.values()];
      if (m15Values.length > 0) {
        this.lastMAZScoreAvg = m15Values.reduce((a, b) => a + b, 0) / m15Values.length;
      }

      logger.info(`Initial MA Z-Score snapshot populated for ${count} symbol/timeframe combinations`);

      const extremeRows = await this.db.getScreenerSnapshots('mazscore_extreme');
      for (const row of extremeRows) {
        this.lastMAZScoreExtreme.set(`${row.symbol}:${row.timeframe}`, row.signal);
      }
      const avgExtremeRows = await this.db.getScreenerSnapshots('mazscore_avg_extreme');
      if (avgExtremeRows.length > 0) {
        this.lastMAZScoreAvgExtreme = avgExtremeRows[0].signal;
      }
      logger.info(`Loaded ${extremeRows.length} per-asset extremes, avg extreme: ${this.lastMAZScoreAvgExtreme}`);
    } catch (error) {
      logger.error('Failed to populate initial MA Z-Score snapshot:', error.message);
    }
  }
}

module.exports = AllAssetsScreenerService;