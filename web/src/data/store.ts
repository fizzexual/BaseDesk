import { create } from 'zustand';
import type {
  AccountHealth, AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, AiUsage, Agent, AssignmentSettings, AutoAck, TimeRule, ModelCache,
  AgentInvite, AgentPatch, ArticleCreate, ArticlePatch, Attachment, AutomationRule, CannedReply, ChannelConn, ChannelCreate,
  ChannelPatch, ChannelTestResult, Contact, CopilotTriage, Counts, CustomFieldCreate, CustomFieldDef, CustomFieldPatch, ImportInput, ImportResult, ImportType, IntakeAnswer, IntakeForm, Notification, TicketEvent, TicketSeen, TicketFollower, TicketTask, TicketLink, TicketLinkType, SavedView, SavedViewCreate, Deal, DealCreate, DealPatch, DraftResult, KbArticle, Message,
  SlaHours, SlaTargets, SmtpSave, SmtpSettings, SmtpTestResult, SummaryResult, Ticket, TicketPatch, TicketPriority, TokenUsage, ViewId,
} from './types';
import type { Repository } from './repository';
import { repo } from './index';
import { categoriesFromForm } from './local';
import { DEFAULT_AI_PROVIDER, DEFAULT_AUTO_ACK, DEFAULT_SLA_HOURS, DEFAULT_SLA_TARGETS, DEFAULT_SMTP, DEFAULT_TIME_RULES } from './defaults';
import { applyTheme, readThemePref } from '../app/theme';

