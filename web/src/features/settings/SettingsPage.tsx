import { NavLink, useParams } from 'react-router';
import { cx } from '../../components/util';
import { IconBell, IconChannels, IconClock, IconContacts, IconFilter, IconImport, IconList, IconLock, IconMegaphone, IconNote, IconSend, IconSparkle, IconSun, IconTag, IconTicket, IconUser } from '../../icons';
import { Profile } from './Profile';
import { TeamSettings } from './TeamSettings';
import { OnCallSettings } from './OnCallSettings';
import { Appearance } from './Appearance';
import { CannedReplies } from './CannedReplies';
import { TicketTemplates } from './TicketTemplates';
import { SlaSettings } from './SlaSettings';
import { AutomationSettings } from './AutomationSettings';
import { AiSettings } from './AiSettings';
import { EmailSettings } from './EmailSettings';
import { CustomFieldsSettings } from './CustomFieldsSettings';
import { IntakeFormSettings } from './IntakeFormSettings';
import { ImportSettings } from './ImportSettings';
import { AnnouncementsSettings } from './AnnouncementsSettings';
import { BusinessHoursSettings } from './BusinessHoursSettings';
import { SecuritySettings } from './SecuritySettings';
import { WebhooksSettings } from './WebhooksSettings';

type TabId = 'profile' | 'team' | 'oncall' | 'appearance' | 'canned' | 'templates' | 'fields' | 'form' | 'sla' | 'hours' | 'automation' | 'ai' | 'email' | 'announcements' | 'security' | 'webhooks' | 'import';

const TABS: Array<{
  id: TabId;
  label: string;
  icon: (p: { size?: number; className?: string }) => React.ReactNode;
}> = [
  { id: 'profile', label: 'Profile', icon: IconUser },
  { id: 'team', label: 'Team', icon: IconContacts },
  { id: 'oncall', label: 'On-call', icon: IconBell },
  { id: 'appearance', label: 'Appearance', icon: IconSun },
  { id: 'canned', label: 'Canned replies', icon: IconNote },
  { id: 'templates', label: 'Templates', icon: IconTicket },
  { id: 'fields', label: 'Ticket fields', icon: IconTag },
  { id: 'form', label: 'Ticket form', icon: IconList },
  { id: 'sla', label: 'SLA', icon: IconClock },
  { id: 'hours', label: 'Business hours', icon: IconClock },
  { id: 'automation', label: 'Automation', icon: IconFilter },
  { id: 'ai', label: 'AI', icon: IconSparkle },
  { id: 'email', label: 'Email', icon: IconSend },
  { id: 'announcements', label: 'Announcements', icon: IconMegaphone },
  { id: 'security', label: 'Security', icon: IconLock },
  { id: 'webhooks', label: 'Webhooks', icon: IconChannels },
  { id: 'import', label: 'Import', icon: IconImport },
];

export function SettingsPage() {
  const params = useParams<{ tab?: string }>();
  const tab: TabId =
    params.tab === 'team' ||
    params.tab === 'oncall' ||
    params.tab === 'appearance' ||
    params.tab === 'canned' ||
    params.tab === 'templates' ||
    params.tab === 'fields' ||
    params.tab === 'form' ||
    params.tab === 'sla' ||
    params.tab === 'hours' ||
    params.tab === 'automation' ||
    params.tab === 'ai' ||
    params.tab === 'email' ||
    params.tab === 'announcements' ||
    params.tab === 'security' ||
    params.tab === 'webhooks' ||
    params.tab === 'import'
      ? params.tab
      : 'profile';

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-line p-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <NavLink
              key={t.id}
              to={`/settings/${t.id}`}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium transition-colors',
                active ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
              )}
            >
              <Icon size={17} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="min-w-0 max-w-[560px] flex-1 overflow-y-auto p-6">
        {tab === 'profile' && <Profile />}
        {tab === 'team' && <TeamSettings />}
        {tab === 'oncall' && <OnCallSettings />}
        {tab === 'appearance' && <Appearance />}
        {tab === 'canned' && <CannedReplies />}
        {tab === 'templates' && <TicketTemplates />}
        {tab === 'fields' && <CustomFieldsSettings />}
        {tab === 'form' && <IntakeFormSettings />}
        {tab === 'sla' && <SlaSettings />}
        {tab === 'hours' && <BusinessHoursSettings />}
        {tab === 'automation' && <AutomationSettings />}
        {tab === 'ai' && <AiSettings />}
        {tab === 'email' && <EmailSettings />}
        {tab === 'announcements' && <AnnouncementsSettings />}
        {tab === 'security' && <SecuritySettings />}
        {tab === 'webhooks' && <WebhooksSettings />}
        {tab === 'import' && <ImportSettings />}
      </div>
    </div>
  );
}
