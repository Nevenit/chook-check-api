export type Bindings = {
  DB: D1Database;
};

export type App = {
  Bindings: Bindings;
};

export interface SubmitResponse {
  accepted: number;
  duplicates: number;
  rejected: number;
  reasons?: string[];
}

export interface ProductStats {
  productId: string;
  productName: string;
  brand: string | null;
  storeChain: string;
  quorum: boolean;
  currentMedianCents: number | null;
  minCents: number | null;
  maxCents: number | null;
  observationCount: number;
  contributorCount: number;
  priceHistory: DayBucket[];
  promoFrequency: Record<string, number>;
}

export interface DayBucket {
  date: string;
  medianCents: number;
  minCents: number;
  maxCents: number;
}

export interface SearchResult {
  productId: string;
  productName: string;
  brand: string | null;
  storeChain: string;
  latestMedianCents: number | null;
  observationCount: number;
}

export interface TrendResult {
  productId: string;
  productName: string;
  brand: string | null;
  storeChain: string;
  changePercent: number;
  direction: "up" | "down";
  currentMedianCents: number;
  previousMedianCents: number;
}
