const ccxt = require('ccxt');
const logger = require('../logger');
const Encryption = require('../utils/encryption');
const { getCcxtConfig } = require('../config/exchanges');

class ExchangeService {
  constructor(exchangeName, apiKeyEnc, apiSecretEnc, isTestnet = true) {
    this.exchangeName = exchangeName.toLowerCase();
    this.apiKey = apiKeyEnc ? Encryption.decrypt(apiKeyEnc).trim() : null;
    this.apiSecret = apiSecretEnc ? Encryption.decrypt(apiSecretEnc).trim() : null;
    this.isTestnet = isTestnet;
    
    // Log for debugging
    logger.info(`ExchangeService initialized for ${this.exchangeName} - key_len=${this.apiKey?.length || 0}, secret_len=${this.apiSecret?.length || 0}, testnet=${isTestnet}`);
    
    // Validate credentials are available
    if (!this.apiKey || !this.apiSecret) {
      logger.warn(`ExchangeService initialized with incomplete credentials for ${this.exchangeName} - key=${!!this.apiKey}, secret=${!!this.apiSecret}`);
    }
    
    // Initialize CCXT exchange instance
    const exchangeClass = ccxt[this.exchangeName];
    if (!exchangeClass) {
      throw new Error(`Unsupported exchange: ${this.exchangeName}`);
    }
    
    // Get CCXT configuration
    const config = getCcxtConfig(this.exchangeName, this.apiKey, this.apiSecret, this.isTestnet);
    
    this.exchange = new exchangeClass(config);
    
    // Set testnet/sandbox mode if supported
    if (this.exchange.setSandboxMode) {
      this.exchange.setSandboxMode(isTestnet);
    }
    
    this.symbolInfoCache = new Map();
    this.symbolMap = null;
  }

  _resolveSymbol(ccxtSymbol) {
    if (this.exchangeName !== 'hyperliquid') return ccxtSymbol;
    try {
      if (!this.symbolMap) {
        const path = require('path');
        const fs = require('fs');
        const { getProjectRoot } = require('../config');
        const config = JSON.parse(fs.readFileSync(path.resolve(getProjectRoot(), 'src/config/symbols/assets.json'), 'utf8'));
        this.symbolMap = {};
        for (const a of config.assets) {
          if (a.symbol_hyperliquid) this.symbolMap[a.symbol_ccxt] = a.symbol_hyperliquid;
        }
      }
      return this.symbolMap[ccxtSymbol] || ccxtSymbol;
    } catch (e) {
      logger.error('Failed to resolve hyperliquid symbol:', e.message);
      return ccxtSymbol;
    }
  }
  
  // Get symbol info (cached)
async getSymbolInfo(symbol) {
    const exchangeSymbol = this._resolveSymbol(symbol);
    if (this.symbolInfoCache.has(exchangeSymbol)) {
      return this.symbolInfoCache.get(exchangeSymbol);
    }
    
    try {
      const markets = await this.exchange.loadMarkets();
      const market = markets[exchangeSymbol];
      
      if (market) {
        const tickSize = market.precision?.price ?? market.info?.priceFilter?.tickSize ?? market.info?.tickSize;
        const qtyStep = market.precision?.amount ?? market.info?.lotSizeFilter?.qtyStep ?? market.info?.qtyStep;
        const info = {
          symbol: market.symbol,
          minOrderQty: market.limits?.amount?.min,
          maxOrderQty: market.limits?.amount?.max,
          qtyStep,
          priceScale: tickSize,
          tickSize,
          contractType: market.type,
          active: market.active,
          trading: market.info?.status === 'Trading',
        };
this.symbolInfoCache.set(exchangeSymbol, info);
        return info;
      }
      throw new Error(`No market info for ${exchangeSymbol} on ${this.exchangeName}`);
    } catch (error) {
      logger.apiError('getSymbolInfo', error);
      throw error;
    }
  }
  
