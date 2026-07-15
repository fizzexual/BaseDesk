import type { ComponentStatus, IncidentImpact, IncidentStatus, StatusComponent, StatusIncident } from '../../data/types';

export const COMPONENT_META: Record<ComponentStatus, { label: string; color: string }> = {
  operational: { label: 'Operational', color: 'var(--green)' },
  degraded: { label: 'Degraded performance', color: 'var(--amber)' },
  partial_outage: { label: 'Partial outage', color: 'var(--amber)' },
  major_outage: { label: 'Major outage', color: 'var(--red)' },
  maintenance: { label: 'Under maintenance', color: 'var(--blue)' },
};
export const COMPONENT_STATUSES: ComponentStatus[] = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];

export const INCIDENT_STATUS_META: Record<IncidentStatus, { label: string; color: string }> = {
  investigating: { label: 'Investigating', color: 'var(--red)' },
  identified: { label: 'Identified', color: 'var(--amber)' },
  monitoring: { label: 'Monitoring', color: 'var(--blue)' },
  resolved: { label: 'Resolved', color: 'var(--green)' },
};
export const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];

export const IMPACT_META: Record<IncidentImpact, { label: string; color: string }> = {
  minor: { label: 'Minor', color: 'var(--amber)' },
  major: { label: 'Major', color: 'var(--red)' },
  critical: { label: 'Critical', color: 'var(--red)' },
  maintenance: { label: 'Maintenance', color: 'var(--blue)' },
};
export const INCIDENT_IMPACTS: IncidentImpact[] = ['minor', 'major', 'critical', 'maintenance'];

const SEVERITY: Record<ComponentStatus, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

/** The headline banner state, derived from the worst component + any unresolved incident. */
export function overallStatus(components: StatusComponent[], incidents: StatusIncident[]): { label: string; color: string; ok: boolean } {
  const activeIncident = incidents.some((i) => i.status !== 'resolved');
  const worst = components.reduce<ComponentStatus>((w, c) => (SEVERITY[c.status] > SEVERITY[w] ? c.status : w), 'operational');
  if (worst === 'operational' && !activeIncident) return { label: 'All systems operational', color: 'var(--green)', ok: true };
  if (worst === 'major_outage') return { label: 'Major service outage', color: 'var(--red)', ok: false };
  if (worst === 'partial_outage') return { label: 'Partial service outage', color: 'var(--amber)', ok: false };
  if (worst === 'degraded') return { label: 'Degraded performance', color: 'var(--amber)', ok: false };
  if (worst === 'maintenance') return { label: 'Under maintenance', color: 'var(--blue)', ok: false };
  return { label: 'Active incident', color: 'var(--amber)', ok: false };
}
