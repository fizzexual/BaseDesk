import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionsBitField,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { BaseDesk } from './basedesk.js';
import { load, save } from './store.js';

// ── Config (from .env — see .env.example) ─────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BASEDESK_URL = process.env.BASEDESK_URL;
const SIGNING_SECRET = process.env.BASEDESK_SIGNING_SECRET || '';
const GUILD_ID = process.env.GUILD_ID || '';
const POLL_MS = Number(process.env.POLL_MS || 4000);

for (const [k, v] of Object.entries({ DISCORD_TOKEN: TOKEN, DISCORD_CLIENT_ID: CLIENT_ID, BASEDESK_URL })) {
  if (!v) {
    console.error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const state = load();

// ── Provision a BaseDesk channel once, then remember it ───────────────────────
if (!state.channel) {
  const ch = await BaseDesk.createChannel(BASEDESK_URL, 'Discord');
  state.channel = { id: ch.id, inboundToken: ch.inboundToken };
  save(state);
  console.log(`Provisioned BaseDesk channel ${ch.id}.`);
}
const bd = new BaseDesk({
  url: BASEDESK_URL,
  channelId: state.channel.id,
  inboundToken: state.channel.inboundToken,
  signingSecret: SIGNING_SECRET,
});

// ── Slash commands ────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open a support ticket')
    .addStringOption((o) => o.setName('subject').setDescription('What do you need help with?').setRequired(false)),
  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Reply to the customer (staff)')
    .addStringOption((o) => o.setName('text').setDescription('Your reply').setRequired(true)),
  new SlashCommandBuilder().setName('solve').setDescription('Mark this ticket solved'),
  new SlashCommandBuilder().setName('close').setDescription('Close this ticket'),
  new SlashCommandBuilder().setName('reopen').setDescription('Reopen this ticket'),
  new SlashCommandBuilder().setName('status').setDescription('Show this ticket’s status'),
].map((c) => c.toJSON());

const ephemeral = { flags: MessageFlags.Ephemeral };
const ticketOf = (channelId) => state.threads[channelId];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ── A customer message in a ticket thread → append to the BaseDesk ticket ─────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.channel.isThread?.()) return;
  const rec = ticketOf(message.channel.id);
  if (!rec || message.author.id !== rec.openerId) return; // only the opener is the customer
  try {
    const res = await bd.inbound({
      externalId: `discord:${message.channel.id}`,
      name: message.author.username,
      body: message.content || '(no text)',
    });
    // If the previous ticket had been solved/closed, a fresh one opens — track it.
    if (res.ticketId && res.ticketId !== rec.ticketId) {
      rec.ticketId = res.ticketId;
      rec.ticketNumber = res.ticketNumber;
      rec.delivered = [];
      save(state);
    }
  } catch (err) {
    console.error('inbound failed:', err.message);
  }
});

// ── Slash commands: open tickets & manage them straight from Discord ──────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;

  if (name === 'ticket') {
    const subject = interaction.options.getString('subject') || 'Support request';
    const parent = interaction.channel;
    if (!parent?.threads) {
      await interaction.reply({ content: 'Run `/ticket` in a normal text channel.', ...ephemeral });
      return;
    }
    await interaction.deferReply(ephemeral);
    const threadName = `🎫 ${subject}`.slice(0, 90);
    const thread = await parent.threads
      .create({ name: threadName, type: ChannelType.PrivateThread, invitable: false })
      .catch(() => parent.threads.create({ name: threadName }));
    await thread.members.add(interaction.user.id).catch(() => {});
    const res = await bd.inbound({ externalId: `discord:${thread.id}`, name: interaction.user.username, body: subject, subject });
    state.threads[thread.id] = {
      ticketId: res.ticketId,
      ticketNumber: res.ticketNumber,
      openerId: interaction.user.id,
      delivered: [],
    };
    save(state);
    await thread.send(
      `Hi <@${interaction.user.id}> — ticket **#${res.ticketNumber}** is open. Describe your issue here and the team will reply. ` +
        'Staff: `/reply`, `/solve`, `/close`, `/reopen`, `/status`.',
    );
    await interaction.editReply(`Opened ${thread}.`);
    return;
  }

  const rec = ticketOf(interaction.channelId);
  if (!rec) {
    await interaction.reply({ content: 'Use this inside a ticket thread.', ...ephemeral });
    return;
  }

  if (name === 'reply') {
    const text = interaction.options.getString('text');
    await interaction.deferReply(ephemeral);
    try {
      await bd.command('reply', rec.ticketId, text);
      await interaction.editReply('Reply sent — it will appear in this thread shortly.');
    } catch (err) {
      await interaction.editReply(`Could not send: ${err.message}`);
    }
    return;
  }

  if (name === 'solve' || name === 'close' || name === 'reopen' || name === 'status') {
    await interaction.deferReply();
    try {
      const res = await bd.command(name, rec.ticketId);
      await interaction.editReply(`Ticket #${res.ticket.number} → **${res.ticket.status}**.`);
      if ((name === 'solve' || name === 'close') && interaction.channel?.setArchived) {
        await interaction.channel.setArchived(true).catch(() => {});
      }
    } catch (err) {
      await interaction.editReply(`That didn’t work: ${err.message}`);
    }
  }
});

// ── Deliver agent/AI replies from the dashboard back into the Discord thread ──
async function poll() {
  for (const [threadId, rec] of Object.entries(state.threads)) {
    let msgs;
    try {
      msgs = await bd.messages(rec.ticketId);
    } catch {
      continue;
    }
    const fresh = msgs.filter(
      (m) => m.authorKind === 'agent' && m.kind === 'reply' && !m.deletedAt && !rec.delivered.includes(m.id),
    );
    if (fresh.length === 0) continue;
    const thread = await client.channels.fetch(threadId).catch(() => null);
    for (const m of fresh) {
      if (thread?.isThread?.()) {
        const files = (m.attachments || []).map((a) => `${bd.url}/api/attachments/${a.id}`);
        const text = `🎧 **Support:** ${m.body}${files.length ? `\n${files.join('\n')}` : ''}`.slice(0, 1900);
        await thread.send(text).catch(() => {});
      }
      rec.delivered.push(m.id);
    }
    if (rec.delivered.length > 300) rec.delivered = rec.delivered.slice(-300);
    save(state);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log(`Logged in as ${c.user.tag}. Registered ${commands.length} commands${GUILD_ID ? ` in guild ${GUILD_ID}` : ' globally (up to ~1h to appear)'}.`);
  setInterval(() => poll().catch((e) => console.error('poll error:', e.message)), POLL_MS);
});

const permissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ReadMessageHistory,
]);
console.log(
  `\n  Invite the bot to your server:\n  https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${permissions.bitfield}&scope=bot%20applications.commands\n`,
);

client.login(TOKEN);
