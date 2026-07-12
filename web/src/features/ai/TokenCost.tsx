import { useApp } from '../../data/store';
import { estimateCost, formatCost, formatTokens } from '../../data/model-catalog';
import { cx } from '../../components/util';

/**
 * Shows what an AI generation cost — token count and dollar estimate at the
 * configured model's price. Rule-based generations spent nothing, so they read
 * "Rule-based · free". Cost is omitted when the model's price isn't in the catalog.
 */
export function TokenCost({
  promptTokens,
  completionTokens,
  className,
}: {
  promptTokens: number;
  completionTokens: number;
  className?: string;
}) {
  const provider = useApp((s) => s.aiProvider);
  const total = promptTokens + completionTokens;

  if (total === 0) {
    return <span className={cx('text-[12px] text-text-3', className)}>Rule-based · free</span>;
  }
  const cost = estimateCost(promptTokens, completionTokens, provider.baseUrl, provider.model);
  return (
    <span className={cx('text-[12px] tabular-nums text-text-3', className)}>
      {formatTokens(total)} tokens
      {cost !== null && ` · ${formatCost(cost)}`}
    </span>
  );
}
