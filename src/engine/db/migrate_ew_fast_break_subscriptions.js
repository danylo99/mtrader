// Auto-migration script for EW Fast Break screener per-user telegram subscriptions.
// Adds ew_fast_break_tf_subscriptions table. Runs on application startup.

const logger = require('../logger');

class EwFastBreakSubscriptionsMigration {
  constructor(db) {
    this.db = db;
  }

  async runMigration() {
    try {
      const needsMigration = await this.checkIfMigrationNeeded();
      if (!needsMigration) {
        logger.info('ew_fast_break_tf_subscriptions table already exists — skipping migration');
        return false;
      }

      logger.info('Starting EW Fast Break subscriptions migration...');

      await this.db.beginTransaction();

      try {
        await this.db.exec(`
          CREATE TABLE IF NOT EXISTS ew_fast_break_tf_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            timeframe TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, timeframe)
          )
        `);
        logger.info('Created ew_fast_break_tf_subscriptions table');

        await this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_ew_fast_break_tf_user ON ew_fast_break_tf_subscriptions(user_id)
        `);
        logger.info('Created idx_ew_fast_break_tf_user index');

        await this.db.commit();
        logger.info('EW Fast Break subscriptions migration completed successfully');
        return true;
      } catch (error) {
        await this.db.rollback();
        logger.error('EW Fast Break subscriptions migration failed, transaction rolled back:', error);
        throw error;
      }
    } catch (error) {
      logger.error('EW Fast Break subscriptions migration check failed:', error);
      throw error;
    }
  }

  async checkIfMigrationNeeded() {
    const exists = await this.db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ew_fast_break_tf_subscriptions'"
    );
    return !exists;
  }
}

module.exports = EwFastBreakSubscriptionsMigration;
