import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import {
  componentFailure,
  componentSuccess,
  type DisplayComponentResult,
} from "./component-result.js";

const PolymarketGraphSeriesOptions = ["yes_price", "volume"] as const;

export const PolymarketGraphDisplayComponentConfigSchema = z.object({
  kind: z.literal("polymarket_graph_display"),
  market_slug: z.string().trim().min(1),
  lookback_hours: z.number().positive().default(24),
  series: z.enum(PolymarketGraphSeriesOptions).default("yes_price"),
  title: z.string().trim().min(1).optional(),
  show_axes: z.boolean().default(true),
  show_last_value: z.boolean().default(true),
});

export type PolymarketGraphDisplayComponentConfig = z.infer<typeof PolymarketGraphDisplayComponentConfigSchema>;

type ChartPoint = {
  t: number;
  value: number;
};

type GammaMarket = {
  question?: string | null;
  slug?: string | null;
  conditionId?: string | null;
  outcomes?: string | null;
  outcomePrices?: string | null;
  clobTokenIds?: string | null;
};

type PolymarketSeries = {
  title: string;
  subtitle: string;
  unitLabel: string;
  points: ChartPoint[];
  latestValue: number | null;
  clampMinToZero: boolean;
};

const EINK_BACKGROUND = "#fff";
const EINK_FOREGROUND = "#000";
const AXIS_COLOUR = "#808080";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const CLOB_BASE_URL = "https://clob.polymarket.com";
const DATA_BASE_URL = "https://data-api.polymarket.com";

const GRAPH_WIDTH = 720;
const GRAPH_HEIGHT = 280;
const GRAPH_PADDING_LEFT = 8;
const GRAPH_PADDING_RIGHT = 8;
const GRAPH_PADDING_TOP = 8;
const GRAPH_PADDING_BOTTOM = 8;
const MAX_POINTS = 64;
const MAX_TRADE_PAGES = 20;
const TRADE_PAGE_SIZE = 500;

const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

