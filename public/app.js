const role = new URLSearchParams(location.search).get('role') === 'gm' ? 'gm' : 'runner';
let state;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const russianActionLabels = {
  Scanner: 'СКАНЕР', Backdoor: 'БЭКДОР', Cloak: 'ПЛАЩ', Control: 'УПРАВЛЕНИЕ',
  Eyedea: 'ОПОЗНАНИЕ', Pathfinder: 'ПЕРВОПРОХОДЕЦ', Slide: 'УСКОЛЬЗНУТЬ', Virus: 'ВИРУС', Zap: 'РАЗРЯД',
  'Сканер': 'СКАНЕР', 'Плащ': 'ПЛАЩ', 'Опознание': 'ОПОЗНАНИЕ', 'Вирус': 'ВИРУС',
  'Бэкдор': 'БЭКДОР', 'Первопроходец': 'ПЕРВОПРОХОДЕЦ', 'Управление': 'УПРАВЛЕНИЕ',
  'Ускользнуть': 'УСКОЛЬЗНУТЬ', 'Разряд': 'РАЗРЯД'
};

async function action(type, payload = {}) {
  const response = await fetch('/api/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, type, payload })
  });
  const result = await response.json();
  if (!result.ok) toast(result.error, true);
  return result.ok;
}

function toast(message, error = false) {
  const box = $('#toast');
  box.textContent = message;
  box.className = error ? 'show error' : 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.className = '', 2600);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function nodeIcon(type) {
  return ({ 'Файл': '▤', 'Пароль': '◇', 'Управляющий Узел': '⌁', 'Чёрный ЛЁД': '⟁' })[type] || '◆';
}

function nodeClass(type) {
  return ({ 'Файл': 'file', 'Пароль': 'password', 'Управляющий Узел': 'control-node', 'Чёрный ЛЁД': 'black-ice' })[type] || 'unknown';
}

function render() {
  document.title = `${role === 'gm' ? 'Мастер' : 'Нетраннер'} // ${state.session.name}`;
  $$('[data-role-link]').forEach(link => link.classList.toggle('active', link.dataset.roleLink === role));
  $('#roleEyebrow').textContent = role === 'gm' ? 'РЕЖИМ МАСТЕРА // ВСЕ УРОВНИ' : 'РЕЖИМ НЕТРАННЕРА // ТОЛЬКО ОБНАРУЖЕННОЕ';
  $('#sessionName').textContent = state.session.name;
  $('#accessPoint').textContent = state.session.accessPoint;
  $('#turnLabel').textContent = `ХОД ${String(state.session.turn).padStart(2, '0')}`;
  $('#linkStatus').textContent = state.session.connected ? 'ПОДКЛЮЧЁН' : 'ОТКЛЮЧЁН';
  $('#linkStatus').classList.toggle('online', state.session.connected);
  $('#connectBtn').textContent = state.session.connected ? 'ОТКЛЮЧИТЬСЯ' : 'ПОДКЛЮЧИТЬСЯ';
  $('#runnerName').textContent = state.runner.name;
  $('.avatar').textContent = state.runner.name.slice(0, 1).toUpperCase();
  $('#interfaceStat').textContent = state.runner.interface;
  $('#speedStat').textContent = `${state.runner.speedBonus >= 0 ? '+' : ''}${state.runner.speedBonus}`;
  $('#brainText').textContent = `${state.runner.brainHP} / ${state.runner.maxBrainHP}`;
  $('#brainMeter').style.width = `${100 * state.runner.brainHP / state.runner.maxBrainHP}%`;
  $('#actionsRemain').textContent = state.runner.netActionsRemaining;
  const total = state.runner.interface >= 10 ? 5 : state.runner.interface >= 7 ? 4 : state.runner.interface >= 4 ? 3 : 2;
  $('#actionPips').innerHTML = Array.from({ length: total }, (_, index) => `<i class="${index < state.runner.netActionsRemaining ? 'live' : ''}"></i>`).join('');
  $('#gmPanel').classList.toggle('hidden', role !== 'gm');
  $('#architectureIntel').textContent = state.totalFloors
    ? `ВСЕГО ЭТАЖЕЙ: ${state.totalFloors}`
    : 'КОЛИЧЕСТВО ЭТАЖЕЙ НЕИЗВЕСТНО';
  const pathfinder = state.runner.pathfinder;
  $('#pathfinderIntel').textContent = pathfinder
    ? `ПЕРВОПРОХОДЕЦ ${pathfinder.result} → ЛИМИТ ${pathfinder.floorBudget}, ОТКРЫТО ${pathfinder.openedByResult}, НОВЫХ ${pathfinder.newlyRevealed}${pathfinder.stoppedBy ? ` · СТОП: ${pathfinder.stoppedBy} СЛ ${pathfinder.stoppedDv}` : ''}`
    : '';
  $$('[data-action-label]').forEach(button => {
    button.textContent = russianActionLabels[button.dataset.actionLabel] || button.textContent;
  });
  $$('[data-meat-label]').forEach(button => {
    button.textContent = russianActionLabels[button.dataset.meatLabel] || button.textContent;
  });
  renderArchitecture();
  renderPrograms();
  renderLog();
  if (role === 'gm') fillGmForm();
}

