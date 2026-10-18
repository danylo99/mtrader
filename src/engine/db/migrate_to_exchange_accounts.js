// Auto-migration script to convert bybit_accounts to exchange_accounts
// Runs on application startup to migrate existing data

const logger = require('../logger');

class DatabaseMigration {
  constructor(db) {
    this.db = db;
  }

  async runMigration() {
    try {
      // Check if migration is needed
      const needsMigration = await this.checkIfMigrationNeeded();
      
      if (!needsMigration) {
        logger.info('Database schema already migrated to exchange_accounts');
        return false;
      }

      logger.info('Starting database migration: bybit_accounts -> exchange_accounts');
      
      // Begin transaction
      await this.db.beginTransaction();

      try {
        // 1. Create new exchange_accounts table
        await this.createExchangeAccountsTable();
        
        // 2. Migrate data from bybit_accounts to exchange_accounts
        const migratedCount = await this.migrateAccountsData();
        
        // 3. Update trading_setups table foreign key
        await this.updateTradingSetupsTable();
        
        // 4. Rename bybit_order_id to exchange_order_id in orders table
        await this.renameOrderIdColumn();
        
        // 5. Drop old bybit_accounts table
        await this.dropBybitAccountsTable();
        
        // 5. Recreate indexes
        await this.recreateIndexes();
        
        // 6. Update schema.sql file for future fresh installs
        await this.updateSchemaFile();
        
        // Commit transaction
        await this.db.commit();
        
        logger.info(`Database migration completed successfully. Migrated ${migratedCount} accounts.`);
        return true;
        
      } catch (error) {
        // Rollback on any error
        await this.db.rollback();
        logger.error('Migration failed, transaction rolled back:', error);
        throw error;
      }
      
    } catch (error) {
      logger.error('Migration check failed:', error);
      throw error;
    }
  }

  async checkIfMigrationNeeded() {
    try {
      // Check if bybit_accounts table exists
      const bybitTableExists = await this.db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='bybit_accounts'"
      );
      
      // Check if exchange_accounts table already exists
      const exchangeTableExists = await this.db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_accounts'"
      );
      
