const role = new URLSearchParams(location.search).get('role') === 'gm' ? 'gm' : 'runner';
let state;
let pendingRoll = null;
let pendingCheckAction = null;

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
  try {
    const response = await fetch('/api/action', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, type, payload })
    });
    const result = await response.json();
    if (!result.ok) {
      const staleServer = ['createNetwork', 'updateNetwork', 'deleteNetwork', 'openNetwork', 'updateNode', 'addWalletFunds'].includes(type)
        && result.error === 'Неизвестное действие.';
      toast(staleServer ? 'Перезапустите сервер: он всё ещё использует старую версию.' : result.error, true);
    }
    return result.ok;
  } catch {
    toast('Нет связи с сервером. Проверьте, что он запущен.', true);
    return false;
  }
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
  $('#connectBtn').disabled = role === 'runner' && !state.activeNetworkId;
  $('#runnerName').textContent = state.runner.name;
  $('.avatar').textContent = state.runner.name.slice(0, 1).toUpperCase();
  $('#interfaceStat').textContent = state.runner.interface;
  $('#speedStat').textContent = `${state.runner.speedBonus >= 0 ? '+' : ''}${state.runner.speedBonus}`;
  $('#healthText').textContent = `${state.runner.health} / ${state.runner.maxHealth}`;
  $('#healthMeter').style.width = `${100 * state.runner.health / state.runner.maxHealth}%`;
  $('#walletBalance').textContent = Number(state.runner.wallet || 0).toLocaleString('ru-RU');
  $('#burningStatus').classList.toggle('hidden', !state.runner.burning);
  $('#actionsRemain').textContent = state.runner.netActionsRemaining;
  const total = state.runner.interface >= 10 ? 4 : state.runner.interface >= 7 ? 3 : state.runner.interface >= 4 ? 2 : 1;
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
  $('#nextTurnBtn').disabled = role === 'gm';
  $('#newNetworkBtn').classList.toggle('hidden', role !== 'gm');
  $('#scanRequestBtn').classList.toggle('hidden', role !== 'runner');
  $('#scanRequestBtn').disabled = role !== 'runner' || state.session.connected || state.scan?.pending;
  $('#scanRequestBtn').textContent = state.scan?.pending ? 'ЗАПРОС ОТПРАВЛЕН' : 'ЗАПРОСИТЬ СКАНИРОВАНИЕ';
  $$('[data-action-label]').forEach(button => {
    button.disabled = role === 'gm' || Boolean(state.battle?.active) || !state.session.connected || state.runner.netActionsRemaining < 1;
  });
  $$('[data-meat-label]').forEach(button => { button.disabled = role === 'gm' || Boolean(state.battle?.active); });
  if (role === 'gm') $('#undoRunnerActionBtn').disabled = !state.canUndoRunnerAction;
  renderNetworks();
  renderArchitecture();
  renderBattle();
  renderPrograms();
  renderLog();
  if (role === 'gm') fillGmForm();
}