export interface AppState {
  ready: boolean;
  tickets: Record<string, Ticket>; contacts: Record<string, Contact>;
  agents: Record<string, Agent>; canned: CannedReply[];
  deals: Record<string, Deal>;
  sla: SlaTargets;
  assignment: AssignmentSettings;
  autoAck: AutoAck;
  timeRules: TimeRule[];
  slaHours: SlaHours;
  automation: AutomationRule[];
  kb: Record<string, KbArticle>;
  aiAgents: Record<string, AiAgent>;
  aiActions: Record<string, AiAction>;
  aiUsage: AiUsage; // aggregate token spend across all recorded model calls
  availableModels: ModelCache | null; // provider's live model list, refreshed on boot + daily
  channels: Record<string, ChannelConn>;
  customFields: CustomFieldDef[]; // ordered by entity + position
  savedViews: SavedView[];
  intakeForm: IntakeForm; // branching ticket-creation questionnaire (admin-built)
  categories: string[]; // distinct categories the intake form can assign
  notifications: Notification[]; // @mention alerts for the current agent, newest first
  aiProvider: AiProvider;
  smtp: SmtpSettings;
  messages: Record<string, Message[]>; // keyed by ticketId, loaded lazily
  ticketEvents: Record<string, TicketEvent[]>; // activity timeline, keyed by ticketId
  ticketSeen: Record<string, TicketSeen[]>; // read receipts, keyed by ticketId
  ticketFollowers: Record<string, TicketFollower[]>; // watchers, keyed by ticketId
  ticketTasks: Record<string, TicketTask[]>; // checklist items, keyed by ticketId
  ticketLinks: Record<string, TicketLink[]>; // related/blocking tickets, keyed by ticketId
  ticketIntake: Record<string, IntakeAnswer[]>; // intake-form answers, keyed by ticketId
  composerPrefill: string | null; // text to drop into the ticket composer (e.g. from an AI draft)
  currentAgentId: string;
  theme: 'light' | 'dark' | 'system';
  init(): Promise<void>;
  ticketsForView(view: ViewId): Ticket[];      // sorted lastMessageAt desc
  counts(): Counts;
  loadMessages(ticketId: string): Promise<void>;
  loadEvents(ticketId: string): Promise<void>;
  /** Follow/unfollow a ticket (defaults to the current agent), updating its watcher list. */
  followTicket(ticketId: string, agentId?: string): Promise<void>;
  unfollowTicket(ticketId: string, agentId: string): Promise<void>;
  /** Ticket checklist mutations — each refreshes the ticket's task list in the store. */
  addTask(ticketId: string, title: string): Promise<void>;
  patchTask(ticketId: string, taskId: string, patch: { title?: string; done?: boolean }): Promise<void>;
  deleteTask(ticketId: string, taskId: string): Promise<void>;
  /** Typed links to other tickets — each mutation refreshes the ticket's link list. */
  addLink(ticketId: string, linkedTicketId: string, type: TicketLinkType): Promise<void>;
  removeLink(ticketId: string, linkId: string): Promise<void>;
  /** Live sync: merge the latest tickets from the server into the store. */
  refreshTickets(): Promise<void>;
  /** Live sync: re-fetch an open ticket's messages + read receipts so new replies appear. */
  refreshOpenMessages(ticketId: string): Promise<void>;
  /** Live sync: refresh the current agent's notifications. */
  refreshNotifications(): Promise<void>;
  patchTicket(id: string, patch: TicketPatch): Promise<void>;   // optimistic + rollback on error
  bulkPatch(ids: string[], patch: TicketPatch, addTags?: string[]): Promise<void>;
  sendMessage(ticketId: string, kind: 'reply' | 'note', body: string, attachmentIds?: string[]): Promise<void>;
  mergeTicket(ticketId: string, into: string): Promise<void>;
  /** Split messages out into a new related ticket; resolves to the new ticket's id. */
  splitTicket(ticketId: string, subject: string, messageIds: string[]): Promise<string>;
  deleteMessage(ticketId: string, messageId: string): Promise<void>;
  uploadAttachment(file: File): Promise<Attachment>;
  setComposerPrefill(text: string | null): void;
  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<string>; // returns id
  createContact(input: { name: string; email: string; company?: string }): Promise<string>;
  saveCanned(c: CannedReply): Promise<void>; deleteCanned(id: string): Promise<void>;
  createDeal(input: DealCreate): Promise<string>;               // returns id
  updateDeal(id: string, patch: DealPatch): Promise<void>;      // optimistic + rollback
  deleteDeal(id: string): Promise<void>;                        // optimistic + rollback
  dealsForTicket(ticketId: string): Deal[];                     // updatedAt desc
  dealsForContact(contactId: string): Deal[];                   // updatedAt desc
  accounts(): AccountHealth[];                                  // grouped by company
  saveSlaTargets(targets: SlaTargets): Promise<void>;
  saveSlaHours(hours: SlaHours): Promise<void>;
  saveAutomation(rules: AutomationRule[]): Promise<void>;
  saveAssignment(settings: AssignmentSettings): Promise<void>;
  saveAutoAck(settings: AutoAck): Promise<void>;
  saveTimeRules(rules: TimeRule[]): Promise<void>;
  runTimeRules(): Promise<number>;
  saveIntakeForm(form: IntakeForm): Promise<void>;
  inviteAgent(input: AgentInvite): Promise<string>;             // returns id
  updateAgent(id: string, patch: AgentPatch): Promise<void>;    // optimistic + rollback
  deleteAgent(id: string): Promise<void>;                       // optimistic + rollback
  createArticle(input: ArticleCreate): Promise<string>;
  updateArticle(id: string, patch: ArticlePatch): Promise<void>;
  deleteArticle(id: string): Promise<void>;
  createAiAgent(input: AiAgentCreate): Promise<string>;
  updateAiAgent(id: string, patch: AiAgentPatch): Promise<void>;
  deleteAiAgent(id: string): Promise<void>;
  runAgents(): Promise<number>;
  approveAction(id: string): Promise<void>;
  dismissAction(id: string): Promise<void>;
  createChannel(input: ChannelCreate): Promise<string>;
  updateChannel(id: string, patch: ChannelPatch): Promise<void>;
  deleteChannel(id: string): Promise<void>;
  testChannel(id: string): Promise<ChannelTestResult>;
  createCustomField(input: CustomFieldCreate): Promise<void>;
  updateCustomField(id: string, patch: CustomFieldPatch): Promise<void>;
  deleteCustomField(id: string): Promise<void>;
  createSavedView(input: SavedViewCreate): Promise<void>;
  deleteSavedView(id: string): Promise<void>;
  markNotificationsRead(id?: string): Promise<void>;
  importData(input: ImportInput): Promise<ImportResult>;
  exportCsv(type: ImportType): Promise<string>;
  setTicketField(ticketId: string, fieldId: string, value: string): Promise<void>;
  saveAiProvider(input: AiProviderSave): Promise<void>;
  testAiProvider(input?: AiProviderSave): Promise<AiTestResult>;
  listProviderModels(input?: { baseUrl?: string; apiKey?: string }): Promise<{ models?: string[]; error?: string }>;
  saveSmtp(input: SmtpSave): Promise<void>;
  testSmtp(to?: string): Promise<SmtpTestResult>;
  bumpUsage(u: TokenUsage): void;
  aiDraft(ticketId: string): Promise<DraftResult>;
  aiTriage(ticketId: string): Promise<CopilotTriage>;
  aiSummarize(ticketId: string): Promise<SummaryResult>;
  setTheme(t: 'light' | 'dark' | 'system'): void;
  searchLocal(q: string): Ticket[];  // subject/preview/requester name+email/tags, max 20
}

function isSnoozed(t: Ticket, now: string): boolean {
  return t.snoozedUntil !== null && t.snoozedUntil > now;
}

