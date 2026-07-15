import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, AiUsage, Agent, AgentInvite, Attachment, ModelCache,
  AgentPatch, ArticleCreate, ArticlePatch, AssignmentSettings, AutoAck, AutomationRule, CannedReply, ChannelConn, ChannelCreate, ChannelPatch, ChannelTestResult,
  CustomFieldCreate, CustomFieldDef, CustomFieldPatch, ImportInput, ImportResult, ImportType, IntakeAnswer, IntakeForm, Notification, TicketEvent, TicketSeen, TicketFollower, TicketTask, SavedView, SavedViewCreate,
  Contact, CopilotTriage, Deal, DealCreate, DealPatch, DealStage, DealType, DraftResult, KbArticle, Message, SlaHours,
  SlaTargets, SmtpSave, SmtpSettings, SmtpTestResult, StatsOverview, SummaryResult, Ticket, TicketPatch, TicketPriority,
} from './types';

export interface BootstrapData {
  tickets: Ticket[]; contacts: Contact[]; agents: Agent[];
  canned: CannedReply[]; currentAgentId: string; deals: Deal[];
  sla: SlaTargets; automation: AutomationRule[]; kb: KbArticle[];
  aiAgents: AiAgent[]; aiActions: AiAction[]; aiUsage: AiUsage; availableModels: ModelCache | null; channels: ChannelConn[];
  slaHours: SlaHours; aiProvider: AiProvider; smtp: SmtpSettings;
  customFields: CustomFieldDef[];
  savedViews: SavedView[];
  notifications: Notification[];
  assignment: AssignmentSettings;
  autoAck: AutoAck;
  intakeForm: IntakeForm;
  categories: string[];
}
export interface Repository {
  bootstrap(): Promise<BootstrapData>;
  /** All tickets, freshly from the server — used by live polling to keep the inbox current. */
  listTickets(): Promise<Ticket[]>;
  /** The current agent's notifications, freshly from the server (for live polling). */
  listNotifications(): Promise<Notification[]>;
  getMessages(ticketId: string): Promise<Message[]>;
  getTicketEvents(ticketId: string): Promise<TicketEvent[]>;
  /** Read receipts: when each participant last viewed this ticket's thread. */
  getTicketSeen(ticketId: string): Promise<TicketSeen[]>;
  /** Intake-form answers captured when the ticket was opened (ticket metadata). */
  getTicketIntake(ticketId: string): Promise<IntakeAnswer[]>;
  /** Agents watching this ticket for activity. */
  getFollowers(ticketId: string): Promise<TicketFollower[]>;
  followTicket(ticketId: string, agentId?: string): Promise<TicketFollower[]>;
  unfollowTicket(ticketId: string, agentId: string): Promise<TicketFollower[]>;
  /** The ticket's checklist. Each mutation returns the full updated list. */
  getTasks(ticketId: string): Promise<TicketTask[]>;
  addTask(ticketId: string, title: string): Promise<TicketTask[]>;
  patchTask(ticketId: string, taskId: string, patch: { title?: string; done?: boolean }): Promise<TicketTask[]>;
  deleteTask(ticketId: string, taskId: string): Promise<TicketTask[]>;
  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<{ ticket: Ticket; message: Message }>;
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket>;
  bulkPatchTickets(ids: string[], patch: TicketPatch, addTags?: string[]): Promise<Ticket[]>;
  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string; attachmentIds?: string[] }): Promise<{ message: Message; ticket: Ticket }>;
  deleteMessage(ticketId: string, messageId: string): Promise<Message>;
  /** Fold `ticketId` into `into`: moves messages, closes the source as a tombstone. */
  mergeTicket(ticketId: string, into: string): Promise<{ source: Ticket; target: Ticket }>;
  uploadAttachment(file: File): Promise<Attachment>;
  createContact(input: { name: string; email: string; company?: string }): Promise<Contact>;
  saveCanned(c: CannedReply): Promise<CannedReply>;
  deleteCanned(id: string): Promise<void>;
  getStats(): Promise<StatsOverview>;
  search(q: string): Promise<{ ticketIds: string[] }>;
  listDeals(filter?: { stage?: DealStage; type?: DealType; contactId?: string }): Promise<Deal[]>;
  createDeal(input: DealCreate): Promise<Deal>;
  updateDeal(id: string, patch: DealPatch): Promise<Deal>;
  deleteDeal(id: string): Promise<void>;
  saveSlaTargets(targets: SlaTargets): Promise<SlaTargets>;
  saveAutomation(rules: AutomationRule[]): Promise<AutomationRule[]>;
  createArticle(input: ArticleCreate): Promise<KbArticle>;
  updateArticle(id: string, patch: ArticlePatch): Promise<KbArticle>;
  deleteArticle(id: string): Promise<void>;
  createAiAgent(input: AiAgentCreate): Promise<AiAgent>;
  updateAiAgent(id: string, patch: AiAgentPatch): Promise<AiAgent>;
  deleteAiAgent(id: string): Promise<void>;
  runAgents(): Promise<{ created: number }>;
  approveAction(id: string): Promise<{ action: AiAction; ticket: Ticket; message: Message }>;
  dismissAction(id: string): Promise<{ action: AiAction }>;
  createChannel(input: ChannelCreate): Promise<ChannelConn>;
  updateChannel(id: string, patch: ChannelPatch): Promise<ChannelConn>;
  deleteChannel(id: string): Promise<void>;
  testChannel(id: string): Promise<ChannelTestResult>;
  createCustomField(input: CustomFieldCreate): Promise<CustomFieldDef>;
  updateCustomField(id: string, patch: CustomFieldPatch): Promise<CustomFieldDef>;
  deleteCustomField(id: string): Promise<void>;
  createSavedView(input: SavedViewCreate): Promise<SavedView>;
  deleteSavedView(id: string): Promise<void>;
  /** Mark one notification read, or all of the current agent's when id is omitted; returns the fresh list. */
  markNotificationsRead(id?: string): Promise<Notification[]>;
  /** Import contacts or tickets from CSV (dryRun previews without writing). */
  importData(input: ImportInput): Promise<ImportResult>;
  /** Export contacts or tickets as CSV text. */
  exportCsv(type: ImportType): Promise<string>;
  saveAssignment(settings: AssignmentSettings): Promise<AssignmentSettings>;
  saveAutoAck(settings: AutoAck): Promise<AutoAck>;
  saveIntakeForm(form: IntakeForm): Promise<IntakeForm>;
  inviteAgent(input: AgentInvite): Promise<Agent>;
  updateAgent(id: string, patch: AgentPatch): Promise<Agent>;
  deleteAgent(id: string): Promise<void>;
  saveSlaHours(hours: SlaHours): Promise<SlaHours>;
  saveAiProvider(input: AiProviderSave): Promise<AiProvider>;
  testAiProvider(input?: AiProviderSave): Promise<AiTestResult>;
  /** List the models the provider currently offers (via its /models endpoint). */
  listProviderModels(input?: { baseUrl?: string; apiKey?: string }): Promise<{ models?: string[]; error?: string }>;
  saveSmtp(input: SmtpSave): Promise<SmtpSettings>;
  testSmtp(to?: string): Promise<SmtpTestResult>;
  aiDraft(ticketId: string): Promise<DraftResult>;
  aiTriage(ticketId: string): Promise<CopilotTriage>;
  aiSummarize(ticketId: string): Promise<SummaryResult>;
}
