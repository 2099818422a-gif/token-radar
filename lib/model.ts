// Token Radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by an implied value that is derived, never
// asserted, from the snapshot's own figures. The derivation has three visible parts:
//
//   1. category multiple — what the market already pays for a dollar of TVL in this
//      protocol's category: the median mcap/tvl of the live-token protocols in the
//      same category (at least 3 of them, else the global median), clamped to
//      [0.05, 1.00] so a thin category cannot explode the number. See categoryMultiple.
//   2. growth — the protocol's own 7-day TVL change, clamped to [-50, +100]%, half
//      weight: growthMultiplier = 1 + 0.5 * clampedChange / 100.
//   3. maturity — how long the protocol has run with no token: age since listed_at,
//      maturityMultiplier = 0.7 + 0.6 * min(ageDays, 1460) / 1460, so a protocol
//      that has survived four tokenless years scores 1.3x a brand-new one.
//
//   implied_value_usd = round(tvl_usd * multiple * growthMultiplier * maturityMultiplier)
//
// No protocol name is ever special-cased: the same three functions score every row.
// Live-token protocols are kept apart and shown with their market cap, never mixed
// into the ranked board. The farm plan is derived the same way, from category,
// chains, TVL and age, with a per-chain gas table — see farmSteps.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard beside the formula. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  min_live_for_category: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_live_for_category: 3,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.6,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it next to the formula. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 210;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's market multiple, for the dashboard's model panel. */
export interface CategoryMultiple {
  category: string;
  live_count: number;
  multiple: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The market's price for a dollar of TVL, per category: the median mcap/tvl of the
 * live-token protocols in that category when at least `min_live_for_category` of
 * them report both figures, else the global median across all live protocols.
 * Clamped to [multiple_floor, multiple_cap] so a category with two outliers
 * (a tiny TVL and a huge market cap) cannot set a absurd multiple.
 */
export function categoryMultiple(
  category: string | null,
  live: SnapshotProtocol[],
  model: ModelConstants,
): { multiple: number; liveCount: number; global: number } {
  const ratios = (ps: SnapshotProtocol[]): number[] =>
    ps.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0).map((p) => p.mcap_usd! / p.tvl_usd);
  const global = median(ratios(live));
  const same = live.filter((p) => (p.category ?? 'Other') === (category ?? 'Other'));
  const sameRatios = ratios(same);
  const picked = same.length >= model.min_live_for_category && sameRatios.length > 0 ? median(sameRatios) : global;
  const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, picked));
  return { multiple: round4(multiple), liveCount: same.length, global: round4(global) };
}

/** The growth factor: the protocol's 7-day TVL change, clamped, at half weight. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(change7d, 0)));
  return { pct, mult: round4(1 + (pct / 100) * model.growth_weight) };
}

/** The maturity factor: longer tokenless survival earns a higher multiple, capped at 4 years. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  return round4(model.maturity_floor + (Math.min(Math.max(days, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  live: SnapshotProtocol[],
  model: ModelConstants,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple } = categoryMultiple(protocol.category, live, model);
  const { pct: growthPct, mult: growthMult } = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, live, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// ---------------------------------------------------------------- farm plans

/** Typical gas for one transaction on a chain, in whole US dollars. */
const GAS_USD: Record<string, number> = {
  Ethereum: 4,
  Base: 0.15,
  Arbitrum: 0.2,
  Optimism: 0.15,
  'zkSync Era': 0.25,
  Linea: 0.2,
  Blast: 0.15,
  Scroll: 0.3,
  Polygon: 0.05,
  BSC: 0.3,
  'BNB Chain': 0.3,
  Avalanche: 0.5,
  Solana: 0.02,
  Sui: 0.05,
  Aptos: 0.05,
  Tron: 1,
  Fantom: 0.1,
  Gnosis: 0.1,
  Mantle: 0.1,
  Mode: 0.1,
  Berachain: 0.1,
  Hyperliquid: 0.05,
  Unichain: 0.15,
  Ink: 0.15,
  Sei: 0.05,
  Sonic: 0.1,
  Monad: 0.05,
};

/** Gas for one transaction on the protocol's first chain, or $1 when the chain is unnamed. */
function gasFor(p: SnapshotProtocol): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_USD[chain] ?? 1;
}

