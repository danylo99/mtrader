#!/usr/bin/env node
/**
 * OmniTrader Services Launcher
 * 
 * Runs both TradingEngine scheduler and ScreenerCandleProvider services
 */

const { spawn } = require('child_process');
const logger = require('./logger');

class ServicesLauncher {
  constructor() {
    this.tradingEngineProcess = null;
    this.screenerProcess = null;
    this.isShuttingDown = false;
    
    this.setupSignalHandlers();
  }
  
  setupSignalHandlers() {
    process.on('SIGINT', async () => {
      await this.shutdown('SIGINT');
    });
    
    process.on('SIGTERM', async () => {
      await this.shutdown('SIGTERM');
    });
    
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      this.shutdown('uncaughtException').finally(() => {
        process.exit(1);
      });
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection:', reason);
    });
  }
  
  start() {
    logger.info('🚀 Starting OmniTrader Services...');
    
    // Start ScreenerCandleProvider first (no health server)
    logger.info('Starting ScreenerCandleProvider...');
    this.screenerProcess = spawn('node', ['screenerCandleProvider.js'], {
      stdio: 'inherit',
      env: process.env
    });
    
    this.screenerProcess.on('error', (error) => {
      logger.error('ScreenerCandleProvider process error:', error);
    });
    
    this.screenerProcess.on('exit', (code, signal) => {
      if (!this.isShuttingDown) {
        logger.error(`ScreenerCandleProvider process exited with code ${code}, signal ${signal}`);
        this.shutdown('screener_exited');
      }
    });
    
    // Wait a bit before starting TradingEngine with health server
    setTimeout(() => {
      // Start TradingEngine scheduler with health server port 3002
      logger.info('Starting TradingEngine scheduler...');
      const tradingEngineEnv = {
        ...process.env,
        HEALTH_PORT: '3002'
      };
      
      this.tradingEngineProcess = spawn('node', ['app.js', 'scheduled'], {
        stdio: 'inherit',
        env: tradingEngineEnv
      });
      
      this.tradingEngineProcess.on('error', (error) => {
        logger.error('TradingEngine process error:', error);
      });
      
      this.tradingEngineProcess.on('exit', (code, signal) => {
        if (!this.isShuttingDown) {
          logger.error(`TradingEngine process exited with code ${code}, signal ${signal}`);
          this.shutdown('trading_engine_exited');
        }
      });
    }, 2000);
    
    logger.info('✅ OmniTrader Services started');
    logger.info('📅 TradingEngine: Scheduled mode');
    logger.info('📊 ScreenerCandleProvider: Real-time screener alerts');
  }
  
  async shutdown(reason) {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    logger.info(`🛑 Shutting down OmniTrader Services (${reason})...`);
    
    // Kill both processes
    if (this.tradingEngineProcess) {
      this.tradingEngineProcess.kill('SIGTERM');
    }
    
    if (this.screenerProcess) {
      this.screenerProcess.kill('SIGTERM');
    }
    
    // Wait for processes to exit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info('✅ OmniTrader Services shutdown complete');
  }
}

if (require.main === module) {
  const launcher = new ServicesLauncher();
  launcher.start();
}

module.exports = ServicesLauncher;