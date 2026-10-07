import { useEffect, useRef, useState } from "react";
import { TREND_RANGES, type QuoteSymbol, type TrendRange, type TrendSeries } from "@aihot/contracts/site";
import { QUOTE_LABEL } from "./instruments.ts";
import { areaPath, curvePath, observedRuns, type Pt } from "../hot/curve.ts";

/**
 * One instrument's price over a chosen range, opened from its cell in the band.
 *
 * Why this is not `features/hot/Sparkline.tsx`, which is the site's other little line chart:
 * Sparkline scales its y-axis from zero, `(1 - v / max) * H`, and that is right for heat — a story
 * going from 0 to 40 should fill the height. A price is not on that scale. Gold moving between 4196
 * and 4200 is a 0.1% change drawn from zero as a flat line pinned to the top, which reads as "nothing
 * happened" on a chart whose entire job is to show that something did. Scaling from the series' own
 * low and high is a different calculation, not a different style, so the component cannot be shared
 * and only the geometry is: `curvePath` and `areaPath` draw any monotone series, and this one is
 * monotone the same way. Changing Sparkline to match would flatten the hot list, which is correct as
 * it is.
 *
 * The default range is 1mo rather than 1d, because `1d` is a single daily close — one point, which is
 * a dot and not a line. The band is a snapshot feed, so "today" has no intraday series behind it and
 * offering 1d first would open onto nothing.
 */
export function QuoteTrend({ symbol, onClose }: { symbol: QuoteSymbol; onClose: () => void }) {
  const [range, setRange] = useState<TrendRange>("1mo");
  const [series, setSeries] = useState<TrendSeries | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const label = QUOTE_LABEL[symbol];

  // One request in flight at a time: switching range while a fetch is open would otherwise let an
  // older, slower response land after a newer one and draw the previous range under the new label.
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    inflight.current?.abort();
    inflight.current = controller;
    setState("loading");
    setSeries(null);
    fetch(`/api/site/quote-trend?symbol=${encodeURIComponent(symbol)}&range=${range}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: TrendSeries) => {
        if (controller.signal.aborted) return;
        setSeries(data);
        setState(data.empty || data.points.length === 0 ? "empty" : "ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState("error");
        void err;
      });
    return () => controller.abort();
  }, [symbol, range]);

  // Escape closes, as it does for every other layer on this site.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closes = series?.points.map((p) => p.close) ?? [];
  return (
    <div className="border-t border-line bg-bg px-3 py-3.5 lg:px-5" role="region" aria-label={`${label.name}价格走势`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-[14px] font-bold text-ink">
          {label.name} <span className="mono text-[12px] font-normal tracking-[0.06em] text-ink-4">{label.code}</span>
        </h3>
        {/*
          The range switch. 1d is present and disabled-looking rather than hidden, because a reader who
          came here for today should be told today is not available instead of finding it missing.
        */}
        <div className="flex items-center gap-0.5" role="group" aria-label="时间区间">
          {TREND_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={r === range}
              className={`rounded-sm px-2 py-1 text-[12px] transition-colors duration-150 ease-standard ${
                r === range ? "bg-bg-muted font-semibold text-ink" : "text-ink-4 hover:text-ink-2"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
          <button type="button" onClick={onClose} className="ml-1.5 rounded-sm px-2 py-1 text-[12px] text-ink-4 transition-colors duration-150 ease-standard hover:text-ink-2">
            收起
          </button>
        </div>
      </div>

      {/*
        The unit and the exchange come from the response, never from the symbol. A reader comparing this
        chart with the cell above it must be looking at the same unit they read there, and the only
        way to guarantee that is to print what the api said.
      */}
      <p className="mt-1 text-[11.5px] text-ink-4">
        {series ? (
          <>
            {series.exchange}
            {series.unit ? ` · ${series.unit}` : ""}
            {closes.length > 1 ? ` · ${closes[0]!.toLocaleString("zh-CN")} → ${closes.at(-1)!.toLocaleString("zh-CN")}` : ""}
          </>
        ) : (
          "正在读取走势"
        )}
      </p>

      <div className="mt-2.5">
        {state === "loading" && <p className="py-6 text-center text-[12.5px] text-ink-4">正在读取走势…</p>}
        {state === "error" && <p className="py-6 text-center text-[12.5px] text-warn">走势读取失败，请稍后再试。</p>}
        {state === "empty" && (
          <p className="py-6 text-center text-[12.5px] text-ink-4">
            {range === "1d" ? "当日无成交数据。本站每日一个快照，没有日内序列。" : "该区间无数据。"}
          </p>
        )}
        {state === "ready" && series && <TrendChart points={series.points.map((p) => p.close)} label={`${label.name}${RANGE_LABEL[range]}收盘价走势`} />}
      </div>
    </div>
  );
}

const RANGE_LABEL: Record<TrendRange, string> = { "1d": "当日", "1mo": "近 1 月", "3mo": "近 3 月", "1y": "近 1 年" };

/**
 * The line itself. Scaled to its own low and high — the one thing that makes this a different
 * calculation from Sparkline — with the last point marked, and a single point drawn as a dot rather
 * than a line that goes nowhere.
 */
function TrendChart({ points, label }: { points: number[]; label: string }) {
  const W = 100;
  const H = 34;
  if (points.length === 0) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series would divide by zero; a flat line is the truthful drawing of a flat series.
  const span = max - min;
  const y = (v: number) => (span === 0 ? H / 2 : H - ((v - min) / span) * (H - 3) - 1.5);
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  // observedRuns over a gap-free list is one run; the shared helper is used so that a future
  // missing-session case draws a break rather than interpolating over a holiday.
  const runs = observedRuns(points).map((run) => run.map((i): Pt => [x(i), y(points[i]!)]));
  const end = runs.at(-1)?.at(-1);
  const rising = points.at(-1)! >= points[0]!;
  const stroke = rising ? "var(--up)" : "var(--down)";

  if (points.length === 1 && end) {
    return (
      <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-[76px] w-full" role="img" aria-label={`${label}，仅一个数据点`} preserveAspectRatio="none">
        <path d={`M${end[0]} ${end[1]}h0`} stroke={stroke} strokeWidth="9" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-[76px] w-full" role="img" aria-label={label} preserveAspectRatio="none">
      {runs.map((pts) => (
        <path key={`a${pts[0]![0]}`} d={areaPath(pts, H + 4)} fill={stroke} fillOpacity="0.08" />
      ))}
      {runs.map((pts) => (
        <path key={`l${pts[0]![0]}`} d={curvePath(pts)} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {end && (
        <>
          <path d={`M${end[0]} ${end[1]}h0`} stroke={stroke} strokeOpacity="0.18" strokeWidth="11" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={`M${end[0]} ${end[1]}h0`} stroke="var(--surface)" strokeWidth="6.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={`M${end[0]} ${end[1]}h0`} stroke={stroke} strokeWidth="4.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}
