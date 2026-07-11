import { useNavigate, useParams } from 'react-router';
import { SegmentedControl } from '../../components/SegmentedControl';
import { PipelineTab } from './PipelineTab';
import { AccountsTab } from './AccountsTab';

type Tab = 'pipeline' | 'accounts';

export function RevenuePage() {
  const navigate = useNavigate();
  const params = useParams();
  const tab: Tab = params.tab === 'accounts' ? 'accounts' : 'pipeline';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="text-[15px] font-semibold">Revenue</h1>
        <div className="flex-1" />
        <SegmentedControl
          options={[
            { value: 'pipeline', label: 'Pipeline' },
            { value: 'accounts', label: 'Accounts' },
          ]}
          value={tab}
          onChange={(v) => navigate(`/revenue/${v}`)}
        />
      </div>
      {tab === 'pipeline' ? <PipelineTab /> : <AccountsTab />}
    </div>
  );
}
