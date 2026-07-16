import { useEffect, useState, type ReactNode } from 'react';
import { Kbd } from '../../components/Kbd';
import { Tooltip } from '../../components/Tooltip';
import { IconX } from '../../icons';
import { MOD_LABEL } from './shortcuts';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-[13px] text-text-2">{label}</span>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </div>
  );
}

function Sep({ children }: { children: ReactNode }) {
  return <span className="px-0.5 text-[11px] text-text-3">{children}</span>;
}

export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('basedesk:open-help', onOpen);
    return () => window.removeEventListener('basedesk:open-help', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{ background: 'rgb(0 0 0 / 0.32)' }}
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-[640px] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface shadow-2"
      >
        <div className="flex h-12 items-center justify-between border-b border-line pl-5 pr-3">
          <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
          <Tooltip label="Close">
            <button
              type="button"
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
              onClick={() => setOpen(false)}
            >
              <IconX size={16} />
            </button>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 p-5">
          <Section title="Global">
            <Row label="Command palette">
              <Kbd>{MOD_LABEL}</Kbd>
              <Kbd>K</Kbd>
            </Row>
            <Row label="This help">
              <Kbd>?</Kbd>
            </Row>
            <Row label="Go to inbox">
              <Kbd>G</Kbd>
              <Kbd>I</Kbd>
            </Row>
            <Row label="Go to contacts">
              <Kbd>G</Kbd>
              <Kbd>C</Kbd>
            </Row>
            <Row label="Go to team">
              <Kbd>G</Kbd>
              <Kbd>T</Kbd>
            </Row>
            <Row label="Go to reports">
              <Kbd>G</Kbd>
              <Kbd>R</Kbd>
            </Row>
          </Section>
          <Section title="Inbox">
            <Row label="Navigate">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd>
            </Row>
            <Row label="Open ticket">
              <Kbd>Enter</Kbd>
              <Sep>or</Sep>
              <Kbd>O</Kbd>
            </Row>
            <Row label="Solve">
              <Kbd>E</Kbd>
            </Row>
            <Row label="Assign to me">
              <Kbd>U</Kbd>
            </Row>
            <Row label="Priority">
              <Kbd>1</Kbd>
              <Sep>–</Sep>
              <Kbd>4</Kbd>
            </Row>
            <Row label="Snooze">
              <Kbd>S</Kbd>
            </Row>
          </Section>
          <Section title="Ticket">
            <Row label="Reply">
              <Kbd>R</Kbd>
            </Row>
            <Row label="Note">
              <Kbd>N</Kbd>
            </Row>
            <Row label="Solve">
              <Kbd>E</Kbd>
            </Row>
            <Row label="Send">
              <Kbd>{MOD_LABEL}</Kbd>
              <Kbd>Enter</Kbd>
            </Row>
            <Row label="Back">
              <Kbd>Esc</Kbd>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
