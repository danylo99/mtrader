#!/usr/bin/env node
/**
 * Screener CandleProvider - Standalone service for real-time candle updates
 * 
 * This service runs independently from the TradingEngine and handles
 * real-time candle updates for all-assets screeners (SuperTrend, EW),
 * pending setups, and triggered setups.
 */

const { getDatabaseManager } = require('./db');
const CandleProvider = require('./services/candleProvider');
const AllAssetsScreenerService = require('./services/allAssetsScreenerService');
const PendingSetupService = require('./services/pendingSetupService');
const EntryService = require('./services/entryService');
const ActiveSetupService = require('./services/activeSetupService');
const TelegramService = require('./services/telegramService');
const PriceAlarmService = require('./services/priceAlarmService');
const logger = require('./logger');
const Config = require('./config');
const fs = require('fs');
const path = require('path');
const express = require('express');

class ScreenerCandleProvider {
  constructor() {
    this.db = getDatabaseManager();
    this.telegramService = new TelegramService(this.db);
    this.candleProvider = null;
    this.isRunning = false;
    this.httpServer = null;
  }

  loadSymbols() {
    const exchange = process.env.EXCHANGE || 'hyperliquid';
    const configPath = path.resolve(Config.getProjectRoot(), `config/symbols/${exchange}.json`);
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return config.symbols.map(s => s.symbol);
  }

  loadTimeframes() {
    const exchange = process.env.EXCHANGE || 'hyperliquid';
    const configPath = path.resolve(Config.getProjectRoot(), `config/symbols/${exchange}.json`);
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return config.intervals;
  }

  async cleanupDatabase(exchange) {
    try {
      logger.info(`Preparing database for ${exchange} migration...`);
      
      // For production safety, we log but don't actually delete data
      // In a real migration, you would:
      // 1. Backup the database first
      // 2. Run specific cleanup SQL
      // 3. Validate the cleanup
      
      logger.info(`Database preparation for ${exchange} completed (dry-run)`);
      
      // Example cleanup code (commented out for safety):
      // await this.db.run('DELETE FROM screener_snapshot');
      // await this.db.run('DELETE FROM price_alarms');
      
    } catch (error) {
      logger.error('Database cleanup failed:', error);
      throw error;
    }
  }