function renderArchitecture() {
  const sorted = [...state.nodes].sort((a, b) => a.floor - b.floor);
  $('#architecture').innerHTML = sorted.map((node, index) => {
    const current = node.id === state.runner.floorId;
    const classes = ['arch-node', nodeClass(node.type), current ? 'current' : '', node.cleared ? 'cleared' : '', node.revealed ? '' : 'concealed'].join(' ');
    const stat = node.type === 'Чёрный ЛЁД' && node.ice
      ? `<span>СКО ${node.ice.speed}</span><span>АТК ${node.ice.attack}</span><span>ЗАЩ ${node.ice.defense}</span><span>REZ ${node.ice.rez}</span>`
      : node.dv ? `<span>СЛ ${node.dv}</span>` : '';
    const dvEditor = role === 'gm' && node.type !== 'Чёрный ЛЁД' ? `<label class="dv-editor">СЛ <input data-node-dv="${node.id}" type="number" min="0" max="30" value="${Number(node.dv || 0)}"></label><button data-save-dv="${node.id}">СОХР.</button>` : '';
    const gmTools = role === 'gm' ? `<div class="node-tools">${dvEditor}<button data-reveal="${node.id}">${node.revealed ? 'СКРЫТЬ' : 'ОТКРЫТЬ'}</button><button data-clear="${node.id}">${node.cleared ? 'ВОССТАНОВИТЬ' : 'ПРЕОДОЛЕНО'}</button><button data-delete="${node.id}">×</button></div>` : '';
    return `${index ? '<div class="trace-line"><i></i></div>' : ''}<article class="${classes}" data-move="${node.id}">
      <div class="floor-no">Э${String(node.floor).padStart(2, '0')}</div>
      <div class="node-glyph">${nodeIcon(node.type)}</div>
      <div class="node-copy"><small>${esc(node.type)}</small><h3>${esc(node.title)}</h3><p>${esc(node.details || '')}</p><div class="node-stats">${stat}</div></div>
      ${current ? '<b class="runner-marker">НЕТРАННЕР ЗДЕСЬ</b>' : ''}${gmTools}
    </article>`;
  }).join('');

  $$('[data-move]').forEach(node => node.addEventListener('click', event => {
    if (event.target.closest('button,input,label')) return;
    action('move', { id: node.dataset.move });
  }));
  $$('[data-reveal]').forEach(button => button.onclick = () => action('toggleReveal', { id: button.dataset.reveal }));
  $$('[data-clear]').forEach(button => button.onclick = () => action('toggleClear', { id: button.dataset.clear }));
  $$('[data-delete]').forEach(button => button.onclick = () => action('deleteNode', { id: button.dataset.delete }));
  $$('[data-save-dv]').forEach(button => button.onclick = () => {
    const input = document.querySelector(`[data-node-dv="${button.dataset.saveDv}"]`);
    action('updateNodeDv', { id: button.dataset.saveDv, dv: Number(input.value) });
  });
}

