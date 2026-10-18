const logger = require('../logger');

class PriceUtils {
  static calculatePositionSize(riskValue, accountBalance, entryPrice, slPrice, side, riskType = 'percent') {
    try {
      // Calculate risk amount in USD
      const riskAmount = riskType === 'fixed' ? riskValue : accountBalance * (riskValue / 100);
      
      // Calculate price difference for risk calculation
      const priceDifference = Math.abs(entryPrice - slPrice);
      
      if (priceDifference <= 0) {
        throw new Error('Invalid price difference for position size calculation');
      }
      
      // Calculate position size
      const positionSize = riskAmount / priceDifference;
      
      logger.info(`Position size calc: risk=${riskValue}${riskType === 'percent' ? '%' : '$'}, balance=$${accountBalance}, entry=$${entryPrice}, sl=$${slPrice}, size=${positionSize}`);
      
      return positionSize;
    } catch (error) {
      logger.error('Error calculating position size:', error);
      throw error;
    }
  }

  static calculateTPPrices(entryPrice, slPrice, rrRatios = [1, 2, 3, 4]) {
    try {
      const priceDifference = entryPrice - slPrice;
      const tpPrices = rrRatios.map(rr => {
        if (priceDifference > 0) {
          // Long position: entryPrice > slPrice
          return entryPrice + (Math.abs(priceDifference) * rr);
        } else {
          // Short position: entryPrice < slPrice
          return entryPrice - (Math.abs(priceDifference) * rr);
        }
      });
      
      logger.info(`TP prices calc: entry=$${entryPrice}, sl=$${slPrice}, TPs=${tpPrices.map(p => `$${p.toFixed(2)}`).join(', ')}`);
      
      return tpPrices;
    } catch (error) {
      logger.error('Error calculating TP prices:', error);
      throw error;
    }
  }

  static calculateSLPrice(entryPrice, ignoreBoxLower, ignoreBoxUpper, side, indicatorType = null, candles = null, indicatorParams = {}) {
    try {
      const IndicatorService = require('../services/indicatorService');
      
      if (side === 'long') {
        // For long positions, SL is typically below entry
        if (ignoreBoxLower > 0) {
          logger.info(`SL using ignoreBoxLower: $${ignoreBoxLower}`);
          return ignoreBoxLower;
        }
        
        // Try swing detection or indicator-based SL if indicator and candles provided
        if (indicatorType && candles && candles.length >= 50) {
          const slResult = IndicatorService.getStopLossPrice(indicatorType, candles, side, entryPrice, indicatorParams);
          if (slResult.price && slResult.price < entryPrice) {
            logger.info(`SL using ${indicatorType} stop price: $${slResult.price}`);
            return slResult.price;
          } else if (slResult.error) {
            logger.warn(`Stop price detection failed for ${indicatorType}: ${slResult.error}`);
          }
        }
        
        // Default to 1% below entry if no ignore box or swing detection
        const defaultSL = entryPrice * 0.95;
        logger.info(`SL using default (1% below): $${defaultSL}`);
        return defaultSL;
      } else if (side === 'short') {
        // For short positions, SL is typically above entry
        if (ignoreBoxUpper > 0) {
          logger.info(`SL using ignoreBoxUpper: $${ignoreBoxUpper}`);
          return ignoreBoxUpper;
        }
        
        // Try swing detection or indicator-based SL if indicator and candles provided
        if (indicatorType && candles && candles.length >= 50) {
          const slResult = IndicatorService.getStopLossPrice(indicatorType, candles, side, entryPrice, indicatorParams);
          if (slResult.price && slResult.price > entryPrice) {
            logger.info(`SL using ${indicatorType} stop price: $${slResult.price}`);
            return slResult.price;
          } else if (slResult.error) {
            logger.warn(`Stop price detection failed for ${indicatorType}: ${slResult.error}`);
          }
        }
        
        // Default to 1% above entry if no ignore box or swing detection
        const defaultSL = entryPrice * 1.05;
        logger.info(`SL using default (1% above): $${defaultSL}`);
        return defaultSL;
      }
      
      throw new Error(`Invalid side for SL calculation: ${side}`);
    } catch (error) {
      logger.error('Error calculating SL price:', error);
      throw error;
    }
  }

