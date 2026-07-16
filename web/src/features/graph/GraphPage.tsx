import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import { useNavigate } from 'react-router';
import { repo } from '../../data';
import type { GraphHub, GraphLeaf, TicketGraph } from '../../data/types';
import { cx } from '../../components/util';
import { IconChevronRight, IconGraph } from '../../icons';

const HUES = [210, 150, 32, 275, 0, 190, 305, 95, 50, 255];
const hueOf = (k: number) => HUES[((k % HUES.length) + HUES.length) % HUES.length];
const hubFill = (h: number) => `hsl(${h} 58% 50%)`;
const dotFill = (h: number) => `hsl(${h} 52% 62%)`;
const edgeStroke = (h: number) => `hsl(${h} 45% 58%)`;
const PRIORITY_R: Record<string, number> = { urgent: 6.5, high: 5.5, medium: 4.5, low: 4 };
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const W = 1600;
const H = 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface SimNode { key: string; kind: 'hub' | 'leaf'; label: string; hue: number; x: number; y: number; r: number; count?: number; leaf?: GraphLeaf }

/** Deterministic cluster layout: hubs on a ring, their leaves in a sunflower disc. */
function layout(hubs: GraphHub[], leaves: GraphLeaf[]): { nodes: SimNode[]; edges: [number, number][] } {
  const shown = new Map<string, number>();
  for (const l of leaves) shown.set(l.hub, (shown.get(l.hub) ?? 0) + 1);
  const clusterR = (n: number) => Math.min(330, 52 + Math.sqrt(n) * 30);
  const circ = hubs.reduce((s, h) => s + 2 * clusterR(shown.get(h.key) ?? 1) + 90, 0);
  const ringR = hubs.length <= 1 ? 0 : Math.max(330, circ / (2 * Math.PI));
  const cx = W / 2;
  const cy = H / 2;

  const nodes: SimNode[] = [];
  const hubIndex = new Map<string, number>();
  hubs.forEach((h, i) => {
    const a = (i / hubs.length) * Math.PI * 2 - Math.PI / 2;
    hubIndex.set(h.key, nodes.length);
    nodes.push({ key: h.key, kind: 'hub', label: h.label, hue: hueOf(h.colorKey), count: h.count, r: 12 + Math.sqrt(h.count) * 0.8, x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR });
  });

  const edges: [number, number][] = [];
  const seq = new Map<string, number>();
  for (const l of leaves) {
    const hi = hubIndex.get(l.hub);
    if (hi === undefined) continue;
    const hub = nodes[hi];
    const total = shown.get(l.hub) ?? 1;
    const j = seq.get(l.hub) ?? 0;
    seq.set(l.hub, j + 1);
    const rr = clusterR(total) * Math.sqrt((j + 0.6) / total);
    const ang = j * GOLDEN;
    const r = l.kind === 'sub' ? 7 : (PRIORITY_R[l.priority ?? ''] ?? 4.5);
    const idx = nodes.length;
    nodes.push({ key: l.key, kind: 'leaf', label: l.label, hue: hub.hue, r, leaf: l, x: hub.x + Math.cos(ang) * rr, y: hub.y + Math.sin(ang) * rr });
    edges.push([idx, hi]);
  }
  return { nodes, edges };
}

function useSize(): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

type Focus = { category: string | null; sub: string | null };