  // Get candles/OHLCV data
  async getCandles(symbol, timeframe, limit = 100) {
    try {
      const exchangeSymbol = this._resolveSymbol(symbol);
      const candles = await this.exchange.fetchOHLCV(exchangeSymbol, this.timeframeToInterval(timeframe), undefined, limit);
      // Convert to format expected by existing code
      const formattedCandles = candles.map(candle => [
        candle[0].toString(), // timestamp
        candle[1].toString(), // open
        candle[2].toString(), // high
        candle[3].toString(), // low
        candle[4].toString(), // close
        candle[5].toString(), // volume
      ]);
      
      logger.info(`Fetched ${formattedCandles.length} candles for ${symbol} (${symbol}) ${timeframe} on ${this.exchangeName}`);
      return formattedCandles; // Oldest to newest
    } catch (error) {
      logger.apiError('getCandles', error);
      throw error;
    }
  }
  
  // Get ticker data
  async getTicker(symbol) {
    try {
      const ticker = await this.exchange.fetchTicker(this._resolveSymbol(symbol));
      const last = ticker.last || ticker.close || ticker.vwap || ticker.lastPrice || 0;
      return {
        symbol: ticker.symbol,
        lastPrice: last.toString(),
        bidPrice: (ticker.bid || last).toString(),
        askPrice: (ticker.ask || last).toString()
      };
    } catch (error) {
      logger.apiError('getTicker', error);
      throw error;
    }
  }
  
  // Get account balance
  async getAccountBalance() {
    try {
      const balance = await this.exchange.fetchBalance();
      if (this.exchangeName=='hyperliquid'){
        const usdtBalance = balance.total?.USDC;
        return parseFloat(usdtBalance);

      }else{
        const usdtBalance = balance.total?.USDT  || balance.total?.usdt || 0;
        return parseFloat(usdtBalance);

      }
      // Find USDT balance
    } catch (error) {
      logger.apiError('getAccountBalance', error);
      throw error;
    }
  }
  
  static formatHyperliquidSymbol(symbol) {
    return symbol.replace('/', '-');
  }

  // Place an order
  async placeOrder(orderParams) {
    try {
      const symbol = this._resolveSymbol(orderParams.symbol);

      // Convert order parameters to CCXT format
      const params = {
        symbol,
        type: orderParams.orderType.toLowerCase(),
        side: orderParams.side.toLowerCase(),
        amount: parseFloat(orderParams.qty)
      };
      
      // Include price for limit orders
      if ((orderParams.orderType.toLowerCase() === 'limit' || orderParams.orderType.toLowerCase() === 'stop_market') && orderParams.price !== undefined && orderParams.price !== null) {
        params.price = parseFloat(orderParams.price);
      }
      
      if ((orderParams.orderType.toLowerCase() === 'market' && this.exchangeName === 'hyperliquid' && orderParams.price !== undefined && orderParams.price !== null)) {
        params.price = parseFloat(orderParams.price);
      }

      // Include additional parameters
      if (orderParams.timeInForce) {
        params.timeInForce = orderParams.timeInForce;
      }
      
      // Trigger price for conditional orders
      if (orderParams.triggerPrice !== undefined && orderParams.triggerPrice !== null) {
        params.triggerPrice = parseFloat(orderParams.triggerPrice);
        if(this.exchangeName=='hyperliquid'){
          params.price = parseFloat(orderParams.triggerPrice);
        }
      }
      
      // Reduce only flag
      if (orderParams.reduceOnly === true) {
        params.reduceOnly = true;
      }
      
      if (orderParams.triggerDirection) {
        params.triggerDirection = orderParams.triggerDirection;
      }
      if (orderParams.positionIdx !== undefined && orderParams.positionIdx !== null) {
        params.positionIdx = parseInt(orderParams.positionIdx);
      }

      logger.info(`Placing ${this.exchangeName} order: ${JSON.stringify(params)}`);
      
      const order = await this.exchange.createOrder(
        params.symbol,
        params.type,
        params.side,
        params.amount,
        params.price,
        params
      );
      
      logger.info(`Order placed on ${this.exchangeName}: ${order.id} for ${order.symbol} (${symbol})`);
      
      return {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        price: order.price,
        qty: order.amount,
        status: order.status || 'pending',
      };
    } catch (error) {
      logger.apiError('placeOrder', error);
      throw error;
    }
  }
  
