import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { useApp } from '../data/store';
import { Toaster } from '../components/Toast';
import { IconLogo } from '../icons';
import { PortalApp } from '../portal/PortalApp';
import { Shell } from './Shell';
import { InboxPage } from '../features/inbox/InboxPage';
import { TicketPage } from '../features/ticket/TicketPage';
import { ContactsPage } from '../features/contacts/ContactsPage';
import { ContactPage } from '../features/contacts/ContactPage';
import { TeamPage } from '../features/team/TeamPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { ReportBuilderPage } from '../features/reports/ReportBuilderPage';
import { StatusPage } from '../features/status/StatusPage';
import { AuditPage } from '../features/audit/AuditPage';
import { HandoverPage } from '../features/handover/HandoverPage';
import { RevenuePage } from '../features/revenue/RevenuePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { AiPage } from '../features/ai/AiPage';
import { DraftsPage } from '../features/ai/DraftsPage';
import { ResolvedPage } from '../features/ai/ResolvedPage';
import { KbPage } from '../features/kb/KbPage';
import { ChannelsPage } from '../features/channels/ChannelsPage';
import { WallboardPage } from '../features/wallboard/WallboardPage';
import { DocsPage } from '../features/docs/DocsPage';
import { ForumPage } from '../features/forum/ForumPage';
import { LoginScreen } from './LoginScreen';

function Boot({ children }: { children: React.ReactNode }) {
  const ready = useApp((s) => s.ready);
  const needsLogin = useApp((s) => s.needsLogin);
  const init = useApp((s) => s.init);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    init().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [init]);

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="max-w-sm rounded-lg border border-line bg-surface p-6 text-center shadow-1">
          <p className="font-medium">BaseDesk can't reach its server.</p>
          <p className="mt-1 text-[13px] text-text-2">{error}</p>
          <p className="mt-3 text-[13px] text-text-3">
            Start it with <code className="rounded bg-surface-2 px-1">npm run dev</code> and reload.
          </p>
        </div>
      </div>
    );
  }
  if (needsLogin) {
    return <LoginScreen />;
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-text-3">
        <IconLogo size={32} className="animate-pulse" />
      </div>
    );
  }
  return <>{children}</>;
}

function AgentApp() {
  return (
    <Boot>
      <Routes>
        {/* Full-screen, chrome-less — meant to live on a TV/second monitor. */}
        <Route path="/wallboard" element={<WallboardPage />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/view/all" replace />} />
          <Route path="/view/:viewId" element={<InboxPage />} />
          <Route path="/ticket/:id" element={<TicketPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/community" element={<ForumPage />} />
          <Route path="/community/:id" element={<ForumPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:slug" element={<DocsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/builder" element={<ReportBuilderPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/handover" element={<HandoverPage />} />
          <Route path="/revenue" element={<RevenuePage />} />
          <Route path="/revenue/:tab" element={<RevenuePage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/ai/drafts" element={<DraftsPage />} />
          <Route path="/ai/resolved" element={<ResolvedPage />} />
          <Route path="/kb" element={<KbPage />} />
          <Route path="/kb/:id" element={<KbPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/view/all" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </Boot>
  );
}

/**
 * Admin dashboard on the admin port, customer portal on the portal port — the same
 * bundle is served on both, and the port decides which app mounts. The production
 * server injects `window.__PORTAL_PORT__` so custom ports work; in dev it defaults
 * to 4011. `/portal/*` also renders the portal on the admin port (same-origin).
 */
const PORTAL_PORT =
  (typeof window !== 'undefined' && (window as unknown as { __PORTAL_PORT__?: string }).__PORTAL_PORT__) || '4011';
function Root() {
  const onPortalPort = typeof window !== 'undefined' && window.location.port === PORTAL_PORT;
  const onPortalPath = useLocation().pathname.startsWith('/portal');
  return onPortalPort || onPortalPath ? <PortalApp /> : <AgentApp />;
}

export function App() {
  return (
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  );
}