  static resolveSLPrice({ entryPrice, side, slPrice, slType, slPercent,
                          indicatorType = null, candles = null, indicatorParams = {} }) {
    const type = String(slType || '').toLowerCase();
    if (type === 'percent') {
      const percent = slPercent > 0 ? slPercent : 2;          // default 2%
      const factor = side === 'long' ? (1 - percent / 100) : (1 + percent / 100);
      const sl = entryPrice * factor;
      logger.info(`SL using percent mode: ${percent}% ${side === 'long' ? 'below' : 'above'} entry -> $${sl}`);
      return sl;
    }
    if (slType && slPrice > 0) return slPrice;                // 'fixed' (explicit)
    if (type === 'swing') {
      return this.calculateSLPrice(entryPrice, 0, 0, side, indicatorType, candles, indicatorParams);
    }
    // Legacy / NULL sl_type: sl_price > 0 ? fixed : swing (current behavior)
    if (slPrice > 0) return slPrice;
    return this.calculateSLPrice(entryPrice, 0, 0, side, indicatorType, candles, indicatorParams);
  }

  static calculateBreakEvenTriggerPrice(entryPrice, tp1Price) {
    // BE trigger is typically when price moves halfway to TP1
    const difference = Math.abs(tp1Price - entryPrice);
    if (entryPrice < tp1Price) {
      // Long position
      return entryPrice + (difference * 0.5);
    } else {
      // Short position
      return entryPrice - (difference * 0.5);
    }
  }

  static parseTpPricesJson(tpPricesJson) {
    try {
      if (!tpPricesJson) {
        return [1, 2, 3, 4]; // Default RR ratios
      }
      
      const parsed = JSON.parse(tpPricesJson);
      if (!Array.isArray(parsed)) {
        throw new Error('TP prices must be an array');
      }
      
      // Validate RR ratios are positive numbers
      if (!parsed.every(ratio => typeof ratio === 'number' && ratio > 0)) {
        throw new Error('All RR ratios must be positive numbers');
      }
      
      return parsed;
    } catch (error) {
      logger.error('Error parsing TP prices JSON:', error);
      return [1, 2, 3, 4]; // Default on error
    }
  }

  static calculatePnl(entryPrice, exitPrice, quantity, side, fees = 0.001) {
    try {
      const tradeValue = entryPrice * quantity;
      const exitValue = exitPrice * quantity;
      
      let pnl;
      if (side === 'long') {
        pnl = exitValue - tradeValue;
      } else if (side === 'short') {
        pnl = tradeValue - exitValue;
      } else {
        throw new Error(`Invalid side for P&L calculation: ${side}`);
      }
      
      // Apply fees (0.1% each way = 0.2% total)
      const totalFees = (tradeValue + exitValue) * fees;
      const netPnl = pnl - totalFees;
      const pnlPercent = (netPnl / tradeValue) * 100;
      
      return {
        grossPnl: pnl,
        fees: totalFees,
        netPnl: netPnl,
        pnlPercent: pnlPercent
      };
    } catch (error) {
      logger.error('Error calculating P&L:', error);
      throw error;
    }
  }

  static getDecimalPlaces(value) {
    const valueString = value.toString();
    if (valueString.includes('e-')) {
      const [, exponent] = valueString.split('e-');
      return parseInt(exponent, 10);
    }
    if (!valueString.includes('.')) {
      return 0;
    }
    return valueString.split('.')[1].length;
  }

  static normalizeValue(value, decimals) {
    return parseFloat(value.toFixed(decimals));
  }

  static roundToTickSize(price, tickSize = 0.01) {
    if (!this.isValidPrice(price) || !this.isValidPrice(tickSize)) {
      throw new Error('Invalid price or tick size for rounding');
    }
    
    const precision = this.getDecimalPlaces(tickSize);
    const multiplier = 1 / tickSize;
    const rounded = Math.round(price * multiplier) / multiplier;
    return this.normalizeValue(rounded, precision);
  }

  static roundQuantity(quantity, stepSize = 0.001) {

    const precision = this.getDecimalPlaces(stepSize);
    const multiplier = 1 / stepSize;
    const rounded = Math.floor(quantity * multiplier) / multiplier;
    return this.normalizeValue(rounded, precision);
  }

  static splitQuantity(quantity, parts, stepSize = 0.001) {
    try {
      if (parts <= 0) {
        return [];
      }

      const roundedQuantity = this.roundQuantity(quantity, stepSize);
      const baseQty = this.roundQuantity(roundedQuantity / parts, stepSize);
      const quantities = Array(parts).fill(baseQty);
      const remaining = roundedQuantity - baseQty * parts;

      if (remaining > 0 && parts > 0) {
        quantities[parts - 1] = this.roundQuantity(quantities[parts - 1] + remaining, stepSize);
      }

      return quantities;
    } catch (e) {
      logger.error('Error splitting quantity:', e);
      throw e;
    }
  }

  static isValidPrice(price) {
    return typeof price === 'number' && price > 0 && !isNaN(price) && isFinite(price);
  }
}

module.exports = PriceUtils;