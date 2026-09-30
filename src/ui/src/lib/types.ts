export type Side = 'long' | 'short';
export type SetupStatus = 'pending' | 'triggered' | 'active' | 'closed' | 'cancelled';
export type EntryIndicatorType = 'supertrend' | 'rollingsupertrend' | 'rollingsupertrend2' | 'macd' | 'ema' | 'ewt' | 'manual' | 'pricelevel';
export type ScreenerIndicatorType = 'supertrend' | 'rollingsupertrend' | 'rollingsupertrend2' | 'macd' | 'ema' | 'ewt';
export type Timeframe = 'm1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h2' | 'h4' | 'd1' | 'w1';
export type RiskType = 'percent' | 'fixed';
export type OrderType = 'entry' | 'tp1' | 'tp2' | 'tp3' | 'tp4' | 'sl';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  telegram_chat_id: string | null;
  created_at: string;
}

export interface ExchangeAccount {
  id: number;
  user_id: number;
  exchange: string;  // bybit, hyperliquid, etc.
  label: string;
  api_key_enc: string;
  api_secret_enc: string;
  is_testnet: number;
  created_at: string;
}

export interface TradingSetup {
  id: number;
  user_id: number;
  exchange_account_id: number;
  exchange?: string;
  account_label?: string;
  symbol: string;
  side: Side;
  status: SetupStatus;
  memo: string | null;
  activation_price: number;
  ignore_box_upper: number;
  ignore_box_lower: number;
  entry_indicator_type: EntryIndicatorType;
  entry_indicator_tf: Timeframe;
  entry_pricelevel_value: number;
  risk_type: RiskType;
  risk_value: number;
  sl_price: number;
  tp_prices: string;
  be_enabled: number;
  be_trigger_price: number;
  be_activated: number;
  entry_price: number | null;
  entry_qty: number | null;
  profit: number;
  activated_at: string | null;
  exit_indicator_type: EntryIndicatorType | null;
  exit_indicator_tf: Timeframe | null;
  exit_pricelevel_value: number;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: number;
  setup_id: number;
  order_type: OrderType;
  side: OrderSide;
  price: number;
  qty: number;
  status: OrderStatus;
  exchange_order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SetupFormData {
  exchange_account_id: number;
  symbol: string;
  side: Side;
  memo?: string;
  activation_price: number;
  ignore_box_upper: number;
  ignore_box_lower: number;
  entry_indicator_type: EntryIndicatorType;
  entry_indicator_tf: Timeframe;
  entry_pricelevel_value: number;
  risk_type: RiskType;
  risk_value: number;
  sl_price: number;
  tp_prices: number[];
  be_enabled: boolean;
  be_trigger_price?: number;
  exit_indicator_type?: EntryIndicatorType;
  exit_indicator_tf?: Timeframe;
  exit_pricelevel_value: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type PriceAlarmDirection = 'cross_above' | 'cross_below';

export interface PriceAlarm {
  id: number;
  user_id: number;
  symbol: string;
  timeframe: Timeframe;
  direction: PriceAlarmDirection;
  price_level: number;
  created_at: string;
}

export interface NewPriceAlarmForm {
  symbol: string;
  timeframe: Timeframe;
  direction: PriceAlarmDirection;
  price_level: number;
}