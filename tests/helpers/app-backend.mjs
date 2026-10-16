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
    // Consent-based membership: members per workspace, the owner's pending
    // invitations per workspace, this user's inbox, and workspaces an inbox
    // invitation joins. Statuses let a test inject 413/429 answers.
    members: {}, pending: {}, inbox: [], joinable: {}, inviteStatus: 202, acceptStatus: 200, password: { status: 200, retryAfter: '' },
    ...options,
  };
  const user = () => ({ id: 42, username: 'ui-user', email: state.email, name: state.profile.name, joined_at: 1700000000, self_keys: true });
  const bootstrap = () => ({
    schema_version: 1, session_id: sessionId, user: user(),
    wallet: { currency: 'CNY', cash_micro: 100000000, grant_micro: 200000000, grant_expires_at: 1900000000 },
    api_allowance: { currency: 'USD', balance: { user_id: 42, micro: 9000000, expires_at: 1900000000 }, term_months: 12, price_cny: 2 },
    agreement: { accepted: true, version: 'server-v1' }, capabilities: { token_plan: false, product_cdk: false, agent_execution: false, api_keys: true },
  });
  const profile = () => ({ profile: { name: state.profile.name, avatar: state.avatarUploaded ? '/api/app/avatar?v=1' : state.profile.avatar }, email: state.email });
  const chatDto = chat => ({ ...chat, message_metadata: chat.messages.map((_, index) => ({ id: `${chat.id}-m${index + 1}`, created: chat.created + index, imported: false, author_user_id: 42, author_name: state.profile.name })) });
  const keyDto = key => ({ id: key.id, name: key.name, prefix: key.prefix, created_at: key.created_at, expires_at: 0, revoked: key.revoked, daily_allow_micro: 0, monthly_allow_micro: 0, monthly_allow_limit_micro: key.limit, rpm: 0 });

  async function handle(route) {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postData() && request.headers()['content-type']?.includes('json') ? request.postDataJSON() : undefined;
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (method !== 'GET') state.writes.push({ method, path, body });
    if (path === '/api/app/session' && method === 'GET') return json(state.signedIn ? { username: 'ui-user', display_name: state.profile.name, created_at: 1700000000, self_keys: true, agreement: { version: 'server-v1', accepted: true } } : { error: 'unauthorized' }, state.signedIn ? 200 : 401);
    if (path === '/api/app/session' && method === 'DELETE') { state.signedIn = false; return json({ ok: true }); }
    // Public account-entry documents are readable before sign-in.
    if (path === '/api/app/auth/config') return json({ signup_enabled: true, email_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: '', ...(state.githubEnabled ? { github_enabled: true } : {}) });
    if (path === '/api/app/agreement') return json({ version: 'server-v1', h1: 'Terms', lede: 'Current terms.', clauses: [], ui: {} });
    if (!state.signedIn) return json({ error: 'unauthorized' }, 401);
    if (path === '/api/app/bootstrap') return json(bootstrap());
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
    let match = path.match(/^\/api\/app\/workspaces\/([^/]+)$/);
    if (match) {
      const workspace = state.workspaces.find(item => item.id === match[1]);
      if (!workspace) return json({ error: 'not found' }, 404);
      if (method === 'PATCH') Object.assign(workspace, body);
      if (method === 'DELETE') { state.workspaces = state.workspaces.filter(item => item !== workspace); state.chats = state.chats.filter(chat => chat.ws !== workspace.id); return route.fulfill({ status: 204 }); }
      return json({ ok: true });
    }
    if (path === '/api/app/password' && method === 'POST') {
      if (state.password.status === 429) return route.fulfill({ status: 429, headers: state.password.retryAfter ? { 'Retry-After': state.password.retryAfter } : {}, json: { error: '尝试过于频繁，请稍后再试' } });
      return json({ ok: true });
    }
    if (path === '/api/app/invitations') return json({ invitations: state.inbox });
    match = path.match(/^\/api\/app\/invitations\/([^/]+)\/(accept|decline)$/);
    if (match && method === 'POST') {
      // An invitation revoked after the inbox was read: the server drops it
      // and answers 404, as fells-api does after a role change, removal or leave.
      if (state.revoked?.includes(match[1])) { state.inbox = state.inbox.filter(item => item.id !== match[1]); return json({ error: 'workspace or conversation not found' }, 404); }
      const invitation = state.inbox.find(item => item.id === match[1]);
      if (!invitation) return json({ error: 'workspace or conversation not found' }, 404);
      if (match[2] === 'accept' && state.acceptStatus === 413) return json({ error: 'workspace storage limit reached' }, 413);
      state.inbox = state.inbox.filter(item => item !== invitation);
      if (match[2] === 'decline') return route.fulfill({ status: 204 });
      const workspace = { ...state.joinable[invitation.workspace_id], role: invitation.role };
      state.workspaces.push(workspace);
      return json({ workspace });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/leave$/);
    if (match && method === 'POST') {
      const workspace = state.workspaces.find(item => item.id === match[1]);
      if (!workspace) return json({ error: 'workspace or conversation not found' }, 404);
      if (workspace.role === 'owner') return json({ error: 'owner membership cannot be changed' }, 400);
      state.workspaces = state.workspaces.filter(item => item !== workspace); state.chats = state.chats.filter(chat => chat.ws !== workspace.id);
      return route.fulfill({ status: 204 });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/invitations(?:\/([^/]+))?$/);
    if (match) {
      const list = state.pending[match[1]] ?? [];
      if (method === 'DELETE') { state.pending[match[1]] = list.filter(item => item.id !== match[2]); return route.fulfill({ status: 204 }); }
      return json({ invitations: list });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/members\/(\d+)$/);
    if (match) {
      const list = state.members[match[1]] ?? [];
      if (method === 'DELETE') { state.members[match[1]] = list.filter(item => item.user_id !== Number(match[2])); return route.fulfill({ status: 204 }); }
      const member = list.find(item => item.user_id === Number(match[2]));
      if (!member) return json({ error: 'workspace or conversation not found' }, 404);
      member.role = body.role; return json({ member: { user_id: member.user_id, role: member.role } });
    }
    match = path.match(/^\/api\/app\/workspaces\/([^/]+)\/(chats|members)$/);
    if (match?.[2] === 'chats') return json({ chats: state.chats.filter(chat => chat.ws === match[1]).map(chatDto) });
    if (match?.[2] === 'members' && method === 'POST') {
      if (state.inviteStatus !== 202) return json({ error: 'too many pending invitations' }, state.inviteStatus);
      const typed = body.username ?? `#${body.user_id}`;
      const label = body.username ? (body.username.includes('@') ? body.username[0] + '***@' + body.username.split('@').pop() : body.username.slice(0, 2) + '***') : typed;
      (state.pending[match[1]] ??= []).push({ id: `9${String(state.nextID++).padStart(7, '0')}-0000-4000-8000-000000000000`, label, role: body.role, created: 1700000000000, expires: 1701209600000 });
      return json({ invitation: { status: 'pending', role: body.role } }, 202);
    }
    if (match?.[2] === 'members') return json({ members: state.members[match[1]] ?? [{ user_id: 42, name: state.profile.name, role: 'owner' }] });
    if (path === '/api/app/chats' && method === 'POST') {
      if (state.failChatWrites) return json({ error: 'Injected chat failure' }, 503);
      state.chats.push({ ...body }); return json({ ok: true }, 201);
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
      '/api/app/subscriptions': { cash_micro: 0, grant_micro: 0, plans: [], now: 1700000000 }, '/api/app/wallet/ledger': { entries: [], rows: [] },
      '/api/app/coupons': { coupons: [] }, '/api/app/invoices': { files: [] },
    };
    return json(empty[path] ?? { ok: true });
  }
  return { state, async install(context) { await context.route('**/api/app/**', handle); } };
}
