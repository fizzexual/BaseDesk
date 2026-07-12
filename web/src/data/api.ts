import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, Agent, AgentInvite,
  AgentPatch, ArticleCreate, ArticlePatch, AutomationRule, CannedReply, ChannelConn, ChannelCreate, ChannelPatch, ChannelTestResult,
  CustomFieldCreate, CustomFieldDef, CustomFieldPatch,
  Contact, CopilotTriage, Deal, DealCreate, DealPatch, DealStage, DealType, DraftResult, KbArticle, Message, SlaHours,
  SlaTargets, SmtpSave, SmtpSettings, SmtpTestResult, StatsOverview, SummaryResult, Ticket, TicketPatch, TicketPriority,
} from './types';
import type { BootstrapData, Repository } from './repository';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') detail = data.error;
    } catch {
      // non-JSON error body; fall back to the status text
    }
    throw new Error(detail ?? res.statusText);
  }
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export class ApiRepository implements Repository {
  bootstrap(): Promise<BootstrapData> {
    return request('/bootstrap');
  }

  getMessages(ticketId: string): Promise<Message[]> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/messages`);
  }

  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<{ ticket: Ticket; message: Message }> {
    return request('/tickets', jsonInit('POST', input));
  }

  updateTicket(id: string, patch: TicketPatch): Promise<Ticket> {
    return request(`/tickets/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }

  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string }): Promise<{ message: Message; ticket: Ticket }> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/messages`, jsonInit('POST', input));
  }

  createContact(input: { name: string; email: string; company?: string }): Promise<Contact> {
    return request('/contacts', jsonInit('POST', input));
  }

  saveCanned(c: CannedReply): Promise<CannedReply> {
    const body = { title: c.title, body: c.body };
    return c.id
      ? request(`/canned/${encodeURIComponent(c.id)}`, jsonInit('PUT', body))
      : request('/canned', jsonInit('POST', body));
  }

  async deleteCanned(id: string): Promise<void> {
    await request<{ ok: true }>(`/canned/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getStats(): Promise<StatsOverview> {
    return request('/stats');
  }

  search(q: string): Promise<{ ticketIds: string[] }> {
    return request(`/search?q=${encodeURIComponent(q)}`);
  }

  listDeals(filter?: { stage?: DealStage; type?: DealType; contactId?: string }): Promise<Deal[]> {
    const qs = new URLSearchParams();
    if (filter?.stage) qs.set('stage', filter.stage);
    if (filter?.type) qs.set('type', filter.type);
    if (filter?.contactId) qs.set('contactId', filter.contactId);
    const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
    return request(`/deals${suffix}`);
  }

  createDeal(input: DealCreate): Promise<Deal> {
    return request('/deals', jsonInit('POST', input));
  }

  updateDeal(id: string, patch: DealPatch): Promise<Deal> {
    return request(`/deals/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }

  async deleteDeal(id: string): Promise<void> {
    await request<{ ok: true }>(`/deals/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  saveSlaTargets(targets: SlaTargets): Promise<SlaTargets> {
    return request('/settings/sla', jsonInit('PUT', targets));
  }

  saveAutomation(rules: AutomationRule[]): Promise<AutomationRule[]> {
    return request('/settings/automation', jsonInit('PUT', rules));
  }

  createArticle(input: ArticleCreate): Promise<KbArticle> {
    return request('/kb', jsonInit('POST', input));
  }

  updateArticle(id: string, patch: ArticlePatch): Promise<KbArticle> {
    return request(`/kb/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }

  async deleteArticle(id: string): Promise<void> {
    await request<{ ok: true }>(`/kb/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  createAiAgent(input: AiAgentCreate): Promise<AiAgent> {
    return request('/ai/agents', jsonInit('POST', input));
  }
  updateAiAgent(id: string, patch: AiAgentPatch): Promise<AiAgent> {
    return request(`/ai/agents/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }
  async deleteAiAgent(id: string): Promise<void> {
    await request<{ ok: true }>(`/ai/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  runAgents(): Promise<{ created: number }> {
    return request('/ai/run', { method: 'POST' });
  }
  approveAction(id: string): Promise<{ action: AiAction; ticket: Ticket; message: Message }> {
    return request(`/ai/actions/${encodeURIComponent(id)}/approve`, { method: 'POST' });
  }
  dismissAction(id: string): Promise<{ action: AiAction }> {
    return request(`/ai/actions/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  }

  createChannel(input: ChannelCreate): Promise<ChannelConn> {
    return request('/channels', jsonInit('POST', input));
  }
  updateChannel(id: string, patch: ChannelPatch): Promise<ChannelConn> {
    return request(`/channels/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }
  async deleteChannel(id: string): Promise<void> {
    await request<{ ok: true }>(`/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  testChannel(id: string): Promise<ChannelTestResult> {
    return request(`/channels/${encodeURIComponent(id)}/test`, { method: 'POST' });
  }
  createCustomField(input: CustomFieldCreate): Promise<CustomFieldDef> {
    return request('/custom-fields', jsonInit('POST', input));
  }
  updateCustomField(id: string, patch: CustomFieldPatch): Promise<CustomFieldDef> {
    return request(`/custom-fields/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }
  async deleteCustomField(id: string): Promise<void> {
    await request<{ ok: true }>(`/custom-fields/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  inviteAgent(input: AgentInvite): Promise<Agent> {
    return request('/agents', jsonInit('POST', input));
  }
  updateAgent(id: string, patch: AgentPatch): Promise<Agent> {
    return request(`/agents/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }
  async deleteAgent(id: string): Promise<void> {
    await request<{ ok: true }>(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  saveSlaHours(hours: SlaHours): Promise<SlaHours> {
    return request('/settings/sla-hours', jsonInit('PUT', hours));
  }

  saveAiProvider(input: AiProviderSave): Promise<AiProvider> {
    return request('/ai/provider', jsonInit('PUT', input));
  }
  testAiProvider(input: AiProviderSave = {}): Promise<AiTestResult> {
    return request('/ai/provider/test', jsonInit('POST', input));
  }
  saveSmtp(input: SmtpSave): Promise<SmtpSettings> {
    return request('/settings/smtp', jsonInit('PUT', input));
  }
  testSmtp(to = ''): Promise<SmtpTestResult> {
    return request('/settings/smtp/test', jsonInit('POST', { to }));
  }
  aiDraft(ticketId: string): Promise<DraftResult> {
    return request('/ai/draft', jsonInit('POST', { ticketId }));
  }
  aiTriage(ticketId: string): Promise<CopilotTriage> {
    return request('/ai/triage', jsonInit('POST', { ticketId }));
  }
  aiSummarize(ticketId: string): Promise<SummaryResult> {
    return request('/ai/summarize', jsonInit('POST', { ticketId }));
  }
}
