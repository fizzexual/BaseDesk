import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { StatusIncident, StatusPageData } from '../data/types';
import { TimeAgo } from '../components/TimeAgo';
import { IconLogo } from '../icons';
import { COMPONENT_META, IMPACT_META, INCIDENT_STATUS_META, overallStatus } from '../features/status/statusMeta';

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}>
      {label}
    </span>
  );
}

function IncidentView({ incident }: { incident: StatusIncident }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{incident.title}</span>
        <Pill label={INCIDENT_STATUS_META[incident.status].label} color={INCIDENT_STATUS_META[incident.status].color} />
        <span className="text-[12px] text-text-3">{IMPACT_META[incident.impact].label} impact</span>
      </div>
      <ol className="mt-3 flex flex-col gap-2.5 border-l-2 border-line pl-3.5">
        {[...incident.updates].reverse().map((u, i) => (
          <li key={i}>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: INCIDENT_STATUS_META[u.status].color }}>
                {INCIDENT_STATUS_META[u.status].label}
              </span>
              <span className="text-[11px] text-text-3">
                <TimeAgo iso={u.at} />
              </span>
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-text-2">{u.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PortalStatus() {
  const [data, setData] = useState<StatusPageData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(
        (d: StatusPageData) => !cancelled && setData(d),
        () => !cancelled && setFailed(true),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const overall = data ? overallStatus(data.components, data.incidents) : null;
  const active = data?.incidents.filter((i) => i.status !== 'resolved') ?? [];
  const past = data?.incidents.filter((i) => i.status === 'resolved').slice(0, 10) ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-[760px] items-center gap-2.5 px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <IconLogo size={18} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Support Center</span>
          <span className="text-[13px] text-text-3">· Status</span>
          <Link to="/portal" className="ml-auto text-[13px] font-medium text-text-2 transition-colors hover:text-text">
            Back to support →
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-4 py-8">
        {failed ? (
          <div className="rounded-xl border border-line bg-surface p-6 text-center text-[14px] text-text-2">Status is temporarily unavailable. Please try again shortly.</div>
        ) : data === null || overall === null ? (
          <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border px-5 py-4" style={{ borderColor: `color-mix(in oklab, ${overall.color} 35%, var(--line))`, background: `color-mix(in oklab, ${overall.color} 9%, transparent)` }}>
              <span aria-hidden className="inline-block size-3 shrink-0 rounded-full" style={{ background: overall.color }} />
              <span className="text-[17px] font-semibold text-text">{overall.label}</span>
            </div>

            {active.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">Active incidents</h2>
                <div className="flex flex-col gap-3">
                  {active.map((i) => (
                    <IncidentView key={i.id} incident={i} />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-6">
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">Components</h2>
              <div className="divide-y divide-line rounded-xl border border-line bg-surface">
                {data.components.length === 0 ? (
                  <p className="px-4 py-4 text-[14px] text-text-3">No components are being monitored yet.</p>
                ) : (
                  data.components.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 truncate text-[14px]">{c.name}</span>
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: COMPONENT_META[c.status].color }}>
                        <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: COMPONENT_META[c.status].color }} />
                        {COMPONENT_META[c.status].label}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {past.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">Past incidents</h2>
                <div className="flex flex-col gap-3">
                  {past.map((i) => (
                    <IncidentView key={i.id} incident={i} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
