const TelegramBot = require('node-telegram-bot-api');
const Config = require('../config');
const logger = require('../logger');
const MessageBatcher = require('./messageBatcher');

class TelegramService {
  static TRADING_MESSAGE_TYPES = new Set([
    'setup_created',
    'setup_activated',
    'setup_canceled',
    'order_placed',
    'order_filled',
    'tp_hit',
    'sl_hit',
    'be_activated',
    'exit_triggered',
    'manual_close',
    'sl_modified'
  ]);

  static SCREENER_MESSAGE_TYPES = new Set([
    'screener_reversal'
  ]);

  static ALARM_MESSAGE_TYPES = new Set([
    'price_alarm'
  ]);

  constructor(db) {
    this.botToken = Config.getTelegramBotToken();
    this.bot = null;
    this.defaultChatId = Config.getTelegramUserId();
    this.db = db || null;
    this.messageBatcher = null;

    if (this.botToken) {
      this.initializeBot();
    } else {
      logger.warn('Telegram bot token not configured. Notifications will be disabled.');
    }
  }

  initializeBot() {
    try {
      this.bot = new TelegramBot(this.botToken, { polling: false });
      this.messageBatcher = new MessageBatcher(
        this.sendDirectNotification.bind(this),
        { formatMessage: this.formatBatchMessage.bind(this) }
      );
      logger.info('Telegram bot initialized');

    } catch (error) {
      logger.error('Failed to initialize Telegram bot:', error);
      this.bot = null;
      this.messageBatcher = null;
    }
  }

  async sendNotification(userId, messageType, data) {
    if (!this.bot) {
      logger.warn('Telegram bot not available. Skipping notification.');
      return false;
    }

    try {
      const chatId = await this.getUserChatId(userId);
      if (!chatId) {
        logger.warn('TELEGRAM_USER_ID not set. Skipping notification.');
        return false;
      }

      const accepted = await this.messageBatcher.enqueue(messageType, userId, data || {}, chatId);
      if (!accepted) return false;

      logger.info(`Telegram notification queued: ${messageType}`);
      return true;
    } catch (error) {
      logger.error('Failed to send Telegram notification:', error);
      return false;
    }
  }

  async sendDirectNotification(chatId, message) {
    if (!this.bot || !chatId) {
      return false;
    }

    try {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      return true;
    } catch (error) {
      logger.error('Failed to send direct Telegram notification:', error);
      return false;
    }
  }

  async flush() {
    if (!this.messageBatcher) return true;
    return this.messageBatcher.flush();
  }

  formatMessage(messageType, data, options = {}) {
    const payload = data || {};

    if (options.batch) {
      return this.formatBatchMessage(messageType, payload);
    }

    if (messageType === 'screener_reversal') {
      return this.formatScreenerReversal(payload);
    }

    if (messageType === 'price_alarm') {
      return this.formatPriceAlarm(payload);
    }

    const emoji = this.getEmojiForMessageType(messageType);
    const timestamp = new Date().toUTCString().substring(0, 22);
    const subtitle = this.getMessageSubtitle(messageType, payload);

    let message = `${emoji} <b>${this.getMessageTitle(messageType)}</b>`;
    if (subtitle) message += `\n${subtitle}`;
    message += `\n⏰ ${timestamp}\n\n`;
    
    switch (messageType) {
      case 'setup_created':
        message += this.formatSetupCreated(payload);
        break;
      case 'setup_activated':
        message += this.formatSetupActivated(payload);
        break;
      case 'setup_canceled':
        message += this.formatSetupCancelled(payload);
        break;
      case 'order_placed':
        message += this.formatOrderPlaced(payload);
        break;
      case 'order_filled':
        message += this.formatOrderFilled(payload);
        break;
      case 'tp_hit':
        message += this.formatTpHit(payload);
        break;
      case 'sl_hit':
        message += this.formatSlHit(payload);
        break;
      case 'be_activated':
        message += this.formatBeActivated(payload);
        break;
      case 'exit_triggered':
        message += this.formatExitTriggered(payload);
        break;
      case 'manual_close':
        message += this.formatManualClose(payload);
        break;
      case 'sl_modified':
        message += this.formatSlModified(payload);
        break;
      case 'error':
        message += this.formatError(payload);
        break;
      default:
        message += JSON.stringify(payload, null, 2);
    }
    
    return message;
  }

  formatBatchMessage(messageType, data) {
    const payload = data || {};

    if (this.constructor.SCREENER_MESSAGE_TYPES.has(messageType)) {
      return this.formatScreenerReversal(payload);
    }

    if (this.constructor.ALARM_MESSAGE_TYPES.has(messageType)) {
      return this.formatPriceAlarm(payload);
    }

    if (this.constructor.TRADING_MESSAGE_TYPES.has(messageType)) {
      return this.formatTradingBatchMessage(messageType, payload);
    }

    return this.formatMessage(messageType, payload);
  }

