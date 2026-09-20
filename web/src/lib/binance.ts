import type { Candle } from "./types";

interface MarketEndpoint {
  name: string;
  rest: string;
  ws: string;
}

/**
 * Ordered fallback list. api.binance.com is geo-blocked in some regions
 * (e.g. the US returns HTTP 451), so we probe each endpoint and use the
 * first one that responds. data-api.binance.vision mirrors global market
 * data and is not geo-fenced; binance.us covers US users as a last resort.
 */
const ENDPOINTS: MarketEndpoint[] = [
  { name: "binance-vision", rest: "https://data-api.binance.vision/api/v3", ws: "wss://data-stream.binance.vision/stream" },
  { name: "binance-global", rest: "https://api.binance.com/api/v3", ws: "wss://stream.binance.com:9443/stream" },
  { name: "binance-us", rest: "https://api.binance.us/api/v3", ws: "wss://stream.binance.us:9443/stream" },
];

let activeEndpoint: MarketEndpoint | null = null;
let probePromise: Promise<MarketEndpoint> | null = null;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function probeEndpoints(): Promise<MarketEndpoint> {
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(`${ep.rest}/klines?symbol=BTCUSDT&interval=1m&limit=1`, 6000);
      if (res.ok) {
        console.log(`Market data endpoint selected: ${ep.name}`);
        return ep;
      }
      console.warn(`Market endpoint ${ep.name} responded ${res.status}, trying next`);
    } catch {
      console.warn(`Market endpoint ${ep.name} unreachable, trying next`);
    }
  }
  throw new Error("All market data endpoints unreachable");
}

/** Resolves (and caches) the first reachable market data endpoint. */
async function resolveEndpoint(): Promise<MarketEndpoint> {
  if (activeEndpoint) return activeEndpoint;
  if (!probePromise) {
    probePromise = probeEndpoints()
      .then((ep) => {
        activeEndpoint = ep;
        return ep;
      })
      .finally(() => {
        probePromise = null;
      });
  }
  return probePromise;
}

/** Clears the cached endpoint so the next call re-probes all hosts. */
function resetEndpoint(): void {
  activeEndpoint = null;
}

interface RawKline extends Array<string | number> {}

function mapKline(k: RawKline): Candle {
  return {
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  };
}

/** Fetches up to 1000 klines ending at `endTime` (or now). */
export async function fetchKlines(symbol: string, interval: string, limit: number, endTime?: number): Promise<Candle[]> {
  const ep = await resolveEndpoint();
  const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(limit, 1000)) });
  if (endTime !== undefined) params.set("endTime", String(endTime));
  const res = await fetchWithTimeout(`${ep.rest}/klines?${params.toString()}`, 15000);
  if (!res.ok) {
    resetEndpoint();
    throw new Error(`Klines request failed on ${ep.name}: ${res.status}`);
  }
  const raw = (await res.json()) as RawKline[];
  return raw.map(mapKline);
}

/** Fetches `total` klines by paging backwards in batches of 1000. */
export async function fetchKlinesDeep(symbol: string, interval: string, total: number): Promise<Candle[]> {
  let out: Candle[] = [];
  let endTime: number | undefined = undefined;
  while (out.length < total) {
    const batch = await fetchKlines(symbol, interval, Math.min(1000, total - out.length), endTime);
    if (batch.length === 0) break;
    out = [...batch, ...out];
    endTime = batch[0].time - 1;
    if (batch.length < 1000) break;
  }
  return out;
}

export interface KlineUpdate {
  symbol: string;
  candle: Candle;
  closed: boolean;
}

interface StreamMessage {
  data?: {
    s?: string;
    k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
  };
}

/**
 * Opens a combined 1m kline WebSocket stream for the given symbols
 * with automatic exponential-backoff reconnection. Returns a disposer.
 */
export function openMarketStream(
  symbols: string[],
  onKline: (update: KlineUpdate) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let timer: number | null = null;

  const connect = async (): Promise<void> => {
    let ep: MarketEndpoint;
    try {
      // Re-probe endpoints after repeated failures in case the host went down.
      if (retry >= 3) resetEndpoint();
      ep = await resolveEndpoint();
    } catch {
      if (stopped) return;
      const delay = Math.min(15000, 1000 * 2 ** retry);
      retry++;
      timer = window.setTimeout(() => void connect(), delay);
      return;
    }
    if (stopped) return;
    const streams = symbols.map((s) => `${s.toLowerCase()}@kline_1m`).join("/");
    ws = new WebSocket(`${ep.ws}?streams=${streams}`);
    ws.onopen = () => {
      retry = 0;
      onStatus(true);
    };
    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as StreamMessage;
        const k = msg.data?.k;
        const s = msg.data?.s;
        if (!k || !s) return;
        onKline({
          symbol: s,
          candle: {
            time: k.t,
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          },
          closed: k.x,
        });
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      onStatus(false);
      if (!stopped) {
        const delay = Math.min(15000, 1000 * 2 ** retry);
        retry++;
        timer = window.setTimeout(() => void connect(), delay);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
  };

  void connect();

  return () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}

export interface GlobalMarketData {
  totalMarketCap: number;
  marketCapChange24h: number;
  usdtDominance: number;
  btcDominance: number;
}

interface CoinGeckoGlobal {
  data?: {
    total_market_cap?: { usd?: number };
    market_cap_change_percentage_24h_usd?: number;
    market_cap_percentage?: { usdt?: number; btc?: number };
  };
}

/** Fetches total crypto market cap and USDT dominance from CoinGecko. */
export async function fetchGlobalMarket(): Promise<GlobalMarketData> {
  const res = await fetch("https://api.coingecko.com/api/v3/global");
  if (!res.ok) throw new Error(`CoinGecko global failed: ${res.status}`);
  const json = (await res.json()) as CoinGeckoGlobal;
  return {
    totalMarketCap: json.data?.total_market_cap?.usd ?? 0,
    marketCapChange24h: json.data?.market_cap_change_percentage_24h_usd ?? 0,
    usdtDominance: json.data?.market_cap_percentage?.usdt ?? 0,
    btcDominance: json.data?.market_cap_percentage?.btc ?? 0,
  };
}
