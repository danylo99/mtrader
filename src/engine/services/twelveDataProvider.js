const axios = require('axios');
const Config = require('../config');

const INTERVAL_MAP = {
  m1: '1min',
  m5: '5min',
  m15: '15min',
  h1: '1h',
  h4: '4h',
  d1: '1day',
};

class TwelveDataProvider {
  constructor() {
    this.apiKey = Config.getTwelveDataApiKey();
    this.baseUrl = 'https://api.twelvedata.com';
  }

  getTwelveDataSymbol(asset) {
    return asset.symbol_twelvedata || asset.symbol_ccxt;
  }

  async fetchOHLCV(asset, timeframe, limit = 100) {
    const symbol = this.getTwelveDataSymbol(asset);
    const interval = INTERVAL_MAP[timeframe];
    if (!interval) throw new Error(`Unsupported TwelveData timeframe: ${timeframe}`);

    const url = `${this.baseUrl}/time_series`;
    const params = {
      symbol,
      interval,
      outputsize: Math.min(limit, 5000),
      apikey: this.apiKey,
    };

    try {
      const response = await axios.get(url, { params, timeout: 10000 });
      const data = response.data;

      if (data.status === 'error') {
        throw new Error(`TwelveData error: ${data.error?.message || JSON.stringify(data)}`);
      }

      const values = data.values || [];
      return values.map(row => {
        const ts = new Date(row.datetime).getTime();
        return [
          ts,
          parseFloat(row.open),
          parseFloat(row.high),
          parseFloat(row.low),
          parseFloat(row.close),
          parseFloat(row.volume || 0),
        ];
      });
    } catch (error) {
      throw new Error(`TwelveData fetchOHLCV failed for ${symbol}: ${error.message}`);
    }
  }

  async pollLatestBar(asset, timeframe) {
    const symbol = this.getTwelveDataSymbol(asset);
    const interval = INTERVAL_MAP[timeframe];
    if (!interval) throw new Error(`Unsupported TwelveData timeframe: ${timeframe}`);

    const url = `${this.baseUrl}/time_series`;
    const params = {
      symbol,
      interval,
      outputsize: 1,
      apikey: this.apiKey,
    };

    try {
      const response = await axios.get(url, { params, timeout: 10000 });
      const data = response.data;

      if (data.status === 'error') {
        throw new Error(`TwelveData error: ${data.error?.message || JSON.stringify(data)}`);
      }

      const values = data.values || [];
      if (values.length === 0) return null;

      const row = values[0];
      return [
        new Date(row.datetime).getTime(),
        parseFloat(row.open),
        parseFloat(row.high),
        parseFloat(row.low),
        parseFloat(row.close),
        parseFloat(row.volume || 0),
      ];
    } catch (error) {
      throw new Error(`TwelveData pollLatestBar failed for ${symbol}: ${error.message}`);
    }
  }

  async fetchQuote(asset) {
    const symbol = this.getTwelveDataSymbol(asset);

    const url = `${this.baseUrl}/quote`;
    const params = {
      symbol,
      apikey: this.apiKey,
    };

    try {
      const response = await axios.get(url, { params, timeout: 10000 });
      const data = response.data;

      if (data.status === 'error') {
        throw new Error(`TwelveData error: ${data.error?.message || JSON.stringify(data)}`);
      }

      return {
        symbol: data.symbol,
        price: parseFloat(data.close || data.previousClose || 0),
        change: parseFloat(data.change || 0),
        changePercent: parseFloat(data.percent || 0),
        timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
      };
    } catch (error) {
      throw new Error(`TwelveData fetchQuote failed for ${symbol}: ${error.message}`);
    }
  }
}

module.exports = TwelveDataProvider;