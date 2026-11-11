const axios = require('axios');
const crypto = require('crypto');
const Config = require('../config');
const logger = require('../logger');
const Encryption = require('../utils/encryption');

class BybitService {
  constructor(apiKeyEnc, apiSecretEnc, isTestnet = true) {
    this.apiKey = apiKeyEnc ? Encryption.decrypt(apiKeyEnc) : null;
    this.apiSecret = apiSecretEnc ? Encryption.decrypt(apiSecretEnc) : null;
    // Trim any whitespace from decrypted values
    if (this.apiKey) this.apiKey = this.apiKey.trim();
    if (this.apiSecret) this.apiSecret = this.apiSecret.trim();
    
    // Log for debugging
    logger.debug(`BybitService initialized with credentials - key_len=${this.apiKey?.length || 0}, secret_len=${this.apiSecret?.length || 0}, testnet=${isTestnet}`);
    
    // Validate credentials are available
    if (!this.apiKey || !this.apiSecret) {
      logger.warn(`BybitService initialized with incomplete credentials - key=${!!this.apiKey}, secret=${!!this.apiSecret}`);
    }
    
    this.baseUrl = Config.getBybitApiUrl(isTestnet);
    this.isTestnet = isTestnet;
    this.symbolInfoCache = new Map();
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: Config.getRequestTimeoutMs(),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Request interceptor for signing
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.apiKey && this.apiSecret && config.url.includes('/v5')) {
          return this.signRequest(config);
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // Response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => {
        if (response.data && response.data.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.data.retMsg || 'Unknown error'}`);
        }
        return response;
      },
      (error) => {
        if (error.response) {
          logger.apiError('Bybit API', {
            status: error.response.status,
            data: error.response.data,
            url: error.config?.url
          });
        } else if (error.request) {
          logger.apiError('Bybit API - No response', error.message);
        } else {
          logger.apiError('Bybit API - Request setup', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  signRequest(config) {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    
    // Validate credentials first
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Bybit API credentials not available for signing');
    }
    
    // Create signature string based on request type
    let signString = '';
    let bodyString = '';
    
    // For POST/PUT requests with body data
    if (config.data) {
      // Ensure consistent JSON stringification
      if (typeof config.data === 'string') {
        bodyString = config.data;
      } else {
        // Remove undefined values before stringifying
        const cleanData = JSON.parse(JSON.stringify(config.data));
        bodyString = JSON.stringify(cleanData);
      }
      signString = timestamp + this.apiKey + recvWindow + bodyString;
      logger.debug(`Sign string for POST: timestamp=${timestamp}, key_len=${this.apiKey.length}, recvWindow=${recvWindow}, body_len=${bodyString.length}`);
    } 
    // For GET requests with query parameters
    else if (config.params) {
      const queryString = new URLSearchParams(config.params).toString();
      signString = timestamp + this.apiKey + recvWindow + queryString;
      logger.debug(`Sign string for GET: timestamp=${timestamp}, key_len=${this.apiKey.length}, recvWindow=${recvWindow}, query=${queryString}`);
    }
    // Fallback for requests with no data or params
    else {
      signString = timestamp + this.apiKey + recvWindow;
      logger.debug(`Sign string for empty: timestamp=${timestamp}, key_len=${this.apiKey.length}, recvWindow=${recvWindow}`);
    }
    
    // Create signature
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(signString)
      .digest('hex');
    
    // Add headers
    config.headers['X-BAPI-API-KEY'] = this.apiKey;
    config.headers['X-BAPI-TIMESTAMP'] = timestamp;
    config.headers['X-BAPI-RECV-WINDOW'] = recvWindow;
    config.headers['X-BAPI-SIGN'] = signature;
    
    logger.debug(`Bybit request signed - Method: ${config.method}, URL: ${config.url}, Signature length: ${signature.length}`);
    
    return config;
  }

  async getSymbolInfo(symbol) {
    if (this.symbolInfoCache.has(symbol)) {
      return this.symbolInfoCache.get(symbol);
    }

    try {
      const params = {
        category: 'linear',
        symbol: symbol
      };

      const response = await this.axiosInstance.get('/v5/market/instruments-info', { params });
      if (response.data && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
        const info = response.data.result.list[0];
        this.symbolInfoCache.set(symbol, info);
        return info;
      }

      throw new Error(`No instrument info for ${symbol}`);
    } catch (error) {
      logger.apiError('getSymbolInfo', error);
      throw error;
    }
  }

  async getCandles(symbol, timeframe, limit = 100) {
    try {
      const interval = this.timeframeToInterval(timeframe);
      const params = {
        category: 'linear',
        symbol: symbol,
        interval: interval,
        limit: limit
      };
      
      const response = await this.axiosInstance.get('/v5/market/kline', { params });
      
      if (response.data && response.data.result && response.data.result.list) {
        const candles = response.data.result.list.reverse(); // Oldest to newest
        return candles;
      }
      
      throw new Error('Invalid response format from Bybit');
    } catch (error) {
      logger.apiError('getCandles', error);
      throw error;
    }
  }

  async getTicker(symbol) {
    try {
      const params = {
        category: 'linear',
        symbol: symbol
      };
      
      const response = await this.axiosInstance.get('/v5/market/tickers', { params });
      
      if (response.data && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
        return response.data.result.list[0];
      }
      
      throw new Error(`No ticker data for ${symbol}`);
    } catch (error) {
      logger.apiError('getTicker', error);
      throw error;
    }
  }

  async getAccountBalance() {
    try {
      const params = {
        accountType: 'UNIFIED',
        coin: 'USDT'
      };
      
      const response = await this.axiosInstance.get('/v5/account/wallet-balance', { params });
      if (response.data && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
        const account = response.data.result.list[0];
        const usdtBalance = account.coin?.find(c => c.coin === 'USDT');
        return usdtBalance ? parseFloat(usdtBalance.walletBalance) : 0;
      }
      
      return 0;
    } catch (error) {
      logger.apiError('getAccountBalance', error);
      throw error;
    }
  }

  async placeOrder(orderParams) {
    try {
      const params = {
        category: 'linear',
        symbol: orderParams.symbol,
        side: orderParams.side,
        orderType: orderParams.orderType,
        qty: orderParams.qty.toString(),
        timeInForce: orderParams.timeInForce || 'GTC'
      };
      
      // Only include price for limit orders
      if (orderParams.orderType === 'Limit' && orderParams.price) {
        params.price = orderParams.price.toString();
      }
      
      // For conditional stop orders, use triggerPrice and triggerDirection (V5 API)
      if (orderParams.triggerPrice !== undefined && orderParams.triggerPrice !== null) {
        params.triggerPrice = orderParams.triggerPrice.toString();
        // triggerDirection: 1 = price rises to/above, 2 = price falls to/below
        params.triggerDirection = orderParams.triggerDirection || 1;
      }
      
      if (orderParams.triggerBy) {
        params.triggerBy = orderParams.triggerBy;
      }
      
      // Include reduce only flag when provided
      if (orderParams.reduceOnly === true) {
        params.reduceOnly = true;
      }
      
      logger.info(`Placing order: ${JSON.stringify(params)}`);
      
      const response = await this.axiosInstance.post('/v5/order/create', params);
      
      if (response.data && response.data.result) {
        const orderId = response.data.result.orderId;
        logger.info(`Order placed: ${orderId} for ${orderParams.symbol}`);
        return {
          orderId: orderId,
          symbol: orderParams.symbol,
          side: orderParams.side,
          orderType: orderParams.orderType,
          price: orderParams.price,
          qty: orderParams.qty,
          status: 'pending'
        };
      }
      
      throw new Error('Failed to place order');
    } catch (error) {
      logger.apiError('placeOrder', error);
      throw error;
    }
  }

  async getOrderStatus(orderId, symbol) {
    try {
      const params = {
        category: 'linear',
        orderId: orderId,
        symbol: symbol,
        orderFilter: 'tpslOrder'
      };
      
      const response = await this.axiosInstance.get('/v5/order/history', { params });
      
      if (response.data && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
        return response.data.result.list[0];
      }
      return null; // Order not found
    } catch (error) {
      logger.apiError('getOrderStatus', error);
      throw error;
    }
  }

  async cancelOrder(orderId, symbol) {
    try {
      const params = {
        category: 'linear',
        orderId: orderId,
        symbol: symbol
      };
      
      const response = await this.axiosInstance.post('/v5/order/cancel', params);
      
      if (response.data && response.data.result) {
        logger.info(`Order canceled: ${orderId} for ${symbol}`);
        return true;
      }
      
      throw new Error('Failed to cancel order');
    } catch (error) {
      logger.apiError('cancelOrder', error);
      throw error;
    }
  }

  async getPositions(symbol) {
    try {
      const params = {
        category: 'linear',
        symbol: symbol
      };
      
      const response = await this.axiosInstance.get('/v5/position/list', { params });
      
      if (response.data && response.data.result && response.data.result.list) {
        return response.data.result.list;
      }
      
      return [];
    } catch (error) {
      logger.apiError('getPositions', error);
      throw error;
    }
  }

  async closePosition(symbol, side) {
    try {
      // For spot trading, closing position means selling/buying back
      const ticker = await this.getTicker(symbol);
      const currentPrice = parseFloat(ticker.lastPrice);
      
      // Get position size (simplified - would need actual position data)
      // This is a placeholder - actual implementation would need position tracking
      const params = {
        category: 'linear',
        symbol: symbol,
        side: side === 'long' ? 'Sell' : 'Buy',
        orderType: 'Market',
        qty: '0.001', // Placeholder - would need actual position size
        timeInForce: 'IOC'
      };
      
      const response = await this.axiosInstance.post('/v5/order/create', params);
      
      if (response.data && response.data.result) {
        logger.info(`Position closed: ${symbol} at $${currentPrice}`);
        return {
          orderId: response.data.result.orderId,
          price: currentPrice,
          symbol: symbol
        };
      }
      
      throw new Error('Failed to close position');
    } catch (error) {
      logger.apiError('closePosition', error);
      throw error;
    }
  }

timeframeToInterval(timeframe) {
    const intervalMap = {
      'm1': '1',
      'm5': '5',
      'm15': '15',
      'm30': '30',
      'h1': '60',
      'h2': '120',
      'h4': '240',
      'd1': 'D'
    };

    const interval = intervalMap[timeframe];
    if (!interval) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }

    return interval;
  }

  validateCredentials() {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Bybit API credentials not available');
    }
    
    return true;
  }
}

module.exports = BybitService;