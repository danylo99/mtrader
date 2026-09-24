const Database = require('./database');
const logger = require('../logger');

class DatabaseManager {
  constructor() {
    this.db = new Database();
    this.isConnected = false;
    this.writeQueue = [];
    this.isProcessingWrite = false;
    this.writeLock = null;
    this.DEFAULT_WRITE_TIMEOUT_MS = 30000; // 30 seconds
  }

  async connect() {
    if (!this.isConnected) {
      await this.db.connect();
      this.isConnected = true;
      logger.info('Global DatabaseManager connected');
    }
  }

  async disconnect() {
    if (this.isConnected) {
      await this.db.disconnect();
      this.isConnected = false;
      logger.info('Global DatabaseManager disconnected');
    }
  }

  async acquireWriteLock(timeoutMs = this.DEFAULT_WRITE_TIMEOUT_MS) {
    // Simple queue-based locking with timeout
    return new Promise((resolve, reject) => {
      const lockRequest = { 
        resolve, 
        reject, 
        timestamp: Date.now(),
        timeoutId: null
      };
      
      // Set timeout for lock acquisition
      if (timeoutMs > 0) {
        lockRequest.timeoutId = setTimeout(() => {
          const index = this.writeQueue.indexOf(lockRequest);
          if (index !== -1) {
            this.writeQueue.splice(index, 1);
          }
          reject(new Error(`Write lock timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      
      this.writeQueue.push(lockRequest);
      this.processWriteQueue();
    });
  }

  async releaseWriteLock() {
    this.isProcessingWrite = false;
    this.writeLock = null;
    this.processWriteQueue();
  }

  processWriteQueue() {
    if (this.isProcessingWrite || this.writeQueue.length === 0) {
      return;
    }

    this.isProcessingWrite = true;
    const lockRequest = this.writeQueue.shift();
    
    // Clear the timeout since we're granting the lock
    if (lockRequest.timeoutId) {
      clearTimeout(lockRequest.timeoutId);
    }
    
    this.writeLock = {
      acquiredAt: Date.now(),
      id: Math.random().toString(36).substring(7)
    };
    
    logger.debug(`Write lock acquired: ${this.writeLock.id}`);
    lockRequest.resolve(this.writeLock);
  }

  async runWriteOperation(operationName, operationFn, timeoutMs = this.DEFAULT_WRITE_TIMEOUT_MS) {
    const startTime = Date.now();
    logger.debug(`Queueing write operation: ${operationName}`);
    
    try {
      const lock = await this.acquireWriteLock(timeoutMs);
      const lockWaitTime = Date.now() - startTime;
      
      if (lockWaitTime > 1000) {
        logger.warn(`Write lock wait time ${lockWaitTime}ms for operation: ${operationName}`);
      }
      
      logger.debug(`Executing write operation: ${operationName} (waited ${lockWaitTime}ms)`);
      
      try {
        const result = await operationFn();
        return result;
      } finally {
        await this.releaseWriteLock();
        const totalTime = Date.now() - startTime;
        logger.debug(`Write operation completed: ${operationName} (total ${totalTime}ms)`);
      }
    } catch (error) {
      logger.error(`Write operation failed: ${operationName}`, error);
      throw error;
    }
  }

  async get(sql, params) {
    // Read operation - no locking required
    return this.db.get(sql, params);
  }

  async all(sql, params) {
    // Read operation - no locking required
    return this.db.all(sql, params);
  }

  // Wrapper methods for existing Database write operations
  async run(sql, params, timeoutMs) {
    return this.runWriteOperation('run', async () => {
      return this.db.run(sql, params);
    }, timeoutMs);
  }

  async exec(sql, timeoutMs) {
    return this.runWriteOperation('exec', async () => {
      return this.db.exec(sql);
    }, timeoutMs);
  }

  async updateSetupStatus(setupId, newStatus, updates, timeoutMs) {
    return this.runWriteOperation('updateSetupStatus', async () => {
      return this.db.updateSetupStatus(setupId, newStatus, updates);
    }, timeoutMs);
  }

  async createOrder(orderData, timeoutMs) {
    return this.runWriteOperation('createOrder', async () => {
      return this.db.createOrder(orderData);
    }, timeoutMs);
  }

  async updateOrderStatus(orderId, status, exchangeOrderId, timeoutMs) {
    return this.runWriteOperation('updateOrderStatus', async () => {
      return this.db.updateOrderStatus(orderId, status, exchangeOrderId);
    }, timeoutMs);
  }

  async getSetupsByStatus(statuses) {
    return this.db.getSetupsByStatus(statuses);
  }

  async getPendingSetupsBySymbolTimeframe() {
    return this.db.getPendingSetupsBySymbolTimeframe();
  }

  async getPendingSetupsForSymbolTimeframe(symbol, timeframe) {
    return this.db.getPendingSetupsForSymbolTimeframe(symbol, timeframe);
  }

  async getTriggeredSetupsBySymbolTimeframe() {
    return this.db.getTriggeredSetupsBySymbolTimeframe();
  }

  async getTriggeredSetupsForSymbolTimeframe(symbol, timeframe) {
    return this.db.getTriggeredSetupsForSymbolTimeframe(symbol, timeframe);
  }

  async getActiveSetups() {
    return this.db.getActiveSetups();
  }

  async getActiveSetupsBySymbolTimeframe(symbol, timeframe) {
    return this.db.getActiveSetupsBySymbolTimeframe(symbol, timeframe);
  }

  async getOrdersBySetupId(setupId) {
    return this.db.getOrdersBySetupId(setupId);
  }

  async getOrdersByStatus(setupId, statuses) {
    return this.db.getOrdersByStatus(setupId, statuses);
  }

  async getUserTelegramChatId(userId) {
    return this.db.getUserTelegramChatId(userId);
  }

  async getUserByEmail(email) {
    return this.db.getUserByEmail(email);
  }

  async getUserById(id) {
    return this.db.getUserById(id);
  }

async createUser(email, passwordHash, timeoutMs) {
    return this.runWriteOperation('createUser', async () => {
      return this.db.createUser(email, passwordHash);
    }, timeoutMs);
  }

  async updateUserPassword(id, hash, timeoutMs) {
    return this.runWriteOperation('updateUserPassword', async () => {
      return this.db.updateUserPassword(id, hash);
    }, timeoutMs);
  }

  async updateUserTelegramChatId(id, chatId, timeoutMs) {
    return this.runWriteOperation('updateUserTelegramChatId', async () => {
      return this.db.updateUserTelegramChatId(id, chatId);
    }, timeoutMs);
  }

  async updateUserPassword(id, hash) {
    return this.runWriteOperation('updateUserPassword', async () => {
      return this.db.updateUserPassword(id, hash);
    });
  }

  async updateUserTelegramChatId(id, chatId) {
    return this.runWriteOperation('updateUserTelegramChatId', async () => {
      return this.db.updateUserTelegramChatId(id, chatId);
    });
  }

  async getSetupById(setupId) {
    return this.db.getSetupById(setupId);
  }

  async upsertScreenerSnapshot(symbol, timeframe, indicatorType, signal, timeoutMs) {
    return this.runWriteOperation('upsertScreenerSnapshot', async () => {
      return this.db.upsertScreenerSnapshot(symbol, timeframe, indicatorType, signal);
    }, timeoutMs);
  }

  async getScreenerSnapshots(indicatorType) {
    return this.db.getScreenerSnapshots(indicatorType);
  }

  async getEwSubscriptionsByUser(userId) {
    return this.db.getEwSubscriptionsByUser(userId);
  }

  async getEnabledEwSubscribers() {
    return this.db.getEnabledEwSubscribers();
  }

  async replaceEwSubscriptionsForUser(userId, timeframes, timeoutMs) {
    return this.runWriteOperation('replaceEwSubscriptionsForUser', async () => {
      return this.db.replaceEwSubscriptionsForUser(userId, timeframes);
    }, timeoutMs);
  }

  async getSupertrendTfSubscriptionsByUser(userId) {
    return this.db.getSupertrendTfSubscriptionsByUser(userId);
  }

  async getEnabledSupertrendTfSubscribers() {
    return this.db.getEnabledSupertrendTfSubscribers();
  }

  async replaceSupertrendTfSubscriptionsForUser(userId, timeframes, timeoutMs) {
    return this.runWriteOperation('replaceSupertrendTfSubscriptionsForUser', async () => {
      return this.db.replaceSupertrendTfSubscriptionsForUser(userId, timeframes);
    }, timeoutMs);
  }

  async getSupertrendAssetSubscriptionsByUser(userId) {
    return this.db.getSupertrendAssetSubscriptionsByUser(userId);
  }

  async getEnabledSupertrendAssetSubscribers() {
    return this.db.getEnabledSupertrendAssetSubscribers();
  }

  async replaceSupertrendAssetSubscriptionsForUser(userId, symbols, timeoutMs) {
    return this.runWriteOperation('replaceSupertrendAssetSubscriptionsForUser', async () => {
      return this.db.replaceSupertrendAssetSubscriptionsForUser(userId, symbols);
    }, timeoutMs);
  }

  async getMazscoreTfSubscriptionsByUser(userId) {
    return this.db.getMazscoreTfSubscriptionsByUser(userId);
  }

  async getEnabledMazscoreTfSubscribers() {
    return this.db.getEnabledMazscoreTfSubscribers();
  }

  async replaceMazscoreTfSubscriptionsForUser(userId, timeframes, timeoutMs) {
    return this.runWriteOperation('replaceMazscoreTfSubscriptionsForUser', async () => {
      return this.db.replaceMazscoreTfSubscriptionsForUser(userId, timeframes);
    }, timeoutMs);
  }

  async getMazscoreAssetSubscriptionsByUser(userId) {
    return this.db.getMazscoreAssetSubscriptionsByUser(userId);
  }

  async getEnabledMazscoreAssetSubscribers() {
    return this.db.getEnabledMazscoreAssetSubscribers();
  }

  async replaceMazscoreAssetSubscriptionsForUser(userId, symbols, timeoutMs) {
    return this.runWriteOperation('replaceMazscoreAssetSubscriptionsForUser', async () => {
      return this.db.replaceMazscoreAssetSubscriptionsForUser(userId, symbols);
    }, timeoutMs);
  }

  async getPriceAlarmsByUser(userId) {
    return this.db.getPriceAlarmsByUser(userId);
  }

  async getPriceAlarmById(id, userId) {
    return this.db.getPriceAlarmById(id, userId);
  }

  async getActivePriceAlarms() {
    return this.db.getActivePriceAlarms();
  }

  async createPriceAlarm(userId, payload, timeoutMs) {
    return this.runWriteOperation('createPriceAlarm', async () => {
      return this.db.createPriceAlarm(userId, payload);
    }, timeoutMs);
  }

  async deletePriceAlarm(id, userId, timeoutMs) {
    return this.runWriteOperation('deletePriceAlarm', async () => {
      return this.db.deletePriceAlarm(id, userId);
    }, timeoutMs);
  }

  async updatePriceAlarm(id, userId, payload, timeoutMs) {
    return this.runWriteOperation('updatePriceAlarm', async () => {
      return this.db.updatePriceAlarm(id, userId, payload);
    }, timeoutMs);
  }

  async deleteAllPriceAlarmsByUser(userId, timeoutMs) {
    return this.runWriteOperation('deleteAllPriceAlarmsByUser', async () => {
      return this.db.deleteAllPriceAlarmsByUser(userId);
    }, timeoutMs);
  }

  getQueueStats() {
    return {
      queueLength: this.writeQueue.length,
      isProcessingWrite: this.isProcessingWrite,
      hasLock: !!this.writeLock,
      lockId: this.writeLock?.id,
      lockAcquiredAt: this.writeLock?.acquiredAt
    };
  }
}

module.exports = DatabaseManager;