function renderNetworks() {
  $('#networkList').innerHTML = state.networks.length ? state.networks.map(network => {
    const active = network.id === state.activeNetworkId;
    const gmActions = role === 'gm'
      ? `<button data-edit-network="${network.id}">ИЗМЕНИТЬ</button><button class="delete-network" data-delete-network="${network.id}"${state.networks.length <= 1 ? ' disabled' : ''}>×</button>`
      : '';
    return `<article class="network-card ${active ? 'active' : ''}">
      <div class="network-card-copy"><small>${active ? 'АКТИВНАЯ СЕТЬ' : 'ДОСТУПНАЯ СЕТЬ'} · ${network.floorCount ? `${network.floorCount} ЭТ.` : 'АРХИТЕКТУРА НЕИЗВЕСТНА'}</small><b>${esc(network.name)}</b></div>
      <div class="network-card-actions"><button data-open-network="${network.id}"${active ? ' disabled' : ''}>${active ? 'ОТКРЫТА' : 'ОТКРЫТЬ'}</button>${gmActions}</div>
    </article>`;
  }).join('') : '<p class="network-empty">Доступные Сети пока не обнаружены. Запросите сканирование.</p>';
  $$('[data-open-network]').forEach(button => button.onclick = () => action('openNetwork', { id: button.dataset.openNetwork }));
  $$('[data-edit-network]').forEach(button => button.onclick = () => {
    const network = state.networks.find(item => item.id === button.dataset.editNetwork);
    const form = $('#networkForm');
    form.elements.id.value = network.id;
    form.elements.name.value = network.name;
    $('#networkDialogTitle').textContent = 'ИЗМЕНИТЬ СЕТЬ';
    $('#networkDialog').showModal();
  });
  $$('[data-delete-network]').forEach(button => button.onclick = () => {
    const network = state.networks.find(item => item.id === button.dataset.deleteNetwork);
    if (confirm(`Удалить сеть «${network.name}» со всеми этажами?`)) action('deleteNetwork', { id: network.id });
  });
  const scanForm = $('#gmScanForm');
  scanForm.classList.toggle('hidden', role !== 'gm' || !state.scan?.pending);
  if (role === 'gm' && state.scan?.pending) {
    const visible = new Set(state.scan.visibleNetworkIds || []);
    $('#scanNetworkChoices').innerHTML = state.networks.map(network => `<label><input type="checkbox" name="networkIds" value="${esc(network.id)}"${visible.has(network.id) ? ' checked' : ''}><span><b>${esc(network.name)}</b><small>${network.floorCount} ЭТ. · ${esc(network.accessPoint || 'ТОЧКА ДОСТУПА НЕ УКАЗАНА')}</small></span></label>`).join('');
  }
}

