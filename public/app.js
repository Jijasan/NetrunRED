const role = new URLSearchParams(location.search).get('role') === 'gm' ? 'gm' : 'runner';
let state;
let planarEngine = null;
let pendingRoll = null;
let pendingCheckAction = null;
let pathfinderSelectedNodeIds = new Set();

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
      const staleServer = ['createNetwork', 'updateNetwork', 'deleteNetwork', 'openNetwork', 'updateNode', 'addWalletFunds', 'deleteEdge', 'setNodePositions'].includes(type)
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
function optionalNumber(id) {
  const value = $(id)?.value?.trim();
  return value === '' || value == null ? null : Number(value);
}

function nodeIcon(type) {
  return ({ 'Файл': '▤', 'Пароль': '◇', 'Управляющий Узел': '⌁', 'Программа': '▱' })[type] || '◆';
}

function nodeClass(type) {
  return ({ 'Файл': 'file', 'Пароль': 'password', 'Управляющий Узел': 'control-node', 'Программа': 'program-node' })[type] || 'unknown';
}

function nodeLabel(node) {
  return node ? `${node.title} [${node.type}]` : '';
}

function nodeDepthFrom(rootId) {
  const depth = new Map([[rootId, 0]]);
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const nextId of nodeNeighbors(queue[i])) {
      if (!depth.has(nextId)) {
        depth.set(nextId, depth.get(queue[i]) + 1);
        queue.push(nextId);
      }
    }
  }
  return depth;
}
function isBlockingNode(node) {
  return node && !node.cleared && (node.type === 'Пароль' || (node.type === 'Программа' && node.ice));
}
function getZoom(canvas) {
  const c = canvas || $('#architecture')?.querySelector('.graph-canvas');
  return parseFloat(c?.dataset?.zoom || '1');
}

function getPanX(canvas) {
  return parseFloat(canvas?.dataset?.panX || '0');
}

function getPanY(canvas) {
  return parseFloat(canvas?.dataset?.panY || '0');
}

function updateTransform(canvas) {
  const zoom = getZoom(canvas);
  const panX = getPanX(canvas);
  const panY = getPanY(canvas);
  const zoomEl = canvas.querySelector('.planar-zoom');
  if (zoomEl) zoomEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function setZoom(zoom) {
  const canvas = $('#architecture')?.querySelector('.graph-canvas');
  if (!canvas) return;
  const rounded = Math.round(zoom * 100) / 100;
  canvas.dataset.zoom = String(Math.max(0.25, Math.min(3, rounded)));
  updateTransform(canvas);
  updateZoomDisplay();
  requestAnimationFrame(drawGraphEdges);
}

function updateZoomDisplay() {
  const level = $('#zoomLevel');
  if (level) level.textContent = `${Math.round(getZoom() * 100)}%`;
}

function nodeNeighbors(nodeId) {
  return (state.edges || []).reduce((neighbors, edge) => {
    if (edge.from === nodeId) neighbors.push(edge.to);
    if (edge.to === nodeId) neighbors.push(edge.from);
    return neighbors;
  }, []);
}

function orderedNodes() {
  return [...state.nodes].sort((a, b) => (a.floor || 0) - (b.floor || 0) || a.title.localeCompare(b.title));
}

function graphLayers() {
  if (!state.nodes.length) return [];
  const nodesById = new Map(state.nodes.map(node => [node.id, node]));
  const entryId = nodesById.has(state.entryNodeId) ? state.entryNodeId : state.nodes[0].id;
  const depths = new Map([[entryId, 0]]);
  const queue = [entryId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const neighborId of nodeNeighbors(id)) {
      if (!nodesById.has(neighborId) || depths.has(neighborId)) continue;
      depths.set(neighborId, depths.get(id) + 1);
      queue.push(neighborId);
    }
  }

  const maxDepth = Math.max(0, ...depths.values());
  const layers = Array.from({ length: maxDepth + 1 }, () => []);
  for (const node of state.nodes) {
    const depth = depths.get(node.id);
    if (depth !== undefined) layers[depth].push(node);
  }
  for (const layer of layers) layer.sort((a, b) => (a.layoutOrder ?? a.floor ?? 0) - (b.layoutOrder ?? b.floor ?? 0));
  const disconnected = state.nodes.filter(node => !depths.has(node.id));
  if (disconnected.length) layers.push(disconnected);
  return layers;
}

function graphDepthMap() {
  const depths = new Map();
  if (!state.nodes.length) return depths;
  const entryId = state.nodes.some(node => node.id === state.entryNodeId) ? state.entryNodeId : state.nodes[0].id;
  depths.set(entryId, 0);
  const queue = [entryId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const neighborId of nodeNeighbors(id)) {
      if (depths.has(neighborId)) continue;
      depths.set(neighborId, depths.get(id) + 1);
      queue.push(neighborId);
    }
  }
  return depths;
}

function orientedEdge(edge, depths = graphDepthMap()) {
  if (edge.directed === true) return { sourceId: edge.from, targetId: edge.to };
  const fromNode = state.nodes.find(node => node.id === edge.from);
  const toNode = state.nodes.find(node => node.id === edge.to);
  const fromRank = [depths.get(edge.from) ?? Infinity, fromNode?.layoutOrder ?? fromNode?.floor ?? Infinity];
  const toRank = [depths.get(edge.to) ?? Infinity, toNode?.layoutOrder ?? toNode?.floor ?? Infinity];
  const fromFirst = fromRank[0] < toRank[0] || (fromRank[0] === toRank[0] && fromRank[1] <= toRank[1]);
  return fromFirst ? { sourceId: edge.from, targetId: edge.to } : { sourceId: edge.to, targetId: edge.from };
}

