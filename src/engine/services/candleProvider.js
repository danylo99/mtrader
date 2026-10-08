const ccxt = require('ccxt');
const logger = require('../logger');
const { getCcxtConfig } = require('../config/exchanges');
const TwelveDataProvider = require('./twelveDataProvider');
const CandleUtils = require('../utils/candleUtils');

function getCcxtInterval(timeframe) {
  const map = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h2: '2h', h4: '4h', d1: '1d', w1: '1w' };
  if (!map[timeframe]) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return map[timeframe];
}

function getBybitInterval(timeframe) {
  const map = { m1: '1', m5: '5', m15: '15', m30: '30', h1: '60', h2: '120', h4: '240', d1: 'D', w1: 'W' };
  if (!map[timeframe]) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return map[timeframe];
}

function ccxtToBybitSymbol(symbol) {
  return symbol.replace(/:(USDT|USDC)/, '').replace('/', '');
}

function bybitToCcxtSymbol(bybitSymbol) {
  const match = bybitSymbol.match(/^([A-Z0-9]+)(USDT|USDC)/);
  if (match) {
    return `${match[1]}/${match[2]}:${match[2]}`;
  }
  return bybitSymbol;
}

class BybitWS {
  constructor({ symbols, timeframes, onCandle, onError, isTestnet = true }) {
    this.symbols = symbols;
    this.timeframes = timeframes;
    this.onCandle = onCandle;
    this.onError = onError;
    this.isTestnet = isTestnet;
    this.exchange = null;
    this.isRunning = false;
  }

  async start() {
    try {
      console.log('Creating Bybit CCXT Pro instance...');
      const config = getCcxtConfig('bybit', undefined, undefined, this.isTestnet);
      const ExchangeClass = ccxt.pro.bybit;
      if (!ExchangeClass) {
        console.error('ccxt.pro.bybit not available, falling back to REST-only mode');
        return;
      }

      this.exchange = new ExchangeClass(config);
      this.isRunning = true;

      for (const symbol of this.symbols) {
        for (const timeframe of this.timeframes) {
          this.subscribe(symbol, timeframe);
        }
      }
      console.log('BybitWS subscriptions started');
    } catch (error) {
      console.error('BybitWS start error:', error.message);
      this.onError(error);
    }
  }