function renderArchitecture() {
  const sorted = [...state.nodes].sort((a, b) => a.floor - b.floor);
  const currentNode = state.nodes.find(node => node.id === state.runner.floorId);
  const movementLocked = Boolean(state.battle?.active && state.battle.nodeId === currentNode?.id);
  $('#architecture').innerHTML = sorted.length ? sorted.map((node, index) => {
    const current = node.id === state.runner.floorId;
    const classes = ['arch-node', role === 'runner' && !movementLocked ? 'movable' : '', nodeClass(node.type), current ? 'current' : '', node.cleared ? 'cleared' : '', node.revealed ? '' : 'concealed'].join(' ');
    const stat = node.type === 'Чёрный ЛЁД' && node.ice
      ? `<span>СКО ${node.ice.speed}</span><span>АТК ${node.ice.attack}</span><span>ЗАЩ ${node.ice.defense}</span><span>REZ ${node.ice.rez}</span>`
      : node.dv ? `<span>СЛ ${node.dv}</span>` : '';
    const dvEditor = role === 'gm' && node.type !== 'Чёрный ЛЁД'
      ? `<label class="dv-editor">${node.type === 'Пароль' ? 'СЛ ПАРОЛЯ' : 'СЛ ПРОВЕРКИ'} <input data-node-dv="${node.id}" aria-label="Сложность проверки ${esc(node.title)}" type="number" min="0" max="30" step="1" value="${Number(node.dv || 0)}" required></label>`
      : '';
    const gmTools = role === 'gm' ? `<div class="node-tools">${dvEditor}<button data-edit-node="${node.id}">ИЗМЕНИТЬ</button><button data-reveal="${node.id}">${node.revealed ? 'СКРЫТЬ' : 'ОТКРЫТЬ'}</button><button data-clear="${node.id}">${node.cleared ? 'ВОССТАНОВИТЬ' : 'ПРЕОДОЛЕНО'}</button><button data-delete="${node.id}">×</button></div>` : '';
    return `${index ? '<div class="trace-line"><i></i></div>' : ''}<article class="${classes}"${role === 'runner' && !movementLocked ? ` data-move="${node.id}"` : ''}>
      <div class="floor-no">Э${String(node.floor).padStart(2, '0')}</div>
      <div class="node-glyph">${nodeIcon(node.type)}</div>
      <div class="node-copy"><small>${esc(node.type)}</small><h3>${esc(node.title)}</h3><p>${esc(node.details || '')}</p><div class="node-stats">${stat}</div></div>
      ${current ? `<b class="runner-marker">${movementLocked ? 'БОЙ // ДВИЖЕНИЕ ЗАБЛОКИРОВАНО' : 'НЕТРАННЕР ЗДЕСЬ'}</b>` : ''}${gmTools}
    </article>`;
  }).join('') : `<p class="architecture-empty">${state.activeNetworkId ? 'ПОДКЛЮЧИТЕСЬ К СЕТИ, ЧТОБЫ ОТКРЫТЬ ПЕРВЫЙ ЭТАЖ' : 'ВЫБЕРИТЕ ОБНАРУЖЕННУЮ СЕТЬ'}</p>`;

  $$('[data-move]').forEach(node => node.addEventListener('click', event => {
    if (event.target.closest('button,input,label')) return;
    action('move', { id: node.dataset.move });
  }));
  $$('[data-reveal]').forEach(button => button.onclick = () => action('toggleReveal', { id: button.dataset.reveal }));
  $$('[data-clear]').forEach(button => button.onclick = () => action('toggleClear', { id: button.dataset.clear }));
  $$('[data-delete]').forEach(button => button.onclick = () => action('deleteNode', { id: button.dataset.delete }));
  $$('[data-edit-node]').forEach(button => button.onclick = () => {
    const node = state.nodes.find(item => item.id === button.dataset.editNode);
    const form = $('#nodeEditForm');
    form.elements.id.value = node.id;
    form.elements.title.value = node.title;
    form.elements.nodeType.value = node.type;
    form.elements.dv.value = Number(node.dv || 0);
    form.elements.iceName.value = node.ice?.name || 'Аспид';
    form.elements.details.value = node.details || '';
    $('#nodeDialog').showModal();
  });
  const saveNodeDv = async input => {
    if (!input.reportValidity()) return;
    const dv = Number(input.value);
    if (await action('updateNodeDv', { id: input.dataset.nodeDv, dv })) {
      toast(`Сложность проверки изменена: СЛ ${dv}`);
    }
  };
  $$('[data-node-dv]').forEach(input => {
    input.onchange = () => saveNodeDv(input);
    input.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.blur();
    };
  });
}