      // Migration needed if bybit_accounts exists AND exchange_accounts doesn't exist
      return bybitTableExists && !exchangeTableExists;
      
    } catch (error) {
      logger.error('Error checking migration status:', error);
      throw error;
    }
  }

  async createExchangeAccountsTable() {
    const sql = `
      CREATE TABLE exchange_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exchange TEXT NOT NULL,
        label TEXT NOT NULL,
        api_key_enc TEXT NOT NULL,
        api_secret_enc TEXT NOT NULL,
        is_testnet INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      )
    `;
    
    await this.db.exec(sql);
    logger.info('Created exchange_accounts table');
  }

  async migrateAccountsData() {
    const sql = `
      INSERT INTO exchange_accounts (id, user_id, exchange, label, api_key_enc, api_secret_enc, is_testnet, created_at, updated_at)
      SELECT id, user_id, 'bybit', label, api_key_enc, api_secret_enc, is_testnet, created_at, updated_at
      FROM bybit_accounts
      ORDER BY id
    `;
    
    const result = await this.db.run(sql);
    logger.info(`Migrated ${result.changes} accounts from bybit_accounts to exchange_accounts`);
    return result.changes;
  }

  async updateTradingSetupsTable() {
    // First check if column already renamed (in case of partial migration)
    const columns = await this.db.all(
      "PRAGMA table_info(trading_setups)"
    );
    
    const hasAccountId = columns.some(col => col.name === 'account_id');
    const hasExchangeAccountId = columns.some(col => col.name === 'exchange_account_id');
    
    if (hasAccountId && !hasExchangeAccountId) {
      // Rename account_id to exchange_account_id
      await this.db.exec(`
        ALTER TABLE trading_setups 
        RENAME COLUMN account_id TO exchange_account_id
      `);
      logger.info('Renamed trading_setups.account_id to exchange_account_id');
    }
    
    // Update foreign key reference if needed
    const foreignKeys = await this.db.all(
      "PRAGMA foreign_key_list(trading_setups)"
    );
    
    const hasBybitForeignKey = foreignKeys.some(fk => 
      fk.table === 'bybit_accounts' && fk.from === 'exchange_account_id'
    );
    
    if (hasBybitForeignKey) {
      // SQLite doesn't support direct foreign key modification
      // We'll need to recreate the table with correct foreign key
      await this.recreateTradingSetupsTable();
    }
  }

  async recreateTradingSetupsTable() {
    logger.info('Recreating trading_setups table with correct foreign key...');
    
    // Create backup table
    await this.db.exec(`
      CREATE TABLE trading_setups_backup AS 
      SELECT * FROM trading_setups
    `);
    
    // Drop original table
    await this.db.exec('DROP TABLE trading_setups');
    
    // Recreate with correct schema
    await this.db.exec(`
      CREATE TABLE trading_setups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exchange_account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        memo TEXT,
        activation_price REAL NOT NULL,
        ignore_box_upper REAL NOT NULL,
        ignore_box_lower REAL NOT NULL,
        entry_indicator_type TEXT NOT NULL,
        entry_indicator_tf TEXT NOT NULL,
        risk_type TEXT NOT NULL,
        risk_value REAL NOT NULL,
        sl_price REAL DEFAULT 0,
        sl_type TEXT,
        sl_percent REAL DEFAULT 2.0,
        tp_prices TEXT DEFAULT '[1,2,3,4]',
        be_enabled INTEGER DEFAULT 0,
        be_trigger_price REAL DEFAULT 0,
        entry_price REAL,
        entry_qty REAL,
        activated_at TEXT,
        exit_indicator_type TEXT,
        exit_indicator_tf TEXT,
        closed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        profit REAL DEFAULT 0,
        reason TEXT DEFAULT ''
      )
    `);
    
    // Copy data back
    await this.db.exec(`
      INSERT INTO trading_setups 
      SELECT * FROM trading_setups_backup
    `);
    
    // Drop backup
    await this.db.exec('DROP TABLE trading_setups_backup');
    
    logger.info('Recreated trading_setups table with exchange_accounts foreign key');
  }

  async renameOrderIdColumn() {
    // Check if bybit_order_id column exists in orders table
    const columns = await this.db.all(
      "PRAGMA table_info(orders)"
    );
    
    const hasBybitOrderId = columns.some(col => col.name === 'bybit_order_id');
    const hasExchangeOrderId = columns.some(col => col.name === 'exchange_order_id');
    
    if (hasBybitOrderId && !hasExchangeOrderId) {
      // Rename bybit_order_id to exchange_order_id
      await this.db.exec(`
        ALTER TABLE orders 
        RENAME COLUMN bybit_order_id TO exchange_order_id
      `);
      logger.info('Renamed orders.bybit_order_id to exchange_order_id');
    } else if (hasExchangeOrderId) {
      logger.info('orders table already has exchange_order_id column');
    }
  }

  async dropBybitAccountsTable() {
    await this.db.exec('DROP TABLE bybit_accounts');
    logger.info('Dropped bybit_accounts table');
  }

  async recreateIndexes() {
    // Drop old index if it exists
    try {
      await this.db.exec('DROP INDEX IF EXISTS idx_accounts_user');
    } catch (error) {
      // Ignore errors if index doesn't exist
    }
    
    // Create new index for exchange_accounts
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_accounts_user 
      ON exchange_accounts(user_id)
    `);
    
    // Ensure other indexes exist
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_setups_account 
      ON trading_setups(exchange_account_id)
    `);
    
    logger.info('Recreated indexes for exchange_accounts');
  }

  async updateSchemaFile() {
    // This is informational - the actual schema.sql will be updated separately
    logger.info('Note: schema.sql file should be updated manually for fresh installs');
    
    // We'll create a backup of the original schema
    const fs = require('fs');
    const path = require('path');
    
    const schemaPath = path.join(__dirname, 'schema.sql');
    const backupPath = path.join(__dirname, 'schema.sql.backup-pre-migration');
    
    if (fs.existsSync(schemaPath)) {
      try {
        fs.copyFileSync(schemaPath, backupPath);
        logger.info(`Created backup of schema.sql at ${backupPath}`);
      } catch (error) {
        logger.warn('Could not create schema backup:', error.message);
      }
    }
  }

  async createEmergencyRollbackScript() {
    // Create a rollback script in case migration needs to be reverted
    const rollbackScript = `
-- Emergency rollback script for exchange_accounts migration
-- Run this manually if migration causes issues

PRAGMA foreign_keys = OFF;

-- 1. Create bybit_accounts table from backup if needed
CREATE TABLE IF NOT EXISTS bybit_accounts_backup AS 
SELECT id, user_id, label, api_key_enc, api_secret_enc, is_testnet, created_at, updated_at
FROM exchange_accounts
WHERE exchange = 'bybit';

-- 2. Update trading_setups foreign key reference
-- Note: This requires manual intervention to update foreign keys
-- 3. Restore indexes

PRAGMA foreign_keys = ON;

-- IMPORTANT: This is a simplified rollback script
-- Full rollback would require restoring the original database backup
`;
    
    const fs = require('fs');
    const path = require('path');
    const rollbackPath = path.join(__dirname, 'rollback_migration.sql');
    
    fs.writeFileSync(rollbackPath, rollbackScript);
    logger.info(`Emergency rollback script created at ${rollbackPath}`);
  }
}

module.exports = DatabaseMigration;