  subscribe(symbol, timeframe) {
    const key = `${symbol}:${timeframe}`;
    const interval = getCcxtInterval(timeframe);

    const loop = async () => {
      while (this.isRunning) {
        try {
          const candles = await this.exchange.watchOHLCV(symbol, interval);
          if (candles && candles.length > 0) {
            const latest = candles[candles.length - 1];
            this.onCandle(key, latest, true);
          }
        } catch (err) {
          console.error(`Bybit WS stream error for ${key}:`, err.message);
          if (this.isRunning) {
            this.onError(err);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
    };

    loop().catch(err => {
      console.error(`Bybit WS loop failed for ${key}:`, err.message);
    });
  }

  async stop() {
    this.isRunning = false;
    if (this.exchange) {
      try {
        await this.exchange.close();
      } catch (err) {
        console.log('Error closing Bybit exchange:', err.message);
      }
    }
  }
}

class CandleProvider {
  constructor({ assets = [], timeframes = [], limit = 100, onUpdate, onScreenerUpdate, isTestnet = true }) {
    this.assets = assets;
    this.timeframes = timeframes;
    this.limit = limit;
    this.onUpdate = onUpdate;
    this.onScreenerUpdate = onScreenerUpdate;
    this.isTestnet = isTestnet;

    this.store = new Map();
    this.currentCandles = new Map();
    this.exchange = null;
    this.twelveDataProvider = null;
    this.isRunning = false;
    this.tasks = [];
    this.historicalPromise = null;
    this.pollTimers = [];
  }

  async start() {
    try {
      const bybitAssets = this.assets.filter(a => a.provider === 'bybit');
      const twelvedataAssets = this.assets.filter(a => a.provider === 'twelvedata');

      // Init CCXT exchange for Bybit REST
      const config = getCcxtConfig('bybit', undefined, undefined, this.isTestnet);
      const ExchangeClass = ccxt.bybit;
      if (!ExchangeClass) {
        throw new Error('Unsupported exchange: bybit');
      }
      this.exchange = new ExchangeClass(config);
      if (this.exchange.setSandboxMode) {
        this.exchange.setSandboxMode(this.isTestnet);
      }

      // Init TwelveData provider
      this.twelveDataProvider = new TwelveDataProvider();

      // Start Bybit WebSocket for real-time crypto data
      if (bybitAssets.length > 0) {
        await this.startBybitWS(bybitAssets.map(a => a.symbol_ccxt));
      }

      // Fetch historical data in background
      this.historicalPromise = this.populateHistory().catch(err => {
        logger.error('Background historical fill failed:', err.message);
      });

      this.isRunning = true;
      logger.info(`CandleProvider started: ${this.assets.length} assets (${bybitAssets.length} bybit, ${twelvedataAssets.length} twelvedata), ${this.timeframes.length} timeframes, limit=${this.limit}, testnet=${this.isTestnet}`);
    } catch (error) {
      logger.error('CandleProvider failed to start:', error);
      throw error;
    }
  }

  async startBybitWS(symbols) {
    console.log('Starting Bybit WebSocket...');
    const ws = new BybitWS({
      symbols,
      timeframes: this.timeframes,
      onCandle: (key, raw, confirm) => this.handleBybitWsCandle(key, raw, confirm),
      onError: (err) => logger.error('Bybit WS error:', err.message),
      isTestnet: this.isTestnet,
    });
    this.ws = ws;
    await ws.start();
  }

  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async populateHistory() {
    const errors = [];

    for (const asset of this.assets) {
      for (const timeframe of this.timeframes) {
        if (asset.provider === 'twelvedata' && timeframe === 'm1') continue;
        const key = `${asset.symbol_ccxt}:${timeframe}`;
        let success = false;
        let retries = 3;

        while (retries > 0 && !success) {
          try {
            let candles;
            if (asset.provider === 'twelvedata') {
              candles = await this.twelveDataProvider.fetchOHLCV(asset, timeframe, this.limit);
              candles = candles.slice(0, candles.length - 1);
            } else {
              const interval = getCcxtInterval(timeframe);
              candles = await this.exchange.fetchOHLCV(asset.symbol_ccxt, interval, undefined, this.limit);
              candles = candles.slice(0, candles.length - 1);
            }

            this.store.set(key, candles);
            const last = candles[candles.length - 1];
            this.currentCandles.set(key, last ? [...last] : null);
            success = true;

            if (typeof this.onScreenerUpdate === 'function') {
              const closedBars = this.getClosedCandles(asset.symbol_ccxt, timeframe);
              this.onScreenerUpdate(asset.symbol_ccxt, timeframe, closedBars);
            }
          } catch (error) {
            const isRateLimit = error.message?.includes('429')
              || error.message?.includes('RateLimitExceeded')
              || error.message?.includes('Too Many Requests');

            if (isRateLimit && retries > 1) {
              retries--;
              const backoff = asset.provider === 'twelvedata' ? 30000 : 2000;
              await this.sleep(backoff);
              continue;
            }
            logger.error(`Historical fetch failed for ${key}: ${error.message}`);
            errors.push({ symbol: asset.symbol_ccxt, timeframe, error: error.message });
            break;
          }
        }

        if (asset.provider === 'twelvedata') {
          await this.sleep(7500); // Throttle: free tier ~8 req/min
        }
      }
    }

    // Start TwelveData polling after historical fill
    if (this.isRunning) {
      this.startTwelveDataPolling();
    }

    if (errors.length > 0) {
      logger.warn(`Historical fill completed with ${errors.length} errors`);
    } else {
      logger.warn('Historical fill completed with 0 errors');
    }
  }

  startTwelveDataPolling() {
    const twelvedataAssets = this.assets.filter(a => a.provider === 'twelvedata');
    if (twelvedataAssets.length === 0) return;

    // Poll m5 every 5min, aggregate into higher timeframes
    // 3 assets × 1 request/5min = 0.6 req/min, well under ~8 req/min limit
    const primaryTf = 'm5';
    logger.info(`Starting TwelveData polling for ${twelvedataAssets.length} assets on ${primaryTf} every 5min`);

    const timer = setInterval(async () => {
      for (const asset of twelvedataAssets) {
        try {
          const bar = await this.twelveDataProvider.pollLatestBar(asset, primaryTf);
          if (bar) {
            const key = `${asset.symbol_ccxt}:${primaryTf}`;
            this.handleTwelveDataBar(asset.symbol_ccxt, key, bar);
          }
        } catch (err) {
          logger.error(`TwelveData poll error for ${asset.symbol_ccxt} ${primaryTf}:`, err.message);
        }
      }
    }, 300000);

    this.pollTimers.push(timer);
  }

  handleBybitWsCandle(key, raw, confirm) {
    if (!confirm) return;
    const lastColon = key.lastIndexOf(':');
    const symbol = key.slice(0, lastColon);
    const timeframe = key.slice(lastColon + 1);
    const current = this.currentCandles.get(key);

    if (!current) {
      this.store.set(key, [raw]);
      this.currentCandles.set(key, raw);
      return;
    }
    if (raw[0] > current[0]) {
      const arr = this.store.get(key) || [];
      arr.push(raw);
      while (arr.length > this.limit) arr.shift();
      this.store.set(key, arr);
      this.currentCandles.set(key, raw);
      if (typeof this.onUpdate === 'function') {
        this.onUpdate(symbol, timeframe, current);
      }
      if (typeof this.onScreenerUpdate === 'function') {
        const closedBars = this.getClosedCandles(symbol, timeframe);
        this.onScreenerUpdate(symbol, timeframe, closedBars);
      }
    } else if (raw[0] === current[0]) {
      this.currentCandles.set(key, raw);
    }
  }

  handleTwelveDataBar(symbol, key, raw) {
    const timeframe = key.slice(key.lastIndexOf(':') + 1);
    const current = this.currentCandles.get(key);

    if (!current) {
      this.store.set(key, [raw]);
      this.currentCandles.set(key, raw);
      return;
    }
    if (raw[0] > current[0]) {
      const arr = this.store.get(key) || [];
      arr.push(raw);
      while (arr.length > this.limit) arr.shift();
      this.store.set(key, arr);
      this.currentCandles.set(key, raw);
      if (typeof this.onUpdate === 'function') {
        this.onUpdate(symbol, timeframe, current);
      }
      if (typeof this.onScreenerUpdate === 'function') {
        const closedBars = this.getClosedCandles(symbol, timeframe);
        this.onScreenerUpdate(symbol, timeframe, closedBars);
      }

      // Aggregate into higher timeframes
      if (timeframe === 'm5') {
        this._aggregateTwelveDataTimeframes(symbol);
      }
    } else if (raw[0] === current[0]) {
      this.currentCandles.set(key, raw);
    }
  }

  _aggregateTwelveDataTimeframes(symbol) {
    const m5Candles = this.store.get(`${symbol}:m5`);
    if (!m5Candles || m5Candles.length < 2) return;

    const higherTfs = this.timeframes.filter(tf => tf !== 'm1' && tf !== 'm5');
    for (const tf of higherTfs) {
      try {
        const aggregated = CandleUtils.aggregateOHLCV(m5Candles, 'm5', tf);
        if (aggregated.length === 0) continue;

        const tfKey = `${symbol}:${tf}`;
        const existing = this.store.get(tfKey);
        const merged = this._mergeAggregatedCandles(existing, aggregated);
        this.store.set(tfKey, merged);
        this.currentCandles.set(tfKey, merged[merged.length - 1]);

        if (typeof this.onScreenerUpdate === 'function') {
          const closedBars = this.getClosedCandles(symbol, tf);
          this.onScreenerUpdate(symbol, tf, closedBars);
        }
      } catch (err) {
        logger.error(`TwelveData aggregation error for ${symbol} ${tf}:`, err.message);
      }
    }
  }

  _mergeAggregatedCandles(existing, aggregated) {
    if (!existing || existing.length === 0) return aggregated;

    const existingMap = new Map();
    for (const c of existing) existingMap.set(c[0], c);

    for (const c of aggregated) existingMap.set(c[0], c);

    const merged = [...existingMap.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    while (merged.length > this.limit) merged.shift();
    return merged;
  }

  handleWsCandle(topic, raw, confirm) {
    if (!confirm) return;
    const parts = topic.split('.');
    const interval = parts[1];
    const bybitSymbol = parts[2];
    const symbol = bybitToCcxtSymbol(bybitSymbol);

    const timeframe = this.timeframes.find(tf => getBybitInterval(tf) === interval);
    if (!timeframe) return;

    const key = `${symbol}:${timeframe}`;
    const current = this.currentCandles.get(key);

    if (!current) {
      this.currentCandles.set(key, raw);
      return;
    }
    if (raw[0] > current[0]) {
      const arr = this.store.get(key) || [];
      arr.push(raw);
      while (arr.length > this.limit) arr.shift();
      this.store.set(key, arr);
      this.currentCandles.set(key, raw);
      if (typeof this.onUpdate === 'function') {
        this.onUpdate(symbol, timeframe, current);
      }
      if (typeof this.onScreenerUpdate === 'function') {
        const closedBars = this.getClosedCandles(symbol, timeframe);
        this.onScreenerUpdate(symbol, timeframe, closedBars);
      }
    } else if (raw[0] === current[0]) {
      this.currentCandles.set(key, raw);
    }
  }

  getClosedCandles(symbol, timeframe) {
    const key = `${symbol}:${timeframe}`;
    const arr = this.store.get(key);
    return arr ? arr.slice() : [];
  }

  getAllClosedCandles() {
    const result = new Map();
    for (const [key, arr] of this.store.entries()) {
      result.set(key, arr.slice());
    }
    return result;
  }

  async waitForHistorical() {
    if (this.historicalPromise) {
      await this.historicalPromise;
    }
  }

  async stop() {
    this.isRunning = false;

    for (const timer of this.pollTimers) {
      clearInterval(timer);
    }
    this.pollTimers = [];

    if (this.ws) {
      try {
        await this.ws.stop();
      } catch (error) {
        logger.error('Error stopping WS:', error.message);
      }
    }
    if (this.exchange) {
      try {
        await this.exchange.close();
      } catch (error) {
        logger.warn('Error closing exchange:', error.message);
      }
    }
    this.store.clear();
    this.currentCandles.clear();
    this.tasks = [];
    logger.info('CandleProvider stopped');
  }
}

module.exports = CandleProvider;