import { useState } from 'react';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { aiEnabled, getApiKey, setAiEnabled, setApiKey } from '../ai/engine';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2';

const TOGGLE_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

export function AiSettings() {
  const [enabled, setEnabled] = useState<boolean>(aiEnabled());
  const [key, setKey] = useState<string>(getApiKey() ?? '');
  const [saved, setSaved] = useState<boolean>(getApiKey() !== null);

  function onToggle(value: 'on' | 'off') {
    const on = value === 'on';
    setAiEnabled(on);
    setEnabled(on);
  }

  function onSave() {
    const trimmed = key.trim();
    setApiKey(trimmed === '' ? null : trimmed);
    setKey(trimmed);
    setSaved(trimmed !== '');
    toast('AI settings saved');
  }

  function onClear() {
    setApiKey(null);
    setKey('');
    setSaved(false);
    toast('AI settings saved');
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">AI copilot</h2>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-line p-3.5">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">Enable AI copilot</div>
          <div className="mt-0.5 text-[13px] text-text-2">
            Show reply drafts, triage suggestions and summaries
          </div>
        </div>
        <SegmentedControl
          options={TOGGLE_OPTIONS}
          value={enabled ? 'on' : 'off'}
          onChange={onToggle}
        />
      </div>

      <div className="mt-6">
        <label htmlFor="ai-key" className="block text-[13px] font-medium text-text-2">
          Model provider key (optional)
        </label>
        <p className="mt-1 text-[13px] text-text-3">
          BaseDesk works fully offline with rule-based assist. Add a provider key to power drafts
          with a model. The key is stored in your browser only.
        </p>
        <input
          id="ai-key"
          type="password"
          className={`${FIELD} mt-2`}
          placeholder="Paste your provider key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div className="mt-2.5 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={onSave}>
            Save
          </Button>
          {saved && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <p className="mt-4 text-[13px] text-text-3">
        Model-powered drafts route through your self-hosted server in a future release; today the
        key is saved for that path and drafts use the built-in rule-based engine.
      </p>
    </section>
  );
}