  async start() {
    try {
      logger.info('Starting Screener CandleProvider service...');
      
      // Connect to database
      await this.db.connect();
      logger.info('Database connected');
      
      // Preload exchange services (warm-up cache)
      const ExchangeServiceManager = require('./services/exchangeServiceManager');
      await ExchangeServiceManager.initialize(this.db);
      
      const exchange = process.env.EXCHANGE || 'hyperliquid';
      
      // Database cleanup when switching exchanges
      await this.cleanupDatabase(exchange);
      
      // Initialize AllAssetsScreenerService dependencies
      AllAssetsScreenerService.setDeps(this.db, this.telegramService);
      AllAssetsScreenerService.setExchange(exchange);

      // Initialize PendingSetupService dependencies
      PendingSetupService.setDeps(this.db, this.telegramService);
      
      // Initialize EntryService dependencies
      EntryService.setDeps(this.db, this.telegramService);

      // Initialize PriceAlarmService dependencies
      PriceAlarmService.setDeps(this.db, this.telegramService);
      
      // Load ALL symbols and timeframes from config
      const symbols = this.loadSymbols();
      const timeframes = this.loadTimeframes();
      
      logger.info(`Loaded ${symbols.length} symbols and ${timeframes.length} timeframes from ${exchange} config`);
      
      // Create and start CandleProvider
      this.candleProvider = new CandleProvider({
        exchange: exchange,
        symbols,
        timeframes,
        limit: 1501,
        onUpdate: (symbol, timeframe, candle) => {
          // Optional: log candle updates
          //logger.debug(`Candle closed for screener: ${symbol} ${timeframe}`);
        },
        onScreenerUpdate: async (symbol, timeframe, closedBars) => {
          // Process all-assets screener (SuperTrend + EW + MA Z-Score)
          // Skip for m1 to avoid excessive noise from 1-min candles
          if (timeframe !== 'm1') {
            AllAssetsScreenerService.processClosedCandle(symbol, timeframe, closedBars);
          }
          // Process pending setups (must complete before processing entries)
          await PendingSetupService.processItemFromCandle(symbol, timeframe, closedBars);
          // Process triggered setups (runs after pending setups complete)
          EntryService.processItemFromCandle(symbol, timeframe, closedBars);
          // Process exit conditions for active setups matching this symbol+timeframe
          try {
            const activeSetups = await this.db.getActiveSetupsBySymbolTimeframe(symbol, timeframe);
            if (activeSetups && activeSetups.length > 0) {
              logger.info(`Processing ${activeSetups.length} active setups for exit check on ${symbol} ${timeframe}`);
              for (const setup of activeSetups) {
                try {
                  const ExchangeServiceManager = require('./services/exchangeServiceManager');
                  const exchangeService = await ExchangeServiceManager.getOrCreate(
                    setup.exchange_account_id,
                    setup.exchange,
                    setup.api_key_enc,
                    setup.api_secret_enc,
                    setup.is_testnet
                  );
                  await ActiveSetupService.checkExitCondition(this.db, this.telegramService, setup, exchangeService, closedBars);
                } catch (err) {
                  logger.error(`Error checking exit condition for setup #${setup.id}:`, err.message);
                }
              }
            }
          } catch (err) {
            logger.error(`Error processing exit conditions for ${symbol} ${timeframe}:`, err.message);
          }
          // Process user price alarms
          PriceAlarmService.processClosedCandle(symbol, timeframe, closedBars).catch(err => {
            logger.error(`PriceAlarmService error for ${symbol} ${timeframe}:`, err.message);
          });
        },
        isTestnet: false
      });
      
      await this.candleProvider.start();
      this.isRunning = true;

      logger.info('✅ Screener CandleProvider service started successfully');
      logger.info(`📊 Monitoring ALL ${symbols.length} symbols from config`);
      logger.info(`⏱️  All timeframes: ${timeframes.join(', ')}`);
      logger.info(`ℹ️  Populating initial screener snapshot...`);

      // Populate initial snapshot so UI has data immediately
      // Wait for historical data to complete first (ensures enough bars)
      await this.candleProvider.waitForHistorical();
      
      // Initialize SuperTrend directions from historical data
      await AllAssetsScreenerService.populateInitialSnapshot(this.candleProvider);
      
      // Initialize MA Z-Score values from historical data
      await AllAssetsScreenerService.populateMAZScoreSnapshot(this.candleProvider);

      // Start HTTP candle API server (buffer guaranteed populated after waitForHistorical)
      this.startCandleApiServer();

    } catch (error) {
      logger.error('Failed to start Screener CandleProvider:', error);
      await this.stop();
      throw error;
    }
  }

startCandleApiServer() {
    const app = express();
    const port = process.env.CANDLE_API_PORT || 3004;

    app.get('/candles/:symbol/:timeframe', (req, res) => {
      const { symbol, timeframe } = req.params;
      if (!symbol || !timeframe) {
        return res.status(404).json({ error: 'Missing symbol or timeframe' });
      }
      const candles = this.candleProvider.getClosedCandles(symbol, timeframe);
      res.json(candles);
    });

    this.httpServer = app.listen(port, () => {
      logger.info(`Candle API server listening on port ${port}`);
    });
  }

  async stop() {
    logger.info('Stopping Screener CandleProvider service...');
    this.isRunning = false;

    if (this.httpServer) {
      try {
        await new Promise((resolve, reject) => {
          this.httpServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.info('Candle API server stopped');
      } catch (error) {
        logger.error('Error stopping Candle API server:', error);
      }
    }

    if (this.candleProvider) {
      try {
        await this.candleProvider.stop();
        logger.info('CandleProvider stopped');
      } catch (error) {
        logger.error('Error stopping CandleProvider:', error);
      }
    }
    
    try {
      const ExchangeServiceManager = require('./services/exchangeServiceManager');
      ExchangeServiceManager.clear();
      await this.db.disconnect();
      logger.info('Database disconnected');
    } catch (error) {
      logger.error('Error disconnecting from database:', error);
    }
    
    logger.info('Screener CandleProvider service stopped');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      symbols: this.candleProvider ? this.candleProvider.symbols : [],
      timeframes: this.candleProvider ? this.candleProvider.timeframes : [],
      storeSize: this.candleProvider ? this.candleProvider.store.size : 0
    };
  }
}

// CLI entry point
if (require.main === module) {
  const app = new ScreenerCandleProvider();
  
  // Handle process signals
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down...`);
    try {
      await app.telegramService.flush();
    } catch (error) {
      logger.error('Error flushing telegram messages:', error);
    }
    await app.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    app.stop().finally(() => process.exit(1));
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection:', reason);
  });
  
  // Start the service
  app.start().catch((error) => {
    logger.error('Failed to start Screener CandleProvider:', error);
    process.exit(1);
  });
}

module.exports = ScreenerCandleProvider;