  // Get order status
  async getOrderStatus(orderId, symbol) {
    const exchangeSymbol = this._resolveSymbol(symbol);
    try {
      if(this.exchangeName=='bybit'){
        const order = await this.exchange.fetchClosedOrder(orderId, exchangeSymbol);
        return order;

      }else{
        const order = await this.exchange.fetchOrder(orderId, exchangeSymbol);
        return order;
      }
    } catch (error) {
      // Order might not exist
      if (error instanceof ccxt.OrderNotFound) {
        return null;
      }
      logger.info('getOrderStatus', error);
      throw error;
    }
}

  roundPrice(symbol, price) {
    return parseFloat(this.exchange.priceToPrecision(this._resolveSymbol(symbol), price));
  }

  roundAmount(symbol, amount) {
    return parseFloat(this.exchange.amountToPrecision(this._resolveSymbol(symbol), amount));
  }

  // Cancel order
  async cancelOrder(orderId, symbol, params = {}) {
    try {
      const exchangeSymbol = this._resolveSymbol(symbol);
      const result = await this.exchange.cancelOrder(orderId, exchangeSymbol, params);
      logger.info(`Order canceled on ${this.exchangeName}: ${orderId} for ${exchangeSymbol}`);
      return true;
    } catch (error) {
      logger.apiError('cancelOrder', error);
      throw error;
    }
  }
  
  // Get positions
  async getPositions(symbol = undefined) {
    try {
      let positions;
      
      if (symbol) {
        positions = await this.exchange.fetchPositions([this._resolveSymbol(symbol)]);
      } else {
        positions = await this.exchange.fetchPositions();
      }
      
      // Convert to consistent format
      return positions.map(pos => ({
        symbol: pos.symbol,
        side: pos.side,
        size: parseFloat(pos.contracts || pos.amount || 0),
        entryPrice: parseFloat(pos.entryPrice || 0),
        markPrice: parseFloat(pos.markPrice || 0),
        liqPrice: parseFloat(pos.liquidationPrice || 0),
        unrealisedPnl: parseFloat(pos.unrealizedPnl || 0),
        realisedPnl: parseFloat(pos.realizedPnl || 0),
        leverage: parseFloat(pos.leverage || 1),
      }));
    } catch (error) {
      logger.apiError('getPositions', error);
      throw error;
    }
  }
  
  // Close position (market order in opposite direction)
  async closePosition(symbol, side) {
    try {
      const exchangeSymbol = this._resolveSymbol(symbol);
      // Get current position
      const positions = await this.getPositions(exchangeSymbol);
      const position = positions.find(p => {
        // Compare normalized symbols
        return p.symbol === exchangeSymbol && Math.abs(p.size) > 0;
      });
      
      if (!position) {
        throw new Error(`No open position found for ${exchangeSymbol}`);
      }
      
      // Determine close side (opposite of current position)
      const closeSide = position.side.toLowerCase() === 'long' ? 'sell' : 'buy';
      const closeAmount = Math.abs(position.size);
      
      // Place market order to close
      const params = {
        symbol: exchangeSymbol,
        orderType: 'market',
        side: closeSide,
        qty: closeAmount.toString(),
        reduceOnly: true,
      };
      
      const result = await this.placeOrder(params);
      
      logger.info(`Position closed on ${this.exchangeName}: ${exchangeSymbol} at ${result.price}`);
      return result;
    } catch (error) {
      logger.apiError('closePosition', error);
      throw error;
    }
  }
  
  // Convert timeframe to CCXT format
  timeframeToInterval(timeframe) {
    const intervalMap = {
      'm1': '1m',
      'm5': '5m',
      'm15': '15m',
      'm30': '30m',
      'h1': '1h',
      'h2': '2h',
      'h4': '4h',
      'd1': '1d',
    };
    
    const interval = intervalMap[timeframe];
    if (!interval) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }
    
    return interval;
  }
  
  // Validate credentials by making a simple API call
  async validateCredentials() {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error(`${this.exchangeName} API credentials not available`);
      }
      
      // Try to fetch account balance as validation
      await this.getAccountBalance();
      logger.info(`${this.exchangeName} credentials validated successfully`);
      return true;
    } catch (error) {
      logger.error(`${this.exchangeName} credentials validation failed:`, error);
      throw error;
    }
  }
  
  // Test connectivity
  async testConnectivity() {
    try {
      await this.exchange.fetchTime();
      return true;
    } catch (error) {
      logger.error(`${this.exchangeName} connectivity test failed:`, error);
      return false;
    }
  }
}

module.exports = ExchangeService;