function renderBattle() {
  const panel = $('#battlePanel');
  const battle = state.battle;
  const node = battle ? state.nodes.find(item => item.id === battle.nodeId) : null;
  panel.classList.toggle('hidden', !battle?.active || !node);
  if (!battle?.active || !node) return;
  $('#battleName').textContent = node.title;
  $('#battleRound').textContent = `РАУНД ${battle.round}`;
  $('#battleRunner').textContent = `ИНТЕРФЕЙС ${state.runner.interface}`;
  $('#battleIceStats').textContent = `ВСП ${node.ice.perception} · СКО ${node.ice.speed} · АТК ${node.ice.attack} · ЗАЩ ${node.ice.defense}`;
  $('#battleInitiativeRunner').textContent = `ВСТРЕЧА ${battle.runnerInitiative}`;
  $('#battleInitiativeIce').textContent = `ВСТРЕЧА ${battle.iceInitiative}${battle.ambushHit ? ' · ЗАСАДА' : ''}`;
  $('#iceRezText').textContent = `${node.currentRez} / ${node.ice.rez}`;
  $('#iceRezMeter').style.width = `${100 * node.currentRez / node.ice.rez}%`;
  $('#battleEffect').textContent = node.ice.effect;
  const attackProgram = state.programs.find(program => program.class === 'Атакующая' && program.target !== 'Нетраннеры' && program.active && !program.destroyed);
  $$('[data-battle-action]').forEach(button => {
    const kind = button.dataset.battleAction;
    if (kind === 'iceAttack') button.disabled = role !== 'gm';
    else if (kind === 'program') {
      button.dataset.programId = attackProgram?.id || '';
      button.disabled = role !== 'runner' || !attackProgram;
    }
    else if (kind === 'extinguish') button.disabled = role !== 'runner' || !state.runner.burning;
    else button.disabled = role !== 'runner';
  });
  const loadedIce = state.programs.filter(program => program.class === 'Чёрный ЛЁД' && program.target === 'Программы' && !program.destroyed);
  $('#runnerIceBattleActions').innerHTML = loadedIce.length ? loadedIce.map(program => {
    const attacked = program.active && program.lastAttackRound === battle.round;
    const label = program.active ? `ХОД: ${program.name}${attacked ? ' · УЖЕ АТАКОВАЛ' : ''}` : `АКТИВИРОВАТЬ: ${program.name} · 1 ДЕЙСТВИЕ`;
    return `<button data-runner-ice="${program.id}"${role !== 'runner' || attacked ? ' disabled' : ''}>${esc(label)}<small>АТК ${program.attack} · ЗАЩ ${program.defense} · REZ ${program.currentRez}/${program.rez}</small></button>`;
  }).join('') : '<p>В Кибердеке нет собственного Чёрного ЛЬДА.</p>';
  $$('[data-runner-ice]').forEach(button => button.onclick = () => action('battleAction', { kind: 'runnerIce', programId: button.dataset.runnerIce }));
}

function renderPrograms() {
  const canEdit = role === 'runner' && state.session.connected && state.runner.netActionsRemaining > 0;
  $('#deckSlotsText').textContent = `${state.deckSlotsUsed || 0} / ${state.runner.deckSlots}`;
  $('#programList').innerHTML = state.programs.length ? state.programs.map(program => `<div class="program-row"><button class="program ${program.active ? 'active' : ''} ${program.destroyed ? 'destroyed' : ''}" data-program="${program.id}"${role === 'gm' || program.destroyed || program.class === 'Чёрный ЛЁД' || !state.session.connected || state.runner.netActionsRemaining < 1 ? ' disabled' : ''}>
    <span class="program-dot"></span><span><b>${esc(program.name)}</b><small>${esc(program.class)} · ${program.slots || 1} ${program.slots === 2 ? 'СЛОТА' : 'СЛОТ'} · АТК ${program.attack} · ЗАЩ ${program.defense} · REZ ${program.currentRez ?? program.rez}/${program.rez}</small></span><em>${program.class === 'Чёрный ЛЁД' ? (program.active ? 'В БОЮ' : 'ГОТОВ') : (program.active ? 'ON' : 'OFF')}</em>
    <p>${program.destroyed ? 'УНИЧТОЖЕНА' : esc(program.effect)}</p></button><button class="program-delete" data-delete-program="${program.id}"${canEdit && !program.active ? '' : ' disabled'}>УДАЛИТЬ<br>· 1 ДЕЙСТВИЕ</button></div>`).join('') : '<p class="program-empty">В КИБЕРДЕКЕ НЕТ ПРОГРАММ</p>';
  $('#downloadProgramBtn').classList.toggle('hidden', role !== 'runner');
  $('#downloadProgramBtn').disabled = !canEdit;
  $$('[data-program]').forEach(button => button.onclick = () => action('toggleProgram', { id: button.dataset.program }));
  $$('[data-delete-program]').forEach(button => button.onclick = () => {
    const program = state.programs.find(item => item.id === button.dataset.deleteProgram);
    if (program && confirm(`Удалить Программу «${program.name}» за одно Сетевое Действие?`)) action('deleteProgram', { id: program.id });
  });
}

