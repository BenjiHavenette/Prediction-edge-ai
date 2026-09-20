/**
 * Reads live round data directly from a PancakeSwap Prediction contract
 * (PancakePredictionV2) on BNB Chain, so the app's round number, lock price
 * and countdown match pancakeswap.finance exactly. The contract address is
 * passed per asset (BTCUSD, BNBUSD, ETHUSD).
 */

/** keccak-256 selectors: currentEpoch() and rounds(uint256). */
const SEL_CURRENT_EPOCH = "0x76671808";
const SEL_ROUNDS = "0x8c65c81f";

/** Public BSC JSON-RPC endpoints (CORS-enabled), tried in order. */
const RPC_URLS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
];

let rpcIndex = 0;

/** The round currently open for betting on PancakeSwap (locks when the live round closes). */
export interface NextChainRound {
  /** PancakeSwap round number (epoch) of the bettable round. */
  epoch: number;
  /** When betting closes and this round locks (lockTimestamp), ms. */
  lockTime: number;
  /** When this round will close, ms. */
  closeTime: number;
  /** Total prize pool committed so far, BNB. */
  totalBnb: number;
  /** Amount staked on UP so far, BNB. */
  bullBnb: number;
  /** Amount staked on DOWN so far, BNB. */
  bearBnb: number;
}

export interface ChainRound {
  /** PancakeSwap round number (epoch), e.g. 85850. */
  epoch: number;
  /** Live phase start (lockTimestamp), ms. */
  startTime: number;
  /** Live phase end (closeTimestamp), ms. */
  closeTime: number;
  /** Chainlink lock price in USD (0 if not yet recorded). */
  lockPrice: number;
  /** Total prize pool for the live round, BNB. */
  totalBnb: number;
  /** Amount staked on UP, BNB. */
  bullBnb: number;
  /** Amount staked on DOWN, BNB. */
  bearBnb: number;
  /** The NEXT round (currently open for betting), or null if unavailable. */
  next: NextChainRound | null;
  /** Local time when this data was fetched, ms. */
  fetchedAt: number;
  /**
   * Correction to add to the device clock so it matches BNB Chain time, ms.
   * Non-zero when the local clock is skewed vs the blockchain.
   */
  clockOffsetMs: number;
}

async function rpcRequestOnce(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.result === undefined || json.result === null) {
      throw new Error(json.error?.message ?? "Bad RPC response");
    }
    return json.result;
  } finally {
    window.clearTimeout(timer);
  }
}

/** JSON-RPC request with automatic failover across public RPC endpoints. */
async function rpcRequest(method: string, params: unknown[]): Promise<unknown> {
  let lastError: unknown = null;
  for (let i = 0; i < RPC_URLS.length; i++) {
    const rpc = RPC_URLS[(rpcIndex + i) % RPC_URLS.length];
    try {
      const result = await rpcRequestOnce(rpc, method, params);
      rpcIndex = (rpcIndex + i) % RPC_URLS.length;
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All BSC RPC endpoints failed");
}

async function ethCall(contract: string, data: string): Promise<string> {
  const result = await rpcRequest("eth_call", [{ to: contract, data }, "latest"]);
  if (typeof result !== "string" || !result.startsWith("0x")) {
    throw new Error("Bad eth_call response");
  }
  return result;
}

/**
 * Estimates how far the device clock is from BNB Chain time by reading the
 * latest block timestamp. Returns a correction in ms to ADD to Date.now().
 * Small skews (within block-production noise) are treated as zero.
 */
async function fetchClockOffsetMs(): Promise<number> {
  const t0 = Date.now();
  const block = (await rpcRequest("eth_getBlockByNumber", ["latest", false])) as { timestamp?: string };
  const t1 = Date.now();
  if (typeof block.timestamp !== "string") throw new Error("Bad block response");
  const blockMs = Number(BigInt(block.timestamp)) * 1000;
  const localMid = (t0 + t1) / 2;
  const offset = blockMs - localMid;
  // Block timestamps lag real time by up to a few seconds; ignore tiny skews.
  return Math.abs(offset) < 3000 ? 0 : offset;
}

function hexWords(result: string): bigint[] {
  const hex = result.slice(2);
  const words: bigint[] = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) {
    words.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  }
  return words;
}

interface RawRound {
  epoch: number;
  lockTs: number;
  closeTs: number;
  lockPrice: number;
  totalBnb: number;
  bullBnb: number;
  bearBnb: number;
}

async function fetchRound(contract: string, epoch: number): Promise<RawRound> {
  const arg = epoch.toString(16).padStart(64, "0");
  const words = hexWords(await ethCall(contract, `${SEL_ROUNDS}${arg}`));
  if (words.length < 14) throw new Error("Unexpected round struct size");
  // Round struct: [epoch, startTs, lockTs, closeTs, lockPrice(1e8), closePrice(1e8),
  //                lockOracleId, closeOracleId, totalAmount(1e18), bullAmount(1e18), bearAmount(1e18), ...]
  return {
    epoch: Number(words[0]),
    lockTs: Number(words[2]) * 1000,
    closeTs: Number(words[3]) * 1000,
    lockPrice: Number(words[4]) / 1e8,
    totalBnb: Number(words[8]) / 1e18,
    bullBnb: Number(words[9]) / 1e18,
    bearBnb: Number(words[10]) / 1e18,
  };
}

/**
 * Fetches the round currently in its LIVE phase on PancakeSwap.
 * `currentEpoch` is the betting round; the live round is `currentEpoch - 1`.
 */
export async function fetchLiveChainRound(contract: string): Promise<ChainRound> {
  const [epochResult, clockOffsetMs] = await Promise.all([
    ethCall(contract, SEL_CURRENT_EPOCH),
    fetchClockOffsetMs().catch(() => 0),
  ]);
  const epochWords = hexWords(epochResult);
  const currentEpoch = Number(epochWords[0] ?? 0n);
  if (!Number.isFinite(currentEpoch) || currentEpoch < 2) {
    throw new Error("Invalid currentEpoch from contract");
  }
  const [live, betting] = await Promise.all([
    fetchRound(contract, currentEpoch - 1),
    fetchRound(contract, currentEpoch).catch(() => null),
  ]);
  if (live.lockTs <= 0 || live.closeTs <= live.lockTs) {
    throw new Error("Live round has no valid timestamps");
  }
  const next: NextChainRound | null =
    betting !== null && betting.lockTs > 0
      ? {
          epoch: betting.epoch,
          lockTime: betting.lockTs,
          closeTime: betting.closeTs,
          totalBnb: betting.totalBnb,
          bullBnb: betting.bullBnb,
          bearBnb: betting.bearBnb,
        }
      : null;
  return {
    epoch: live.epoch,
    startTime: live.lockTs,
    closeTime: live.closeTs,
    lockPrice: live.lockPrice,
    totalBnb: live.totalBnb,
    bullBnb: live.bullBnb,
    bearBnb: live.bearBnb,
    next,
    fetchedAt: Date.now(),
    clockOffsetMs,
  };
}
