const winston = require('winston');
const Config = require('./config');

const logLevel = Config.getLogLevel();
const logFile = Config.getLogFile();

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'trading-engine' },
  transports: [
    new winston.transports.File({ 
      filename: logFile, 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: logFile,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Custom logging methods for different types of events
logger.setupCreated = (setupId, symbol, side) => {
  logger.info(`Setup created: #${setupId} ${symbol} ${side}`);
};

logger.setupActivated = (setupId, price) => {
  logger.info(`Setup activated: #${setupId} at $${price}`);
};

logger.setupCancelled = (setupId, reason) => {
  logger.warn(`Setup canceled: #${setupId} - ${reason}`);
};

logger.orderPlaced = (setupId, orderType, symbol, price, quantity) => {
  logger.info(`Order placed: #${setupId} ${orderType} ${symbol} @ $${price} x ${quantity}`);
};

logger.orderFilled = (setupId, orderType, price) => {
  logger.info(`Order filled: #${setupId} ${orderType} @ $${price}`);
};

logger.tpHit = (setupId, tpLevel, price, pnl) => {
  logger.info(`TP${tpLevel} hit: #${setupId} @ $${price} (P&L: ${pnl})`);
};

logger.slHit = (setupId, price, pnl) => {
  logger.warn(`SL hit: #${setupId} @ $${price} (P&L: ${pnl})`);
};

logger.beActivated = (setupId) => {
  logger.info(`Break-even activated: #${setupId}`);
};

logger.exitTriggered = (setupId, reason) => {
  logger.info(`Exit triggered: #${setupId} - ${reason}`);
};

logger.engineStarted = () => {
  logger.info('Trading engine started');
};

logger.engineStopped = () => {
  logger.info('Trading engine stopped');
};

logger.schedulerRun = () => {
  logger.info('Scheduler running');
};

logger.apiError = (method, error) => {
  logger.error(`API error in ${method}:`, error);
};

logger.dbError = (operation, error) => {
  logger.error(`Database error in ${operation}:`, error);
};

logger.setupClosed = (setupId, reason) => {
  logger.info(`Setup closed: #${setupId} - ${reason}`);
};

module.exports = logger;