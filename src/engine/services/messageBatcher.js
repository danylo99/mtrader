const logger = require('../logger');

class MessageBatcher {
  static TRADING_MESSAGE_TYPES = new Set([
    'setup_created',
    'setup_activated',
    'setup_canceled',
    'order_placed',
    'order_filled',
    'tp_hit',
    'sl_hit',
    'be_activated',
    'exit_triggered'
  ]);

  static SCREENER_MESSAGE_TYPES = new Set([
    'screener_reversal',
    'screener_fast_break'
  ]);

  static ALARM_MESSAGE_TYPES = new Set([
    'price_alarm'
  ]);

  constructor(sendCallback, options = {}) {
    this.sendCallback = sendCallback;
    this.formatCallback = options.formatMessage || null;
    this.windowMs = options.windowMs || 10 * 1000;
    this.maxBatchSize = options.maxBatchSize || 20;
    this.groups = new Map();
  }

  async enqueue(messageType, userId, data, chatId) {
    if (!this.sendCallback) return false;

    const groupKey = this.getGroupKey(messageType, userId, data);
    const item = { messageType, data: data || {}, chatId };

    if (groupKey.type === 'error') {
      return this.sendCallback(chatId, this.formatGroupMessage(groupKey, [item]));
    }

    const existingGroup = this.groups.get(groupKey.key);
    if (existingGroup && existingGroup.messages.length >= this.maxBatchSize) {
      await this.flushGroup(groupKey.key);
    }

    const group = this.groups.get(groupKey.key) || {
      type: groupKey.type,
      symbol: groupKey.symbol,
      messages: [],
      timer: null
    };

    group.messages.push(item);
    this.groups.set(groupKey.key, group);
    this.resetTimer(groupKey.key);

    return true;
  }

  async flush() {
    const keys = Array.from(this.groups.keys());
    const results = await Promise.all(keys.map(key => this.flushGroup(key)));
    return results.every(Boolean);
  }

  async flushGroup(key) {
    const group = this.groups.get(key);
    if (!group || group.messages.length === 0) return false;

    if (group.timer) {
      clearTimeout(group.timer);
      group.timer = null;
    }

    this.groups.delete(key);

    const chatId = group.messages[0].chatId;
    const message = this.formatGroupMessage(group, group.messages);
    return this.sendCallback(chatId, message);
  }

  resetTimer(key) {
    const group = this.groups.get(key);
    if (!group) return;

    if (group.timer) clearTimeout(group.timer);

    group.timer = setTimeout(() => {
      this.flushGroup(key);
    }, this.windowMs);

    if (typeof group.timer.unref === 'function') {
      group.timer.unref();
    }
  }

  getGroupKey(messageType, userId, data) {
    const safeUserId = userId || 'default';
    const symbol = data?.symbol || 'unknown';

    if (messageType === 'error') {
      return { type: 'error', symbol, key: `error:${safeUserId}` };
    }

    if (this.constructor.SCREENER_MESSAGE_TYPES.has(messageType)) {
      return { type: 'screener', symbol: null, key: `screener:${safeUserId}` };
    }

    if (this.constructor.ALARM_MESSAGE_TYPES.has(messageType)) {
      return { type: 'alarm', symbol, key: `alarm:${safeUserId}:${symbol}` };
    }

    if (this.constructor.TRADING_MESSAGE_TYPES.has(messageType)) {
      return { type: 'trading', symbol, key: `trading:${safeUserId}:${symbol}` };
    }

    return { type: 'other', symbol, key: `other:${safeUserId}:${symbol}` };
  }

  formatGroupMessage(group, messages) {
    const header = this.getHeader(group.type, group.symbol);
    const lines = messages.map(item => this.formatMessage(item.messageType, item.data));
    return `${header}\n${lines.join('\n\n')}`;
  }

  getHeader(type, symbol) {
    const labels = {
      trading: '📊 Trading Signals',
      screener: '🔔 Screener Alerts',
      alarm: '⏰ Price Alarms',
      error: '⚠️ Error Alerts',
      other: '📨 Notifications'
    };
    const label = labels[type] || 'Notifications';
    return label;
  }

  formatMessage(messageType, data) {
    if (!this.formatCallback) {
      return JSON.stringify(data || {}, null, 2);
    }

    try {
      return this.formatCallback(messageType, data);
    } catch (error) {
      logger.warn('Failed to format batched Telegram message:', error.message);
      return JSON.stringify(data || {}, null, 2);
    }
  }
}

module.exports = MessageBatcher;