function planarGraphPositions() {
  if (!planarEngine || !state.nodes.length) return null;
  if (state.nodes.every(node => Number.isFinite(Number(node.layoutX)) && Number.isFinite(Number(node.layoutY)))) {
    return new Map(state.nodes.map(node => [node.id, { x: Number(node.layoutX), y: Number(node.layoutY) }]));
  }
  const builder = new planarEngine.graph.GraphBuilder();
  const layoutNodes = [...state.nodes].sort((a, b) => (a.layoutOrder ?? a.floor ?? 0) - (b.layoutOrder ?? b.floor ?? 0));
  const vertexById = new Map(layoutNodes.map(node => [node.id, builder.addVertex(node.id)]));
  for (const edge of state.edges || []) builder.addEdge(vertexById.get(edge.from), vertexById.get(edge.to));
  const graph = builder.build();
  const planar = planarEngine.planarity.testPlanarity(graph);
  if (!planar.planar) return null;
  const mesh = planarEngine.embedding.buildHalfEdgeMesh(graph, planar.embedding);
  const drawing = planarEngine.layout.planarStraightLine(mesh);
  const raw = layoutNodes.map(node => ({ id: node.id, ...drawing.positions.get(vertexById.get(node.id)) }));
  const center = raw.reduce((sum, point) => ({ x: sum.x + point.x / raw.length, y: sum.y + point.y / raw.length }), { x: 0, y: 0 });
  const entry = raw.find(point => point.id === state.entryNodeId) || raw[0];
  const angle = -Math.PI / 2 - Math.atan2(entry.y - center.y, entry.x - center.x);
  const rotated = raw.map(point => ({ id: point.id, x: (point.x - center.x) * Math.cos(angle) - (point.y - center.y) * Math.sin(angle), y: (point.x - center.x) * Math.sin(angle) + (point.y - center.y) * Math.cos(angle) }));
  const minX = Math.min(...rotated.map(point => point.x));
  const maxX = Math.max(...rotated.map(point => point.x));
  const minY = Math.min(...rotated.map(point => point.y));
  const maxY = Math.max(...rotated.map(point => point.y));
  return new Map(rotated.map(point => {
    const node = state.nodes.find(item => item.id === point.id);
    const generated = { x: 10 + 80 * (point.x - minX) / Math.max(1, maxX - minX), y: 7 + 86 * (point.y - minY) / Math.max(1, maxY - minY) };
    return [point.id, Number.isFinite(Number(node?.layoutX)) && Number.isFinite(Number(node?.layoutY))
      ? { x: Number(node.layoutX), y: Number(node.layoutY) }
      : generated];
  }));
}

