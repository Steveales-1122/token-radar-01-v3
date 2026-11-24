// Token Radar v3 — empirical calibration model (Node 22, standard library only).
//
// v2 priced every protocol with hand-written multiples per category: a judgement
// table. v3 calibrates from the snapshot itself. For each category it takes the
// protocols in this snapshot that already have a token, computes the ratio
// market-cap / TVL for each of them, and uses the median ratio as that
// category's multiple. A category with fewer than 3 priced peers falls back to
// the global median across all priced protocols, and the dashboard says so.
// The 25th/75th percentiles of the same peer set give a low/high value range,
// so every implied value on the board carries its own uncertainty band.
//
// implied = TVL x category multiple x momentum x maturity x risk
//   momentum: 7-day TVL change, clamped to [-50%, +100%], mapped to [0.75, 1.50]
//   maturity: days since listing — young protocols are discounted, proven ones
//             earn a small premium
//   risk:     chain spread — a protocol live on 3+ chains earns a premium over
//             a single-chain one
//
// The board ranks the watchlist plus every other pre-token protocol below the
// floor that could plausibly launch a token of its own. The house's own
// watchlist logic decides plausibility: a wrapped, staked or bridged product
// of a token that already trades, a versioned copy, or a centralised exchange
// is not a protocol still waiting on a launch of its own — WBTC is Bitcoin on
// Ethereum, a chain bridge is chain infrastructure, a CEX is a company, not a
// launch candidate. Ranking those by TVL would put WBTC and the chain bridges
// at the top of the board and the radar would be a TVL sort, not a radar.
// That leaves 158 eligible protocols below the floor, so the board has 198
// rows: the whole 40-protocol watchlist plus those 158.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface PeerStats {
  category: string;
  n: number;
  median: number;
  p25: number;
  p75: number;
  fallback: boolean;
}

export interface Calibration {
  global: PeerStats;
  byCategory: Map<string, PeerStats>;
}

export interface ValueBreakdown {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  momentum: number;
  maturity: number;
  risk: number;
  age: number | null;
  peers: number;
  p25: number;
  p75: number;
  fallback: boolean;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  low_usd: number;
  high_usd: number;
  multiple: number;
  momentum: number;
  maturity: number;
  risk: number;
  peers: number;
  p25: number;
  p75: number;
  fallback: boolean;
  watchlist: boolean;
  listed_at: string | null;
  age: number | null;
}

export interface RadarRow extends BoardRow {
  breakdown: string[];
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  model: string;
  counts: { watchlist: number; board: number; pre_token: number; priced_peers: number };
  calibration: PeerStats[];
  rows: RadarRow[];
}

export const MODEL_VERSION = 'radar-3-empirical';
export const MIN_PEERS = 3;

/** The house's watchlist logic, applied to the below-floor picks: a protocol
 *  is a launch candidate unless it is a wrapped/staked/bridged product of a
 *  token that already trades, a versioned copy, or a centralised exchange. */
const NON_CANDIDATE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (p.category !== null && NON_CANDIDATE_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

export class SnapshotError extends Error {}

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function statsFor(category: string, ratios: number[], fallback: PeerStats | null): PeerStats {
  const sorted = [...ratios].sort((a, b) => a - b);
  if (sorted.length >= MIN_PEERS) {
    return { category, n: sorted.length, median: median(sorted), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75), fallback: false };
  }
  const g = fallback!;
  return { category, n: sorted.length, median: g.median, p25: g.p25, p75: g.p75, fallback: true };
}

