import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import type { IncidentImpact, IncidentStatus, StatusComponent, StatusIncident } from '../../data/types';
import { IconChart, IconPlus, IconTrash } from '../../icons';
import {
  COMPONENT_META,
  COMPONENT_STATUSES,
  IMPACT_META,
  INCIDENT_IMPACTS,
  INCIDENT_STATUS_META,
  INCIDENT_STATUSES,
  overallStatus,
} from './statusMeta';

const SELECT = 'h-8 rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus:border-line-2';
const INPUT = 'h-9 rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2';

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

export function StatusPage() {
  const [components, setComponents] = useState<StatusComponent[]>([]);
  const [incidents, setIncidents] = useState<StatusIncident[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo.getStatusPage().then(
      (data) => {
        if (cancelled) return;
        setComponents(data.components);
        setIncidents(data.incidents);
        setLoaded(true);
      },
      () => {
        if (!cancelled) setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const overall = useMemo(() => overallStatus(components, incidents), [components, incidents]);
  const active = incidents.filter((i) => i.status !== 'resolved');

  async function addComponent() {
    const name = newName.trim();
    if (name === '') return;
    try {
      setComponents(await repo.addStatusComponent(name));
      setNewName('');
    } catch {
      toast('Could not add the component');
    }
  }
  async function changeStatus(c: StatusComponent, status: StatusComponent['status']) {
    try {
      setComponents(await repo.saveStatusComponent(c.id, c.name, status));
    } catch {
      toast('Could not update the component');
    }
  }
  async function removeComponent(id: string) {
    try {
      setComponents(await repo.removeStatusComponent(id));
    } catch {
      toast('Could not remove the component');
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
      <header className="flex items-center gap-2.5">
        <h1 className="text-[15px] font-semibold text-text">Status page</h1>
        <span className="text-[13px] text-text-3">Public service status</span>
        <a
          href="/portal/status"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          View public page ↗
        </a>
      </header>

      <div className="flex items-center gap-2.5 rounded-md border border-line px-4 py-3" style={{ background: `color-mix(in oklab, ${overall.color} 8%, transparent)` }}>
        <Dot color={overall.color} />
        <span className="text-[14px] font-semibold text-text">{overall.label}</span>
      </div>

      {/* Components */}
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">Components</h2>
        {!loaded ? (
          <div className="h-24 animate-pulse rounded-md bg-surface-2" />
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-md border border-line">
            {components.map((c) => (
              <div key={c.id} className="group flex items-center gap-3 px-3 py-2.5">
                <Dot color={COMPONENT_META[c.status].color} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{c.name}</span>
                <select className={SELECT} value={c.status} onChange={(e) => void changeStatus(c, e.target.value as StatusComponent['status'])} aria-label={`Status of ${c.name}`}>
                  {COMPONENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {COMPONENT_META[s].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void removeComponent(c.id)}
                  aria-label={`Remove ${c.name}`}
                  className="shrink-0 rounded-sm p-1 text-text-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <input
                className={cx(INPUT, 'min-w-0 flex-1')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addComponent()}
                placeholder="Add a component (e.g. Search, Uploads)…"
              />
              <Button variant="subtle" size="sm" disabled={newName.trim() === ''} onClick={() => void addComponent()}>
                <IconPlus size={15} />
                Add
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Incidents */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Incidents</h2>
          <Button variant="subtle" size="sm" onClick={() => setReporting((v) => !v)}>
            <IconPlus size={15} />
            Report incident
          </Button>
        </div>

        {reporting && <IncidentForm onCreated={(list) => { setIncidents(list); setReporting(false); }} />}

        {active.length === 0 && incidents.length === 0 ? (
          <EmptyState icon={<IconChart size={28} />} title="No incidents" hint="When something breaks, report an incident here to keep customers informed." />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {incidents.map((i) => (
              <IncidentCard key={i.id} incident={i} onChange={setIncidents} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function IncidentForm({ onCreated }: { onCreated: (list: StatusIncident[]) => void }) {
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<IncidentImpact>('minor');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (title.trim() === '' || busy) return;
    setBusy(true);
    try {
      onCreated(await repo.createIncident(title.trim(), impact, body));
      setTitle('');
      setBody('');
      setImpact('minor');
    } catch {
      toast('Could not report the incident');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-line bg-surface-2/40 p-3">
      <div className="flex gap-2">
        <input className={cx(INPUT, 'min-w-0 flex-1')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Incident title (e.g. Elevated API errors)" autoFocus />
        <select className={cx(SELECT, 'h-9')} value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)} aria-label="Impact">
          {INCIDENT_IMPACTS.map((im) => (
            <option key={im} value={im}>
              {IMPACT_META[im].label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="mt-2 w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="First update — what are you seeing?"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={title.trim() === '' || busy} onClick={() => void submit()}>
          Report incident
        </Button>
      </div>
    </div>
  );
}

function IncidentCard({ incident, onChange }: { incident: StatusIncident; onChange: (list: StatusIncident[]) => void }) {
  const [status, setStatus] = useState<IncidentStatus>(incident.status === 'resolved' ? 'monitoring' : incident.status);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const resolved = incident.status === 'resolved';

  async function post() {
    if (body.trim() === '' || busy) return;
    setBusy(true);
    try {
      onChange(await repo.postIncidentUpdate(incident.id, status, body.trim()));
      setBody('');
    } catch {
      toast('Could not post the update');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      onChange(await repo.removeIncident(incident.id));
    } catch {
      toast('Could not delete the incident');
    }
  }

  return (
    <div className="rounded-md border border-line p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{incident.title}</span>
            <span className="rounded-full px-1.5 py-0.5 text-[11px] font-medium" style={{ color: INCIDENT_STATUS_META[incident.status].color, background: `color-mix(in oklab, ${INCIDENT_STATUS_META[incident.status].color} 14%, transparent)` }}>
              {INCIDENT_STATUS_META[incident.status].label}
            </span>
            <span className="text-[12px] text-text-3">{IMPACT_META[incident.impact].label} impact</span>
          </div>
          <div className="mt-0.5 text-[12px] text-text-3">
            Opened <TimeAgo iso={incident.createdAt} />
            {incident.resolvedAt && <> · resolved <TimeAgo iso={incident.resolvedAt} /></>}
          </div>
        </div>
        <button type="button" onClick={() => void remove()} aria-label="Delete incident" className="shrink-0 rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text">
          <IconTrash size={14} />
        </button>
      </div>

      <ol className="mt-3 flex flex-col gap-2 border-l border-line pl-3">
        {[...incident.updates].reverse().map((u, idx) => (
          <li key={idx}>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: INCIDENT_STATUS_META[u.status].color }}>
                {INCIDENT_STATUS_META[u.status].label}
              </span>
              <span className="text-[11px] text-text-3">
                <TimeAgo iso={u.at} />
              </span>
            </div>
            <p className="text-[13px] text-text-2">{u.body}</p>
          </li>
        ))}
      </ol>

      {!resolved && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row">
          <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)} aria-label="Update status">
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INCIDENT_STATUS_META[s].label}
              </option>
            ))}
          </select>
          <input className={cx(INPUT, 'min-w-0 flex-1')} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void post()} placeholder="Post an update…" />
          <Button size="sm" disabled={body.trim() === '' || busy} onClick={() => void post()}>
            Post
          </Button>
        </div>
      )}
    </div>
  );
}
