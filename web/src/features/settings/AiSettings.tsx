import { useState } from 'react';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { AiTestResult } from '../../data/types';
import { aiEnabled, setAiEnabled } from '../ai/engine';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

const TOGGLE_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
];

export function AiSettings() {
  const provider = useApp((s) => s.aiProvider);
  const saveAiProvider = useApp((s) => s.saveAiProvider);
  const testAiProvider = useApp((s) => s.testAiProvider);

  const [copilot, setCopilot] = useState<boolean>(aiEnabled());
  const [enabled, setEnabled] = useState<boolean>(provider.enabled);
  const [baseUrl, setBaseUrl] = useState<string>(provider.baseUrl);
  const [model, setModel] = useState<string>(provider.model);
  const [temperature, setTemperature] = useState<string>(String(provider.temperature));
  const [key, setKey] = useState<string>('');
  const [hasKey, setHasKey] = useState<boolean>(provider.hasKey);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);

  function onCopilot(value: 'on' | 'off') {
    const on = value === 'on';
    setAiEnabled(on);
    setCopilot(on);
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setBaseUrl(p.baseUrl);
    setModel(p.model);
    setTest(null);
  }

  function payload() {
    const temp = Number(temperature);
    return {
      enabled,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      temperature: Number.isFinite(temp) ? temp : 0.4,
      // Only send the key when the user typed one, so blank keeps the stored key.
      ...(key.trim() !== '' ? { apiKey: key.trim() } : {}),
    };
  }

  async function onSave() {
    setSaving(true);
    try {
      await saveAiProvider(payload());
      if (key.trim() !== '') setHasKey(true);
      setKey('');
      toast('AI provider saved');
    } catch {
      toast('Could not save AI provider');
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTest(null);
    try {
      const result = await testAiProvider(payload());
      setTest(result);
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
    } finally {
      setTesting(false);
    }
  }

  async function onRemoveKey() {
    setSaving(true);
    try {
      await saveAiProvider({ ...payload(), enabled: false, apiKey: '' });
      setHasKey(false);
      setEnabled(false);
      setKey('');
      setTest(null);
      toast('API key removed');
    } catch {
      toast('Could not remove the key');
    } finally {
      setSaving(false);
    }
  }

  const active = enabled && hasKey;

  return (
    <section>
      <h2 className="text-[15px] font-semibold">AI copilot</h2>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-line p-3.5">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">Enable AI copilot</div>
          <div className="mt-0.5 text-[13px] text-text-2">Show reply drafts, triage and summaries in the workspace</div>
        </div>
        <SegmentedControl options={TOGGLE_OPTIONS} value={copilot ? 'on' : 'off'} onChange={onCopilot} />
      </div>

      <div className="mt-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Model provider</h2>
          <p className="mt-2 text-[13px] text-text-3">
            BaseDesk works fully offline with a rule-based engine. Connect any OpenAI-compatible
            provider — DeepSeek, OpenAI, OpenRouter, or a local model — to power the copilot with a
            real model. Your key is stored on your server and never sent to the browser.
          </p>
        </div>
        <div className="mt-0.5 shrink-0">
          <Switch enabled={enabled} onToggle={() => setEnabled(!enabled)} label="Use a model provider" />
        </div>
      </div>

      <div className={cx('mt-5 flex flex-col gap-4', !enabled && 'opacity-60')}>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Preset</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={cx(
                  'h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
                  baseUrl === p.baseUrl ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-text-2 hover:bg-surface-2',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Base URL</span>
          <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" className={`${FIELD} font-mono text-[13px]`} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Model</span>
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" className={`${FIELD} font-mono text-[13px]`} />
          <span className="text-[12px] text-text-3">
            The provider's model id, e.g. <code className="font-mono">deepseek-chat</code>. Use whatever id your provider lists.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">API key</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '•••••••••• (stored — leave blank to keep)' : 'Paste your provider key'}
            className={`${FIELD} font-mono text-[13px]`}
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Creativity (temperature)</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            className="h-9 w-24 rounded-md border border-line bg-bg px-2.5 text-[14px] tabular-nums outline-none focus:border-line-2"
          />
          <span className="text-[12px] text-text-3">Lower is more factual (0–0.4 recommended for support).</span>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save provider'}
        </Button>
        <Button variant="subtle" size="sm" onClick={() => void onTest()} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {hasKey && (
          <Button variant="ghost" size="sm" onClick={() => void onRemoveKey()} disabled={saving}>
            Remove key
          </Button>
        )}
      </div>

      {test !== null && (
        <div
          className={cx(
            'mt-3 rounded-md border px-3 py-2 text-[13px]',
            test.ok ? 'border-green/30 bg-green-bg text-green' : 'border-red/30 bg-red-bg text-red',
          )}
        >
          {test.ok
            ? `Connected to ${test.model ?? model}${test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ''}`
            : `Connection failed: ${test.error ?? 'unknown error'}`}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-[13px]">
        <span className={cx('inline-block size-2 rounded-full', active ? 'bg-green' : 'bg-gray-dot')} />
        <span className="text-text-2">
          {active ? `Model active — copilot uses ${model}` : 'Rule-based — copilot runs offline with no model'}
        </span>
      </div>
    </section>
  );
}
