import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, AiUsage, Agent, AgentInvite, Attachment, ModelCache,
  AgentPatch, AiAutomation, ArticleCreate, ArticlePatch, AssignmentSettings, AutoAck, HandoverNote, OnCallConfig, AutomationRule, CannedReply, ChannelConn, ChannelCreate, ChannelPatch, ChannelTestResult, TimeRule,
  Announcement, Branding, AuditEvent, CustomFieldCreate, CustomFieldDef, CustomFieldPatch, CustomReport, ComponentStatus, IncidentImpact, IncidentStatus, StatusComponent, StatusIncident, StatusPageData, ImportInput, ImportResult, ImportType, IntakeAnswer, IntakeForm, Notification, SideConversation, TicketApproval, TicketEvent, TicketSeen, TicketFollower, TicketTask, TicketTemplate, TicketLink, TicketLinkType, SavedView, SavedViewCreate,
  Contact, CopilotTriage, Deal, DealCreate, DealPatch, DealStage, DealType, DraftResult, KbArticle, Message, MessageEmbed, SlaHours,
  SlaTargets, SmtpSave, SmtpSettings, SmtpTestResult, StatsOverview, SummaryResult, Ticket, TicketPatch, TicketPriority,
} from './types';

export interface BootstrapData {
  tickets: Ticket[]; contacts: Contact[]; agents: Agent[];
  canned: CannedReply[]; templates: TicketTemplate[]; customReports: CustomReport[]; announcements: Announcement[]; branding: Branding; currentAgentId: string; deals: Deal[];
  sla: SlaTargets; automation: AutomationRule[]; kb: KbArticle[];
  aiAgents: AiAgent[]; aiActions: AiAction[]; aiUsage: AiUsage; availableModels: ModelCache | null; channels: ChannelConn[];
  slaHours: SlaHours; aiProvider: AiProvider; smtp: SmtpSettings;
  customFields: CustomFieldDef[];
  savedViews: SavedView[];
  notifications: Notification[];
  assignment: AssignmentSettings;
  autoAck: AutoAck;
  aiAutomation: AiAutomation;
  onCall: OnCallConfig;
  timeRules: TimeRule[];
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
  /** Recent activity across every ticket, newest first — the global audit log. */
  getAuditLog(limit?: number): Promise<AuditEvent[]>;
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
  /** Typed links to other tickets. Each mutation returns the full updated list. */
  getLinks(ticketId: string): Promise<TicketLink[]>;
  addLink(ticketId: string, linkedTicketId: string, type: TicketLinkType): Promise<TicketLink[]>;
  removeLink(ticketId: string, linkId: string): Promise<TicketLink[]>;
  getApprovals(ticketId: string): Promise<TicketApproval[]>;
  requestApproval(ticketId: string, reason: string, approverId: string | null): Promise<TicketApproval[]>;
  decideApproval(ticketId: string, approvalId: string, decision: 'approved' | 'rejected', note: string | null): Promise<TicketApproval[]>;
  getSideConversations(ticketId: string): Promise<SideConversation[]>;
  createSideConversation(ticketId: string, subject: string, participant: string | null, body: string): Promise<SideConversation[]>;
  addSideMessage(ticketId: string, sideId: string, body: string): Promise<SideConversation[]>;
  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority; category?: string | null; tags?: string[] }): Promise<{ ticket: Ticket; message: Message }>;
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket>;
  bulkPatchTickets(ids: string[], patch: TicketPatch, addTags?: string[]): Promise<Ticket[]>;
  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string; attachmentIds?: string[]; embeds?: MessageEmbed[] }): Promise<{ message: Message; ticket: Ticket }>;
  deleteMessage(ticketId: string, messageId: string): Promise<Message>;
  /** Fold `ticketId` into `into`: moves messages, closes the source as a tombstone. */
  mergeTicket(ticketId: string, into: string): Promise<{ source: Ticket; target: Ticket }>;
  /** Split the given messages out of `ticketId` into a new, related ticket. */
  splitTicket(ticketId: string, subject: string, messageIds: string[]): Promise<{ source: Ticket; created: Ticket }>;
  uploadAttachment(file: File): Promise<Attachment>;
  createContact(input: { name: string; email: string; company?: string }): Promise<Contact>;
  saveCanned(c: CannedReply): Promise<CannedReply>;
  deleteCanned(id: string): Promise<void>;
  /** Create a template (empty id) or update an existing one; returns the saved record with its id. */
  saveTemplate(t: TicketTemplate): Promise<TicketTemplate>;
  deleteTemplate(id: string): Promise<void>;
  saveReport(r: CustomReport): Promise<CustomReport>;
  deleteReport(id: string): Promise<void>;
  /** Public status page: components + incidents (no auth required). */
  getStatusPage(): Promise<StatusPageData>;
  addStatusComponent(name: string): Promise<StatusComponent[]>;
  saveStatusComponent(id: string, name: string, status: ComponentStatus): Promise<StatusComponent[]>;
  removeStatusComponent(id: string): Promise<StatusComponent[]>;
  createIncident(title: string, impact: IncidentImpact, body: string): Promise<StatusIncident[]>;
  postIncidentUpdate(id: string, status: IncidentStatus, body: string): Promise<StatusIncident[]>;
  removeIncident(id: string): Promise<StatusIncident[]>;
  /** Create (empty id) or update an announcement; returns the full list. */
  saveAnnouncement(a: Announcement): Promise<Announcement[]>;
  deleteAnnouncement(id: string): Promise<Announcement[]>;
  saveBranding(b: Branding): Promise<Branding>;
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
  runAgents(ticketId?: string): Promise<{ created: number }>;
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
  saveAiAutomation(settings: AiAutomation): Promise<AiAutomation>;
  saveOnCall(config: OnCallConfig): Promise<OnCallConfig>;
  getHandover(): Promise<HandoverNote[]>;
  addHandover(body: string): Promise<HandoverNote[]>;
  deleteHandover(id: string): Promise<HandoverNote[]>;
  saveTimeRules(rules: TimeRule[]): Promise<TimeRule[]>;
  /** Run time-based rules now; resolves to how many tickets were acted on. */
  runTimeRules(): Promise<number>;
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