  formatTradingBatchMessage(messageType, data) {
    switch (messageType) {
      case 'setup_created':
        return this.formatSetupCreated(data);
      case 'setup_activated':
        return this.formatSetupActivated(data);
      case 'setup_canceled':
        return this.formatSetupCancelled(data);
      case 'order_placed':
        return this.formatOrderPlaced(data);
      case 'order_filled':
        return this.formatOrderFilled(data);
      case 'tp_hit':
        return this.formatTpHit(data);
      case 'sl_hit':
        return this.formatSlHit(data);
      case 'be_activated':
        return this.formatBeActivated(data);
      case 'exit_triggered':
        return this.formatExitTriggered(data);
      case 'manual_close':
        return this.formatManualClose(data);
      case 'sl_modified':
        return this.formatSlModified(data);
      default:
        return this.formatCompactTradingMessage(
          ['NOTIFICATION', data.symbol, messageType],
          '📨',
          data.price || data.activationPrice || data.entryPrice,
          data.timestamp
        );
    }
  }

  getMessageSubtitle(messageType, data) {
    try {
      switch (messageType) {
        case 'setup_created':
        case 'setup_activated':
        case 'setup_canceled':
        case 'order_placed':
        case 'order_filled':
        case 'tp_hit':
        case 'sl_hit':
        case 'be_activated':
        case 'exit_triggered':
        case 'manual_close':
        case 'sl_modified':
        case 'supply_demand_zone':
          if (data && data.setupId && data.symbol) {
            const side = data.side ? ` • ${data.side.toUpperCase()}` : '';
            return `Setup #${data.setupId} • ${data.symbol}${side}`;
          }
          if (data && data.symbol) {
            return `${data.symbol}${data.side ? ` • ${data.side.toUpperCase()}` : ''}`;
          }
          return '';
        case 'screener_reversal':
          return data && data.symbol ? `${data.symbol}` : '';
        case 'error':
          return data && data.component ? `Component: ${data.component}` : '';
        default:
          return '';
      }
    } catch (e) {
      return '';
    }
  }

  formatSetupCreated(data) {
    const payload = data || {};
    const side = this.getSideAction(payload.side);
    const timeframe = payload.entryIndicatorTf || payload.entry_indicator_tf || '';
    const indicator = payload.entryIndicatorType || payload.entry_indicator_type || '';

    return this.formatCompactTradingMessage(
      [side.action, payload.symbol, timeframe, indicator],
      side.emoji,
      payload.activationPrice || payload.price,
      payload.timestamp
    );
  }

  formatSetupActivated(data) {
    const payload = data || {};
    const side = this.getSideAction(payload.side);

    return this.formatCompactTradingMessage(
      [side.action, payload.symbol, 'ACTIVATED'],
      side.emoji,
      payload.price,
      payload.timestamp
    );
  }

  formatSetupCancelled(data) {
    const payload = data || {};
    const side = this.getSideAction(payload.side);

    return this.formatCompactTradingMessage(
      [side.action, payload.symbol, 'CANCELED'],
      '❌',
      payload.price,
      payload.timestamp
    );
  }

  formatOrderPlaced(data) {
    const payload = data || {};
    const side = this.getSideAction(payload.side);
    const orderType = payload.orderType || payload.order_type || 'ORDER';

    return this.formatCompactTradingMessage(
      [side.action, payload.symbol, orderType],
      '🔄',
      payload.price,
      payload.timestamp
    );
  }

  formatOrderFilled(data) {
    const payload = data || {};
    const side = this.getSideAction(payload.side);
    const orderType = payload.orderType || payload.order_type || 'ORDER';

    return this.formatCompactTradingMessage(
      [side.action, payload.symbol, orderType],
      '✅',
      payload.price,
      payload.timestamp
    );
  }

  formatTpHit(data) {
    const payload = data || {};
    const tpLevel = payload.tpLevel ? `TP${payload.tpLevel}` : 'TP';

    return this.formatCompactTradingMessage(
      [tpLevel, payload.symbol, 'HIT'],
      '🎯',
      payload.price,
      payload.timestamp
    );
  }

  formatSlHit(data) {
    const payload = data || {};
    return this.formatCompactTradingMessage(
      ['SL', payload.symbol, 'HIT'],
      '🛑',
      payload.price,
      payload.timestamp
    );
  }

  formatBeActivated(data) {
    const payload = data || {};
    return this.formatCompactTradingMessage(
      ['BE', payload.symbol, 'ACTIVATED'],
      '🛡️',
      payload.entryPrice,
      payload.timestamp
    );
  }

  formatExitTriggered(data) {
    const payload = data || {};
    const timeframe = payload.exitIndicatorTf || payload.exit_indicator_tf || '';
    const indicator = payload.exitIndicatorType || payload.exit_indicator_type || 'EXIT';

    return this.formatCompactTradingMessage(
      ['EXIT', payload.symbol, timeframe, indicator],
      '🚪',
      payload.price,
      payload.timestamp
    );
  }