const COMPACT_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const HOUR_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} from ${url.origin}${url.pathname}${body ? `: ${body}` : ""}`);
  }

  return response.json() as Promise<T>;
}

function parseArrayLike(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
  } catch {
    return [];
  }
  return [];
}

function normalizeYesOutcomeIndex(outcomes: string[]): number {
  const idx = outcomes.findIndex((outcome) => outcome.trim().toLowerCase() === "yes");
  return idx >= 0 ? idx : 0;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function getGammaMarketBySlug(slug: string): Promise<GammaMarket> {
  const bySlugUrl = new URL(`/markets/slug/${encodeURIComponent(slug)}`, GAMMA_BASE_URL);
  try {
    return await fetchJson<GammaMarket>(bySlugUrl);
  } catch {
    const fallback = new URL("/markets", GAMMA_BASE_URL);
    fallback.searchParams.set("slug", slug);
    const list = await fetchJson<GammaMarket[] | { data?: GammaMarket[] }>(fallback);
    if (Array.isArray(list) && list.length > 0) return list[0];
    if (!Array.isArray(list) && Array.isArray(list.data) && list.data.length > 0) return list.data[0];
    throw new Error(`Market slug not found: ${slug}`);
  }
}

function pickYesTokenId(market: GammaMarket): string | null {
  const outcomes = parseArrayLike(market.outcomes);
  const tokenIds = parseArrayLike(market.clobTokenIds);
  if (tokenIds.length === 0) return null;
  const yesIdx = normalizeYesOutcomeIndex(outcomes);
  return tokenIds[yesIdx] ?? tokenIds[0] ?? null;
}

function pickCurrentYesPrice(market: GammaMarket): number | null {
  const outcomes = parseArrayLike(market.outcomes);
  const prices = parseArrayLike(market.outcomePrices)
    .map((raw) => toNumber(raw))
    .filter((value): value is number => value !== null);
  if (prices.length === 0) return null;
  const yesIdx = normalizeYesOutcomeIndex(outcomes);
  const value = prices[yesIdx] ?? prices[0];
  if (value === undefined) return null;
  return Math.min(1, Math.max(0, value));
}

function normalizeTimestamp(raw: unknown): number | null {
  const value = toNumber(raw);
  if (value === null) return null;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function downsampleByTime(points: ChartPoint[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;

  const span = Math.max(1, last.t - first.t);
  const bucketMs = span / (maxPoints - 1);
  const sampled: ChartPoint[] = [first];
  let nextThreshold = first.t + bucketMs;
  for (let idx = 1; idx < points.length - 1; idx += 1) {
    const point = points[idx];
    if (point && point.t >= nextThreshold) {
      sampled.push(point);
      nextThreshold += bucketMs;
    }
  }
  sampled.push(last);
  return sampled.slice(0, maxPoints);
}

async function fetchYesPriceSeries(
  tokenId: string,
  startMs: number,
  endMs: number,
): Promise<ChartPoint[]> {
  const historyUrl = new URL("/prices-history", CLOB_BASE_URL);
  historyUrl.searchParams.set("market", tokenId);
  historyUrl.searchParams.set("startTs", String(Math.floor(startMs / 1000)));
  historyUrl.searchParams.set("endTs", String(Math.floor(endMs / 1000)));
  historyUrl.searchParams.set("fidelity", "5");

  const payload = await fetchJson<{ history?: Array<{ t?: unknown; p?: unknown }> }>(historyUrl);
  const points = (payload.history ?? [])
    .map((entry) => {
      const t = normalizeTimestamp(entry.t);
      const p = toNumber(entry.p);
      if (t === null || p === null) return null;
      return { t, value: Math.min(1, Math.max(0, p)) };
    })
    .filter((point): point is ChartPoint => point !== null)
    .sort((a, b) => a.t - b.t);

  return downsampleByTime(points, MAX_POINTS);
}

async function fetchVolumeSeries(
  conditionId: string,
  startMs: number,
  endMs: number,
): Promise<ChartPoint[]> {
  const trades: Array<{ timestamp?: unknown; size?: unknown; price?: unknown }> = [];
  let offset = 0;

  for (let page = 0; page < MAX_TRADE_PAGES; page += 1) {
    const url = new URL("/trades", DATA_BASE_URL);
    url.searchParams.set("market", conditionId);
    url.searchParams.set("limit", String(TRADE_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const pageItems = await fetchJson<Array<{ timestamp?: unknown; size?: unknown; price?: unknown }>>(url);
    if (!Array.isArray(pageItems) || pageItems.length === 0) break;
    trades.push(...pageItems);

    const pageTimestamps = pageItems
      .map((item) => normalizeTimestamp(item.timestamp))
      .filter((value): value is number => value !== null);
    const oldestPageTs = pageTimestamps.length > 0 ? Math.min(...pageTimestamps) : Number.POSITIVE_INFINITY;
    if (oldestPageTs < startMs || pageItems.length < TRADE_PAGE_SIZE) {
      break;
    }
    offset += TRADE_PAGE_SIZE;
  }

  const inRange = trades
    .map((trade) => {
      const t = normalizeTimestamp(trade.timestamp);
      const size = toNumber(trade.size);
      const price = toNumber(trade.price);
      if (t === null || size === null) return null;
      const notional = Math.abs(size * (price ?? 1));
      return { t, value: notional };
    })
    .filter((trade): trade is ChartPoint => trade !== null && trade.t >= startMs && trade.t <= endMs)
    .sort((a, b) => a.t - b.t);

  if (inRange.length === 0) return [];

  const bucketMs = Math.max(60_000, Math.floor((endMs - startMs) / MAX_POINTS));
  const buckets = new Map<number, number>();
  for (const trade of inRange) {
    const bucket = Math.floor((trade.t - startMs) / bucketMs);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + trade.value);
  }

  let cumulative = 0;
  const points: ChartPoint[] = [];
  for (let bucket = 0; bucket <= Math.floor((endMs - startMs) / bucketMs); bucket += 1) {
    cumulative += buckets.get(bucket) ?? 0;
    points.push({
      t: startMs + bucket * bucketMs,
      value: cumulative,
    });
  }

  return downsampleByTime(points, MAX_POINTS);
}

function buildLookbackLabel(hours: number): string {
  if (hours < 1) return "Last hour";
  if (hours === 1) return "Last 1h";
  if (hours < 48) return `Last ${HOUR_FORMATTER.format(hours)}h`;
  const days = hours / 24;
  if (Number.isInteger(days)) return `Last ${days}d`;
  return `Last ${HOUR_FORMATTER.format(hours)}h`;
}

function buildShortLookbackLabel(hours: number): string {
  if (hours < 1) return "1h";
  if (hours === 1) return "1h";
  if (hours < 48) return `${HOUR_FORMATTER.format(hours)}h`;
  const days = hours / 24;
  if (Number.isInteger(days)) return `${days}d`;
  return `${HOUR_FORMATTER.format(hours)}h`;
}

function withBoundaryPoints(points: ChartPoint[], startMs: number, endMs: number): ChartPoint[] {
  if (points.length === 0) return points;
  const normalized = [...points];
  if (normalized[0] && normalized[0].t > startMs) {
    normalized.unshift({ t: startMs, value: normalized[0].value });
  }
  const last = normalized[normalized.length - 1];
  if (last && last.t < endMs) {
    normalized.push({ t: endMs, value: last.value });
  }
  return normalized;
}

function formatValue(series: PolymarketGraphDisplayComponentConfig["series"], value: number): string {
  if (series === "yes_price") {
    return PERCENT_FORMATTER.format(Math.min(1, Math.max(0, value)));
  }
  return `$${COMPACT_FORMATTER.format(Math.max(0, value))}`;
}

function buildPolyline(points: ChartPoint[], minValue: number, maxValue: number): string {
  const width = GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT;
  const height = GRAPH_HEIGHT - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";

  const timeSpan = Math.max(1, last.t - first.t);
  const valueSpan = Math.max(1e-9, maxValue - minValue);

  return points.map((point) => {
    const x = GRAPH_PADDING_LEFT + ((point.t - first.t) / timeSpan) * width;
    const y = GRAPH_PADDING_TOP + (1 - ((point.value - minValue) / valueSpan)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function renderChart(
  config: PolymarketGraphDisplayComponentConfig,
  series: PolymarketSeries,
): ReactElement {
  const wrapperStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
    color: EINK_FOREGROUND,
    fontFamily: "DejaVu Sans",
    backgroundColor: EINK_BACKGROUND,
    gap: 8,
  };

  const titleStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.15,
    wordBreak: "break-word",
  };

  const subtitleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
  };

  const points = series.points;
  if (points.length === 0) {
    return (
      <div style={wrapperStyle}>
        <div style={titleStyle}>{series.title}</div>
        <div style={subtitleStyle}>{series.subtitle}</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>No data in selected window</div>
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const minValue = rawMin;
  const maxValue = Math.max(rawMin + 1e-9, rawMax);
  const polyline = buildPolyline(points, minValue, maxValue);

  const statsParts: string[] = [series.subtitle];
  if (config.show_last_value && series.latestValue !== null) {
    statsParts.push(`now ${formatValue(config.series, series.latestValue)}`);
  }
  statsParts.push(`min ${formatValue(config.series, rawMin)}`);
  statsParts.push(`max ${formatValue(config.series, rawMax)}`);
  const statsLine = statsParts.join(" · ");

  const svgParts: string[] = [];
  if (config.show_axes) {
    svgParts.push(
      `<line x1="${GRAPH_PADDING_LEFT}" y1="${GRAPH_PADDING_TOP}" x2="${GRAPH_PADDING_LEFT}" y2="${GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}" stroke="${AXIS_COLOUR}" stroke-width="2"/>`,
      `<line x1="${GRAPH_PADDING_LEFT}" y1="${GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}" x2="${GRAPH_WIDTH - GRAPH_PADDING_RIGHT}" y2="${GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}" stroke="${AXIS_COLOUR}" stroke-width="2"/>`,
    );
  }
  svgParts.push(
    `<polyline fill="none" stroke="${EINK_FOREGROUND}" stroke-width="3" points="${escapeXml(polyline)}" stroke-linejoin="round" stroke-linecap="round"/>`,
  );

  const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${GRAPH_WIDTH}" height="${GRAPH_HEIGHT}" viewBox="0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}">${svgParts.join("")}</svg>`;
  const chartDataUrl = `data:image/svg+xml,${encodeURIComponent(svgXml)}`;

  return (
    <div style={wrapperStyle}>
      <div style={titleStyle}>{series.title}</div>
      <div style={{ ...subtitleStyle, fontWeight: 400 }}>{statsLine}</div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
        <img
          src={chartDataUrl}
          alt=""
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>
    </div>
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSeriesMeta(
  market: GammaMarket,
  config: PolymarketGraphDisplayComponentConfig,
): { title: string; subtitle: string } {
  const baseTitle = config.title ?? market.question ?? market.slug ?? config.market_slug;
  const seriesLabel = config.series === "yes_price" ? "YES" : "Volume";
  return {
    title: baseTitle,
    subtitle: `${seriesLabel}, ${buildShortLookbackLabel(config.lookback_hours)}`,
  };
}

async function loadSeries(
  market: GammaMarket,
  config: PolymarketGraphDisplayComponentConfig,
  startMs: number,
  endMs: number,
): Promise<PolymarketSeries> {
  const labels = buildSeriesMeta(market, config);
  if (config.series === "yes_price") {
    const yesTokenId = pickYesTokenId(market);
    if (!yesTokenId) {
      throw new Error("Missing CLOB token id for YES outcome");
    }
    let points = await fetchYesPriceSeries(yesTokenId, startMs, endMs);
    if (points.length === 0) {
      const fallbackPrice = pickCurrentYesPrice(market);
      if (fallbackPrice !== null) {
        points = [{ t: endMs, value: fallbackPrice }];
      }
    }
    points = withBoundaryPoints(points, startMs, endMs);
    return {
      title: labels.title,
      subtitle: labels.subtitle,
      unitLabel: "Probability",
      points,
      latestValue: points.length > 0 ? points[points.length - 1].value : null,
      clampMinToZero: true,
    };
  }

  const conditionId = market.conditionId?.trim();
  if (!conditionId) {
    throw new Error("Missing condition id for volume series");
  }
  const points = withBoundaryPoints(await fetchVolumeSeries(conditionId, startMs, endMs), startMs, endMs);
  return {
    title: labels.title,
    subtitle: labels.subtitle,
    unitLabel: "Cumulative traded notional (approx.)",
    points,
    latestValue: points.length > 0 ? points[points.length - 1].value : null,
    clampMinToZero: true,
  };
}

export async function createPolymarketGraphDisplayElement(
  config: PolymarketGraphDisplayComponentConfig,
): Promise<DisplayComponentResult> {
  try {
    const now = Date.now();
    const lookbackMs = Math.max(60_000, Math.floor(config.lookback_hours * 60 * 60 * 1000));
    const startMs = now - lookbackMs;
    const market = await getGammaMarketBySlug(config.market_slug);
    const series = await loadSeries(market, config, startMs, now);
    return componentSuccess(renderChart(config, series));
  } catch (error) {
    return componentFailure(
      "polymarket_graph_display",
      "Unable to load market graph",
      error instanceof Error ? error.message : String(error),
    );
  }
}
