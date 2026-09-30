async function migrate(db) {
  const columnExists = async (table, column) => {
    const result = await db.all(`PRAGMA table_info(${table})`);
    return result.some((col) => col.name === column);
  };

  const hasEntryPriceLevel = await columnExists('trading_setups', 'entry_pricelevel_value');
  const hasExitPriceLevel = await columnExists('trading_setups', 'exit_pricelevel_value');

  if (!hasEntryPriceLevel) {
    await db.run(
      'ALTER TABLE trading_setups ADD COLUMN entry_pricelevel_value REAL DEFAULT 0'
    );
    console.log('Added entry_pricelevel_value column to trading_setups');
  }

  if (!hasExitPriceLevel) {
    await db.run(
      'ALTER TABLE trading_setups ADD COLUMN exit_pricelevel_value REAL DEFAULT 0'
    );
    console.log('Added exit_pricelevel_value column to trading_setups');
  }
}

module.exports = { migrate };