import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { usePortal } from './store';
import { Toaster } from '../components/Toast';
import { ContextMenuHost } from '../components/ContextMenu';
import { IconLogo } from '../icons';
import { PortalLayout } from './PortalLayout';
import { PortalAuth } from './PortalAuth';
import { PortalTickets } from './PortalTickets';
import { PortalTicket } from './PortalTicket';
import { PortalNewTicket } from './PortalNewTicket';
import { PortalProfile } from './PortalProfile';
import { HelpLayout, HelpIndex, HelpArticle } from './PortalHelp';

/** Scrollable, centered column for the portal's non-ticket pages. */
function ContainedPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <Outlet />
      </div>
    </div>
  );
}

export function PortalApp() {
  const ready = usePortal((s) => s.ready);
  const contact = usePortal((s) => s.contact);
  const init = usePortal((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-text-3">
        <IconLogo size={32} className="animate-pulse" />
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/portal/login" element={contact ? <Navigate to="/portal" replace /> : <PortalAuth />} />
        {contact && (
          <Route path="/portal" element={<PortalLayout />}>
            {/* The list, composer, ticket view and help center are all full-bleed
                app screens — each lays out its own sidebar + content. Only the
                profile settings page stays in a narrow contained column. */}
            <Route index element={<PortalTickets />} />
            <Route path="new" element={<PortalNewTicket />} />
            <Route path="ticket/:id" element={<PortalTicket />} />
            <Route path="help" element={<HelpLayout />}>
              <Route index element={<HelpIndex />} />
              <Route path=":slug" element={<HelpArticle />} />
            </Route>
            <Route element={<ContainedPage />}>
              <Route path="profile" element={<PortalProfile />} />
            </Route>
          </Route>
        )}
        {/* Any other path (including the bare root "/") lands somewhere real:
            signed-in customers go to their portal, everyone else to sign-in. */}
        <Route path="*" element={<Navigate to={contact ? '/portal' : '/portal/login'} replace />} />
      </Routes>
      <Toaster />
      <ContextMenuHost />
    </>
  );
}
