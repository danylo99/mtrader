const { getDatabaseManager } = require('./db');
const TelegramService = require('./services/telegramService');
const ActiveSetupService = require('./services/activeSetupService');
const logger = require('./logger');

class TradingEngine {
  constructor() {
    this.db = getDatabaseManager();
    this.telegramService = new TelegramService(this.db);
    this.candleProviderManager = null;
    this.isInitialized = false;
    this.stats = {
      activeSetupsProcessed: 0,
      positionsMonitored: 0,
      ordersUpdated: 0,
      errors: 0,
      lastRun: null
    };
  }

  async initialize() {
    try {
      await this.db.connect();
      const ExchangeServiceManager = require('./services/exchangeServiceManager');
      await ExchangeServiceManager.initialize(this.db);
      logger.info('Trading engine initialized');

      // Initialize CandleProviderManager (HTTP client for ScreenerCandleProvider API)
      const CandleProviderManager = require('./services/candleProviderManager');
      this.candleProviderManager = new CandleProviderManager();
      await this.candleProviderManager.initialize(this.db);

      // No CandleProvider refresh needed — data is live via ScreenerCandleProvider WebSocket

      this.isInitialized = true;
      return true;
    } catch (error) {
      logger.error('Failed to initialize trading engine:', error);
      throw error;
    }
  }

  async processAllSetups() {
    if (!this.isInitialized) {
      throw new Error('Trading engine not initialized');
    }

    try {
      logger.info('Starting to process all active setups');

      const setups = await this.db.getActiveSetups();

      logger.info(`Found ${setups.length} active setups to process`);
      this.stats.activeSetupsProcessed += setups.length;

      for (const setup of setups) {
        try {
          await this.processSetup(setup);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`Error processing setup #${setup.id}:`, error);
          this.stats.errors++;

          await this.sendErrorNotification(setup.user_id, {
            component: 'TradingEngine',
            error: error.message,
            details: `Setup #${setup.id} - ${setup.symbol}`,
            timestamp: new Date().toISOString()
          });
        }
      }

      this.stats.lastRun = new Date().toISOString();
      logger.info(`Processing completed. Stats: ${JSON.stringify(this.stats, null, 2)}`);

      return this.stats;
    } catch (error) {
      logger.error('Error in processAllSetups:', error);
      throw error;
    }
  }

  async processSetup(setup) {
    logger.info(`Processing setup #${setup.id}: ${setup.symbol} ${setup.side} (${setup.status})`);

    switch (setup.status) {
      case 'active':
        await ActiveSetupService.processActiveSetup(this, setup);
        break;
      default:
        logger.info(`Setup #${setup.id} with status '${setup.status}' handled by candle provider`);
    }
  }

  getCandleProviderManager() {
    return this.candleProviderManager;
  }

  async getExchangeService(accountId, exchange, apiKeyEnc, apiSecretEnc, isTestnet) {
    const ExchangeServiceManager = require('./services/exchangeServiceManager');
    return ExchangeServiceManager.getOrCreate(accountId, exchange, apiKeyEnc, apiSecretEnc, isTestnet);
  }

  async sendErrorNotification(userId, errorData) {
    try {
      await this.telegramService.sendNotification(userId, 'error', errorData);
    } catch (error) {
      logger.error('Failed to send error notification:', error);
    }
  }

  getStatus() {
    return {
      isInitialized: this.isInitialized,
      stats: this.stats,
      exchangeServicesCount: require('./services/exchangeServiceManager').size(),
      telegramAvailable: this.telegramService.isAvailable()
    };
  }

  async cleanup() {
    try {
      if (this.candleProviderManager) {
        this.candleProviderManager.clear();
      }
      await this.telegramService.flush();
      await this.db.disconnect();
      require('./services/exchangeServiceManager').clear();
      this.isInitialized = false;
      logger.info('Trading engine cleaned up');
    } catch (error) {
      logger.error('Error cleaning up trading engine:', error);
    }
  }
}

module.exports = TradingEngine;