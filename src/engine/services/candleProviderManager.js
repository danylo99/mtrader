const axios = require('axios');
const logger = require('../logger');

class CandleProviderManager {
  constructor() {
    this.baseUrl = process.env.CANDLE_PROVIDER_URL || 'http://localhost:3004';
    this.axios = axios.create({ timeout: 5000 });
  }

  async initialize(db) {
    logger.info(`CandleProviderManager initialized, target=${this.baseUrl}`);
  }

  async getClosedCandles(exchangeName, symbol, timeframe) {
    try {
      const response = await this.axios.get(`/candles/${symbol}/${timeframe}`);
      if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
        return response.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  clear() {
    // No-op (no resources to release)
  }
}

module.exports = CandleProviderManager;