function drawGraphEdges() {
  const architecture = $('#architecture');
  const svg = architecture?.querySelector('.graph-links');
  const canvas = architecture?.querySelector('.graph-canvas');
  if (!svg || !canvas) return;
  const zoom = getZoom(canvas);
  const panX = getPanX(canvas);
  const panY = getPanY(canvas);
  const bounds = canvas.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  const depths = graphDepthMap();
  svg.innerHTML = (state.edges || []).map(edge => {
    const { sourceId, targetId } = orientedEdge(edge, depths);
    const from = canvas.querySelector(`[data-node-id="${CSS.escape(sourceId)}"]`);
    const to = canvas.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`);
    if (!from || !to) return '';
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = (a.left + a.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2;
    const y1 = (a.bottom - bounds.top - panY) / zoom;
    const x2 = (b.left + b.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2;
    const y2 = (b.top - bounds.top - panY) / zoom;
    return `<g><path data-source="${sourceId}" data-target="${targetId}" d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="transparent" stroke-width="24" /><path d="M ${x1} ${y1} L ${x2} ${y2}" style="pointer-events:none" /></g>`;
  }).join('');
}

function renderedEdgeCrossings() {
  const canvas = $('#architecture')?.querySelector('.graph-canvas');
  if (!canvas) return 0;
  const zoom = getZoom(canvas);
  const panX = getPanX(canvas);
  const panY = getPanY(canvas);
  const bounds = canvas.getBoundingClientRect();
  const boxes = new Map(state.nodes.map(node => {
    const element = canvas.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
    if (!element) return [node.id, null];
    const rect = element.getBoundingClientRect();
    const top = { x: (rect.left + rect.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2, y: (rect.top - bounds.top - panY) / zoom };
    const bottom = { x: (rect.left + rect.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2, y: (rect.bottom - bounds.top - panY) / zoom };
    return [node.id, { top, bottom }];
  }));
  const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let crossings = 0;
  const depths = graphDepthMap();
  for (let i = 0; i < state.edges.length; i += 1) {
    for (let j = i + 1; j < state.edges.length; j += 1) {
      const first = state.edges[i];
      const second = state.edges[j];
      if ([first.from, first.to].some(id => id === second.from || id === second.to)) continue;
      const firstDirection = orientedEdge(first, depths);
      const secondDirection = orientedEdge(second, depths);
      const a = boxes.get(firstDirection.sourceId)?.bottom; const b = boxes.get(firstDirection.targetId)?.top;
      const c = boxes.get(secondDirection.sourceId)?.bottom; const d = boxes.get(secondDirection.targetId)?.top;
      if (a && b && c && d && orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0) crossings += 1;
    }
  }
  return crossings;
}

function openNodeDetails(nodeId) {
  const node = state.nodes.find(item => item.id === nodeId);
  if (!node) return;
  const nodeIdValue = node.id;
  const neighbors = nodeNeighbors(nodeIdValue).map(id => state.nodes.find(item => item.id === id)).filter(Boolean);
  const entry = nodeIdValue === state.entryNodeId;
  const terminal = (state.terminalNodeIds || []).includes(nodeIdValue);
  const current = nodeIdValue === state.runner.floorId;
  const status = [entry ? 'ВХОД' : '', terminal ? 'ТЕРМИНАЛ' : '', node.revealed ? 'ОТКРЫТ' : 'СКРЫТ', node.cleared ? 'ПРЕОДОЛЕН' : 'АКТИВЕН', current ? 'НЕТРАННЕР ЗДЕСЬ' : ''].filter(Boolean);
  const stats = node.type === 'Программа' && node.ice
    ? [['ВОСПРИЯТИЕ', node.ice.perception], ['СКОРОСТЬ', node.ice.speed], ['АТАКА', node.ice.attack], ['ЗАЩИТА', node.ice.defense], ['REZ', `${node.currentRez ?? node.ice.rez} / ${node.ice.rez}`]]
    : [['СЛ', Number(node.dv || 0)]];
  $('#nodeInfoType').textContent = node.type;
  $('#nodeInfoTitle').textContent = node.title;
  $('#nodeInfoStatus').innerHTML = status.map(item => `<span>${esc(item)}</span>`).join('');
  $('#nodeInfoStats').innerHTML = stats.map(([label, value]) => `<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('');
  $('#nodeInfoDetails').textContent = node.details || 'Описание отсутствует.';
  $('#nodeInfoEffect').textContent = node.ice?.effect || '';
  $('#nodeInfoEffectWrap').classList.toggle('hidden', !node.ice?.effect);
  $('#encounterRolls').classList.toggle('hidden', role !== 'runner' || !node.ice || node.cleared || node.active === false);
  $('#nodeInfoLinks').innerHTML = neighbors.length ? neighbors.map(item => `<span>${esc(item.title)}<small>${esc(item.type)}</small></span>`).join('') : '<span>Нет связей</span>';
  const gmTools = $('#nodeInfoGmTools');
  gmTools.classList.toggle('hidden', role !== 'gm');
  if (role === 'gm') {
    const dvInput = $('#nodeInfoDv');
    dvInput.value = Number(node.dv || 0);
    dvInput.onchange = () => { action('updateNodeDv', { id: nodeIdValue, dv: Number(dvInput.value) }); };
    const entryBtn = $('#nodeInfoSetEntry');
    entryBtn.disabled = entry;
    entryBtn.onclick = () => action('setEntryNode', { id: nodeIdValue });
    const revealBtn = $('#nodeInfoToggleReveal');
    revealBtn.disabled = entry;
    revealBtn.textContent = node.revealed ? 'СКРЫТЬ' : 'ОТКРЫТЬ';
    revealBtn.onclick = () => action('toggleReveal', { id: nodeIdValue });
    const clearBtn = $('#nodeInfoToggleClear');
    clearBtn.textContent = node.cleared ? 'ВОССТАНОВИТЬ' : 'ПРЕОДОЛЕНО';
    clearBtn.onclick = () => action('toggleClear', { id: nodeIdValue });
    const editBtn = $('#nodeInfoEdit');
    editBtn.onclick = () => {
      const form = $('#nodeEditForm');
      form.elements.id.value = nodeIdValue;
      form.elements.title.value = node.title;
      form.elements.nodeType.value = node.type;
      form.elements.iceCatalogId.value = node.iceCatalogId || '';
      form.elements.dv.value = Number(node.dv || 0);
      form.elements.details.value = node.details || '';
      fillNodeLinkOptions(form.elements.edgeIds, nodeNeighbors(nodeIdValue), nodeIdValue);
      $('#nodeDialog').showModal();
    };
    const deleteBtn = $('#nodeInfoDelete');
    deleteBtn.onclick = () => { if (confirm(`Удалить узел «${node.title}»?`)) action('deleteNode', { id: nodeIdValue }); };
  }
  const moveButton = $('#nodeInfoMove');
  const movementLocked = Boolean(state.battle?.active && state.battle.nodeId === state.runner.floorId);
  const runnerNode = state.nodes.find(n => n.id === state.runner.floorId);
  const canMoveHere = node.revealed && nodeNeighbors(state.runner.floorId).includes(nodeIdValue) && (!isBlockingNode(runnerNode) || nodeDepthFrom(state.entryNodeId).get(nodeIdValue) <= nodeDepthFrom(state.entryNodeId).get(runnerNode.id));
  moveButton.classList.toggle('hidden', role !== 'runner' || current || movementLocked || !canMoveHere);
  moveButton.dataset.nodeId = nodeIdValue;
  $('#nodeInfoDialog').showModal();
}

function fillNodeLinkOptions(select, selectedIds = [], excludeId = null) {
  if (!select) return;
  const selected = new Set(selectedIds);
  select.innerHTML = orderedNodes()
    .filter(node => node.id !== excludeId)
    .map(node => `<option value="${esc(node.id)}"${selected.has(node.id) ? ' selected' : ''}>${esc(nodeLabel(node))}</option>`)
    .join('');
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
    ? `УЗЛОВ: ${state.totalFloors} · ТЕРМИНАЛОВ: ${(state.terminalNodeIds || []).length}`
    : 'КОЛИЧЕСТВО УЗЛОВ НЕИЗВЕСТНО';
  $('#pathfinderIntel').textContent = state.runner.pathfinder
    ? `ПЕРВОПРОХОДЕЦ: ${state.runner.pathfinder.result}`
    : '';
  $$('[data-action-label]').forEach(button => {
    button.textContent = russianActionLabels[button.dataset.actionLabel] || button.textContent;
  });
  $$('[data-meat-label]').forEach(button => {
    button.textContent = russianActionLabels[button.dataset.meatLabel] || button.textContent;
  });
  $('#nextTurnBtn').disabled = role === 'gm' || Boolean(state.battle?.active && state.battle.currentTurn && state.battle.currentTurn !== 'runner');
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
  if (role === 'gm') {
    const enemyPrograms = (state.programCatalog || []).filter(program => program.class === 'Чёрный ЛЁД');
    $$('.enemy-program-select').forEach(select => {
      const previous = select.value;
      select.innerHTML = '<option value="">— ВЫБЕРИТЕ ЛЁД —</option>' + enemyPrograms.map(program =>
        `<option value="${esc(program.catalogId)}">${esc(program.name)} · ВСП ${program.perception} · СКО ${program.speed} · АТК ${program.attack} · ЗАЩ ${program.defense} · REZ ${program.rez}</option>`
      ).join('');
      select.value = previous;
    });
    fillGmForm();
    fillNodeLinkOptions($('#nodeForm').elements.edgeIds, [state.entryNodeId].filter(Boolean));
    const pfResolve = $('#pathfinderResolve');
    const pfPending = state.session?.pathfinderPending;
    if (pfPending) {
      pfResolve.classList.remove('hidden');
      $('#pfResult').textContent = pfPending.result;
      const unrevealed = state.nodes.filter(node => !node.revealed);
      const validIds = new Set(unrevealed.map(node => node.id));
      pathfinderSelectedNodeIds = new Set([...pathfinderSelectedNodeIds].filter(id => validIds.has(id)));
      $('#pfNodeChoices').innerHTML = unrevealed.length
        ? `<p class="form-hint">Выберите узлы кликом на основной схеме. Выбрано: <b id="pfSelectionCount">${pathfinderSelectedNodeIds.size}</b></p>`
        : '<p class="form-hint">Нет скрытых узлов для открытия.</p>';
      $('#pfResolveBtn').disabled = pathfinderSelectedNodeIds.size === 0;
    } else {
      pfResolve.classList.add('hidden');
      pathfinderSelectedNodeIds.clear();
    }
  }
}

function renderNetworks() {
  $('#networkList').innerHTML = state.networks.length ? state.networks.map(network => {
    const active = network.id === state.activeNetworkId;
    const gmActions = role === 'gm'
      ? `<button data-edit-network="${network.id}">ИЗМЕНИТЬ</button><button class="delete-network" data-delete-network="${network.id}"${state.networks.length <= 1 ? ' disabled' : ''}>×</button>`
      : '';
    return `<article class="network-card ${active ? 'active' : ''}">
      <div class="network-card-copy"><small>${active ? 'АКТИВНАЯ СЕТЬ' : 'ДОСТУПНАЯ СЕТЬ'} · ${network.nodeCount || network.floorCount ? `${network.nodeCount || network.floorCount} УЗЛ.` : 'АРХИТЕКТУРА НЕИЗВЕСТНА'}</small><b>${esc(network.name)}</b></div>
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
    if (confirm(`Удалить сеть «${network.name}» со всеми узлами?`)) action('deleteNetwork', { id: network.id });
  });
  const scanForm = $('#gmScanForm');
  scanForm.classList.toggle('hidden', role !== 'gm' || !state.scan?.pending);
  if (role === 'gm' && state.scan?.pending) {
    const visible = new Set(state.scan.visibleNetworkIds || []);
    $('#scanNetworkChoices').innerHTML = state.networks.map(network => `<label><input type="checkbox" name="networkIds" value="${esc(network.id)}"${visible.has(network.id) ? ' checked' : ''}><span><b>${esc(network.name)}</b><small>${network.nodeCount || network.floorCount} УЗЛ. · ${esc(network.accessPoint || 'ТОЧКА ДОСТУПА НЕ УКАЗАНА')}</small></span></label>`).join('');
  }
}

function renderArchitecture() {
  const layers = graphLayers();
  const planarPositions = planarGraphPositions();
  const depthById = new Map(layers.flatMap((layer, depth) => layer.map(node => [node.id, depth])));
  const currentNode = state.nodes.find(node => node.id === state.runner.floorId);
  const movementLocked = Boolean(state.battle?.active && state.battle.nodeId === currentNode?.id);
  const movableNodeIds = new Set(nodeNeighbors(state.runner.floorId));
  const renderNode = (node, depth, index) => {
    const current = node.id === state.runner.floorId;
    const entry = node.id === state.entryNodeId;
    const terminal = (state.terminalNodeIds || []).includes(node.id);
    const canMoveHere = role === 'runner' && !movementLocked && node.revealed && movableNodeIds.has(node.id) && (!isBlockingNode(currentNode) || nodeDepthFrom(state.entryNodeId).get(node.id) <= nodeDepthFrom(state.entryNodeId).get(currentNode.id));
    const classes = ['arch-node', canMoveHere ? 'movable' : '', nodeClass(node.type), current ? 'current' : '', entry ? 'entry' : '', terminal ? 'terminal' : '', node.cleared ? 'cleared' : '', node.revealed ? '' : 'concealed'].join(' ');
    const stat = node.type === 'Программа' && node.ice
      ? `<span>СКО ${node.ice.speed}</span><span>АТК ${node.ice.attack}</span><span>ЗАЩ ${node.ice.defense}</span><span>REZ ${node.ice.rez}</span>`
      : node.dv ? `<span>СЛ ${node.dv}</span>` : '';
    const badges = `${entry ? '<b>ВХОД</b>' : ''}${terminal ? '<b>ТЕРМИНАЛ</b>' : ''}`;
    const position = planarPositions?.get(node.id);
    return `<article class="${classes}" data-node-id="${node.id}"${position ? ` style="--node-x:${position.x}%;--node-y:${position.y}%"` : ''}${role === 'gm' ? ' data-positionable="true"' : ''}${canMoveHere ? ` data-move="${node.id}"` : ''}>
      <div class="floor-no">С${String(depth).padStart(2, '0')}.${String(index + 1).padStart(2, '0')}</div>
      <div class="node-glyph">${nodeIcon(node.type)}</div>
      <div class="node-copy"><small>${esc(node.type)} ${badges}</small><h3>${esc(node.title)}</h3><div class="node-stats">${stat}</div></div>
      ${current ? `<b class="runner-marker">${movementLocked ? 'БОЙ // ДВИЖЕНИЕ ЗАБЛОКИРОВАНО' : 'НЕТРАННЕР ЗДЕСЬ'}</b>` : ''}
    </article>`;
  };
  const hasGraph = layers.length && planarPositions;
  $('#architecture').innerHTML = hasGraph
    ? `<div class="graph-canvas planar-canvas" data-zoom="1" data-pan-x="0" data-pan-y="0"><div class="planar-zoom"><svg class="graph-links" aria-hidden="true"></svg>${orderedNodes().map((node, index) => renderNode(node, depthById.get(node.id) || 0, index)).join('')}</div></div>`
    : `<p class="architecture-empty">${state.activeNetworkId ? 'ПОДКЛЮЧИТЕСЬ К СЕТИ, ЧТОБЫ ОТКРЫТЬ ВХОДНОЙ УЗЕЛ' : 'ВЫБЕРИТЕ ОБНАРУЖЕННУЮ СЕТЬ'}</p>`;

  requestAnimationFrame(drawGraphEdges);
  setTimeout(drawGraphEdges, 0);

  if (hasGraph) {
    let meta = $('.architecture-meta');
    if (meta && !$('#zoomControls')) {
      meta.insertAdjacentHTML('beforeend', `<div id="zoomControls" class="zoom-controls"><button data-zoom-out title="Отдалить">−</button><span class="zoom-level" id="zoomLevel">100%</span><button data-zoom-in title="Приблизить">+</button><button data-zoom-reset title="Сбросить масштаб">⟲</button></div>`);
    }

    const zoomControls = $('#zoomControls');
    if (zoomControls) {
      zoomControls.querySelector('[data-zoom-in]').onclick = () => setZoom(Math.min(3, getZoom() + 0.2));
      zoomControls.querySelector('[data-zoom-out]').onclick = () => setZoom(Math.max(0.25, getZoom() - 0.2));
      zoomControls.querySelector('[data-zoom-reset]').onclick = () => setZoom(1);
      updateZoomDisplay();
    }

    const canvas = $('#architecture').querySelector('.graph-canvas');
    if (canvas) {
      updateTransform(canvas);
      if (!canvas.dataset.zoomWheel) {
        canvas.dataset.zoomWheel = '1';
        canvas.addEventListener('wheel', event => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.1 : 0.1;
          setZoom(getZoom(canvas) + delta);
        }, { passive: false });
      }
      if (!canvas.dataset.panInit) {
        canvas.dataset.panInit = '1';
        canvas.addEventListener('pointerdown', panEvent => {
          if (panEvent.button !== 0) return;
          if (panEvent.target.closest('.arch-node, .node-port, button, input, label, select, a, textarea, path')) return;
          panEvent.preventDefault();
          canvas.classList.add('panning');
          const startX = panEvent.clientX;
          const startY = panEvent.clientY;
          const panStartX = getPanX(canvas);
          const panStartY = getPanY(canvas);
          const doPan = moveEvent => {
            moveEvent.preventDefault();
            canvas.dataset.panX = String(panStartX + moveEvent.clientX - startX);
            canvas.dataset.panY = String(panStartY + moveEvent.clientY - startY);
            updateTransform(canvas);
            drawGraphEdges();
          };
          const stopPan = () => {
            canvas.classList.remove('panning');
            document.removeEventListener('pointermove', doPan);
            document.removeEventListener('pointerup', stopPan);
          };
          document.addEventListener('pointermove', doPan);
          document.addEventListener('pointerup', stopPan);
        });
      }
    }
  }

  if (role === 'gm') {
    const edgeSvg = $('.graph-links');
    if (edgeSvg) {
      edgeSvg.addEventListener('click', event => {
        const path = event.target.closest('path');
        if (!path || !path.dataset.source || path.classList.contains('pending-edge')) return;
        event.stopPropagation();
        const from = path.dataset.source;
        const to = path.dataset.target;
        if (confirm('Удалить эту связь?')) {
          action('deleteEdge', { from, to });
        }
      });
    }
    $$('[data-connect-from]').forEach(handle => handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = handle.closest('.graph-canvas');
      const svg = canvas.querySelector('.graph-links');
      const bounds = canvas.getBoundingClientRect();
      const zoom = getZoom(canvas);
      const panX = getPanX(canvas);
      const panY = getPanY(canvas);
      const sourceCard = handle.closest('.arch-node');
      const sourceRect = sourceCard.getBoundingClientRect();
      const start = { x: (sourceRect.left + sourceRect.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2, y: (sourceRect.bottom - bounds.top - panY) / zoom };
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      preview.classList.add('pending-edge');
      svg.appendChild(preview);
      handle.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-connect-to]');
        $$('[data-connect-to].connection-target').forEach(item => item.classList.remove('connection-target'));
        if (target && target.dataset.connectTo !== handle.dataset.connectFrom) target.classList.add('connection-target');
        const targetCard = target?.closest('.arch-node');
        const targetRect = targetCard?.getBoundingClientRect();
        const end = targetRect && target.dataset.connectTo !== handle.dataset.connectFrom
          ? { x: (targetRect.left + targetRect.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2, y: (targetRect.top - bounds.top - panY) / zoom }
          : { x: (moveEvent.clientX - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2, y: (moveEvent.clientY - bounds.top - panY) / zoom };
        preview.setAttribute('d', `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
      };
      const finish = async finishEvent => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', cancel);
        const target = document.elementFromPoint(finishEvent.clientX, finishEvent.clientY)?.closest('[data-connect-to]');
        preview.remove();
        $$('[data-connect-to].connection-target').forEach(item => item.classList.remove('connection-target'));
        if (!target || target.dataset.connectTo === handle.dataset.connectFrom) return;
        const targetId = target.dataset.connectTo;
        const targetRect = target.closest('.arch-node').getBoundingClientRect();
        const end = { x: (targetRect.left + targetRect.width / 2 - bounds.left - panX - bounds.width / 2) / zoom + bounds.width / 2, y: (targetRect.top - bounds.top - panY) / zoom };
        const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const crosses = [...svg.querySelectorAll('path[data-source]:not(.pending-edge)')].some(path => {
          if ([path.dataset.source, path.dataset.target].some(id => id === handle.dataset.connectFrom || id === targetId)) return false;
          const numbers = (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
          const a = { x: numbers[0], y: numbers[1] }; const b = { x: numbers[2], y: numbers[3] };
          return orientation(start, end, a) * orientation(start, end, b) < 0 && orientation(a, b, start) * orientation(a, b, end) < 0;
        });
        if (crosses) {
          toast('Связь отклонена: рёбра не могут пересекаться.', true);
          return;
        }
        await action('connectNodes', { from: handle.dataset.connectFrom, to: targetId });
      };
      const cancel = () => {
        preview.remove();
        $$('[data-connect-to].connection-target').forEach(item => item.classList.remove('connection-target'));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', cancel);
    }));
  }

  if (role === 'gm') {
    $$('.arch-node[data-positionable="true"]').forEach(card => {
      card.addEventListener('pointerdown', event => {
        if (event.target.closest('button,input,label')) return;
        event.preventDefault();
        const canvas = card.closest('.graph-canvas');
        const startX = card.style.getPropertyValue('--node-x');
        const startY = card.style.getPropertyValue('--node-y');
        const pointerStart = { x: event.clientX, y: event.clientY };
        card.setPointerCapture(event.pointerId);
        card.classList.add('positioning');
        const move = moveEvent => {
          if (Math.hypot(moveEvent.clientX - pointerStart.x, moveEvent.clientY - pointerStart.y) > 4) card.dataset.dragged = 'true';
          const bounds = canvas.getBoundingClientRect();
          const zoom = getZoom(canvas);
          const panX = getPanX(canvas);
          const panY = getPanY(canvas);
          const cx = bounds.width / 2;
          const x = Math.max(10, Math.min(90, 100 * ((moveEvent.clientX - bounds.left - panX - cx) / (zoom * bounds.width) + 0.5)));
          const y = Math.max(7, Math.min(93, 100 * ((moveEvent.clientY - bounds.top - panY) / (zoom * bounds.height))));
          card.style.setProperty('--node-x', `${x}%`);
          card.style.setProperty('--node-y', `${y}%`);
          drawGraphEdges();
          card.classList.toggle('invalid-position', renderedEdgeCrossings() > 0);
        };
        const finish = async () => {
          card.removeEventListener('pointermove', move);
          card.removeEventListener('pointerup', finish);
          card.removeEventListener('pointercancel', cancel);
          card.classList.remove('positioning');
          if (renderedEdgeCrossings() > 0) {
            card.style.setProperty('--node-x', startX);
            card.style.setProperty('--node-y', startY);
            card.classList.remove('invalid-position');
            drawGraphEdges();
            toast('Позиция отклонена: рёбра не могут пересекаться.', true);
            return;
          }
          const positions = $$('.arch-node[data-node-id]').map(node => ({
            id: node.dataset.nodeId,
            x: parseFloat(node.style.getPropertyValue('--node-x')),
            y: parseFloat(node.style.getPropertyValue('--node-y'))
          }));
          await action('setNodePositions', { positions });
        };
        const cancel = () => {
          card.style.setProperty('--node-x', startX);
          card.style.setProperty('--node-y', startY);
          card.classList.remove('positioning', 'invalid-position');
          drawGraphEdges();
        };
        card.addEventListener('pointermove', move);
        card.addEventListener('pointerup', finish);
        card.addEventListener('pointercancel', cancel);
      });
    });
  }

  if (role === 'gm') {
    let draggedId = null;
    let suppressClick = false;
    $$('.arch-node[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', event => {
        if (event.target.closest('button,input,label')) {
          event.preventDefault();
          return;
        }
        draggedId = card.dataset.nodeId;
        suppressClick = true;
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedId);
      });
      card.addEventListener('dragend', () => {
        draggedId = null;
        $$('.arch-node').forEach(node => node.classList.remove('dragging', 'drop-target'));
        setTimeout(() => { suppressClick = false; }, 0);
      });
      card.addEventListener('click', event => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      card.addEventListener('dragover', event => {
        const source = draggedId && $(`[data-node-id="${CSS.escape(draggedId)}"]`);
        if (!source || source === card || source.parentElement !== card.parentElement) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        $$('.arch-node.drop-target').forEach(node => node.classList.remove('drop-target'));
        card.classList.add('drop-target');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
      card.addEventListener('drop', event => {
        event.preventDefault();
        const sourceId = draggedId || event.dataTransfer.getData('text/plain');
        const layerIds = [...card.parentElement.querySelectorAll('.arch-node')].map(node => node.dataset.nodeId);
        const from = layerIds.indexOf(sourceId);
        const to = layerIds.indexOf(card.dataset.nodeId);
        if (from < 0 || to < 0 || from === to) return;
        layerIds.splice(to, 0, layerIds.splice(from, 1)[0]);
        const layerSet = new Set(layerIds);
        const nodeIds = card.parentElement.classList.contains('planar-canvas')
          ? layerIds
          : graphLayers().flatMap(layer => {
            const ids = layer.map(node => node.id);
            return ids.some(id => layerSet.has(id)) ? layerIds : ids;
          });
        action('setNodeOrder', { nodeIds });
      });
    });
  }

  $$('.arch-node[data-node-id]').forEach(node => node.addEventListener('click', event => {
    if (event.target.closest('button,input,label')) return;
    if (node.dataset.dragged === 'true') {
      delete node.dataset.dragged;
      return;
    }
    if (node.dataset.pathfinderNode) {
      const nodeId = node.dataset.pathfinderNode;
      if (pathfinderSelectedNodeIds.has(nodeId)) pathfinderSelectedNodeIds.delete(nodeId);
      else pathfinderSelectedNodeIds.add(nodeId);
      node.classList.toggle('pathfinder-selected', pathfinderSelectedNodeIds.has(nodeId));
      const count = $('#pfSelectionCount');
      if (count) count.textContent = pathfinderSelectedNodeIds.size;
      $('#pfResolveBtn').disabled = pathfinderSelectedNodeIds.size === 0;
      return;
    }
    openNodeDetails(node.dataset.nodeId);
  }));
  $$('[data-reveal]').forEach(button => button.onclick = () => action('toggleReveal', { id: button.dataset.reveal }));
  $$('[data-clear]').forEach(button => button.onclick = () => action('toggleClear', { id: button.dataset.clear }));
  $$('[data-delete]').forEach(button => button.onclick = () => action('deleteNode', { id: button.dataset.delete }));
  $$('[data-entry]').forEach(button => button.onclick = () => action('setEntryNode', { id: button.dataset.entry }));
  $$('[data-edit-node]').forEach(button => button.onclick = () => {
    const node = state.nodes.find(item => item.id === button.dataset.editNode);
    const form = $('#nodeEditForm');
    form.elements.id.value = node.id;
    form.elements.title.value = node.title;
    form.elements.nodeType.value = node.type;
    form.elements.dv.value = Number(node.dv || 0);
    form.elements.details.value = node.details || '';
    fillNodeLinkOptions(form.elements.edgeIds, nodeNeighbors(node.id), node.id);
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
  const friendlyIce = state.programs.filter(program => program.class === 'Чёрный ЛЁД' && program.active && !program.destroyed && program.targetNodeId === battle.nodeId);
  const baseQueue = battle.runnerInitiative >= battle.iceInitiative
    ? [{ id: 'runner', name: state.runner.name, detail: `НЕТРАННЕР · ${battle.runnerInitiative}` }, { id: 'ice', name: node.title, detail: `ВРАЖЕСКИЙ ЛЁД · ${battle.iceInitiative}` }]
    : [{ id: 'ice', name: node.title, detail: `ВРАЖЕСКИЙ ЛЁД · ${battle.iceInitiative}` }, { id: 'runner', name: state.runner.name, detail: `НЕТРАННЕР · ${battle.runnerInitiative}` }];
  const queue = [...friendlyIce.map(program => ({ id: `runnerIce:${program.id}`, name: program.name, detail: 'ВАШ ЛЁД · ВЕРШИНА ОЧЕРЕДИ' })), ...baseQueue];
  const currentTurn = queue.some(item => item.id === battle.currentTurn) ? battle.currentTurn : queue[0]?.id;
  const activeActor = queue.find(item => item.id === currentTurn);
  const activeIndex = Math.max(0, queue.findIndex(item => item.id === currentTurn));
  const visibleQueue = [...queue.slice(activeIndex), ...queue.slice(0, activeIndex)];
  $('#activeTurnLabel').textContent = `ХОД: ${activeActor?.name || '—'}`;
  $('#initiativeQueue').innerHTML = visibleQueue.map((item, index) => `<div class="initiative-entry ${item.id === currentTurn ? 'active' : ''}"><span>${index === 0 ? '▶' : `+${index}`}</span><div><b>${esc(item.name)}</b><small>${esc(item.detail)}</small></div>${item.id === currentTurn ? '<em>СЕЙЧАС</em>' : ''}</div>`).join('');
  $('#iceRezText').textContent = `${node.currentRez} / ${node.ice.rez}`;
  $('#iceRezMeter').style.width = `${100 * node.currentRez / node.ice.rez}%`;
  $('#battleEffect').textContent = node.ice.effect;
  const attackProgram = state.programs.find(program => program.class === 'Атакующая' && program.target !== 'Нетраннеры' && program.active && !program.destroyed);
  const pendingRoll = battle.pendingRoll;
  $$('[data-battle-action]').forEach(button => {
    const kind = button.dataset.battleAction;
    if (kind === 'iceAttack') button.disabled = Boolean(pendingRoll) || role !== 'gm' || currentTurn !== 'ice';
    else if (kind === 'program') {
      button.dataset.programId = attackProgram?.id || '';
      button.textContent = attackProgram ? `${attackProgram.name.toUpperCase()} · ${attackProgram.catalogId === 'sword' ? '3d6' : '2d6'}` : 'НЕТ АКТИВНОЙ АТАКУЮЩЕЙ ПРОГРАММЫ';
      button.disabled = Boolean(pendingRoll) || role !== 'runner' || currentTurn !== 'runner' || !attackProgram;
    }
    else if (kind === 'extinguish') button.disabled = Boolean(pendingRoll) || role !== 'runner' || currentTurn !== 'runner' || !state.runner.burning;
    else button.disabled = Boolean(pendingRoll) || role !== 'runner' || currentTurn !== 'runner';
  });
  $$('[data-battle-irl]').forEach(button => {
    const kind = button.dataset.battleIrl;
    if (kind === 'program') {
      button.dataset.programId = attackProgram?.id || '';
      button.disabled = Boolean(pendingRoll) || role !== 'runner' || currentTurn !== 'runner' || !attackProgram;
    } else if (kind === 'iceAttack') button.disabled = Boolean(pendingRoll) || role !== 'gm' || currentTurn !== 'ice';
    else button.disabled = Boolean(pendingRoll) || role !== 'runner' || currentTurn !== 'runner';
  });
  const irlBox = $('#battleIrlRequest');
  irlBox.classList.toggle('hidden', !pendingRoll);
  if (pendingRoll) {
    const submitted = Boolean(pendingRoll.submissions?.[role]);
    const attacker = pendingRoll.attackerRole === role;
    const needsDamage = attacker && ['zap', 'program', 'runnerIce', 'iceAttack'].includes(pendingRoll.kind);
    irlBox.innerHTML = submitted
      ? `<b>БРОСОК ПРИНЯТ</b><p>Ожидание ${role === 'runner' ? 'Мастера' : 'Нетраннера'}.</p>`
      : `<b>${attacker ? 'ВАШ БРОСОК АТАКИ' : 'ВАШ БРОСОК ЗАЩИТЫ'}</b>
        <label>d10<input id="pendingBattleD10" type="number" min="1" max="10" required></label>
        <label>КРИТ. d10<input id="pendingBattleCriticalD10" type="number" min="1" max="10"></label>
        ${needsDamage ? '<label class="damage-rolls">УРОН d6 (через запятую)<input id="pendingBattleDamage" placeholder="6, 3, 4"></label>' : ''}
        <button id="submitBattleIrlRoll" type="button">ОТПРАВИТЬ БРОСОК</button>`;
    if (!submitted) $('#submitBattleIrlRoll').onclick = () => {
      const damage = $('#pendingBattleDamage')?.value.trim();
      action('submitBattleIrlRoll', {
        d10: optionalNumber('#pendingBattleD10'), criticalD10: optionalNumber('#pendingBattleCriticalD10'),
        damageRolls: damage ? damage.split(/[ ,;]+/).filter(Boolean).map(Number) : null
      });
    };
  }
  const loadedIce = state.programs.filter(program => program.class === 'Чёрный ЛЁД' && program.target === 'Программы' && !program.destroyed);
  $('#runnerIceBattleActions').innerHTML = loadedIce.length ? `<h3>ВАШ ЧЁРНЫЙ ЛЁД // ПРОТИВ ПРОГРАММ</h3>${loadedIce.map(program => {
    const attacked = program.active && program.lastAttackRound === battle.round;
    const assignedElsewhere = program.active && program.targetNodeId !== node.id;
    const label = program.active ? `АТАКА: ${program.name}${attacked ? ' · УЖЕ АТАКОВАЛ' : ''}` : `АКТИВИРОВАТЬ И АТАКОВАТЬ: ${program.name} · 1 ДЕЙСТВИЕ`;
    const iceTurn = currentTurn === `runnerIce:${program.id}`;
    const canActivate = !program.active && currentTurn === 'runner' && state.runner.netActionsRemaining > 0;
    const disabled = Boolean(pendingRoll) || role !== 'runner' || attacked || assignedElsewhere || (program.active ? !iceTurn : !canActivate);
    return `<button data-runner-ice="${program.id}"${disabled ? ' disabled' : ''}>${esc(label)}<small>${assignedElsewhere ? 'НАЗНАЧЕН НА ДРУГУЮ ЦЕЛЬ' : `АТК ${program.attack} · ЗАЩ ${program.defense} · REZ ${program.currentRez}/${program.rez}`}</small></button><button data-runner-ice-irl="${program.id}"${disabled ? ' disabled' : ''}>${esc(program.name)} · IRL</button>`;
  }).join('')}` : '<p>Загрузите Чёрный ЛЁД против Программ, чтобы активировать его в бою.</p>';
  $$('[data-runner-ice]').forEach(button => button.onclick = () => action('battleAction', { kind: 'runnerIce', programId: button.dataset.runnerIce }));
  $$('[data-runner-ice-irl]').forEach(button => button.onclick = () => action('requestBattleIrlRoll', { kind: 'runnerIce', programId: button.dataset.runnerIceIrl }));
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
  ['name', 'interface', 'health', 'maxHealth', 'deckSlots', 'wallet'].forEach(name => form.elements[name].value = state.runner[name]);
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
    toast('Сначала переместитесь в узел с Паролем.', true);
    return false;
  }
  if (label === 'Управление' && currentNode?.type !== 'Управляющий Узел') {
    toast('Управление можно применить только в узле с Управляющим Узлом.', true);
    return false;
  }
  if (label === 'Опознание' && currentNode?.type !== 'Файл') {
    toast('Опознание можно применить только в узле с Файлом.', true);
    return false;
  }
  if (['Разряд', 'Ускользнуть'].includes(label) && !state.battle?.active) {
    toast(`${label} можно применить только во время боя.`, true);
    return false;
  }
  if (label === 'Вирус') {
    if (!(state.terminalNodeIds || []).includes(currentNode?.id)) {
      toast('Вирус можно установить только в терминальном узле Архитектуры.', true);
      return false;
    }
  }
  if (label === 'Первопроходец') {
    if (!currentNode?.revealed) {
      toast('Первопроходца можно запускать только из открытого узла.', true);
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
  action('updateRunner', { ...data, interface: Number(data.interface), health: Number(data.health), maxHealth: Number(data.maxHealth), deckSlots: Number(data.deckSlots), wallet: Number(data.wallet) });
});
$('#walletTopUpForm').addEventListener('submit', async event => {
  event.preventDefault();
  const amount = Number(new FormData(event.currentTarget).get('amount'));
  if (await action('addWalletFunds', { amount })) event.currentTarget.reset();
});
$('#nodeForm').addEventListener('submit', event => {
  event.preventDefault(); const formData = new FormData(event.currentTarget); const data = Object.fromEntries(formData);
  action('addNode', { ...data, edgeIds: formData.getAll('edgeIds'), dv: Number(data.dv) }); event.currentTarget.reset();
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
  const formData = new FormData(event.currentTarget);
  const data = Object.fromEntries(formData);
  const submitter = event.submitter;
  submitter.disabled = true;
  const ok = await action('updateNode', { ...data, edgeIds: formData.getAll('edgeIds'), dv: Number(data.dv) });
  submitter.disabled = false;
  if (ok) $('#nodeDialog').close();
});
$('#gmScanForm').addEventListener('submit', event => {
  event.preventDefault();
  const networkIds = new FormData(event.currentTarget).getAll('networkIds');
  action('resolveScan', { networkIds });
});
$('#pfResolveBtn').onclick = () => {
  action('resolvePathfinder', { nodeIds: [...pathfinderSelectedNodeIds] });
};
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
$$('[data-battle-irl]').forEach(button => button.onclick = () => action('requestBattleIrlRoll', {
  kind: button.dataset.battleIrl,
  programId: button.dataset.programId
}));
$('#undoRunnerActionBtn').onclick = () => action('undoRunnerAction');
$('#nodeInfoMove').onclick = async event => {
  const encounterDamage = $('#encounterDamageRolls')?.value.trim();
  if (await action('move', {
    id: event.currentTarget.dataset.nodeId,
    runnerD10: optionalNumber('#encounterRunnerD10'), runnerCriticalD10: optionalNumber('#encounterRunnerCriticalD10'),
    iceD10: optionalNumber('#encounterIceD10'), iceCriticalD10: optionalNumber('#encounterIceCriticalD10'),
    damageRolls: encounterDamage ? encounterDamage.split(/[ ,;]+/).filter(Boolean).map(Number) : null
  })) $('#nodeInfoDialog').close();
};
$('#resetBtn').onclick = () => { if (confirm('Сбросить текущую сессию? Созданные сети сохранятся.')) action('reset'); };

window.addEventListener('resize', () => requestAnimationFrame(drawGraphEdges));
import('/vendor/topoloom/index.js').then(module => { planarEngine = module; if (state) render(); });
fetch(`/api/state?role=${role}`).then(response => response.json()).then(data => { state = data; render(); });
const stream = new EventSource(`/events?role=${role}`);
stream.addEventListener('state', event => { state = JSON.parse(event.data); $('#syncDot').classList.add('online'); $('#syncLabel').textContent = 'СИНХРОНИЗИРОВАНО'; render(); });
stream.onerror = () => { $('#syncDot').classList.remove('online'); $('#syncLabel').textContent = 'ПЕРЕПОДКЛЮЧЕНИЕ'; };