/** Calibrate multiples from the snapshot's own priced protocols. */
export function calibrate(snapshot: Snapshot): Calibration {
  const priced = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const allRatios = priced.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global: PeerStats = {
    category: 'All priced protocols',
    n: allRatios.length,
    median: median(allRatios),
    p25: quantile(allRatios, 0.25),
    p75: quantile(allRatios, 0.75),
    fallback: false,
  };
  const byCategory = new Map<string, PeerStats>();
  const cats = new Map<string, number[]>();
  for (const p of priced) {
    const c = p.category ?? 'Uncategorised';
    const list = cats.get(c) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    cats.set(c, list);
  }
  for (const [c, ratios] of cats) byCategory.set(c, statsFor(c, ratios, global));
  return { global, byCategory };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const ms = Date.parse(asOf) - Date.parse(listedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Price one protocol. Every factor is stated on the dashboard's detail view. */
export function impliedValue(p: SnapshotProtocol, cal: Calibration, asOf: string): ValueBreakdown {
  const cat = p.category ?? 'Uncategorised';
  const st = cal.byCategory.get(cat) ?? statsFor(cat, [], cal.global);
  const momentum = p.change_7d === null ? 1 : 1 + clamp(p.change_7d, -50, 100) / 200;
  const age = ageDays(asOf, p.listed_at);
  const maturity = age === null ? 0.95 : age < 90 ? 0.85 : age < 365 ? 0.95 : age <= 1095 ? 1.05 : 1.1;
  const risk = p.chains.length >= 3 ? 1.05 : p.chains.length === 2 ? 1 : 0.95;
  const base = (r: number): number => Math.max(1, Math.round(p.tvl_usd * r * momentum * maturity * risk));
  return {
    implied: base(st.median),
    low: base(st.p25),
    high: base(st.p75),
    multiple: st.median,
    momentum,
    maturity,
    risk,
    age,
    peers: st.n,
    p25: st.p25,
    p75: st.p75,
    fallback: st.fallback,
  };
}

const CATEGORY_STEPS: Record<string, string[]> = {
  Dexs: [
    'Swap a small amount on {name} twice a month on {chain}, using different token pairs each time so the volume looks like real trading rather than one repeated route.',
    'Add a modest amount of liquidity to one {name} pool on {chain} and leave it in place for several weeks, collecting any fees instead of entering and exiting daily.',
  ],
  Lending: [
    'Supply collateral to {name} on {chain} and keep the position open for several weeks, topping it up once so the account shows a sustained deposit rather than a flash loan.',
    'Borrow a small amount against the deposit on {name}, repay it in full, and repeat once a month to record genuine borrow-and-repay activity.',
  ],
  Yield: [
    'Deposit into one {name} vault on {chain} and hold the position for at least a month, harvesting any yield back into the same vault instead of withdrawing it at once.',
    'Try a second {name} strategy on {chain} with a different asset so the account shows more than one vault interaction over time.',
  ],
  Bridge: [
    'Bridge a small amount through {name} to {chain} once a month, varying the destination chain when the route supports it, and keep the transaction hashes.',
    'Use {name} for a real transfer you actually need, such as moving funds to {chain} for another position, rather than bridging back and forth for its own sake.',
  ],
  RWA: [
    'Complete the identity and onboarding steps {name} asks for on {chain}, then hold a small position in one tokenised asset for several weeks.',
    'Reinvest one distribution or yield payout from {name} back into the same asset to show a holding pattern instead of a single purchase.',
  ],
  Restaking: [
    'Restake a small amount through {name} on {chain} and leave it staked for at least a month, then claim any rewards once rather than compounding daily.',
    'Delegate to a second operator on {name} if the protocol supports it, so the account is not a single-deposit, single-operator record.',
  ],
};

function categorySteps(p: SnapshotProtocol): string[] {
  const key = p.category ?? '';
  const steps = CATEGORY_STEPS[key];
  if (steps !== undefined) return steps;
  return [
    'Use the core feature of {name} on {chain} twice a month with a real position, varying the amount and the asset so the activity reads as genuine use.',
    'Try a second feature of {name} on {chain}, such as a different pool, market or product line, so the account is not a single-action record.',
  ];
}

function fill(template: string, p: SnapshotProtocol): string {
  const chain = p.chains[0] ?? 'its main chain';
  return template.replaceAll('{name}', p.name).replaceAll('{chain}', chain);
}

/** 7 concrete farm steps, each 20–600 characters once trimmed. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const raw: string[] = [
    `Set up a fresh wallet for farming ${p.name} and fund it with only enough ${chain} gas money for a few weeks of transactions, keeping the main holdings in a separate wallet.`,
    `Bridge a modest amount of stablecoins to ${chain} for ${p.name} and keep the transfer receipt, so the account starts with a funded, traceable arrival rather than an empty wallet.`,
    ...categorySteps(p),
    `Repeat one real transaction on ${p.name} every week for at least eight weeks, so the activity reads as a sustained user pattern instead of a single-day burst.`,
    `Complete every official quest, role and feedback task ${p.name} publishes, and save a dated screenshot of each completion as proof of the work.`,
    `Before any token launch, re-check ${p.name} through its official announcements, revoke any approval no longer in use, and never sign a blind transaction or share a seed phrase.`,
  ];
  return raw.map((s) => fill(s, p));
}

export function breakdownLines(row: BoardRow): string[] {
  const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
  const cat = row.category ?? 'Uncategorised';
  const peerNote = row.fallback
    ? `only ${row.peers} priced peer${row.peers === 1 ? '' : 's'} in ${cat}, so the global median is used`
    : `${row.peers} priced peers in ${cat}`;
  return [
    `TVL ${money(row.tvl_usd)} x category multiple ${row.multiple.toFixed(3)} (${cat} median, ${peerNote})`,
    `x momentum ${row.momentum.toFixed(2)} (${row.change_7d === null ? 'no 7-day change reported' : `${row.change_7d > 0 ? '+' : ''}${row.change_7d.toFixed(1)}% TVL in 7 days`})`,
    `x maturity ${row.maturity.toFixed(2)} (${row.age === null ? 'listing date not reported' : `listed ${row.age} days ago`})`,
    `x risk ${row.risk.toFixed(2)} (live on ${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}: ${row.chains.slice(0, 3).join(', ')}${row.chains.length > 3 ? ', …' : ''})`,
    `= implied value ${money(row.implied_value_usd)} — range ${money(row.low_usd)} to ${money(row.high_usd)} from the peers' 25th to 75th percentile (multiple ${row.p25.toFixed(3)} to ${row.p75.toFixed(3)})`,
  ];
}

/** Build the board: the whole watchlist + every launch candidate below the floor. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const cal = calibrate(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = snapshot.watchlist.map((s) => bySlug.get(s)!).filter(Boolean);
  const watchSlugs = new Set(watch.map((p) => p.slug));
  const rest = snapshot.protocols
    .filter((p) => isPreToken(p) && !watchSlugs.has(p.slug) && isLaunchCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
  const picked = [...watch, ...rest];
  const rows: BoardRow[] = picked.map((p) => {
    const v = impliedValue(p, cal, snapshot.as_of);
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: v.implied,
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      low_usd: v.low,
      high_usd: v.high,
      multiple: v.multiple,
      momentum: v.momentum,
      maturity: v.maturity,
      risk: v.risk,
      peers: v.peers,
      p25: v.p25,
      p75: v.p75,
      fallback: v.fallback,
      watchlist: watchSlugs.has(p.slug),
      listed_at: p.listed_at,
      age: v.age,
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const cal = calibrate(snapshot);
  const table: PeerStats[] = [...cal.byCategory.values()].sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const rows: RadarRow[] = board.map((r) => ({ ...r, breakdown: breakdownLines(r) }));
  const preToken = snapshot.protocols.filter(isPreToken);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: MODEL_VERSION,
    counts: {
      watchlist: snapshot.watchlist.length,
      board: board.length,
      pre_token: preToken.length,
      priced_peers: cal.global.n,
    },
    calibration: table,
    rows,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  const s = raw as Snapshot;
  if (typeof s !== 'object' || s === null || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot has no protocols/watchlist arrays');
  }
  return s;
}

/** The gate's shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!slugs.has(r.slug)) return `unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!r.name) return `empty name for ${r.slug}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `bad implied value for ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `bad farm step count for ${r.slug}`;
    for (const st of r.farm_steps) {
      const t = st.trim();
      if (t.length < 20 || t.length > 600) return `farm step length ${t.length} for ${r.slug}`;
    }
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${board[i]!.rank} at position ${i + 1}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'all implied values equal';
  for (const w of snapshot.watchlist) if (!seen.has(w)) return `watchlist slug ${w} missing`;
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR = ${JSON.stringify(radar)};\n`;
}