/** A gas cost as words, so the plan reads the same on a $0.02 chain and a $4 one. */
function gasWords(gas: number): string {
  if (gas < 0.1) return `about $${gas.toFixed(2)} of gas`;
  if (gas < 1) return `about $${gas.toFixed(2)} of gas`;
  return `about $${gas.toFixed(0)} of gas`;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${n} on ${chain} as collateral, then borrow $20 of USDC against it and repay it the same week.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${n}'s largest pool on ${chain} (a USDC pair if one exists) and keep the LP tokens.`;
  }
  if (c.includes('yield aggregator') || c.includes('leveraged farm')) {
    return `Deposit $${capital} of USDC into ${n}'s highest-TVL vault on ${chain} and leave auto-compounding on.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and keep the receipt tokens.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position of $25 notional.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} with USDC and hold it in the farm wallet.`;
  }
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) {
    return `Deposit $${capital} of USDC into a ${n} curator vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  }
  if (c.includes('restak') || c.includes('staking pool')) {
    return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${n} on ${chain} for a protocol you already use, and keep the policy active.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Fund $${capital} into ${n} on ${chain} and make one real payment or card top-up from the farm wallet.`;
  }
  if (c.includes('stablecoin')) {
    return `Mint $${capital} of ${n}'s stable asset on ${chain} with USDC and hold it in the farm wallet.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds in its own app once.`;
  }
  if (c.includes('chain')) {
    return `Move $${capital} of USDC onto ${n} and use it in the chain's flagship app once, keeping the wallet funded.`;
  }
  if (c.includes('governance')) {
    return `Deposit $${capital} of USDC into ${n} on ${chain} and vote once on an open proposal from the farm wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${n} with $${capital} on ${chain} and place one small position on a market that settles within a month.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${capital} of USDC in ${n}'s launch pool on ${chain} to qualify for an allocation.`;
  }
  if (c.includes('farm')) {
    return `Deposit $${capital} of USDC into ${n}'s main farm on ${chain} and stake the LP receipt.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${n}'s index token on ${chain} and hold it in the farm wallet.`;
  }
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action, so the plan is more than one deposit. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $10 of USDC against the collateral on ${n}, hold it a day, then repay it in full.`;
  if (c.includes('dex')) return `Swap $25 of USDC for another asset on ${n} on ${chain} and swap it back the next day.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Claim the vault's rewards on ${n} once and redeposit them into the same vault.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the hedge on ${n} at a small profit or loss and open a fresh one half the size.`;
  if (c.includes('rwa')) return `Check ${n}'s yield accrual on ${chain} once a week and record the balance in the farm log.`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) return `Move a quarter of the position into a second ${n} vault on ${chain} to show more than one vault.`;
  if (c.includes('basis')) return `Top the ${n} vault up by $25 after the first funding cycle settles.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Restake the receipt token once through ${n} on ${chain} instead of holding it idle.`;
  if (c.includes('insurance')) return `Renew or extend the ${n} cover once before it lapses, even for a small amount.`;
  if (c.includes('payment') || c.includes('card')) return `Make a second small payment with ${n} on ${chain} in a different week from the first.`;
  if (c.includes('stablecoin')) return `Swap half the minted stable asset back to USDC on ${n} and mint it again the following week.`;
  if (c.includes('bridge')) return `Bridge $25 back through ${n} to the chain you started from, so the flow runs both ways.`;
  if (c.includes('chain')) return `Send one transaction a week on ${n} from the farm wallet, even a $1 transfer to yourself.`;
  if (c.includes('governance')) return `Delegate the position's voting power once on ${n} and vote on the next proposal yourself.`;
  if (c.includes('prediction')) return `Settle or close the ${n} position when its market resolves, then open one more small one.`;
  if (c.includes('launchpad')) return `Join a second ${n} pool on ${chain} with $25 once the first allocation is recorded.`;
  if (c.includes('farm')) return `Harvest the ${n} farm rewards once and stake them again instead of selling.`;
  if (c.includes('index')) return `Rebalance the ${n} index holding once by adding $25 after a month.`;
  return `Make one more deposit of $25 into ${n} on ${chain} in a different week from the first.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names. Gas comes from the chain's own typical fee.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(p);
  const gw = gasWords(gas);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the $${capital} you plan to farm with, and keep its seed phrase offline on paper.`,
      cost: `${gw} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC onto ${chain} from an exchange or another chain, and confirm it arrived before doing anything else.`,
      cost: 'about $2 to $5 of bridge or withdrawal fees',
      time: '10 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and ${gw}`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, chain),
      cost: gw,
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week — a deposit, a swap, a vote or a claim — so the wallet shows steady use, not one burst.`,
      cost: `${gw} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's dashboard form, with its farm plan and model breakdown. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const liveProtos = snapshot.protocols.filter((p) => !isPreToken(p));
  const { global } = categoryMultiple(null, liveProtos, model);
  const cats = new Map<string, number>();
  for (const r of board) cats.set(r.category ?? 'Other', (cats.get(r.category ?? 'Other') ?? 0) + 1);
  const multiples: CategoryMultiple[] = [...cats.entries()]
    .map(([category]) => {
      const { multiple, liveCount } = categoryMultiple(category === 'Other' ? null : category, liveProtos, model);
      return { category, live_count: liveCount, multiple };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: global,
    multiples,
    watchlist: [...snapshot.watchlist],
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
