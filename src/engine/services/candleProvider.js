const ccxt = require('ccxt');
const logger = require('../logger');
const { getCcxtConfig } = require('../config/exchanges');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

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

function getHyperliquidInterval(timeframe) {
  const map = { 
    m1: '1m', m5: '5m', m15: '15m', m30: '30m', 
    h1: '1h', h2: '2h', h4: '4h', d1: '1d', w1: '1w',
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d', '1w': '1w'
  };
  if (!map[timeframe]) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return map[timeframe];
}

function ccxtToBybitSymbol(symbol) {
  return symbol.replace(':USDT', '').replace('/', '');
}

function bybitToCcxtSymbol(bybitSymbol) {
  return bybitSymbol.replace(/([A-Z0-9]+)(USDT)/, '$1/$2:$2');
}

class HyperliquidWS {
  constructor({ symbols, timeframes, onCandle, onError, isTestnet = true }) {
    this.symbols = symbols;
    this.timeframes = timeframes;
    this.onCandle = onCandle;
    this.onError = onError;
    this.isTestnet = isTestnet;
    this.exchange = null;
    this.isRunning = false;
    this.watchers = new Map(); // key -> { iterator, timeout }
  }

  async start() {
    try {
      console.log('Creating Hyperliquid CCXT Pro instance...');
      const config = getCcxtConfig('hyperliquid', undefined, undefined, this.isTestnet);
      console.log('CCXT config:', config);
      
      // Use ccxt.pro.hyperliquid for WebSocket
      const ExchangeClass = ccxt.pro.hyperliquid;
      if (!ExchangeClass) {
        throw new Error('CCXT Pro Hyperliquid not available');
      }
      
      this.exchange = new ExchangeClass(config);
      console.log('Hyperliquid exchange instance created');
      
      // Skip loadMarkets for Hyperliquid - not needed for WebSocket
      console.log('Skipping loadMarkets for Hyperliquid (WebSocket only)');
      
      this.isRunning = true;
      for (const symbol of this.symbols) {
        for (const timeframe of this.timeframes) {
          await this.subscribe(symbol, timeframe);
        }
      }
      console.log('All subscriptions started');
    } catch (error) {
      console.error('HyperliquidWS start error:', error);
      this.onError(error);
      throw error;
    }
  }

  async subscribe(symbol, timeframe) {
    const key = `${symbol}:${timeframe}`;
    try {
      console.log(`Subscribing to ${symbol} ${timeframe}...`);
      const interval = getHyperliquidInterval(timeframe);
      
      // Start processing loop
      this.processCandleStream(key, symbol, interval);
      console.log(`Started processing stream for ${key}`);
    } catch (err) {
      console.error(`Failed to subscribe to ${key}:`, err);
      this.onError(err);
    }
  }

