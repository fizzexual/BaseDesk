import { useState } from 'react';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { AiTestResult } from '../../data/types';
import {
  formatContext, formatPrice, looksLikeReasoningModel, mergeModels, modelInfo, PRICES_NOTE, providerForBaseUrl, PROVIDERS,
} from '../../data/model-catalog';
import { aiEnabled, setAiEnabled } from '../ai/engine';
import { IconAlert } from '../../icons';
import { ModelPicker } from './ModelPicker';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

const TOGGLE_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

export function AiSettings() {
  const provider = useApp((s) => s.aiProvider);
  const availableModels = useApp((s) => s.availableModels);
  const saveAiProvider = useApp((s) => s.saveAiProvider);
  const testAiProvider = useApp((s) => s.testAiProvider);
  const listProviderModels = useApp((s) => s.listProviderModels);
  const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

  const [copilot, setCopilot] = useState<boolean>(aiEnabled());
  const [enabled, setEnabled] = useState<boolean>(provider.enabled);
  const [baseUrl, setBaseUrl] = useState<string>(provider.baseUrl);
  const [model, setModel] = useState<string>(provider.model);
  const [reasoning, setReasoning] = useState<boolean>(provider.reasoning);
  const [kbOnly, setKbOnly] = useState<boolean>(provider.kbOnly);
  const [temperature, setTemperature] = useState<string>(String(provider.temperature));
  const [key, setKey] = useState<string>('');
  const [hasKey, setHasKey] = useState<boolean>(provider.hasKey);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);
  // Seed from the addresser's cached list so the picker shows the provider's
  // current models on open (refreshed on boot + daily), no click needed.
  const [fetchedIds, setFetchedIds] = useState<string[]>(
    () => (availableModels && sameUrl(availableModels.baseUrl, provider.baseUrl) ? availableModels.models : []),
  );
  const [loadingModels, setLoadingModels] = useState(false);

  const currentProvider = providerForBaseUrl(baseUrl);
  const selectedInfo = modelInfo(baseUrl, model);
  // The picker shows curated models plus anything the provider returned live.
  const modelList = mergeModels(currentProvider?.models ?? [], baseUrl, fetchedIds);
  // If we have a live list for this exact provider and the chosen model isn't in it, flag it.
  const modelUnavailable =
    availableModels !== null &&
    sameUrl(availableModels.baseUrl, baseUrl) &&
    model.trim() !== '' &&
    !availableModels.models.includes(model.trim());

  async function loadModels() {
    if (loadingModels) return;
    setLoadingModels(true);
    try {
      const r = await listProviderModels({ baseUrl: baseUrl.trim(), apiKey: key.trim() || undefined });
      if (r.error !== undefined) {
        toast(r.error);
        return;
      }
      const ids = r.models ?? [];
      setFetchedIds(ids);
      toast(ids.length > 0 ? `Loaded ${ids.length} models from the provider` : 'The provider returned no models');
    } catch {
      toast('Could not load the model list');
    } finally {
      setLoadingModels(false);
    }
  }

  function onCopilot(value: 'on' | 'off') {
    const on = value === 'on';
    setAiEnabled(on);
    setCopilot(on);
  }

  function applyPreset(p: (typeof PROVIDERS)[number]) {
    setBaseUrl(p.baseUrl);
    const first = p.models[0];
    if (first) {
      setModel(first.id);
      setReasoning(first.reasoning);
    }
    setTest(null);
    setFetchedIds([]); // a different provider has a different model list
  }

  function payload() {
    const temp = Number(temperature);
    return {
      enabled,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      reasoning,
      kbOnly,
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
      setTest(await testAiProvider(payload()));
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
    } finally {
      setTesting(false);
    }
  }

  async function onRemoveKey() {
    setSaving(true);
    try {
      await saveAiProvider({ ...payload(), enabled: false, removeKey: true, apiKey: undefined });
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
            provider to power the copilot with a real model. Your key is stored on your server and
            never sent to the browser.
          </p>
        </div>
        <div className="mt-0.5 shrink-0">
          <Switch enabled={enabled} onToggle={() => setEnabled(!enabled)} label="Use a model provider" />
        </div>
      </div>

      <div className={cx('mt-5 flex flex-col gap-4', !enabled && 'opacity-60')}>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Provider</span>
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p)}
                className={cx(
                  'h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
                  currentProvider?.key === p.key ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-text-2 hover:bg-surface-2',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Base URL</span>
          <input type="text" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setFetchedIds([]); }} placeholder="https://api.deepseek.com/v1" className={`${FIELD} font-mono text-[13px]`} />
        </label>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium">Model</span>
            <button
              type="button"
              onClick={() => void loadModels()}
              disabled={loadingModels || baseUrl.trim() === ''}
              className="text-[12px] font-medium text-accent hover:underline disabled:opacity-50"
            >
              {loadingModels ? 'Loading…' : fetchedIds.length > 0 ? `Reload models (${fetchedIds.length})` : 'Load models from provider'}
            </button>
          </div>
          <ModelPicker
            models={modelList}
            value={model}
            onChange={(id, info) => {
              setModel(id);
              if (info) setReasoning(info.reasoning);
              setTest(null);
            }}
          />
          {modelUnavailable && (
            <span className="flex items-center gap-1.5 text-[12px] text-amber">
              <IconAlert size={13} className="shrink-0" />
              <span>
                <b className="font-mono">{model}</b> isn’t in your provider’s current model list — it may be renamed or retired.
              </span>
            </span>
          )}
          {availableModels !== null && sameUrl(availableModels.baseUrl, baseUrl) && (
            <span className="text-[12px] text-text-3">
              {availableModels.models.length} models available from your provider · auto-checked on startup and daily
            </span>
          )}
          {selectedInfo ? (
            <span className="text-[12px] text-text-3">
              {selectedInfo.inputPer1M === 0 && selectedInfo.outputPer1M === 0
                ? 'Runs locally · free'
                : `≈ ${formatPrice(selectedInfo.inputPer1M)} in · ${formatPrice(selectedInfo.outputPer1M)} out per 1M tokens`}
              {' · '}{formatContext(selectedInfo.contextK)} context{selectedInfo.reasoning ? ' · reasoning' : ''}
            </span>
          ) : (
            <span className="text-[12px] text-text-3">Custom model id — sent to the provider as-is.</span>
          )}
          {currentProvider && (
            <span className="text-[12px] text-text-3">
              {PRICES_NOTE.replace(/’/g, "'")}{' '}
              <span className="font-mono text-[11px] text-text-2">{currentProvider.pricingUrl}</span>
            </span>
          )}
        </div>

        <label className="flex items-start gap-2.5 rounded-md border border-line p-2.5">
          <input
            type="checkbox"
            checked={kbOnly}
            onChange={(e) => setKbOnly(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-green"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Answer only from the knowledge base</span>
            <span className="block text-[12px] text-text-3">
              Drafts and auto-resolves use only your published articles as facts and never guess. Turn off to let the model add general knowledge (less safe, more flexible).
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 rounded-md border border-line p-2.5">
          <input
            type="checkbox"
            checked={reasoning}
            onChange={(e) => setReasoning(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-green"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Reasoning model</span>
            <span className="block text-[12px] text-text-3">
              Allocates a much larger response budget so chain-of-thought models still return a full answer. Set automatically when you pick a known reasoning model.
            </span>
          </span>
        </label>

        {looksLikeReasoningModel(model) && !reasoning && (
          <div className="flex items-start gap-2 rounded-md border border-amber/30 bg-amber-bg px-3 py-2 text-[12px] text-amber">
            <IconAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              <b>{model}</b> looks like a reasoning model, but Reasoning is off. It may spend its whole budget thinking
              and return an empty answer — which falls back to a rule-based draft.{' '}
              <button type="button" className="font-semibold underline" onClick={() => setReasoning(true)}>
                Turn on Reasoning
              </button>
              .
            </span>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">
            <Tooltip
              title="API key"
              label="Your private credential for this provider, from their dashboard. Stored on your server and never sent to the browser."
            >
              API key
            </Tooltip>
          </span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? 'Stored — leave blank to keep it' : 'Paste your provider key'}
            className={`${FIELD} font-mono text-[13px]`}
            autoComplete="off"
          />
          {provider.keyHint !== null && key.trim() === '' && (
            <span className="text-[12px] text-text-3">
              Stored key <span className="font-mono text-text-2">{provider.keyHint}</span> · kept unless you type a new one or remove it
            </span>
          )}
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
            !test.ok && 'border-red/30 bg-red-bg text-red',
            test.ok && test.empty && 'border-amber/30 bg-amber-bg text-amber',
            test.ok && !test.empty && 'border-green/30 bg-green-bg text-green',
          )}
        >
          {!test.ok
            ? `Connection failed: ${test.error ?? 'unknown error'}`
            : test.empty
              ? `Reached ${test.model ?? model}, but it returned no text. ${
                  looksLikeReasoningModel(model) && !reasoning
                    ? 'It looks like a reasoning model — turn on Reasoning above so it has budget to answer.'
                    : 'Double-check the model id — for DeepSeek try deepseek-chat or deepseek-reasoner.'
                }`
              : `Connected to ${test.model ?? model}${test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ''}`}
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
