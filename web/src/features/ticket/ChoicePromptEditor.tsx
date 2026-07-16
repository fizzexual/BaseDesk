import type { ChoiceLayout, ChoiceOption, ChoicePrompt } from '../../data/types';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Tooltip } from '../../components/Tooltip';
import { IconList, IconPlus, IconX } from '../../icons';

// Ephemeral option ids for editing (React keys); the server assigns stable ids on send.
let optSeq = 0;
const newOptId = () => `opt_${++optSeq}`;

/** A blank choice prompt to drop into the composer. */
export function newChoicePrompt(): ChoicePrompt {
  return {
    type: 'choice_prompt',
    question: '',
    layout: 'buttons',
    options: [{ id: newOptId(), label: '' }, { id: newOptId(), label: '' }],
  };
}

/** True once the prompt is worth sending: a question and at least two real options. */
export function isChoicePromptValid(p: ChoicePrompt): boolean {
  return p.question.trim() !== '' && p.options.filter((o) => o.label.trim() !== '').length >= 2;
}

/** Composer editor for a pending choice prompt — question, layout, and option rows. */
export function ChoicePromptEditor({
  prompt,
  onChange,
  onRemove,
}: {
  prompt: ChoicePrompt;
  onChange: (next: ChoicePrompt) => void;
  onRemove: () => void;
}) {
  const setQuestion = (question: string) => onChange({ ...prompt, question });
  const setLayout = (layout: ChoiceLayout) => onChange({ ...prompt, layout });
  const setOption = (id: string, label: string) =>
    onChange({ ...prompt, options: prompt.options.map((o) => (o.id === id ? { ...o, label } : o)) });
  const addOption = () => {
    if (prompt.options.length >= 10) return;
    onChange({ ...prompt, options: [...prompt.options, { id: newOptId(), label: '' } satisfies ChoiceOption] });
  };
  const removeOption = (id: string) => {
    // A choice prompt needs at least two options to be sendable — keep the last two.
    if (prompt.options.length <= 2) return;
    onChange({ ...prompt, options: prompt.options.filter((o) => o.id !== id) });
  };

  return (
    <div className="rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[12px]">
      <div className="flex items-center gap-2">
        <IconList size={13} className="shrink-0 text-accent" />
        <span className="flex-1 font-medium">Ask the customer</span>
        <SegmentedControl<ChoiceLayout>
          options={[
            { value: 'buttons', label: 'Buttons' },
            { value: 'dropdown', label: 'Dropdown' },
          ]}
          value={prompt.layout}
          onChange={setLayout}
        />
        <Tooltip label="Remove question">
          <button
            type="button"
            aria-label="Remove question"
            onClick={onRemove}
            className="shrink-0 rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-3 hover:text-text"
          >
            <IconX size={12} />
          </button>
        </Tooltip>
      </div>
      <input
        value={prompt.question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Your question…"
        className="mt-1.5 w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-text-3"
      />
      <div className="mt-1.5 flex flex-col gap-1">
        {prompt.options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-1.5">
            <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-text-3">{i + 1}</span>
            <input
              value={o.label}
              onChange={(e) => setOption(o.id, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-[13px] outline-none placeholder:text-text-3"
            />
            <Tooltip label="Remove option">
              <button
                type="button"
                aria-label={`Remove option ${i + 1}`}
                disabled={prompt.options.length <= 1}
                onClick={() => removeOption(o.id)}
                className="shrink-0 rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
              >
                <IconX size={12} />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      {prompt.options.length < 10 && (
        <button
          type="button"
          onClick={addOption}
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-text-2 transition-colors hover:text-text"
        >
          <IconPlus size={12} /> Add option
        </button>
      )}
    </div>
  );
}