function renderPrograms() {
  $('#programList').innerHTML = state.programs.map(program => `<button class="program ${program.active ? 'active' : ''}" data-program="${program.id}">
    <span class="program-dot"></span><span><b>${esc(program.name)}</b><small>${esc(program.class)} · REZ ${program.rez}</small></span><em>${program.active ? 'ON' : 'OFF'}</em>
    <p>${esc(program.effect)}</p></button>`).join('');
  $$('[data-program]').forEach(button => button.onclick = () => action('toggleProgram', { id: button.dataset.program }));
}

function renderLog() {
  $('#eventLog').innerHTML = state.log.map(item => {
    const time = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="log-entry ${item.kind}"><time>${time}</time><p>${esc(item.text)}</p></div>`;
  }).join('');
}

function fillGmForm() {
  const form = $('#runnerForm');
  ['name', 'interface', 'brainHP', 'maxBrainHP'].forEach(name => form.elements[name].value = state.runner[name]);
  const settings = $('#pathfinderSettingsForm');
  settings.elements.mode.value = state.session.pathfinderReveal?.mode || 'result';
  settings.elements.table.value = state.session.pathfinderReveal?.table || '';
}

$('#connectBtn').onclick = () => action('connect', { connected: !state.session.connected });
$('#nextTurnBtn').onclick = () => action('nextTurn');
function openFunctionCheck(label) {
  const form = $('#rollForm');
  const currentNode = state.nodes.find(node => node.id === state.runner.floorId);
  if (label === 'Бэкдор' && currentNode?.type !== 'Пароль') {
    toast('Сначала переместитесь на этаж с Паролем.', true);
    return false;
  }
  form.elements.label.value = label;
  form.elements.bonus.value = state.runner.interface;
  form.elements.dv.value = ['Сканер', 'Плащ', 'Первопроходец', 'Ускользнуть', 'Вирус', 'Разряд'].includes(label) ? 0 : 8;
  form.elements.dv.readOnly = false;
  $('#dvLabel').textContent = 'СЛ (0 для встречной проверки)';
  if (label === 'Бэкдор') {
    form.elements.dv.value = Number(currentNode.dv || 0);
    form.elements.dv.readOnly = true;
    $('#dvLabel').textContent = 'СЛ Пароля (задаёт Мастер)';
  }
  $('#rollDialog').showModal();
  return true;
}
$$('[data-action-label]').forEach(button => button.onclick = () => {
  const label = button.dataset.actionLabel;
  if (!openFunctionCheck(label)) return;
  action('spendAction', { label }).then(ok => { if (!ok) $('#rollDialog').close(); });
});
$$('[data-meat-label]').forEach(button => button.onclick = () => {
  const label = button.dataset.meatLabel;
  if (!openFunctionCheck(label)) return;
  action('meatAction', { label }).then(ok => { if (!ok) $('#rollDialog').close(); });
});
$('#rollForm').addEventListener('submit', event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  action('roll', { label: data.label, bonus: Number(data.bonus), dv: Number(data.dv) });
  $('#rollDialog').close();
});
$('#runnerForm').addEventListener('submit', event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  action('updateRunner', { ...data, interface: Number(data.interface), brainHP: Number(data.brainHP), maxBrainHP: Number(data.maxBrainHP) });
});
$('#nodeForm').addEventListener('submit', event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  action('addNode', { ...data, dv: Number(data.dv) }); event.currentTarget.reset();
});
$('#pathfinderSettingsForm').addEventListener('submit', event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  action('updatePathfinderReveal', data);
});
$('#resetBtn').onclick = () => { if (confirm('Сбросить всю общую сессию?')) action('reset'); };

fetch(`/api/state?role=${role}`).then(response => response.json()).then(data => { state = data; render(); });
const stream = new EventSource(`/events?role=${role}`);
stream.addEventListener('state', event => { state = JSON.parse(event.data); $('#syncDot').classList.add('online'); $('#syncLabel').textContent = 'СИНХРОНИЗИРОВАНО'; render(); });
stream.onerror = () => { $('#syncDot').classList.remove('online'); $('#syncLabel').textContent = 'ПЕРЕПОДКЛЮЧЕНИЕ'; };
