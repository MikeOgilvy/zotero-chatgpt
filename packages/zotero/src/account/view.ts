import { AccountController, type AccountViewServices, type AccountViewState } from './controller.ts';
const HTML = 'http://www.w3.org/1999/xhtml';
/** Keeps the output node stable during streaming so neither layout nor focus is reset. */
export function mountAccountView(body: HTMLElement, services: AccountViewServices, connect: boolean): () => void {
  const doc = body.ownerDocument;
  const element = (tag: string, text = '') => { const node = doc.createElementNS(HTML, tag); node.textContent = text; return node; };
  const root = element('section'); root.className = 'zcr-account'; root.dataset.zcrAccount = '';
  const status = element('p', '正在启动 Codex…'); status.setAttribute('role', 'status');
  const note = element('p', '开发预览 · 本阶段仅运行合成问题，不发送论文内容。'); note.className = 'zcr-identity';
  const error = element('p'); error.className = 'zcr-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const buttons = element('div'); buttons.className = 'zcr-actions';
  const makeButton = (text: string, action: string, callback: () => Promise<void>) => {
    const button = element('button', text) as HTMLButtonElement; button.type = 'button'; button.dataset.zcrAction = action;
    button.addEventListener('click', () => { void callback(); }); buttons.append(button); return button;
  };
  const login = makeButton('使用 ChatGPT 登录', 'login', () => controller.login());
  const cancelLogin = makeButton('取消登录', 'cancel-login', () => controller.cancelLogin());
  const retry = makeButton('重新连接', 'retry', () => controller.connect());
  const run = makeButton('运行连接测试', 'run-test', () => controller.runTest());
  const stop = makeButton('停止回复', 'stop', () => controller.stopRequest());
  const model = element('p'); model.className = 'zcr-identity';
  const question = element('p'); question.className = 'zcr-test-question'; question.hidden = true;
  const result = element('div'); result.className = 'zcr-test-output'; result.dataset.zcrOutput = ''; result.setAttribute('aria-label', '连接测试回复');
  const phase = element('p'); phase.className = 'zcr-identity'; phase.setAttribute('role', 'status');
  const requestStates = { accepted: '请求已记录', dispatching: '正在发送…', running: '正在回复…', completed: '连接测试完成', cancelled: '已停止', failed: '连接测试失败', uncertain: '连接中断，无法确认请求是否完成。为避免重复发送，已暂停测试。' };
  const update = ({ connection, snapshot, message }: AccountViewState) => {
    const account = snapshot?.account;
    root.dataset.zcrRuntime = connection;
    root.dataset.zcrAuth = account?.state || 'signedOut';
    root.dataset.zcrRequestState = snapshot?.request?.state || 'idle';
    root.dataset.zcrRequestId = snapshot?.request?.requestId || '';
    const pendingLogin = snapshot?.login?.state === 'pending';
    status.textContent = connection === 'starting' ? '正在启动 Codex…' : connection === 'error' ? 'Codex 连接不可用'
      : account?.state === 'signedIn' ? `已登录 ${account.displayLabel || 'ChatGPT'}`
      : pendingLogin ? '请在浏览器中完成 ChatGPT 登录。' : '登录 ChatGPT，开始连接测试。';
    const request = snapshot?.request;
    const generating = !!request && ['accepted', 'dispatching', 'running'].includes(request.state);
    login.hidden = account?.state === 'signedIn' || !!pendingLogin; login.disabled = connection === 'starting';
    cancelLogin.hidden = !pendingLogin;
    retry.hidden = connection !== 'error';
    run.disabled = connection !== 'ready' || account?.state !== 'signedIn' || generating || request?.state === 'uncertain';
    stop.hidden = !generating;
    const selected = snapshot?.models.find(option => option.isDefault) ?? snapshot?.models[0];
    model.textContent = selected ? `测试模型：${selected.displayName} · 已读取 ${snapshot!.models.length} 个模型` : '';
    const detail = message || request?.error || (snapshot?.login?.state === 'failed' ? snapshot.login.message : null);
    error.textContent = detail || ''; error.hidden = !detail;
    question.textContent = request?.question || ''; question.hidden = !request;
    // textContent is the only rendering path for upstream output in S2.
    if (result.textContent !== (request?.output || '')) result.textContent = request?.output || '';
    phase.textContent = request ? requestStates[request.state] : '';
  };
  const controller = new AccountController(services, update);
  root.append(note, status, buttons, error, model, question, result, phase); body.append(root);
  update({ connection: 'starting', snapshot: null, message: null });
  if (connect) void controller.connect();
  else { status.textContent = '打开 Codex 侧栏以连接。'; login.disabled = false; }
  return () => { controller.dispose(); root.remove(); };
}
