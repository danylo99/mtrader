import { z } from 'zod';

const timeframeEnum = z.enum(['m1', 'm5', 'm15', 'm30', 'h1', 'h2', 'h4', 'd1']);
const indicatorEnum = z.enum(['supertrend', 'rollingsupertrend', 'rollingsupertrend2', 'macd', 'ema', 'ewt']);

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const setupSchema = z.object({
  exchange_account_id: z.number().positive('Please select an account'),
  symbol: z.string().min(1, 'Symbol is required').toUpperCase(),
  side: z.enum(['long', 'short']),
  memo: z.string().optional().default(''),
  activation_price: z.number().nonnegative('Must be zero or positive'),
  ignore_box_upper: z.number().nonnegative('Must be zero or positive'),
  ignore_box_lower: z.number().nonnegative('Must be zero or positive'),
  entry_indicator_type: indicatorEnum,
  entry_indicator_tf: timeframeEnum,
  risk_type: z.enum(['percent', 'fixed']),
  risk_value: z.number().positive('Must be positive'),
  sl_price: z.number().optional().default(0),
  sl_type: z.enum(['fixed', 'swing', 'percent']).optional(),
  sl_percent: z.number().optional().default(2),
  tp_prices: z.array(z.number()).min(0).max(8).default([1, 2, 3, 4]),
  be_enabled: z.boolean().default(false),
  be_trigger_price: z.number().optional().default(0),
  exit_indicator_type: indicatorEnum.optional(),
  exit_indicator_tf: timeframeEnum.optional(),
}).refine(
  (data) => {
    if (data.be_enabled && (data.be_trigger_price === undefined || data.be_trigger_price < 0)) {
      return false;
    }
    return true;
  },
  { message: 'BE trigger price is required when BE is enabled', path: ['be_trigger_price'] }
);

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const telegramSchema = z.object({
  telegram_chat_id: z.string().nullable(),
});