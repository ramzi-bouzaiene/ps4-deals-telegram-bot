export interface GameDeal {
  id: string;
  title: string;
  platform: "PS4";
  store: string;
  region: string;
  currentPrice: number;
  originalPrice: number;
  currency: string;
  discountPercentage: number;
  url: string;
  imageUrl?: string;
  rating?: number;
  popularity?: number;
  expiresAt?: string;
}

export interface DealSource {
  name: string;
  regions: string[];
  fetchDeals(): Promise<GameDeal[]>;
}

export interface NotificationPrefs {
  historicalLow: boolean;
  wishlist: boolean;
  hotDeals: boolean;
  dailyDeals: boolean;
}

export interface ScoreWeights {
  discount: number;
  price: number;
  historical: number;
  drop: number;
  rating: number;
  popularity: number;
}

export interface Preferences {
  region: string;
  currency: string;
  displayTND: boolean;
  tndRate: number;
  minimumDealScore: number;
  dailyDealsCount: number;
  notifications: NotificationPrefs;
  scoreWeights: ScoreWeights;
}

export interface WishlistEntry {
  gameId: string;
  title: string;
  targetPrice: number;
  url?: string;
}

export interface PricePoint {
  price: number;
  currency: string;
  date: string;
}

export interface PriceHistoryEntry {
  prices: PricePoint[];
}

export type PriceHistoryFile = Record<string, PriceHistoryEntry>;

export interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}