  async processCandleStream(key, symbol, interval) {
    const loop = async () => {
      while (this.isRunning) {
        try {
          // watchOHLCV returns candles array
          const candles = await this.exchange.watchOHLCV(symbol, interval);
          
          if (candles && candles.length > 0) {
            const latest = candles[candles.length - 1]; // [timestamp, open, high, low, close, volume]
            this.onCandle(key, latest, true); // confirmed = true
          }
        } catch (err) {
          console.error(`Candle stream error for ${key}:`, err.message);
          if (this.isRunning) {
            this.onError(err);
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
    };
    
    // Start the loop
    loop().catch(err => {
      console.error(`Candle stream loop failed for ${key}:`, err);
    });
  }

  async stop() {
    this.isRunning = false;
    console.log('Stopping HyperliquidWS...');
    
    if (this.exchange) {
      try { 
        await this.exchange.close(); 
        console.log('Hyperliquid exchange closed');
      } catch (err) {
        console.warn('Error closing exchange:', err.message);
      }
    }
    console.log('HyperliquidWS stopped');
  }
}

class CandleProvider {
  constructor({ exchange = 'bybit', symbols = [], timeframes = [], limit = 100, onUpdate, onScreenerUpdate, isTestnet = true }) {
    this.exchangeName = exchange.toLowerCase();
    this.symbols = symbols;
    this.timeframes = timeframes;
    this.limit = limit;
    this.onUpdate = onUpdate;
    this.onScreenerUpdate = onScreenerUpdate;
    this.isTestnet = isTestnet;

    this.store = new Map();
    this.currentCandles = new Map();
    this.exchange = null;
    this.isRunning = false;
    this.tasks = [];
    this.wsTimeout = null;
    this.historicalPromise = null;
  }

  async start() {
    try {
      const config = getCcxtConfig(this.exchangeName, undefined, undefined, this.isTestnet);
      const ExchangeClass = ccxt[this.exchangeName];
      if (!ExchangeClass) {
        throw new Error(`Unsupported exchange: ${this.exchangeName}`);
      }

      this.exchange = new ExchangeClass(config);

      if (this.exchange.setSandboxMode) {
        this.exchange.setSandboxMode(this.isTestnet);
      }

      await this.filterPerpSymbols();
      
      // Start WebSocket first for real-time data
      await this.startWebSocket();
      
      // Fetch historical data in background (non-blocking)
      this.historicalPromise = this.fetchHistorical().catch(err => {
        logger.error('Background historical fetch failed:', err.message);
      });

      this.isRunning = true;
      const combos = this.symbols.length * this.timeframes.length;
      logger.info(`CandleProvider started: ${this.symbols.length} symbols x ${this.timeframes.length} timeframes (${combos} channels), limit=${this.limit}, testnet=${this.isTestnet}`);
    } catch (error) {
      logger.error('CandleProvider failed to start:', error);
      throw error;
    }
  }

  async filterPerpSymbols() {
    try {
      if (this.exchangeName === 'hyperliquid') {
        // For Hyperliquid, skip market filtering for now since fetchMarkets might not work
        // We'll trust the config symbols are correct
        console.log('Skipping market filtering for Hyperliquid');
        return;
      }
      
      console.log('Fetching markets...');
      const markets = await this.exchange.fetchMarkets();
      console.log(`Fetched ${Object.keys(markets).length} markets`);
      const validSymbols = new Set();
      for (const market of Object.values(markets)) {
        if (this.exchangeName === 'bybit') {
          // Bybit: perpetual futures with USDT settlement (legacy support)
          if (market.type === 'swap' && market.linear === true && market.settle === 'USDT') {
            validSymbols.add(market.symbol);
          }
        }
      }
      console.log(`Valid symbols found: ${validSymbols.size}`);
      const originalCount = this.symbols.length;
      this.symbols = this.symbols.filter(s => validSymbols.has(s));
      if (this.symbols.length < originalCount) {
        const removed = originalCount - this.symbols.length;
        logger.warn(`Filtered out ${removed} non-perp symbols. ${this.symbols.length}/${originalCount} remaining.`);
        logger.warn(`Remaining symbols: ${this.symbols.join(', ')}`);
      }
    } catch (error) {
      console.error('Failed to filter perp symbols:', error.message, error.stack);
      logger.error('Failed to filter perp symbols:', error);
    }
  }

  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async fetchHistorical() {
    const errors = [];
    for (const symbol of this.symbols) {
      for (const timeframe of this.timeframes) {
        const key = `${symbol}:${timeframe}`;
        let success = false;
        let retries = 20;

        while (retries > 0 && !success) {
          try {
            const interval = this.exchangeName === 'hyperliquid'
              ? getHyperliquidInterval(timeframe)
              : getCcxtInterval(timeframe);

            const candles = await this.exchange.fetchOHLCV(symbol, interval, undefined, this.limit);
            const ordered = candles.slice(0, candles.length - 1);
            this.store.set(key, ordered);
            const last = ordered[ordered.length - 1];
            this.currentCandles.set(key, last ? [...last] : null);
            success = true;

            if (typeof this.onScreenerUpdate === 'function') {
              const closedBars = this.getClosedCandles(symbol, timeframe);
              this.onScreenerUpdate(symbol, timeframe, closedBars);
            }
          } catch (error) {
            const isRateLimit = error.message?.includes('429')
              || error.message?.includes('RateLimitExceeded')
              || error.message?.includes('Too Many Requests');

            if (isRateLimit && retries > 1) {
              retries--;
              const delay = 1000 * (21 - retries);
              await this.sleep(delay);
              continue;
            }
            logger.error(`Historical fetch failed for ${key}:`, error.message);
            errors.push({ symbol, timeframe, error: error.message });
            break;
          }
        }
      }
    }

    if (errors.length > 0) {
      logger.warn(`Sequential historical fill completed with ${errors.length} errors`);
    } else {
      logger.warn(`Sequential historical fill completed with 0 errors`);
    }
  }

  async startWebSocket() {
    if (this.exchangeName === 'bybit') {
      // Legacy Bybit support
      console.error('BybitWS class not found - WebSocket will not work');
      logger.error('BybitWS class not found - WebSocket will not work');
      // Continue without WebSocket for now
    } else if (this.exchangeName === 'hyperliquid') {
      console.log('Starting Hyperliquid WebSocket...');
      const ws = new HyperliquidWS({
        symbols: this.symbols,
        timeframes: this.timeframes,
        onCandle: (key, raw, confirm) => this.handleHyperliquidWsCandle(key, raw, confirm),
        onError: (err) => logger.error('Hyperliquid WS error:', err.message),
        isTestnet: this.isTestnet,
      });
      this.ws = ws;
      await ws.start();
      console.log('Hyperliquid WebSocket started');
    } else {
      throw new Error(`WebSocket not supported for exchange: ${this.exchangeName}`);
    }
  }

  handleWsCandle(topic, raw,confirm) {
    if (!confirm) return; // Only process confirmed candles
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

  handleHyperliquidWsCandle(key, raw, confirm) {
    if (!confirm) return; // Only process confirmed candles
    const lastColon = key.lastIndexOf(':');
    const symbol = key.slice(0, lastColon);
    const timeframe = key.slice(lastColon + 1);
    const current = this.currentCandles.get(key);

    if (!current) {
      // First candle for this key - initialize store with it
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

if (require.main === module) {
  const exchange = process.env.EXCHANGE || 'hyperliquid';
  const symbolsConfigPath = path.resolve(__dirname, `../../config/symbols/${exchange}.json`);
  const symbolsConfig = JSON.parse(fs.readFileSync(symbolsConfigPath, 'utf8'));
  const symbols = symbolsConfig.symbols.map(s => s.symbol);
  const provider = new CandleProvider({
    exchange: exchange,
    symbols,
    timeframes: symbolsConfig.intervals,
    limit: 1000,
    onUpdate: (symbol, timeframe, candle) => {
      console.log(`[CLOSED] ${symbol} ${timeframe} | O:${candle[1]} H:${candle[2]} L:${candle[3]} C:${candle[4]} V:${candle[5]}`);
    },
    isTestnet: false
  });
  provider.start().catch(console.error);
  process.on('SIGINT', () => {
    provider.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}

module.exports = CandleProvider;
