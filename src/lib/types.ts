export type Bindings = {
  DB: D1Database;
  RATE_LIMIT_SECRET: string;
  ALLOWED_EXTENSION_ORIGINS?: string;
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
  differentialSignal?: DifferentialSignal;
  observerEffect?: ObserverEffect;
}

export interface DifferentialSignal {
  classification:
    | "insufficient_evidence"
    | "contextual_difference"
    | "possible_differential_pricing";
  confidence: "none" | "low" | "moderate";
  explanation: string;
  matchedContributorCount: number;
  priceGroups: Array<{ priceCents: number; contributorCount: number }>;
}

export interface ObserverEffect {
  comparisonCount: number;
  contributorCount: number;
  changedCount: number;
  medianChangeCents: number | null;
}

export interface ContributorCredentials {
  contributorId: string;
  submitToken: string;
  deletionToken: string;
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
