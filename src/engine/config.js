const path = require('path');
require('dotenv').config();

class Config {
  static getProjectRoot() {
    return path.resolve(__dirname, '..', '..');
  }

  static getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable must be set');
    }
    return key;
  }

  static getDatabasePath() {
    const dbPath = process.env.DATABASE_PATH || 'db/trading.db';
    return path.resolve(Config.getProjectRoot(), dbPath);
  }

  static getTelegramBotToken() {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  static getTelegramUserId() {
    return process.env.TELEGRAM_USER_ID;
  }

  static getWebhookRiskAmount() {
    return parseFloat(process.env.WEBHOOK_RISK_AMOUNT || '20');
  }

  static getWebhookRRList() {
    try {
      return JSON.parse(process.env.WEBHOOK_RR_LIST || '[1,2,3,4,5,6,7,8]');
    } catch {
      return [1, 2, 3, 4, 5, 6, 7, 8];
    }
  }

  static getWebhookExchangeAccountIndex() {
    return parseInt(process.env.WEBHOOK_EXCHANGE_ACCOUNT_INDEX || '3', 10);
  }

  static getBybitApiUrl(isTestnet = true) {
    return isTestnet 
      ? process.env.BYBIT_TESTNET_API_URL || 'https://api-testnet.bybit.com'
      : process.env.BYBIT_MAINNET_API_URL || 'https://api.bybit.com';
  }

  static getSchedulePattern() {
    return process.env.SCHEDULE_PATTERN || '0,15,30,45 * * * *';
  }

  static getTwelveDataApiKey() {
    return process.env.TWELVEDATA_API_KEY;
  }

  static getLogLevel() {
    return process.env.LOG_LEVEL || 'info';
  }

  static getLogFile() {
    return process.env.LOG_FILE || 'logs/trading-engine.log';
  }

  static getMaxConcurrentRequests() {
    return parseInt(process.env.MAX_CONCURRENT_REQUESTS || '5', 10);
  }

  static getRequestTimeoutMs() {
    return parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);
  }

  static getMaxRetryAttempts() {
    return parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10);
  }

  static getRetryDelayMs() {
    return parseInt(process.env.RETRY_DELAY_MS || '1000', 10);
  }

  static validate() {
    const errors = [];
    
    if (!process.env.ENCRYPTION_KEY) {
      errors.push('ENCRYPTION_KEY environment variable must be set');
    }
    
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.warn('Warning: TELEGRAM_BOT_TOKEN not set. Telegram notifications will be disabled.');
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
    
    return true;
  }
}

module.exports = Config;