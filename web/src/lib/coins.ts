/**
 * Multi-market support: each tracked coin maps to a Binance symbol, its
 * PancakeSwap Prediction contract on BNB Chain, correlation peers, and a
 * localStorage suffix so per-coin round/position history never mixes.
 */

export type CoinId = "BTC" | "BNB" | "ETH";

export interface CoinPeer {
  /** Display id, e.g. "ETH". */
  id: string;
  /** Binance stream symbol, e.g. "ETHUSDT". */
  symbol: string;
}

export interface CoinConfig {
  id: CoinId;
  name: string;
  /** Binance kline/stream symbol. */
  symbol: string;
  /** Display pair, e.g. "BTC/USDT". */
  pair: string;
  /** PancakeSwap Prediction V2 contract on BSC for this asset. */
  contract: string;
  /** Two correlation peers streamed alongside the main symbol. */
  peers: [CoinPeer, CoinPeer];
  /** localStorage key suffix ("" keeps BTC on its legacy keys). */
  storageSuffix: string;
}

export const COINS: Record<CoinId, CoinConfig> = {
  BTC: {
    id: "BTC",
    name: "Bitcoin",
    symbol: "BTCUSDT",
    pair: "BTC/USDT",
    contract: "0x48781a7d35f6137a9135Bbb984AF65fd6AB25618",
    peers: [
      { id: "ETH", symbol: "ETHUSDT" },
      { id: "SOL", symbol: "SOLUSDT" },
    ],
    storageSuffix: "",
  },
  BNB: {
    id: "BNB",
    name: "BNB",
    symbol: "BNBUSDT",
    pair: "BNB/USDT",
    contract: "0x18B2A687610328590Bc8F2e5fEdDe3b582A49cdA",
    peers: [
      { id: "BTC", symbol: "BTCUSDT" },
      { id: "ETH", symbol: "ETHUSDT" },
    ],
    storageSuffix: ":bnb",
  },
  ETH: {
    id: "ETH",
    name: "Ethereum",
    symbol: "ETHUSDT",
    pair: "ETH/USDT",
    contract: "0x7451F994A8D510CBCB46cF57D50F31F188Ff58F5",
    peers: [
      { id: "BTC", symbol: "BTCUSDT" },
      { id: "SOL", symbol: "SOLUSDT" },
    ],
    storageSuffix: ":eth",
  },
};

export const COIN_IDS: CoinId[] = ["BTC", "BNB", "ETH"];

const COIN_STORAGE_KEY = "pea_selected_coin_v1";

/** Loads the last selected coin from localStorage (defaults to BTC). */
export function loadSelectedCoin(): CoinId {
  try {
    const raw = localStorage.getItem(COIN_STORAGE_KEY);
    if (raw === "BTC" || raw === "BNB" || raw === "ETH") return raw;
  } catch {
    // storage unavailable — default
  }
  return "BTC";
}

/** Persists the selected coin. */
export function saveSelectedCoin(id: CoinId): void {
  try {
    localStorage.setItem(COIN_STORAGE_KEY, id);
  } catch {
    // storage unavailable — non-fatal
  }
}