export function GraphPage() {
  const navigate = useNavigate();
  const [graph, setGraph] = useState<TicketGraph | null>(null);
  const [focus, setFocus] = useState<Focus>({ category: null, sub: null });
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [containerRef, size] = useSize();
  const [view, setView] = useState({ tx: 0, ty: 0, s: 1 });
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    repo.getGraph(focus.category ?? undefined, focus.sub ?? undefined)
      .then((g) => { if (live) setGraph(g); })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : 'Could not load the graph'); });
    return () => { live = false; };
  }, [focus]);

  const { nodes, edges } = useMemo(() => (graph ? layout(graph.hubs, graph.leaves) : { nodes: [] as SimNode[], edges: [] as [number, number][] }), [graph]);

  useLayoutEffect(() => {
    if (nodes.length === 0 || size.w === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const pad = 90;
    const s = clamp(Math.min(size.w / (maxX - minX + pad * 2), size.h / (maxY - minY + pad * 2)), 0.15, 1.8);
    setView({ s, tx: size.w / 2 - ((minX + maxX) / 2) * s, ty: size.h / 2 - ((minY + maxY) / 2) * s });
  }, [nodes, size.w, size.h]);

  const activeSet = useMemo(() => {
    if (hover === null) return null;
    const set = new Set<number>([hover]);
    for (const [u, v] of edges) { if (u === hover) set.add(v); if (v === hover) set.add(u); }
    return set;
  }, [hover, edges]);

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const s2 = clamp(view.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.15, 6);
    setView({ s: s2, tx: mx - ((mx - view.tx) / view.s) * s2, ty: my - ((my - view.ty) / view.s) * s2 });
  }
  function onPointerDown(e: ReactPointerEvent) {
    pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (!pan.current) return;
    setView((v) => ({ ...v, tx: pan.current!.tx + (e.clientX - pan.current!.x), ty: pan.current!.ty + (e.clientY - pan.current!.y) }));
  }
  const endPan = () => { pan.current = null; };
  const zoomBy = (f: number) => {
    const s2 = clamp(view.s * f, 0.15, 6);
    const cx = size.w / 2;
    const cy = size.h / 2;
    setView({ s: s2, tx: cx - ((cx - view.tx) / view.s) * s2, ty: cy - ((cy - view.ty) / view.s) * s2 });
  };

  function onNodeClick(n: SimNode) {
    if (n.kind === 'hub') {
      if (n.key.startsWith('cat:')) setFocus({ category: n.key.slice(4), sub: null });
      else if (n.key.startsWith('sub:')) {
        const rest = n.key.slice(4);
        const i = rest.indexOf('/');
        setFocus({ category: rest.slice(0, i), sub: rest.slice(i + 1) });
      }
      return;
    }
    const l = n.leaf!;
    if (l.kind === 'sub') setFocus({ category: l.category, sub: l.sub });
    else if (l.ticketId) navigate(`/ticket/${l.ticketId}`);
  }

  const taxonomy = graph?.taxonomy ?? [];
  const subsOfFocus = taxonomy.find((c) => c.name === focus.category)?.subs ?? [];
  const showTicketLabels = view.s >= 1.6;
  const hovered = hover !== null ? nodes[hover] : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      {/* Tabs + breadcrumb */}
      <div className="shrink-0 border-b border-line bg-surface px-3 py-2">
        <div className="mb-2 flex items-center gap-1 text-[12px]">
          <button type="button" onClick={() => setFocus({ category: null, sub: null })} className={cx('hover:text-text', focus.category === null ? 'font-semibold text-text' : 'text-text-3')}>All tickets</button>
          {focus.category !== null && (
            <>
              <IconChevronRight size={12} className="text-text-3" />
              <button type="button" onClick={() => setFocus({ category: focus.category, sub: null })} className={cx('hover:text-text', focus.sub === null ? 'font-semibold text-text' : 'text-text-3')}>{focus.category}</button>
            </>
          )}
          {focus.sub !== null && (<><IconChevronRight size={12} className="text-text-3" /><span className="font-semibold text-text">{focus.sub}</span></>)}
          {graph && (
            <span className="ml-1.5 text-text-3">· {focus.category === null ? `${graph.total.toLocaleString()} tickets · ${taxonomy.length} categories` : `${graph.total.toLocaleString()} tickets`}</span>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <Tab active={focus.category === null} label="All" onClick={() => setFocus({ category: null, sub: null })} />
          {taxonomy.map((cat, i) => (
            <Tab key={cat.name} active={focus.category === cat.name} label={cat.name} count={cat.count} hue={hueOf(i)} onClick={() => setFocus({ category: cat.name, sub: null })} />
          ))}
        </div>

        {focus.category !== null && subsOfFocus.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 overflow-x-auto">
            <Chip active={focus.sub === null} label={`All ${focus.category}`} onClick={() => setFocus({ category: focus.category, sub: null })} />
            {subsOfFocus.map((s) => (
              <Chip key={s.name} active={focus.sub === s.name} label={s.name} count={s.count} onClick={() => setFocus({ category: focus.category, sub: s.name })} />
            ))}
          </div>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute bottom-4 right-4 z-10 flex flex-col overflow-hidden rounded-md border border-line bg-surface shadow-1">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)} className="flex size-8 items-center justify-center text-[18px] text-text-2 hover:bg-surface-2">+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)} className="flex size-8 items-center justify-center border-t border-line text-[18px] text-text-2 hover:bg-surface-2">−</button>
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-1.5 text-[11px] text-text-3">
          <IconGraph size={13} /> Drag to pan · scroll to zoom · click a {graph?.level === 0 ? 'hub to drill in' : 'ticket to open it'}
        </div>

        {error !== null ? (
          <div className="flex h-full items-center justify-center text-[13px] text-text-3">{error}</div>
        ) : graph === null ? (
          <div className="flex h-full items-center justify-center text-[13px] text-text-3">Laying out the graph…</div>
        ) : (
          <svg
            ref={svgRef}
            className="h-full w-full touch-none select-none"
            style={{ cursor: pan.current ? 'grabbing' : 'grab' }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerLeave={endPan}
          >
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
              {edges.map(([u, v], i) => {
                const a = nodes[u];
                const dim = activeSet !== null && !(activeSet.has(u) && activeSet.has(v));
                return <line key={i} x1={a.x} y1={a.y} x2={nodes[v].x} y2={nodes[v].y} stroke={edgeStroke(a.hue)} strokeWidth={0.6} opacity={dim ? 0.04 : 0.26} />;
              })}
              {nodes.map((n, i) => {
                const dim = activeSet !== null && !activeSet.has(i);
                const isHub = n.kind === 'hub';
                const isSub = n.leaf?.kind === 'sub';
                const showLabel = isHub || isSub || showTicketLabels || (activeSet !== null && activeSet.has(i));
                return (
                  <g key={n.key} opacity={dim ? 0.16 : 1} style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                    onClick={() => onNodeClick(n)}
                  >
                    <circle cx={n.x} cy={n.y} r={n.r} fill={isHub ? hubFill(n.hue) : dotFill(n.hue)} stroke={isHub ? 'white' : isSub ? hubFill(n.hue) : 'none'} strokeWidth={isHub ? 1.5 : isSub ? 1 : 0} />
                    {showLabel && (
                      <text
                        x={n.x}
                        y={n.y + n.r + (isHub ? 14 : isSub ? 11 : 9)}
                        textAnchor="middle"
                        className={isHub ? 'fill-current text-text' : isSub ? 'fill-current text-text-2' : 'fill-current text-text-3'}
                        style={{ fontSize: isHub ? 13 : isSub ? 10 : 8, fontWeight: isHub ? 600 : isSub ? 500 : 400, paintOrder: 'stroke' }}
                        stroke="var(--bg, #fff)"
                        strokeWidth={isHub ? 3.5 : 2.5}
                      >
                        {isHub ? `${n.label} (${n.count?.toLocaleString()})` : isSub ? n.label : truncate(n.label, 28)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {hovered?.leaf?.kind === 'ticket' && hovered.leaf.ticketId && (
          <div
            className="pointer-events-none absolute z-20 max-w-[260px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-1"
            style={{ left: clamp(hovered.x * view.s + view.tx + 10, 8, size.w - 270), top: clamp(hovered.y * view.s + view.ty + 10, 8, size.h - 60) }}
          >
            <div className="font-medium text-text">#{hovered.leaf.number} · {truncate(hovered.leaf.label, 44)}</div>
            <div className="mt-0.5 capitalize text-text-3">{hovered.leaf.sub} · {hovered.leaf.status?.replace('_', ' ')} · {hovered.leaf.priority}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({ active, label, count, hue, onClick }: { active: boolean; label: string; count?: number; hue?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
        active ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
      )}
    >
      {hue !== undefined && <span className="size-2.5 shrink-0 rounded-full" style={{ background: hubFill(hue) }} />}
      <span>{label}</span>
      {count !== undefined && <span className="tabular-nums text-text-3">{count.toLocaleString()}</span>}
    </button>
  );
}

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors',
        active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-text-2 hover:bg-surface-3',
      )}
    >
      <span>{label}</span>
      {count !== undefined && <span className={cx('tabular-nums', active ? 'text-accent-fg/80' : 'text-text-3')}>{count.toLocaleString()}</span>}
    </button>
  );
}
