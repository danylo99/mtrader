#!/usr/bin/env node

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

  loadAssets() {
    const configPath = path.resolve(Config.getProjectRoot(), 'src/config/symbols/assets.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return { assets: config.assets, intervals: config.intervals };
  }

  async cleanupDatabase(exchange) {
    try {
      logger.info(`Preparing database for ${exchange} migration...`);
      logger.info(`Database preparation for ${exchange} completed (dry-run)`);
    } catch (error) {
      logger.error('Database cleanup failed:', error);
      throw error;
    }
  }

  async start() {
    try {
      logger.info('Starting Screener CandleProvider service...');

      await this.db.connect();
      logger.info('Database connected');

      const ExchangeServiceManager = require('./services/exchangeServiceManager');
      await ExchangeServiceManager.initialize(this.db);

      const exchange = process.env.EXCHANGE || 'bybit';
      await this.cleanupDatabase(exchange);

      AllAssetsScreenerService.setDeps(this.db, this.telegramService);
      AllAssetsScreenerService.setExchange(exchange);
      PendingSetupService.setDeps(this.db, this.telegramService);
      EntryService.setDeps(this.db, this.telegramService);
      PriceAlarmService.setDeps(this.db, this.telegramService);

      const { assets, intervals } = this.loadAssets();
      const timeframes = intervals;

      logger.info(`Loaded ${assets.length} assets (${assets.filter(a => a.provider === 'bybit').length} bybit, ${assets.filter(a => a.provider === 'twelvedata').length} twelvedata) and ${timeframes.length} timeframes`);

      this.candleProvider = new CandleProvider({
        assets,
        timeframes,
        limit: 1501,
        onUpdate: (symbol, timeframe, candle) => {},
        onScreenerUpdate: async (symbol, timeframe, closedBars) => {
          if (timeframe !== 'm1') {
            AllAssetsScreenerService.processClosedCandle(symbol, timeframe, closedBars);
          }
          await PendingSetupService.processItemFromCandle(symbol, timeframe, closedBars);
          EntryService.processItemFromCandle(symbol, timeframe, closedBars);
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
          PriceAlarmService.processClosedCandle(symbol, timeframe, closedBars).catch(err => {
            logger.error(`PriceAlarmService error for ${symbol} ${timeframe}:`, err.message);
          });
        },
        isTestnet: false
      });

      await this.candleProvider.start();
      this.isRunning = true;

      logger.info('Screener CandleProvider service started successfully');
      logger.info(`Monitoring ALL ${assets.length} assets from config`);
      logger.info(`Timeframes: ${timeframes.join(', ')}`);

      this.startCandleApiServer();

      await this.candleProvider.waitForHistorical();

      await AllAssetsScreenerService.populateInitialSnapshot(this.candleProvider);
      await AllAssetsScreenerService.populateMAZScoreSnapshot(this.candleProvider);

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

    app.get('/quote/:symbol', (req, res) => {
      const symbol = req.params.symbol;
      const timeframe = req.query.timeframe || 'm1';
      if (!symbol) {
        return res.status(400).json({ error: 'Missing symbol' });
      }
      const candles = this.candleProvider.getClosedCandles(symbol, timeframe);
      const latest = candles[candles.length - 1];
      if (!latest) {
        return res.json({ symbol, price: null, timestamp: null });
      }
      res.json({
        symbol,
        price: latest[4],
        open: latest[1],
        high: latest[2],
        low: latest[3],
        close: latest[4],
        volume: latest[5],
        timestamp: latest[0],
      });
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
      assets: this.candleProvider ? this.candleProvider.assets : [],
      timeframes: this.candleProvider ? this.candleProvider.timeframes : [],
      storeSize: this.candleProvider ? this.candleProvider.store.size : 0
    };
  }
}

if (require.main === module) {
  const app = new ScreenerCandleProvider();

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

  app.start().catch((error) => {
    logger.error('Failed to start Screener CandleProvider:', error);
    process.exit(1);
  });
}

module.exports = ScreenerCandleProvider;