function matchesView(t: Ticket, view: ViewId, currentAgentId: string, now: string): boolean {
  switch (view) {
    case 'archive':
    case 'spam':
    case 'trash':
      return t.bucket === view;
    case 'snoozed':
      return t.bucket === 'inbox' && isSnoozed(t, now);
    default:
      break;
  }
  if (t.bucket !== 'inbox' || isSnoozed(t, now)) return false;
  switch (view) {
    case 'all':
      return t.status !== 'closed';
    case 'unassigned':
      return t.assigneeId === null && (t.status === 'open' || t.status === 'pending');
    case 'mine':
      return (
        t.assigneeId === currentAgentId &&
        (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold')
      );
    case 'awaiting':
      // Threads that owe the customer a reply — matches the "Awaiting reply" badge.
      return t.awaitingReply && t.status !== 'solved' && t.status !== 'closed';
    default:
      return t.status === view;
  }
}

/** First 90 chars of the body with all whitespace collapsed to single spaces. */
function previewOf(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function initialTheme(): 'light' | 'dark' | 'system' {
  // Node exposes an experimental localStorage global that throws when no
  // backing file is configured; fall back to 'system' outside the browser.
  try {
    return readThemePref();
  } catch {
    return 'system';
  }
}

const byRecency = (a: Ticket, b: Ticket) => b.lastMessageAt.localeCompare(a.lastMessageAt);

export function createAppStore(repository: Repository) {
  let tempCounter = 0;
  return create<AppState>()((set, get) => ({
    ready: false,
    tickets: {},
    contacts: {},
    agents: {},
    canned: [],
    deals: {},
    sla: DEFAULT_SLA_TARGETS,
    assignment: { enabled: false, strategy: 'round_robin' },
    autoAck: DEFAULT_AUTO_ACK,
    timeRules: DEFAULT_TIME_RULES,
    slaHours: DEFAULT_SLA_HOURS,
    automation: [],
    kb: {},
    aiAgents: {},
    aiActions: {},
    aiUsage: { promptTokens: 0, completionTokens: 0, generations: 0 },
    availableModels: null,
    channels: {},
    customFields: [],
    savedViews: [],
    intakeForm: { enabled: false, rootId: null, nodes: {} },
    categories: [],
    notifications: [],
    aiProvider: DEFAULT_AI_PROVIDER,
    smtp: DEFAULT_SMTP,
    messages: {},
    ticketEvents: {},
    ticketSeen: {},
    ticketFollowers: {},
    ticketTasks: {},
    ticketLinks: {},
    ticketIntake: {},
    composerPrefill: null,
    currentAgentId: '',
    theme: initialTheme(),

    async init() {
      const data = await repository.bootstrap();
      set({
        ready: true,
        tickets: Object.fromEntries(data.tickets.map((t) => [t.id, t])),
        contacts: Object.fromEntries(data.contacts.map((c) => [c.id, c])),
        agents: Object.fromEntries(data.agents.map((a) => [a.id, a])),
        canned: data.canned,
        deals: Object.fromEntries(data.deals.map((d) => [d.id, d])),
        sla: data.sla,
        assignment: data.assignment,
        autoAck: data.autoAck,
        timeRules: data.timeRules,
        slaHours: data.slaHours,
        automation: data.automation,
        kb: Object.fromEntries(data.kb.map((a) => [a.id, a])),
        aiAgents: Object.fromEntries(data.aiAgents.map((a) => [a.id, a])),
        aiActions: Object.fromEntries(data.aiActions.map((a) => [a.id, a])),
        aiUsage: data.aiUsage,
        availableModels: data.availableModels,
        channels: Object.fromEntries(data.channels.map((ch) => [ch.id, ch])),
        customFields: data.customFields,
        savedViews: data.savedViews,
        intakeForm: data.intakeForm,
        categories: data.categories,
        notifications: data.notifications,
        aiProvider: data.aiProvider,
        smtp: data.smtp,
        currentAgentId: data.currentAgentId,
      });
    },

    ticketsForView(view) {
      const now = new Date().toISOString();
      const { tickets, currentAgentId } = get();
      return Object.values(tickets)
        .filter((t) => matchesView(t, view, currentAgentId, now))
        .sort(byRecency);
    },

    counts() {
      const now = new Date().toISOString();
      const { tickets, currentAgentId } = get();
      const c: Counts = {
        all: 0, unassigned: 0, mine: 0, awaiting: 0, snoozed: 0,
        open: 0, pending: 0, on_hold: 0, solved: 0, closed: 0,
        archive: 0, spam: 0, trash: 0,
      };
      for (const t of Object.values(tickets)) {
        if (t.bucket === 'archive') c.archive += 1;
        if (t.bucket === 'spam') c.spam += 1;
        if (t.bucket === 'trash') c.trash += 1;
        if (t.bucket !== 'inbox') continue;
        if (isSnoozed(t, now)) {
          c.snoozed += 1;
          continue;
        }
        c[t.status] += 1;
        if (t.status !== 'closed' && t.status !== 'solved' && t.awaitingReply) c.awaiting += 1;
        if (t.status !== 'closed') {
          c.all += 1;
          if (t.assigneeId === null && (t.status === 'open' || t.status === 'pending')) c.unassigned += 1;
          if (
            t.assigneeId === currentAgentId &&
            (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold')
          ) {
            c.mine += 1;
          }
        }
      }
      return c;
    },

    async loadMessages(ticketId) {
      const [msgs, events] = await Promise.all([
        repository.getMessages(ticketId),
        repository.getTicketEvents(ticketId).catch(() => [] as TicketEvent[]),
      ]);
      // Fetch read receipts after messages resolve — opening the thread records
      // the current agent as having seen it, and we want that reflected.
      const [seen, intake, followers, tasks, links] = await Promise.all([
        repository.getTicketSeen(ticketId).catch(() => [] as TicketSeen[]),
        repository.getTicketIntake(ticketId).catch(() => [] as IntakeAnswer[]),
        repository.getFollowers(ticketId).catch(() => [] as TicketFollower[]),
        repository.getTasks(ticketId).catch(() => [] as TicketTask[]),
        repository.getLinks(ticketId).catch(() => [] as TicketLink[]),
      ]);
      set((s) => ({
        messages: { ...s.messages, [ticketId]: msgs },
        ticketEvents: { ...s.ticketEvents, [ticketId]: events },
        ticketSeen: { ...s.ticketSeen, [ticketId]: seen },
        ticketIntake: { ...s.ticketIntake, [ticketId]: intake },
        ticketFollowers: { ...s.ticketFollowers, [ticketId]: followers },
        ticketTasks: { ...s.ticketTasks, [ticketId]: tasks },
        ticketLinks: { ...s.ticketLinks, [ticketId]: links },
      }));
    },

    async loadEvents(ticketId) {
      const events = await repository.getTicketEvents(ticketId);
      set((s) => ({ ticketEvents: { ...s.ticketEvents, [ticketId]: events } }));
    },

    async followTicket(ticketId, agentId) {
      const followers = await repository.followTicket(ticketId, agentId);
      set((s) => ({ ticketFollowers: { ...s.ticketFollowers, [ticketId]: followers } }));
    },

    async unfollowTicket(ticketId, agentId) {
      const followers = await repository.unfollowTicket(ticketId, agentId);
      set((s) => ({ ticketFollowers: { ...s.ticketFollowers, [ticketId]: followers } }));
    },

    async addTask(ticketId, title) {
      const tasks = await repository.addTask(ticketId, title);
      set((s) => ({ ticketTasks: { ...s.ticketTasks, [ticketId]: tasks } }));
    },

    async patchTask(ticketId, taskId, patch) {
      const tasks = await repository.patchTask(ticketId, taskId, patch);
      set((s) => ({ ticketTasks: { ...s.ticketTasks, [ticketId]: tasks } }));
    },

    async deleteTask(ticketId, taskId) {
      const tasks = await repository.deleteTask(ticketId, taskId);
      set((s) => ({ ticketTasks: { ...s.ticketTasks, [ticketId]: tasks } }));
    },

    async addLink(ticketId, linkedTicketId, type) {
      const links = await repository.addLink(ticketId, linkedTicketId, type);
      set((s) => ({ ticketLinks: { ...s.ticketLinks, [ticketId]: links } }));
    },

    async removeLink(ticketId, linkId) {
      const links = await repository.removeLink(ticketId, linkId);
      set((s) => ({ ticketLinks: { ...s.ticketLinks, [ticketId]: links } }));
    },

    async refreshTickets() {
      const list = await repository.listTickets();
      // Merge server truth over the store (adds new tickets, updates changed ones).
      set((s) => ({ tickets: { ...s.tickets, ...Object.fromEntries(list.map((t) => [t.id, t])) } }));
    },

    async refreshOpenMessages(ticketId) {
      const [msgs, seen] = await Promise.all([
        repository.getMessages(ticketId),
        repository.getTicketSeen(ticketId).catch(() => get().ticketSeen[ticketId] ?? []),
      ]);
      set((s) => ({
        messages: { ...s.messages, [ticketId]: msgs },
        ticketSeen: { ...s.ticketSeen, [ticketId]: seen },
      }));
    },

    async refreshNotifications() {
      const notifications = await repository.listNotifications();
      set({ notifications });
    },

    async patchTicket(id, patch) {
      const prev = get().tickets[id] as Ticket | undefined;
      if (!prev) throw new Error('Ticket not found');
      const optimistic: Ticket = { ...prev, updatedAt: new Date().toISOString() };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (optimistic as unknown as Record<string, unknown>)[key] = value;
      }
      set((s) => ({ tickets: { ...s.tickets, [id]: optimistic } }));
      try {
        const ticket = await repository.updateTicket(id, patch);
        set((s) => ({ tickets: { ...s.tickets, [id]: ticket } }));
        // Refresh the timeline if this ticket's thread is loaded (a change logged events).
        if (get().ticketEvents[id] !== undefined) void get().loadEvents(id).catch(() => {});
      } catch (err) {
        set((s) => ({ tickets: { ...s.tickets, [id]: prev } }));
        throw err;
      }
    },

    async bulkPatch(ids, patch, addTags) {
      const prev = get().tickets;
      const now = new Date().toISOString();
      const optimistic = { ...prev };
      for (const id of ids) {
        const t = prev[id] as Ticket | undefined;
        if (!t) continue;
        const next: Ticket = { ...t, updatedAt: now };
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
        }
        if (addTags && addTags.length > 0) next.tags = Array.from(new Set([...t.tags, ...addTags]));
        optimistic[id] = next;
      }
      set({ tickets: optimistic });
      try {
        const updated = await repository.bulkPatchTickets(ids, patch, addTags);
        set((s) => {
          const merged = { ...s.tickets };
          for (const t of updated) merged[t.id] = t;
          return { tickets: merged };
        });
      } catch (err) {
        set({ tickets: prev });
        throw err;
      }
    },

    async sendMessage(ticketId, kind, body, attachmentIds = []) {
      const { tickets, messages, currentAgentId } = get();
      const prevTicket = tickets[ticketId] as Ticket | undefined;
      if (!prevTicket) throw new Error('Ticket not found');
      const prevMessages = messages[ticketId] ?? [];
      const now = new Date().toISOString();
      tempCounter += 1;
      const temp: Message = {
        id: `tmp_${tempCounter}`,
        ticketId,
        authorKind: 'agent',
        authorId: currentAgentId,
        kind,
        body,
        at: now,
      };
      const optimistic: Ticket = { ...prevTicket, updatedAt: now, lastMessageAt: now };
      if (kind === 'reply') {
        optimistic.lastMessagePreview = previewOf(body);
        if (optimistic.status === 'open') optimistic.status = 'pending';
      }
      set((s) => ({
        tickets: { ...s.tickets, [ticketId]: optimistic },
        messages: { ...s.messages, [ticketId]: [...prevMessages, temp] },
      }));
      try {
        const { message, ticket } = await repository.addMessage(ticketId, { kind, body, attachmentIds });
        set((s) => ({
          tickets: { ...s.tickets, [ticketId]: ticket },
          messages: {
            ...s.messages,
            [ticketId]: (s.messages[ticketId] ?? []).map((m) => (m.id === temp.id ? message : m)),
          },
        }));
      } catch (err) {
        set((s) => ({
          tickets: { ...s.tickets, [ticketId]: prevTicket },
          messages: { ...s.messages, [ticketId]: prevMessages },
        }));
        throw err;
      }
    },

    async deleteMessage(ticketId, messageId) {
      const prev = get().messages[ticketId] ?? [];
      const now = new Date().toISOString();
      const by = get().currentAgentId;
      const optimistic = prev.map((m) =>
        m.id === messageId ? { ...m, deletedAt: now, deletedBy: by, body: '', attachments: [] } : m,
      );
      set((s) => ({ messages: { ...s.messages, [ticketId]: optimistic } }));
      try {
        const message = await repository.deleteMessage(ticketId, messageId);
        set((s) => ({
          messages: {
            ...s.messages,
            [ticketId]: (s.messages[ticketId] ?? []).map((m) => (m.id === messageId ? message : m)),
          },
        }));
      } catch (err) {
        set((s) => ({ messages: { ...s.messages, [ticketId]: prev } }));
        throw err;
      }
    },

    async mergeTicket(ticketId, into) {
      const { source, target } = await repository.mergeTicket(ticketId, into);
      set((s) => {
        // Drop cached threads + timelines for both tickets so they reload fresh.
        const messages = { ...s.messages };
        const ticketEvents = { ...s.ticketEvents };
        delete messages[ticketId];
        delete messages[into];
        delete ticketEvents[ticketId];
        delete ticketEvents[into];
        return {
          tickets: { ...s.tickets, [source.id]: source, [target.id]: target },
          messages,
          ticketEvents,
        };
      });
    },

    async splitTicket(ticketId, subject, messageIds) {
      const { source, created } = await repository.splitTicket(ticketId, subject, messageIds);
      set((s) => {
        // The source thread, its timeline and its links all changed — drop the caches.
        const messages = { ...s.messages };
        const ticketEvents = { ...s.ticketEvents };
        const ticketLinks = { ...s.ticketLinks };
        delete messages[ticketId];
        delete ticketEvents[ticketId];
        delete ticketLinks[ticketId];
        return {
          tickets: { ...s.tickets, [source.id]: source, [created.id]: created },
          messages,
          ticketEvents,
          ticketLinks,
        };
      });
      return created.id;
    },

    async uploadAttachment(file) {
      return repository.uploadAttachment(file);
    },

    setComposerPrefill(text) {
      set({ composerPrefill: text });
    },

    async createTicket(input) {
      const { ticket, message } = await repository.createTicket(input);
      set((s) => ({
        tickets: { ...s.tickets, [ticket.id]: ticket },
        messages: { ...s.messages, [ticket.id]: [message] },
      }));
      return ticket.id;
    },

    async createContact(input) {
      const contact = await repository.createContact(input);
      set((s) => ({ contacts: { ...s.contacts, [contact.id]: contact } }));
      return contact.id;
    },

    async saveCanned(c) {
      const saved = await repository.saveCanned(c);
      set((s) => ({
        canned: s.canned.some((x) => x.id === saved.id)
          ? s.canned.map((x) => (x.id === saved.id ? saved : x))
          : [...s.canned, saved],
      }));
    },

    async deleteCanned(id) {
      await repository.deleteCanned(id);
      set((s) => ({ canned: s.canned.filter((c) => c.id !== id) }));
    },

    async createDeal(input) {
      const deal = await repository.createDeal(input);
      set((s) => ({ deals: { ...s.deals, [deal.id]: deal } }));
      return deal.id;
    },

    async updateDeal(id, patch) {
      const prev = get().deals[id] as Deal | undefined;
      if (!prev) throw new Error('Deal not found');
      const now = new Date().toISOString();
      const optimistic: Deal = { ...prev, ...patch, updatedAt: now };
      if (patch.stage !== undefined) {
        if (patch.stage === 'won' || patch.stage === 'lost') {
          optimistic.closedAt = prev.closedAt ?? now;
        } else {
          optimistic.closedAt = null;
        }
      }
      set((s) => ({ deals: { ...s.deals, [id]: optimistic } }));
      try {
        const deal = await repository.updateDeal(id, patch);
        set((s) => ({ deals: { ...s.deals, [id]: deal } }));
      } catch (err) {
        set((s) => ({ deals: { ...s.deals, [id]: prev } }));
        throw err;
      }
    },

    async deleteDeal(id) {
      const prev = get().deals[id] as Deal | undefined;
      if (!prev) return;
      set((s) => {
        const next = { ...s.deals };
        delete next[id];
        return { deals: next };
      });
      try {
        await repository.deleteDeal(id);
      } catch (err) {
        set((s) => ({ deals: { ...s.deals, [id]: prev } }));
        throw err;
      }
    },

    dealsForTicket(ticketId) {
      return Object.values(get().deals)
        .filter((d) => d.ticketId === ticketId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    dealsForContact(contactId) {
      return Object.values(get().deals)
        .filter((d) => d.contactId === contactId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    accounts() {
      const now = new Date().toISOString();
      const { tickets, contacts, deals } = get();
      const groups = new Map<string, AccountHealth>();

      const ensure = (company: string): AccountHealth => {
        let acc = groups.get(company);
        if (acc === undefined) {
          acc = {
            company, contactIds: [], mrr: 0, openTickets: 0, urgentOpen: 0,
            wonValue: 0, openPipeline: 0, openExpansion: 0, openRetention: 0, status: 'healthy',
          };
          groups.set(company, acc);
        }
        return acc;
      };

      const companyOf = new Map<string, string>(); // contactId -> company
      for (const c of Object.values(contacts)) {
        if (c.company === null) continue;
        companyOf.set(c.id, c.company);
        const acc = ensure(c.company);
        acc.contactIds.push(c.id);
        acc.mrr += c.mrr ?? 0;
      }

      for (const t of Object.values(tickets)) {
        const company = companyOf.get(t.requesterId);
        if (company === undefined) continue;
        const snoozed = t.snoozedUntil !== null && t.snoozedUntil > now;
        if (t.bucket === 'inbox' && !snoozed && t.status !== 'closed' && t.status !== 'solved') {
          const acc = ensure(company);
          acc.openTickets += 1;
          if (t.priority === 'urgent') acc.urgentOpen += 1;
        }
      }

      for (const d of Object.values(deals)) {
        const company = companyOf.get(d.contactId);
        if (company === undefined) continue;
        const acc = ensure(company);
        if (d.stage === 'won') acc.wonValue += d.value;
        else if (d.stage === 'open') {
          acc.openPipeline += d.value;
          if (d.type === 'expansion') acc.openExpansion += 1;
          if (d.type === 'retention') acc.openRetention += 1;
        }
      }

      const rank = { at_risk: 0, expansion_ready: 1, healthy: 2 };
      const list = [...groups.values()].map((acc) => {
        acc.status =
          acc.openRetention > 0 || acc.urgentOpen >= 1 ? 'at_risk'
          : acc.openExpansion > 0 ? 'expansion_ready'
          : 'healthy';
        return acc;
      });
      list.sort((a, b) => rank[a.status] - rank[b.status] || b.mrr - a.mrr || a.company.localeCompare(b.company));
      return list;
    },

    async saveSlaTargets(targets) {
      const prev = get().sla;
      set({ sla: targets });
      try {
        const saved = await repository.saveSlaTargets(targets);
        set({ sla: saved });
      } catch (err) {
        set({ sla: prev });
        throw err;
      }
    },

    async saveSlaHours(hours) {
      const prev = get().slaHours;
      set({ slaHours: hours });
      try {
        const saved = await repository.saveSlaHours(hours);
        set({ slaHours: saved });
      } catch (err) {
        set({ slaHours: prev });
        throw err;
      }
    },

    async saveAutomation(rules) {
      const prev = get().automation;
      set({ automation: rules });
      try {
        const saved = await repository.saveAutomation(rules);
        set({ automation: saved });
      } catch (err) {
        set({ automation: prev });
        throw err;
      }
    },

    async saveAssignment(settings) {
      const prev = get().assignment;
      set({ assignment: settings });
      try {
        const saved = await repository.saveAssignment(settings);
        set({ assignment: saved });
      } catch (err) {
        set({ assignment: prev });
        throw err;
      }
    },

    async saveAutoAck(settings) {
      const prev = get().autoAck;
      set({ autoAck: settings });
      try {
        const saved = await repository.saveAutoAck(settings);
        set({ autoAck: saved });
      } catch (err) {
        set({ autoAck: prev });
        throw err;
      }
    },

    async saveTimeRules(rules) {
      const prev = get().timeRules;
      set({ timeRules: rules });
      try {
        const saved = await repository.saveTimeRules(rules);
        set({ timeRules: saved });
      } catch (err) {
        set({ timeRules: prev });
        throw err;
      }
    },

    async runTimeRules() {
      const fired = await repository.runTimeRules();
      // Tickets may have changed priority/status — pull the fresh list in.
      if (fired > 0) await get().refreshTickets().catch(() => {});
      return fired;
    },

    async saveIntakeForm(form) {
      const prev = get().intakeForm;
      set({ intakeForm: form, categories: categoriesFromForm(form) });
      try {
        const saved = await repository.saveIntakeForm(form);
        set({ intakeForm: saved, categories: categoriesFromForm(saved) });
      } catch (err) {
        set({ intakeForm: prev, categories: categoriesFromForm(prev) });
        throw err;
      }
    },

    async inviteAgent(input) {
      const agent = await repository.inviteAgent(input);
      set((s) => ({ agents: { ...s.agents, [agent.id]: agent } }));
      return agent.id;
    },

    async updateAgent(id, patch) {
      const prev = get().agents[id] as Agent | undefined;
      if (!prev) throw new Error('Agent not found');
      set((s) => ({ agents: { ...s.agents, [id]: { ...prev, ...patch } } }));
      try {
        const agent = await repository.updateAgent(id, patch);
        set((s) => ({ agents: { ...s.agents, [id]: agent } }));
      } catch (err) {
        set((s) => ({ agents: { ...s.agents, [id]: prev } }));
        throw err;
      }
    },

    async deleteAgent(id) {
      const prev = get().agents[id] as Agent | undefined;
      if (!prev) return;
      set((s) => {
        const next = { ...s.agents };
        delete next[id];
        return { agents: next };
      });
      try {
        await repository.deleteAgent(id);
      } catch (err) {
        set((s) => ({ agents: { ...s.agents, [id]: prev } }));
        throw err;
      }
    },

    async createArticle(input) {
      const article = await repository.createArticle(input);
      set((s) => ({ kb: { ...s.kb, [article.id]: article } }));
      return article.id;
    },

    async updateArticle(id, patch) {
      const prev = get().kb[id] as KbArticle | undefined;
      if (!prev) throw new Error('Article not found');
      set((s) => ({ kb: { ...s.kb, [id]: { ...prev, ...patch, updatedAt: new Date().toISOString() } } }));
      try {
        const article = await repository.updateArticle(id, patch);
        set((s) => ({ kb: { ...s.kb, [id]: article } }));
      } catch (err) {
        set((s) => ({ kb: { ...s.kb, [id]: prev } }));
        throw err;
      }
    },

    async deleteArticle(id) {
      const prev = get().kb[id] as KbArticle | undefined;
      if (!prev) return;
      set((s) => {
        const next = { ...s.kb };
        delete next[id];
        return { kb: next };
      });
      try {
        await repository.deleteArticle(id);
      } catch (err) {
        set((s) => ({ kb: { ...s.kb, [id]: prev } }));
        throw err;
      }
    },

    async createAiAgent(input) {
      const agent = await repository.createAiAgent(input);
      set((s) => ({ aiAgents: { ...s.aiAgents, [agent.id]: agent } }));
      return agent.id;
    },

    async updateAiAgent(id, patch) {
      const prev = get().aiAgents[id] as AiAgent | undefined;
      if (!prev) throw new Error('Agent not found');
      set((s) => ({ aiAgents: { ...s.aiAgents, [id]: { ...prev, ...patch } } }));
      try {
        const agent = await repository.updateAiAgent(id, patch);
        set((s) => ({ aiAgents: { ...s.aiAgents, [id]: agent } }));
      } catch (err) {
        set((s) => ({ aiAgents: { ...s.aiAgents, [id]: prev } }));
        throw err;
      }
    },

    async deleteAiAgent(id) {
      const prev = get().aiAgents[id] as AiAgent | undefined;
      if (!prev) return;
      set((s) => {
        const next = { ...s.aiAgents };
        delete next[id];
        return { aiAgents: next };
      });
      try {
        await repository.deleteAiAgent(id);
      } catch (err) {
        set((s) => ({ aiAgents: { ...s.aiAgents, [id]: prev } }));
        throw err;
      }
    },

    async runAgents() {
      const { created } = await repository.runAgents();
      // Refresh actions + tickets: agents may have created actions and resolved tickets.
      const data = await repository.bootstrap();
      set({
        aiActions: Object.fromEntries(data.aiActions.map((a) => [a.id, a])),
        tickets: Object.fromEntries(data.tickets.map((t) => [t.id, t])),
      });
      return created;
    },

    async approveAction(id) {
      const { action, ticket, message } = await repository.approveAction(id);
      set((s) => ({
        aiActions: { ...s.aiActions, [action.id]: action },
        tickets: { ...s.tickets, [ticket.id]: ticket },
        messages: s.messages[ticket.id]
          ? { ...s.messages, [ticket.id]: [...s.messages[ticket.id]!, message] }
          : s.messages,
      }));
    },

    async dismissAction(id) {
      const prev = get().aiActions[id] as AiAction | undefined;
      set((s) => (prev ? { aiActions: { ...s.aiActions, [id]: { ...prev, status: 'dismissed' as const } } } : {}));
      try {
        const { action } = await repository.dismissAction(id);
        set((s) => ({ aiActions: { ...s.aiActions, [action.id]: action } }));
      } catch (err) {
        if (prev) set((s) => ({ aiActions: { ...s.aiActions, [id]: prev } }));
        throw err;
      }
    },

    async createChannel(input) {
      const channel = await repository.createChannel(input);
      set((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      return channel.id;
    },

    async updateChannel(id, patch) {
      const prev = get().channels[id] as ChannelConn | undefined;
      if (!prev) throw new Error('Channel not found');
      set((s) => ({ channels: { ...s.channels, [id]: { ...prev, ...patch } } }));
      try {
        const channel = await repository.updateChannel(id, patch);
        set((s) => ({ channels: { ...s.channels, [id]: channel } }));
      } catch (err) {
        set((s) => ({ channels: { ...s.channels, [id]: prev } }));
        throw err;
      }
    },

    async deleteChannel(id) {
      const prev = get().channels[id] as ChannelConn | undefined;
      if (!prev) return;
      set((s) => {
        const next = { ...s.channels };
        delete next[id];
        return { channels: next };
      });
      try {
        await repository.deleteChannel(id);
      } catch (err) {
        set((s) => ({ channels: { ...s.channels, [id]: prev } }));
        throw err;
      }
    },

    async testChannel(id) {
      return repository.testChannel(id);
    },

    async createCustomField(input) {
      const field = await repository.createCustomField(input);
      set((s) => ({ customFields: [...s.customFields, field] }));
    },

    async updateCustomField(id, patch) {
      const prev = get().customFields;
      set((s) => ({ customFields: s.customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
      try {
        const field = await repository.updateCustomField(id, patch);
        set((s) => ({ customFields: s.customFields.map((f) => (f.id === id ? field : f)) }));
      } catch (err) {
        set({ customFields: prev });
        throw err;
      }
    },

    async deleteCustomField(id) {
      const prev = get().customFields;
      set((s) => ({ customFields: s.customFields.filter((f) => f.id !== id) }));
      try {
        await repository.deleteCustomField(id);
      } catch (err) {
        set({ customFields: prev });
        throw err;
      }
    },

    async createSavedView(input) {
      const view = await repository.createSavedView(input);
      set((s) => ({ savedViews: [...s.savedViews, view] }));
    },

    async deleteSavedView(id) {
      const prev = get().savedViews;
      set((s) => ({ savedViews: s.savedViews.filter((v) => v.id !== id) }));
      try {
        await repository.deleteSavedView(id);
      } catch (err) {
        set({ savedViews: prev });
        throw err;
      }
    },

    async exportCsv(type) {
      return repository.exportCsv(type);
    },

    async importData(input) {
      const result = await repository.importData(input);
      // A committed import adds contacts/tickets — re-bootstrap to pull them in.
      if (input.dryRun !== true && result.error === undefined && result.created > 0) {
        await get().init();
      }
      return result;
    },

    async markNotificationsRead(id) {
      const now = new Date().toISOString();
      const prev = get().notifications;
      // Optimistically stamp read; reconcile with the server's fresh list.
      set((s) => ({
        notifications: s.notifications.map((n) =>
          (id === undefined || n.id === id) && n.readAt === null ? { ...n, readAt: now } : n,
        ),
      }));
      try {
        const fresh = await repository.markNotificationsRead(id);
        set({ notifications: fresh });
      } catch {
        set({ notifications: prev });
      }
    },

    async setTicketField(ticketId, fieldId, value) {
      const ticket = get().tickets[ticketId] as Ticket | undefined;
      if (!ticket) throw new Error('Ticket not found');
      const next = { ...ticket.customFields };
      if (value.trim() === '') delete next[fieldId];
      else next[fieldId] = value;
      await get().patchTicket(ticketId, { customFields: next });
    },

    async saveAiProvider(input) {
      const provider = await repository.saveAiProvider(input);
      set({ aiProvider: provider });
    },

    testAiProvider(input) {
      return repository.testAiProvider(input);
    },

    listProviderModels(input) {
      return repository.listProviderModels(input);
    },

    async saveSmtp(input) {
      const smtp = await repository.saveSmtp(input);
      set({ smtp });
    },

    testSmtp(to) {
      return repository.testSmtp(to);
    },

    // Add a model call's returned token usage to the running total so the AI
    // overview updates live (the server records the same call to its ledger).
    bumpUsage(u) {
      if (u.promptTokens + u.completionTokens <= 0) return;
      set((s) => ({
        aiUsage: {
          promptTokens: s.aiUsage.promptTokens + u.promptTokens,
          completionTokens: s.aiUsage.completionTokens + u.completionTokens,
          generations: s.aiUsage.generations + 1,
        },
      }));
    },

    async aiDraft(ticketId) {
      const r = await repository.aiDraft(ticketId);
      get().bumpUsage(r.usage);
      return r;
    },

    async aiTriage(ticketId) {
      const r = await repository.aiTriage(ticketId);
      get().bumpUsage(r.usage);
      return r;
    },

    async aiSummarize(ticketId) {
      const r = await repository.aiSummarize(ticketId);
      get().bumpUsage(r.usage);
      return r;
    },

    setTheme(t) {
      set({ theme: t });
      applyTheme(t);
    },

    searchLocal(q) {
      const query = q.trim().toLowerCase();
      if (query === '') return [];
      const { tickets, contacts } = get();
      const prefixMatches: Ticket[] = [];
      const otherMatches: Ticket[] = [];
      for (const t of Object.values(tickets)) {
        const subject = t.subject.toLowerCase();
        const contact = contacts[t.requesterId] as Contact | undefined;
        const matched =
          subject.includes(query) ||
          t.lastMessagePreview.toLowerCase().includes(query) ||
          (contact !== undefined &&
            (contact.name.toLowerCase().includes(query) || contact.email.toLowerCase().includes(query))) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query));
        if (!matched) continue;
        if (subject.startsWith(query)) prefixMatches.push(t);
        else otherMatches.push(t);
      }
      return [...prefixMatches.sort(byRecency), ...otherMatches.sort(byRecency)].slice(0, 20);
    },
  }));
}

export const useApp = createAppStore(repo);