  formatManualClose(data) {
    const payload = data || {};
    const side = this.getSideAction(payload.side);
    const remaining = payload.remainingQty !== undefined && payload.remainingQty !== null
      ? ` · LEFT ${payload.remainingQty}`
      : '';

    return this.formatCompactTradingMessage(
      [`MANUAL CLOSE ${payload.quantity ?? ''}`, payload.symbol, 'CLOSED' + remaining],
      side.emoji,
      payload.price,
      payload.timestamp
    );
  }

  formatSlModified(data) {
    const payload = data || {};
    return this.formatCompactTradingMessage(
      ['SL', payload.symbol, 'MODIFIED'],
      '🎚️',
      payload.newPrice,
      payload.timestamp
    );
  }

  formatError(data) {
    const payload = data || {};
    return `❌ Error: ${payload.error || 'Unknown error'}

📝 Details: ${payload.details || 'No additional details'}
`;
  }

  formatCompactTradingMessage(parts, emoji, price, timestamp) {
    const lineParts = Array.isArray(parts) ? parts : [parts];
    const filteredParts = lineParts
      .map(part => String(part || '').trim())
      .filter(part => part.length > 0);
    const line = filteredParts.length > 0 ? filteredParts.join(' · ') : 'NOTIFICATION';

    return `${emoji} ${line}
Price: ${this.formatPrice(price)}  ·  ${this.formatBatchTimestamp(timestamp)}
`;
  }

  getSideAction(side) {
    const normalizedSide = String(side || '').toLowerCase();
    if (normalizedSide === 'short' || normalizedSide === 'sell') {
      return { action: 'SELL', emoji: '🔴' };
    }

    return { action: 'BUY', emoji: '🟢' };
  }

  formatBatchTimestamp(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return this.formatBatchTimestamp();

    const day = date.toUTCString().slice(0, 3);
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mon = date.toUTCString().slice(8, 11);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');

    return `${day} ${dd} ${mon} ${hh}:${mm}`;
  }

  formatScreenerReversal(data) {
    const payload = data || {};
    let action, emoji;

    if (payload.indicatorType === 'MAZSCORE') {
      if (payload.signal === 'bullish') {
        action = 'BULLISH';
        emoji = '🟢';
      } else {
        action = 'BEARISH';
        emoji = '🔴';
      }
    } else {
      const isBuy = payload.signal === 'bullish_crossover' || payload.signal === 'bullish';
      action = isBuy ? 'BUY' : 'SELL';
      emoji = isBuy ? '🟢' : '🔴';
    }
    const indicator = payload.indicatorType ? payload.indicatorType.toUpperCase() : '';

    return this.formatCompactTradingMessage(
      [action, payload.symbol, payload.timeframe, indicator],
      emoji,
      payload.price,
      payload.timestamp
    );
  }

  formatPriceAlarm(data) {
    const payload = data || {};
    const directionLabel = payload.direction === 'cross_above' ? 'ABOVE' : 'BELOW';
    const timeframe = payload.timeframe ? String(payload.timeframe).toUpperCase() : '';

    return `${this.formatCompactTradingMessage(
      ['ALARM', payload.symbol, timeframe, `CROSSED ${directionLabel}`],
      '🔔',
      payload.price_level,
      payload.timestamp
    ).trim()}\nClose: ${this.formatPrice(payload.close)}\n`;
  }

  formatPrice(price) {
    if (price === undefined || price === null) return '$0.00';
    return '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  getEmojiForMessageType(messageType) {
    const emojiMap = {
      'setup_created': '📊',
      'setup_activated': '🚀',
      'setup_canceled': '❌',
      'order_placed': '🔄',
      'order_filled': '✅',
      'tp_hit': '🎯',
      'sl_hit': '🛑',
      'be_activated': '🛡️',
      'exit_triggered': '🚪',
      'manual_close': '✂️',
      'sl_modified': '🎚️',
      'screener_reversal': '🔔',
      'price_alarm': '🔔',
      'supply_demand_zone': '🏢',
      'error': '⚠️'
    };
    
    return emojiMap[messageType] || '📨';
  }

  getMessageTitle(messageType) {
    const titleMap = {
      'setup_created': 'Setup Created',
      'setup_activated': 'Setup Activated',
      'setup_canceled': 'Setup Cancelled',
      'order_placed': 'Order Placed',
      'order_filled': 'Order Filled',
      'tp_hit': 'Take Profit Hit',
      'sl_hit': 'Stop Loss Hit',
      'be_activated': 'Break-Even Activated',
      'exit_triggered': 'Exit Triggered',
      'manual_close': 'Manual Close',
      'sl_modified': 'Stop Loss Modified',
      'screener_reversal': 'Screener Alert',
      'price_alarm': 'Price Alarm',
      'supply_demand_zone': 'Zone Alert',
      'error': 'Error Alert'
    };
    
    return titleMap[messageType] || 'Notification';
  }

  async getUserChatId(userId) {
    if (this.db && userId) {
      try {
        const chatId = await this.db.getUserTelegramChatId(userId);
        if (chatId) return chatId;
      } catch (err) {
        logger.warn('Failed to query user telegram chat id:', err.message);
      }
    }
    return this.defaultChatId || null;
  }

  isAvailable() {
    return this.bot !== null;
  }
}

module.exports = TelegramService;