function renderLog() {
  $('#eventLog').innerHTML = state.log.map(item => {
    const time = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="log-entry ${item.kind}"><time>${time}</time><p>${esc(item.text)}</p></div>`;
  }).join('');
}

function fillGmForm() {
  const form = $('#runnerForm');
  ['name', 'interface', 'health', 'maxHealth', 'wallet'].forEach(name => form.elements[name].value = state.runner[name]);
  const settings = $('#pathfinderSettingsForm');
  settings.elements.mode.value = state.session.pathfinderReveal?.mode || 'result';
  settings.elements.table.value = state.session.pathfinderReveal?.table || '';
}

$('#connectBtn').onclick = () => action('connect', { connected: !state.session.connected });
$('#nextTurnBtn').onclick = () => action('nextTurn');
$('#scanRequestBtn').onclick = () => action('requestScan');
const programGroupDescriptions = {
  'Усиления': 'Повышают способности Нетраннера, пока остаются активными.',
  'Защитные': 'Останавливают или ослабляют атаки вражеских Программ.',
  'Атакующие против программ': 'Повреждают обычные Программы и Чёрный ЛЁД.',
  'Атакующие против Нетраннеров': 'Наносят урон или накладывают эффекты на вражеского Нетраннера.',
  'Чёрный ЛЁД против Людей': 'Занимает 2 слота Кибердеки. Активируется на вражеского Нетраннера и получает собственный Ход в бою.',
  'Чёрный ЛЁД против Программ': 'Занимает 2 слота Кибердеки, активируется на цель и получает собственный Ход в бою.'
};

function renderProgramGroups() {
  const groups = [...new Set((state.programCatalog || []).map(program => program.category))];
  $('#programGroups').innerHTML = groups.map(group => {
    const count = state.programCatalog.filter(program => program.category === group).length;
    return `<button type="button" class="program-group" data-program-group="${esc(group)}"><b>${esc(group)}</b><small>${count} ПРОГРАММ</small><p>${esc(programGroupDescriptions[group] || '')}</p></button>`;
  }).join('') || '<p class="program-empty">КАТАЛОГ НЕДОСТУПЕН</p>';
  $$('[data-program-group]').forEach(button => button.onclick = () => showProgramGroup(button.dataset.programGroup));
}

function renderProgramCatalog(group) {
  const wallet = Number(state.runner.wallet || 0);
  $('#programCatalog').innerHTML = (state.programCatalog || []).filter(program => program.category === group).map(program => {
    const affordable = wallet >= Number(program.cost || 0);
    return `<label class="catalog-program ${affordable ? '' : 'unaffordable'}">
    <input type="radio" name="catalogId" value="${esc(program.catalogId)}" required${affordable ? '' : ' disabled'}>
    <span class="catalog-program-body">
      <span class="catalog-program-head"><b>${esc(program.name)}</b><em>${esc(program.category)}</em></span>
      <span class="catalog-program-stats"><i>СЛОТЫ <b>${program.slots || 1}</b></i>${program.class === 'Чёрный ЛЁД' ? `<i>ВСП <b>${program.perception}</b></i><i>СКО <b>${program.speed}</b></i>` : ''}<i>АТК <b>${program.attack}</b></i><i>ЗАЩ <b>${program.defense}</b></i><i>REZ <b>${program.rez}</b></i><i class="catalog-price">${program.cost} eb · ${esc(program.availability)}</i>${affordable ? '' : '<i class="catalog-insufficient">НЕДОСТАТОЧНО СРЕДСТВ</i>'}</span>
      <p>${esc(program.effect)}</p>
    </span>
  </label>`;
  }).join('') || '<p class="program-empty">КАТАЛОГ НЕДОСТУПЕН</p>';
}

function showProgramGroup(group) {
  $('#programGroupStep').classList.add('hidden');
  $('#programChoiceStep').classList.remove('hidden');
  $('#programSubmitBtn').classList.remove('hidden');
  $('#programGroupTitle').textContent = group;
  renderProgramCatalog(group);
}

$('#downloadProgramBtn').onclick = () => {
  const form = $('#programForm');
  form.reset();
  $('#programGroupStep').classList.remove('hidden');
  $('#programChoiceStep').classList.add('hidden');
  $('#programSubmitBtn').classList.add('hidden');
  renderProgramGroups();
  $('#programDialog').showModal();
};
$('#programGroupBackBtn').onclick = () => {
  $('#programForm').reset();
  $('#programGroupStep').classList.remove('hidden');
  $('#programChoiceStep').classList.add('hidden');
  $('#programSubmitBtn').classList.add('hidden');
};
function openFunctionCheck(label) {
  const form = $('#rollForm');
  const currentNode = state.nodes.find(node => node.id === state.runner.floorId);
  if (label === 'Бэкдор' && currentNode?.type !== 'Пароль') {
    toast('Сначала переместитесь на этаж с Паролем.', true);
    return false;
  }
  if (label === 'Управление' && currentNode?.type !== 'Управляющий Узел') {
    toast('Управление можно применить только на этаже с Управляющим Узлом.', true);
    return false;
  }
  if (label === 'Опознание' && currentNode?.type !== 'Файл') {
    toast('Опознание можно применить только на этаже с Файлом.', true);
    return false;
  }
  if (['Разряд', 'Ускользнуть'].includes(label) && !state.battle?.active) {
    toast(`${label} можно применить только во время боя.`, true);
    return false;
  }
  if (label === 'Вирус') {
    const lastFloor = Math.max(...state.nodes.map(node => Number(node.floor) || 0));
    if (currentNode?.floor !== lastFloor) {
      toast('Вирус можно установить только на последнем этаже Архитектуры.', true);
      return false;
    }
  }
  if (label === 'Первопроходец') {
    const lastRevealed = state.nodes.reduce((max, n) => n.revealed ? Math.max(max, n.floor) : max, 0);
    if (currentNode?.floor !== lastRevealed) {
      toast('Первопроходца можно запускать только с последнего открытого этажа.', true);
      return false;
    }
  }
  form.elements.label.value = label;
  form.elements.bonus.value = state.runner.interface;
  form.elements.dv.value = ['Сканер', 'Плащ', 'Первопроходец', 'Ускользнуть', 'Вирус', 'Разряд'].includes(label) ? 0 : 8;
  form.elements.dv.readOnly = false;
  $('#dvLabel').textContent = 'СЛ (0 для встречной проверки)';
  const dvField = form.elements.dv.closest('label');
  dvField.style.display = role !== 'gm' || label === 'Первопроходец' ? 'none' : '';
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
  pendingCheckAction = 'spendAction';
});
$$('[data-meat-label]').forEach(button => button.onclick = () => {
  const label = button.dataset.meatLabel;
  if (!openFunctionCheck(label)) return;
  pendingCheckAction = 'meatAction';
});
$('#rollForm').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') {
    pendingCheckAction = null;
    return;
  }
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (event.submitter?.value === 'physical') {
    pendingRoll = {
      label: data.label,
      bonus: Number(data.bonus),
      dv: Number(data.dv),
      actionType: pendingCheckAction
    };
    pendingCheckAction = null;
    $('#d10Form').reset();
    $('#criticalD10Label').hidden = true;
    $('#d10Form').elements.criticalD10.required = false;
    $('#rollDialog').close();
    $('#d10Dialog').showModal();
    return;
  }
  const actionType = pendingCheckAction;
  pendingCheckAction = null;
  if (actionType && await action(actionType, { label: data.label })) {
    await action('roll', { label: data.label, bonus: Number(data.bonus), dv: Number(data.dv) });
    $('#rollDialog').close();
  }
});
$('#d10Form').elements.d10.addEventListener('input', event => {
  const value = event.currentTarget.valueAsNumber;
  const isCritical = value === 1 || value === 10;
  $('#criticalD10Label').hidden = !isCritical;
  $('#d10Form').elements.criticalD10.required = isCritical;
  if (!isCritical) $('#d10Form').elements.criticalD10.value = '';
});
$('#d10Form').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') {
    pendingRoll = null;
    return;
  }
  event.preventDefault();
  const d10 = Number(Object.fromEntries(new FormData(event.currentTarget)).d10);
  if (!Number.isInteger(d10) || d10 < 1 || d10 > 10) {
    toast('Введите результат физического броска D10 (1–10).', true);
    return;
  }
  const criticalD10 = Number(Object.fromEntries(new FormData(event.currentTarget)).criticalD10);
  if ((d10 === 1 || d10 === 10) && (!Number.isInteger(criticalD10) || criticalD10 < 1 || criticalD10 > 10)) {
    toast('Введите дополнительный результат физического броска D10 (1–10).', true);
    return;
  }
  if (pendingRoll) {
    const { actionType, ...rollPayload } = pendingRoll;
    if (actionType && await action(actionType, { label: rollPayload.label })) {
      await action('roll', { ...rollPayload, d10, criticalD10: d10 === 1 || d10 === 10 ? criticalD10 : null });
      pendingRoll = null;
      $('#d10Dialog').close();
    }
  }
});
$('#runnerForm').addEventListener('submit', event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  action('updateRunner', { ...data, interface: Number(data.interface), health: Number(data.health), maxHealth: Number(data.maxHealth), wallet: Number(data.wallet) });
});
$('#walletTopUpForm').addEventListener('submit', async event => {
  event.preventDefault();
  const amount = Number(new FormData(event.currentTarget).get('amount'));
  if (await action('addWalletFunds', { amount })) event.currentTarget.reset();
});
$('#nodeForm').addEventListener('submit', event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  action('addNode', { ...data, dv: Number(data.dv) }); event.currentTarget.reset();
});
$('#newNetworkBtn').onclick = () => {
  const form = $('#networkForm');
  form.reset();
  form.elements.id.value = '';
  $('#networkDialogTitle').textContent = 'НОВАЯ СЕТЬ';
  $('#networkDialog').showModal();
};
$('#networkForm').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const submitter = event.submitter;
  submitter.disabled = true;
  const ok = await action(data.id ? 'updateNetwork' : 'createNetwork', data);
  submitter.disabled = false;
  if (ok) $('#networkDialog').close();
});
$('#nodeEditForm').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const submitter = event.submitter;
  submitter.disabled = true;
  const ok = await action('updateNode', { ...data, dv: Number(data.dv) });
  submitter.disabled = false;
  if (ok) $('#nodeDialog').close();
});
$('#pathfinderSettingsForm').addEventListener('submit', event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  action('updatePathfinderReveal', data);
});
$('#gmScanForm').addEventListener('submit', event => {
  event.preventDefault();
  const networkIds = new FormData(event.currentTarget).getAll('networkIds');
  action('resolveScan', { networkIds });
});
$('#programForm').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const ok = await action('downloadProgram', { catalogId: data.catalogId });
  if (ok) $('#programDialog').close();
});
$$('[data-battle-action]').forEach(button => button.onclick = () => action('battleAction', {
  kind: button.dataset.battleAction,
  programId: button.dataset.programId
}));
$('#undoRunnerActionBtn').onclick = () => action('undoRunnerAction');
$('#resetBtn').onclick = () => { if (confirm('Сбросить текущую сессию? Созданные сети сохранятся.')) action('reset'); };

fetch(`/api/state?role=${role}`).then(response => response.json()).then(data => { state = data; render(); });
const stream = new EventSource(`/events?role=${role}`);
stream.addEventListener('state', event => { state = JSON.parse(event.data); $('#syncDot').classList.add('online'); $('#syncLabel').textContent = 'СИНХРОНИЗИРОВАНО'; render(); });
stream.onerror = () => { $('#syncDot').classList.remove('online'); $('#syncLabel').textContent = 'ПЕРЕПОДКЛЮЧЕНИЕ'; };
