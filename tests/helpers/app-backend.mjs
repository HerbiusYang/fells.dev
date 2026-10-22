import { png } from '../fixtures/support-images.mjs';

// An in-memory, same-origin /api/app contract server for CI. It keeps the state
// a browser session would persist on the real backend (profile, preferences,
// workspaces, conversations and API keys), so UI flows can be reloaded.
// Behavior against the real server is covered by tests/browser/security.test.mjs
// when FELLS_REAL_BACKEND_TEST=1.
const sessionId = 'c'.repeat(64);

export function createAppBackend(options = {}) {
  const state = {
    signedIn: true, nextID: 1, email: 'ui-user@example.test',
    profile: { name: 'UI user', avatar: 0 }, avatarUploaded: false,
    preferences: { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: false, answers: [[], [], [], []], promoClosed: false, sbHidden: false },
    workspaces: [], chats: [], keys: [], writes: [], failChatWrites: false,
    modelChat: false, chatModels: [{ model: 'server/text-model-v2', label: 'Server text model', format: 'openai-completions', formats: ['openai-completions'] }],
    chatRuns: {}, generations: [], modelReads: [], generationStatus: 'completed', assistantReply: 'A real server-owned model reply.',
    pendingInvitations: [], receivedInvitations: [], nextInvitationID: 1,
    apiAllowance: { user_id: 42, micro: 9000000, expires_at: 1900000000 },
    tokenPlans: { plans: [], current: null, burst_allowed: false }, ...options,
  };
  const user = () => ({ id: 42, username: 'ui-user', email: state.email, name: state.profile.name, joined_at: 1700000000, self_keys: true });
  const bootstrap = () => ({
    schema_version: 1, session_id: sessionId, user: user(),
    wallet: { currency: 'CNY', cash_micro: 100000000, grant_micro: 200000000, grant_expires_at: 1900000000 },
    api_allowance: { currency: 'USD', balance: state.apiAllowance, term_months: 12, price_cny: 2 },
    agreement: { accepted: true, version: 'server-v1' }, capabilities: { token_plan: false, product_cdk: false, agent_execution: false, model_chat: state.modelChat, api_keys: true },
  });
  const profile = () => ({ profile: { name: state.profile.name, avatar: state.avatarUploaded ? '/api/app/avatar?v=1' : state.profile.avatar }, email: state.email });
  const chatDto = chat => ({ ...chat, message_metadata: chat.message_metadata ?? chat.messages.map(([who], index) => ({ id: `${chat.id}-m${index + 1}`, created: chat.created + index, imported: false, ...(who === 'assistant' ? {} : { author_user_id: 42, author_name: state.profile.name }) })) });
  const keyDto = key => ({ id: key.id, name: key.name, prefix: key.prefix, created_at: key.created_at, kind: key.kind, expires_at: key.expires_at ?? 0, revoked: key.revoked, daily_allow_micro: 0, monthly_allow_micro: 0, monthly_allow_limit_micro: key.limit ?? 0, rpm: 0 });

  async function handle(route) {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postData() && request.headers()['content-type']?.includes('json') ? request.postDataJSON() : undefined;
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (method !== 'GET') state.writes.push({ method, path, body: structuredClone(body) });
    if (path === '/api/app/session' && method === 'GET') return json(state.signedIn ? { username: 'ui-user', display_name: state.profile.name, created_at: 1700000000, self_keys: true, agreement: { version: 'server-v1', accepted: true } } : { error: 'unauthorized' }, state.signedIn ? 200 : 401);
    if (path === '/api/app/session' && method === 'DELETE') { state.signedIn = false; return json({ ok: true }); }
    if (!state.signedIn) return json({ error: 'unauthorized' }, 401);
    if (path === '/api/app/bootstrap') return json(bootstrap());
    if (path === '/api/app/chat-models') {
      const key = Number(url.searchParams.get('key_id'));
      state.modelReads.push(key);
      return json({ models: state.chatModels, key_id: key, capability: 'model_chat' });
    }
    if (path === '/api/app/profile') {
      if (method === 'POST') { if (body.name !== undefined) state.profile.name = body.name; if (body.avatar !== undefined) { state.profile.avatar = body.avatar; state.avatarUploaded = false; } }
      return json(profile());
    }
    if (path === '/api/app/avatar') {
      if (method === 'POST') { state.avatarUploaded = true; return json({ ok: true }); }
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: png });
    }
    if (path === '/api/app/preferences') { if (method === 'POST') Object.assign(state.preferences, body); return json(state.preferences); }
    if (path === '/api/app/workspaces') {
      if (method === 'POST') { state.workspaces.push({ ...body, role: 'owner' }); return json({ ok: true }, 201); }
      return json({ workspaces: state.workspaces });
    }
    if (path === '/api/app/invitations' && method === 'GET') return json({ invitations: state.receivedInvitations });
    let invitationMatch = path.match(/^\/api\/app\/invitations\/([^/]+)\/(accept|decline)$/);
    if (invitationMatch) {
      const invitation = state.receivedInvitations.find(item => item.id === invitationMatch[1]);
      if (!invitation) return json({ error: 'not found' }, 404);
      state.receivedInvitations = state.receivedInvitations.filter(item => item !== invitation);
      if (invitationMatch[2] === 'decline') return route.fulfill({ status: 204 });
      const workspace = { id: invitation.workspace_id, name: invitation.workspace_name, region: 'auto', tz: 'UTC', created: 1700000000000, role: invitation.role };
      state.workspaces.push(workspace);
      return json({ workspace });
    }
    let match = path.match(/^\/api\/app\/workspaces\/([^/]+)$/);
    if (match) {
      const workspace = state.workspaces.find(item => item.id === match[1]);
      if (!workspace) return json({ error: 'not found' }, 404);
      if (method === 'PATCH') Object.assign(workspace, body);
      if (method === 'DELETE') { state.workspaces = state.workspaces.filter(item => item !== workspace); state.chats = state.chats.filter(chat => chat.ws !== workspace.id); return route.fulfill({ status: 204 }); }
      return json({ ok: true });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/(chats|members)$/);
    if (match?.[2] === 'chats') return json({ chats: state.chats.filter(chat => chat.ws === match[1]).map(chatDto) });
    if (match?.[2] === 'members') {
      if (method === 'POST') {
        const id = `invite-${state.nextInvitationID++}`;
        const target = String(body.username ?? `#${body.user_id}`);
        state.pendingInvitations.push({ id, workspace_id: match[1], label: target.includes('@') ? `${target[0]}***@${target.split('@')[1]}` : `${target[0]}***`, role: body.role, created: 1898790400000, expires: 1900000000000 });
        return json({ invitation: { status: 'pending', role: body.role } }, 202);
      }
      return json({ members: [{ user_id: 42, name: state.profile.name, role: state.workspaces.find(w => w.id === match[1])?.role || 'owner' }] });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/invitations(?:\/([^/]+))?$/);
    if (match) {
      if (method === 'DELETE') {
        state.pendingInvitations = state.pendingInvitations.filter(item => item.id !== match[2]);
        return route.fulfill({ status: 204 });
      }
      return json({ invitations: state.pendingInvitations.filter(item => item.workspace_id === match[1]).map(({ workspace_id: _workspace, ...item }) => item) });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/leave$/);
    if (match && method === 'POST') {
      state.workspaces = state.workspaces.filter(item => item.id !== match[1]);
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/app/chats' && method === 'POST') {
      if (state.failChatWrites) return json({ error: 'Injected chat failure' }, 503);
      state.chats.push({ ...body }); return json({ ok: true }, 201);
    }
    match = path.match(/^\/api\/app\/chats\/([^/]+)\/(generate|runs\/([^/]+))$/);
    if (match) {
      const chat = state.chats.find(item => item.id === match[1]);
      if (!chat) return json({ error: 'not found' }, 404);
      if (method === 'GET') { const run = state.chatRuns[match[3]]; return run ? json({ run }) : json({ error: 'not found' }, 404); }
      let run = state.chatRuns[body.request_id];
      if (!run) {
        state.generations.push({ ...body, chat_id: chat.id, headers: request.headers() });
        chat.model = body.model; chat.messages.push(['you', body.body]); delete chat.message_metadata;
        run = state.chatRuns[body.request_id] = { request_id: body.request_id, status: state.generationStatus };
        if (run.status === 'completed') { chat.messages.push(['assistant', state.assistantReply]); run.message_id = `${chat.id}-m${chat.messages.length}`; }
      }
      return json({ run });
    }
    match = path.match(/^\/api\/app\/chats\/([^/]+)(?:\/(messages))?$/);
    if (match) {
      const chat = state.chats.find(item => item.id === match[1]);
      if (!chat) return json({ error: 'not found' }, 404);
      if (match[2] === 'messages') {
        if (state.failChatWrites) return json({ error: 'Injected chat failure' }, 503);
        chat.messages.push([body.speaker, body.body]); return json({ ok: true }, 201);
      }
      if (method === 'PATCH') Object.assign(chat, body);
      if (method === 'DELETE') state.chats = state.chats.filter(item => item !== chat);
      return method === 'DELETE' ? route.fulfill({ status: 204 }) : json({ ok: true });
    }
    if (path === '/api/app/keys' && method === 'POST') {
      const key = { id: state.nextID++, name: body.name, prefix: 'sk-ui', created_at: 1700000100, revoked: false, limit: 0 };
      state.keys.push(key); return json({ raw: 'sk-contract-secret-' + 'a'.repeat(32), key: keyDto(key) });
    }
    if (path === '/api/app/keys') return json({ keys: state.keys.map(keyDto), self_keys: true, limit_defaults: { daily_micro: 0, monthly_micro: 0, rpm: 0 } });
    match = path.match(/^\/api\/app\/keys\/(\d+)(?:\/(revoke|limits))?$/);
    if (match) {
      const key = state.keys.find(item => item.id === Number(match[1]));
      if (!key) return json({ error: 'not found' }, 404);
      if (match[2] === 'revoke') key.revoked = true;
      if (match[2] === 'limits' && method === 'POST') key.limit = body.monthly_micro;
      if (method === 'DELETE') state.keys = state.keys.filter(item => item !== key);
      return json({ ok: true, ...(match[2] === 'limits' ? { monthly_allow_limit_micro: key.limit } : {}) });
    }
    const empty = {
      '/api/app/usage': { usage: [], keys: [], now: 1700000000 }, '/api/app/logs': { logs: [], rows: [] }, '/api/app/catalog': { models: [], channels: [] },
      '/api/app/subscriptions': { cash_micro: 0, grant_micro: 0, plans: [], now: 1700000000 }, '/api/app/plans': state.tokenPlans, '/api/app/wallet/ledger': { entries: [], rows: [] },
      '/api/app/coupons': { coupons: [] }, '/api/app/invoices': { files: [] },
    };
    return json(empty[path] ?? { ok: true });
  }
  return { state, async install(context) { await context.route('**/api/app/**', handle); } };
}
