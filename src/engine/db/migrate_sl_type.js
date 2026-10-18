// Auto-migration script to add sl_type and sl_percent columns to trading_setups
// Runs on application startup

const logger = require('../logger');

class SlTypeMigration {
  constructor(db) {
    this.db = db;
  }

  async runMigration() {
    try {
      const status = await this.checkIfMigrationNeeded();
      const needsMigration = status.slType || status.slPercent;
      if (!needsMigration) {
        logger.info('sl_type/sl_percent columns already exist — skipping migration');
        return false;
      }

      logger.info('Starting sl_type migration...');
      await this.db.beginTransaction();

      try {
        if (status.slType) {
          await this.db.exec(`
            ALTER TABLE trading_setups 
            ADD COLUMN sl_type TEXT
          `);
          logger.info('Added sl_type column to trading_setups table');
        }
        if (status.slPercent) {
          await this.db.exec(`
            ALTER TABLE trading_setups 
            ADD COLUMN sl_percent REAL DEFAULT 2.0
          `);
          logger.info('Added sl_percent column to trading_setups table');
        }

        await this.db.commit();
        logger.info('sl_type migration completed successfully');
        return true;
      } catch (error) {
        await this.db.rollback();
        logger.error('sl_type migration failed, transaction rolled back:', error);
        throw error;
      }
    } catch (error) {
      logger.error('sl_type migration check failed:', error);
      throw error;
    }
  }

  async checkIfMigrationNeeded() {
    const columns = await this.db.all(
      "PRAGMA table_info(trading_setups)"
    );
    const names = columns.map(col => col.name);
    return {
      slType: !names.includes('sl_type'),
      slPercent: !names.includes('sl_percent')
    };
  }
}

module.exports = SlTypeMigration;
