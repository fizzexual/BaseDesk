import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { usePortal } from './store';
import { Toaster } from '../components/Toast';
import { IconLogo } from '../icons';
import { PortalLayout } from './PortalLayout';
import { PortalAuth } from './PortalAuth';
import { PortalTickets } from './PortalTickets';
import { PortalTicket } from './PortalTicket';
import { PortalNewTicket } from './PortalNewTicket';
import { PortalProfile } from './PortalProfile';
import { PortalHelp } from './PortalHelp';

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
            <Route index element={<PortalTickets />} />
            <Route path="new" element={<PortalNewTicket />} />
            <Route path="ticket/:id" element={<PortalTicket />} />
            <Route path="help" element={<PortalHelp />} />
            <Route path="profile" element={<PortalProfile />} />
          </Route>
        )}
        {/* Any other path (including the bare root "/") lands somewhere real:
            signed-in customers go to their portal, everyone else to sign-in. */}
        <Route path="*" element={<Navigate to={contact ? '/portal' : '/portal/login'} replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
