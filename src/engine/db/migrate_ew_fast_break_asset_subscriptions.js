// Auto-migration script for EW Fast Break screener per-user asset telegram subscriptions.
// Adds ew_fast_break_asset_subscriptions table. Runs on application startup.

const logger = require('../logger');

class EwFastBreakAssetSubscriptionsMigration {
  constructor(db) {
    this.db = db;
  }

  async runMigration() {
    try {
      const needsMigration = await this.checkIfMigrationNeeded();
      if (!needsMigration) {
        logger.info('ew_fast_break_asset_subscriptions table already exists — skipping migration');
        return false;
      }

      logger.info('Starting EW Fast Break asset subscriptions migration...');

      await this.db.beginTransaction();

      try {
        await this.db.exec(`
          CREATE TABLE IF NOT EXISTS ew_fast_break_asset_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            symbol TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, symbol)
          )
        `);
        logger.info('Created ew_fast_break_asset_subscriptions table');

        await this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_ew_fast_break_asset_user ON ew_fast_break_asset_subscriptions(user_id)
        `);
        logger.info('Created idx_ew_fast_break_asset_user index');

        await this.db.commit();
        logger.info('EW Fast Break asset subscriptions migration completed successfully');
        return true;
      } catch (error) {
        await this.db.rollback();
        logger.error('EW Fast Break asset subscriptions migration failed, transaction rolled back:', error);
        throw error;
      }
    } catch (error) {
      logger.error('EW Fast Break asset subscriptions migration check failed:', error);
      throw error;
    }
  }

  async checkIfMigrationNeeded() {
    const exists = await this.db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ew_fast_break_asset_subscriptions'"
    );
    return !exists;
  }
}

module.exports = EwFastBreakAssetSubscriptionsMigration;
