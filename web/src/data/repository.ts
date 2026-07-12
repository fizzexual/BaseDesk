import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, Agent, AgentInvite, AgentPatch, ArticleCreate, ArticlePatch,
  AutomationRule, CannedReply, ChannelConn, ChannelCreate, ChannelPatch, Contact, Deal, DealCreate, DealPatch,
  DealStage, DealType, KbArticle, Message, SlaHours, SlaTargets, StatsOverview, Ticket, TicketPatch, TicketPriority,
} from './types';

export interface BootstrapData {
  tickets: Ticket[]; contacts: Contact[]; agents: Agent[];
  canned: CannedReply[]; currentAgentId: string; deals: Deal[];
  sla: SlaTargets; automation: AutomationRule[]; kb: KbArticle[];
  aiAgents: AiAgent[]; aiActions: AiAction[]; channels: ChannelConn[];
  slaHours: SlaHours;
}
export interface Repository {
  bootstrap(): Promise<BootstrapData>;
  getMessages(ticketId: string): Promise<Message[]>;
  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<{ ticket: Ticket; message: Message }>;
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket>;
  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string }): Promise<{ message: Message; ticket: Ticket }>;
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
  inviteAgent(input: AgentInvite): Promise<Agent>;
  updateAgent(id: string, patch: AgentPatch): Promise<Agent>;
  deleteAgent(id: string): Promise<void>;
  saveSlaHours(hours: SlaHours): Promise<SlaHours>;
}
