import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, Agent, AgentInvite,
  AgentPatch, ArticleCreate, ArticlePatch, AssignmentSettings, Attachment, AutomationRule, CannedReply, ChannelConn, ChannelCreate, ChannelPatch, ChannelTestResult,
  CustomFieldCreate, CustomFieldDef, CustomFieldPatch, ImportInput, ImportResult, ImportType, IntakeAnswer, IntakeForm, Notification, TicketEvent, TicketSeen, SavedView, SavedViewCreate,
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

  listTickets(): Promise<Ticket[]> {
    return request('/tickets');
  }
  listNotifications(): Promise<Notification[]> {
    return request('/notifications');
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
  async bulkPatchTickets(ids: string[], patch: TicketPatch, addTags?: string[]): Promise<Ticket[]> {
    const { updated } = await request<{ updated: Ticket[] }>('/tickets', jsonInit('PATCH', { ids, patch, addTags }));
    return updated;
  }

  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string; attachmentIds?: string[] }): Promise<{ message: Message; ticket: Ticket }> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/messages`, jsonInit('POST', input));
  }
  async deleteMessage(ticketId: string, messageId: string): Promise<Message> {
    const { message } = await request<{ message: Message }>(
      `/tickets/${encodeURIComponent(ticketId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    );
    return message;
  }
  mergeTicket(ticketId: string, into: string): Promise<{ source: Ticket; target: Ticket }> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/merge`, jsonInit('POST', { into }));
  }
  getTicketEvents(ticketId: string): Promise<TicketEvent[]> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/events`);
  }
  getTicketSeen(ticketId: string): Promise<TicketSeen[]> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/seen`);
  }
  getTicketIntake(ticketId: string): Promise<IntakeAnswer[]> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/intake`);
  }
  uploadAttachment(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file);
    return request('/uploads', { method: 'POST', body: form });
  }

  createContact(input: { name: string; email: string; company?: string }): Promise<Contact> {
    return request('/contacts', jsonInit('POST', input));
  }

  saveCanned(c: CannedReply): Promise<CannedReply> {
    const body = { title: c.title, body: c.body, actions: c.actions };
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

  saveAssignment(settings: AssignmentSettings): Promise<AssignmentSettings> {
    return request('/settings/assignment', jsonInit('PUT', settings));
  }

  saveIntakeForm(form: IntakeForm): Promise<IntakeForm> {
    return request('/intake-form', jsonInit('PUT', form));
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
  createSavedView(input: SavedViewCreate): Promise<SavedView> {
    return request('/saved-views', jsonInit('POST', input));
  }
  async deleteSavedView(id: string): Promise<void> {
    await request<{ ok: true }>(`/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  markNotificationsRead(id?: string): Promise<Notification[]> {
    return request('/notifications/read', jsonInit('POST', id === undefined ? {} : { id }));
  }

  // Reads the body on any status: a 400 (required column unmapped) still carries
  // the headers + partial mapping the import UI needs to render its selectors.
  async importData(input: ImportInput): Promise<ImportResult> {
    const res = await fetch('/api/import', jsonInit('POST', input));
    return (await res.json()) as ImportResult;
  }

  async exportCsv(type: ImportType): Promise<string> {
    const res = await fetch(`/api/export?type=${encodeURIComponent(type)}`);
    if (!res.ok) throw new Error('export failed');
    return res.text();
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
  listProviderModels(input: { baseUrl?: string; apiKey?: string } = {}): Promise<{ models?: string[]; error?: string }> {
    return request('/ai/models', jsonInit('POST', input));
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
