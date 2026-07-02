const { state, streams, runnerUndoStack, cloneState, cloneValue, revertChangedValues } = require('./shared'), { ALLOWED_NODE_TYPES, programCatalog } = require('./constants'), { assertTerminalNodes, assertPlanarGraph, canReachNode, graphNeighbors, entryNodeCandidates, recalculateEntryNode, findNode, resetActiveNetworkDiscovery, setNodeEdges, placeNewNode, assertCrossingFreePositions, edgeKey, starterNodes, makeEdge } = require('./graph'), { syncActiveNetwork, log, netActionsFor, requireRole, requireRunner, requireFunctionContext, normalizeNetworks, normalizeNetworkGraph, newState, saveAndBroadcast, usedDeckSlots } = require('./state-core'), { rollD10, rollDice, formatD10, applyIceEffect, startIceEncounter, ensureBattleTurn, advanceBattleTurn, battleInitiativeOrder, damageIce, handleBattleAction } = require('./dice');

function nodeDepthFrom(rootId) {
  const depth = new Map([[rootId, 0]]);
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const nextId of graphNeighbors(id)) {
      if (!depth.has(nextId)) {
        depth.set(nextId, depth.get(id) + 1);
        queue.push(nextId);
      }
    }
  }
  return depth;
}
function configureEnemyProgram(node, catalogId) {
  if (node.type !== 'Программа') {
    delete node.ice;
    delete node.currentRez;
    delete node.active;
    return;
  }
  const template = programCatalog.find(program => program.catalogId === catalogId && program.class === 'Чёрный ЛЁД');
  if (!template) throw new Error('Для узла «Программа» выберите Чёрный ЛЁД из каталога.');
  node.iceCatalogId = template.catalogId;
  node.ice = { ...template, name: template.name };
  node.currentRez = Number(template.rez || 0);
  node.active = true;
  node.cleared = false;
  node.title = node.title || template.name;
  node.details = node.details || template.effect;
  node.dv = 0;
}
function runnerActionLabel(type, payload) {
  if (payload?.label) return String(payload.label);
  if (type === 'nextTurn') return 'завершение Хода';
  if (type === 'move') return `перемещение к узлу «${state.nodes.find(node => node.id === payload.id)?.title || '?'}»`;
  if (type === 'toggleProgram') return `Программа «${state.programs.find(program => program.id === payload.id)?.name || '?'}»`;
  if (type === 'downloadProgram') return `загрузка Программы «${programCatalog.find(program => program.catalogId === payload.catalogId)?.name || '?'}»`;
  return 'действие';
}

function recordRunnerAction(type, payload, snapshot) {
  const previous = runnerUndoStack[runnerUndoStack.length - 1];
  const groupedRoll = type === 'roll'
    && ['spendAction', 'meatAction'].includes(previous?.type)
    && previous.label === String(payload?.label || '')
    && previous.afterRevision === state.revision;
  if (groupedRoll) {
    previous.type = 'roll';
    previous.after = cloneState();
    previous.afterRevision = state.revision + 1;
    return;
  }
  runnerUndoStack.push({
    before: snapshot,
    after: cloneState(),
    type,
    label: runnerActionLabel(type, payload),
    afterRevision: state.revision + 1
  });
  if (runnerUndoStack.length > 20) runnerUndoStack.shift();
}
function applyAction(role, type, payload = {}) {
  const actor = role === 'gm' ? 'Мастер' : state.runner.name;
  const undoableRunnerActions = ['nextTurn', 'spendAction', 'meatAction', 'roll', 'move', 'toggleProgram', 'downloadProgram', 'deleteProgram', 'battleAction'];
  const runnerSnapshot = role === 'runner' && undoableRunnerActions.includes(type) ? cloneState() : null;
  switch (type) {
    case 'connect':
      if (role === 'runner' && payload.connected && entryNodeCandidates().length !== 1) {
        throw new Error('Network must have exactly one node without incoming edges before Netrunner can connect.');
      }
      if (role === 'runner' && payload.connected && !state.scan.visibleNetworkIds.includes(state.activeNetworkId)) {
        throw new Error('Сначала обнаружьте Сеть сканированием и выберите её.');
      }
      if (role === 'runner' && payload.connected && !state.session.connected) {
        resetActiveNetworkDiscovery();
      }
      if (role === 'runner' && payload.connected && !state.scan.enteredNetworkIds.includes(state.activeNetworkId)) {
        state.scan.enteredNetworkIds.push(state.activeNetworkId);
      }
      state.session.connected = Boolean(payload.connected);
      log(payload.connected ? `${actor} подключился к Архитектуре.` : `${actor} безопасно отключился.`, payload.connected ? 'success' : 'system');
      break;
    case 'nextTurn':
      requireRunner(role);
      if (state.battle?.active) {
        ensureBattleTurn();
        if (state.battle.currentTurn !== 'runner') throw new Error('Сейчас Ход другого участника Очереди Инициативы.');
      }
      state.session.turn += 1;
      const actionPenalty = Math.max(0, Number(state.runner.nextTurnActionPenalty || 0));
      state.runner.netActionsRemaining = Math.max(2, netActionsFor(state.runner.interface) - actionPenalty);
      state.runner.nextTurnActionPenalty = 0;
      if (state.runner.netMovementLockedTurns > 0) state.runner.netMovementLockedTurns -= 1;
      if (state.battle?.active) state.battle.slideUsed = false;
      if (state.runner.burning) {
        state.runner.health = Math.max(0, state.runner.health - 2);
        log(`Горение наносит 2 урона. Здоровье: ${state.runner.health}/${state.runner.maxHealth}.`, 'damage');
        if (state.runner.health === 0) {
          state.session.connected = false;
          if (state.battle) state.battle.active = false;
          log('Здоровье Нетраннера упало до 0. Соединение разорвано.', 'damage');
        }
      }
      log(`Ход ${state.session.turn}. Сетевые Действия восстановлены: ${state.runner.netActionsRemaining}.`, 'turn');
      if (state.battle?.active) advanceBattleTurn();
      break;
    case 'spendAction':
      requireRunner(role);
      if (!state.session.connected) throw new Error('Подключитесь к Архитектуре перед использованием Сетевых Действий.');
      if (state.runner.netActionsRemaining < 1) throw new Error('В этом Ходу не осталось Сетевых Действий.');
      requireFunctionContext(payload.label);
      state.runner.netActionsRemaining -= 1;
      log(`${actor}: ${String(payload.label || 'Сетевое Действие')} (осталось ${state.runner.netActionsRemaining}).`, 'action');
      break;
    case 'meatAction':
      requireRunner(role);
      log(`${actor}: ${String(payload.label || 'Мясное Действие')} (Мясное Действие; Сетевые Действия не расходуются).`, 'action');
      break;
    case 'requestScan':
      requireRunner(role);
      if (state.session.connected) throw new Error('Сканировать доступные сети можно только вне Архитектуры. Сначала отключитесь.');
      if (state.scan.pending) throw new Error('Запрос сканирования уже отправлен Мастеру.');
      state.scan.pending = true;
      log(`${actor} запросил сканирование доступных Сетей. Ожидается ответ Мастера.`, 'action');
      break;
    case 'resolveScan': {
      requireRole(role, 'gm');
      if (!state.scan.pending) throw new Error('Нет активного запроса сканирования.');
      const requestedIds = Array.isArray(payload.networkIds) ? payload.networkIds : [];
      state.scan.visibleNetworkIds = [...new Set(requestedIds)].filter(id => state.networks.some(network => network.id === id));
      state.scan.pending = false;
      if (!state.scan.visibleNetworkIds.includes(state.activeNetworkId)) {
        state.session.connected = false;
        state.battle = null;
      }
      log(`Мастер завершил сканирование: обнаружено Сетей — ${state.scan.visibleNetworkIds.length}.`, 'system');
      break;
    }
    case 'resolvePathfinder': {
      requireRole(role, 'gm');
      if (!state.session.pathfinderPending) throw new Error('Нет активного запроса Первопроходца.');
      const nodeIds = Array.isArray(payload.nodeIds) ? payload.nodeIds : [];
      const revealed = [];
      for (const id of nodeIds) {
        try {
          const node = findNode(id);
          if (!node.revealed) {
            node.revealed = true;
            revealed.push(node.title);
          }
        } catch {}
      }
      state.session.pathfinderPending = null;
      log(`Мастер открыл узлы по запросу Первопроходца: ${revealed.join(', ') || 'ни одного'}.`, 'system');
      break;
    }
    case 'roll': {
      requireRunner(role);
      requireFunctionContext(payload.label);
      const physical = payload.d10 != null;
      const d10 = rollD10(payload.d10, payload.criticalD10);
      const d10Tag = formatD10(d10, physical);
      const bonus = Number(payload.bonus || 0);
      const total = d10.total + bonus;
      const currentForRoll = findNode(state.runner.floorId);
      let dv = Number(currentForRoll?.dv || 0);
      let backdoorTarget = null;
      if (payload.label === 'Бэкдор') {
        if (currentForRoll.type !== 'Пароль') throw new Error('«Бэкдор» можно применить только в узле с Паролем.');
        backdoorTarget = currentForRoll;
      }
      log(`${actor}, ${payload.label || 'проверка'}: ${d10Tag} + ${bonus} = ${total}${dv ? ` против СЛ ${dv} — ${total > dv ? 'УСПЕХ' : 'ПРОВАЛ'}` : ''}.`, total > dv && dv ? 'success' : 'roll');
      if (backdoorTarget && total > dv) {
        backdoorTarget.cleared = true;
        log(`Бэкдор: Пароль «${backdoorTarget.title}» преодолён.`, 'success');
      }
      if (payload.label === 'Первопроходец') {
        const curNode = findNode(state.runner.floorId);
        if (!curNode?.revealed) throw new Error('Первопроходца можно запускать только из открытого узла.');
        state.runner.architectureKnown = true;
        state.runner.pathfinder = { result: total };
        state.session.pathfinderPending = { result: total };
        log(`Первопроходец ${total}: запрос отправлен Мастеру на открытие узлов.`, 'success');
      }
      break;
    }
    case 'move': {
      if (role === 'gm') throw new Error('Перемещать Нетраннера между узлами может только сам Нетраннер.');
      const target = findNode(payload.id);
      const current = findNode(state.runner.floorId);
      if (current.type === 'Пароль' && !current.cleared) {
        const entryNode = findNode(state.entryNodeId);
        if (!entryNode) throw new Error('Входной узел не найден.');
        const depth = nodeDepthFrom(state.entryNodeId);
        const currentDepth = depth.get(current.id);
        const targetDepth = depth.get(target.id);
        if (currentDepth != null && targetDepth != null && targetDepth > currentDepth) {
          throw new Error('Взломайте пароль, чтобы продвинуться дальше в сети.');
        }
      }
      if (target.id !== current.id && !graphNeighbors(current.id).includes(target.id)) {
        throw new Error('Netrunner movement requires a direct edge to the target node.');
      }
      if (state.battle?.active && state.battle.nodeId === current.id && target.id !== current.id) {
        throw new Error(`Нельзя покинуть узел во время боя с «${current.title}». Сначала завершите бой.`);
      }
      if (!target.revealed) throw new Error('Этот узел ещё не обнаружен.');
      if (!canReachNode(current.id, target.id)) throw new Error('Нет открытого маршрута к этому узлу: путь блокирует непредолённый Пароль или Чёрный ЛЁД.');
      state.runner.floorId = target.id;
      log(`${actor} переместился в узел «${target.title}».`, 'move');
      if (target.type === 'Программа' && target.ice && target.active !== false && !target.cleared) startIceEncounter(target);
      break;
    }
    case 'toggleProgram': {
      requireRunner(role);
      const program = state.programs.find(item => item.id === payload.id);
      if (!program) throw new Error('Программа не найдена.');
      if (program.destroyed) throw new Error('Уничтоженную Программу нельзя активировать.');
      if (program.class === 'Чёрный ЛЁД') throw new Error('Собственный Чёрный ЛЁД активируется на цель в боевом слое.');
      if (state.runner.netActionsRemaining < 1) throw new Error('Активация или деактивация Программы требует Сетевого Действия.');
      state.runner.netActionsRemaining -= 1;
      program.active = !program.active;
      if (program.active && program.rez > 0) program.currentRez = program.rez;
      log(`${actor} ${program.active ? 'активировал' : 'деактивировал'} Программу «${program.name}».`, 'action');
      break;
    }
    case 'downloadProgram': {
      requireRunner(role);
      if (!state.session.connected) throw new Error('Загружать Программы можно только при подключении к Архитектуре.');
      if (state.runner.netActionsRemaining < 1) throw new Error('В этом Ходу не осталось Сетевых Действий.');
      const template = programCatalog.find(program => program.catalogId === payload.catalogId);
      if (!template) throw new Error('Выберите Программу из каталога.');
      const cost = Math.max(0, Math.floor(Number(template.cost || 0)));
      if (state.runner.wallet < cost) throw new Error(`Недостаточно средств: требуется ${cost} eb, в кошельке ${state.runner.wallet} eb.`);
      const slots = Number(template.slots || (template.class === 'Чёрный ЛЁД' ? 2 : 1));
      if (usedDeckSlots() + slots > state.runner.deckSlots) throw new Error(`Недостаточно слотов Кибердеки: требуется ${slots}, свободно ${state.runner.deckSlots - usedDeckSlots()}.`);
      const program = {
        ...template,
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        currentRez: template.rez,
        destroyed: false,
        active: false,
        lastAttackRound: 0,
        targetNodeId: null
      };
      state.runner.netActionsRemaining -= 1;
      state.runner.wallet -= cost;
      state.programs.push(program);
      log(`${actor} купил и загрузил Программу «${program.name}» за ${cost} eb (кошелёк: ${state.runner.wallet} eb; Сетевых Действий: ${state.runner.netActionsRemaining}).`, 'action');
      break;
    }
    case 'deleteProgram': {
      requireRunner(role);
      if (!state.session.connected) throw new Error('Удалять Программы можно только при подключении к Архитектуре.');
      if (state.runner.netActionsRemaining < 1) throw new Error('В этом Ходу не осталось Сетевых Действий.');
      const index = state.programs.findIndex(program => program.id === payload.id);
      if (index < 0) throw new Error('Программа не найдена.');
      if (state.programs[index].active) throw new Error('Сначала деактивируйте Программу.');
      const [program] = state.programs.splice(index, 1);
      state.runner.netActionsRemaining -= 1;
      log(`${actor} удалил Программу «${program.name}» (осталось Сетевых Действий: ${state.runner.netActionsRemaining}).`, 'action');
      break;
    }
    case 'battleAction': {
      handleBattleAction(role, payload);
      break;
    }
    case 'damage':
      state.runner.health = Math.max(0, Math.min(state.runner.maxHealth, state.runner.health + Number(payload.amount || 0)));
      log(`${actor}: Здоровье ${Number(payload.amount || 0) >= 0 ? '+' : ''}${Number(payload.amount || 0)} → ${state.runner.health}.`, 'damage');
      break;
    case 'updateRunner':
      requireRole(role, 'gm');
      Object.assign(state.runner, payload);
      state.runner.interface = Math.max(1, Math.min(10, Number(state.runner.interface)));
      state.runner.maxHealth = Math.max(1, Number(state.runner.maxHealth));
      state.runner.health = Math.max(0, Math.min(state.runner.maxHealth, Number(state.runner.health)));
      state.runner.wallet = Math.max(0, Math.floor(Number(state.runner.wallet) || 0));
      state.runner.netActionsRemaining = Math.min(state.runner.netActionsRemaining, netActionsFor(state.runner.interface));
      log('Мастер обновил параметры Нетраннера.');
      break;
    case 'addWalletFunds': {
      requireRole(role, 'gm');
      const amount = Math.floor(Number(payload.amount));
      if (!Number.isFinite(amount) || amount < 1) throw new Error('Сумма пополнения должна быть положительным целым числом.');
      state.runner.wallet = Math.max(0, Math.floor(Number(state.runner.wallet) || 0)) + amount;
      log(`Мастер добавил ${amount} eb в кошелёк Нетраннера. Баланс: ${state.runner.wallet} eb.`, 'success');
      break;
    }
    case 'updateSession':
      requireRole(role, 'gm');
      Object.assign(state.session, payload);
      log('Мастер обновил параметры сессии.');
      break;
    case 'openNetwork': {
      const network = state.networks.find(item => item.id === payload.id);
      if (!network) throw new Error('Сеть не найдена.');
      if (role === 'runner' && !state.scan.visibleNetworkIds.includes(network.id)) throw new Error('Эта Сеть не обнаружена сканированием.');
      if (network.id === state.activeNetworkId) break;
      syncActiveNetwork();
      state.activeNetworkId = network.id;
      state.nodes = cloneValue(network.nodes);
      state.edges = cloneValue(network.edges);
      state.entryNodeId = network.entryNodeId;
      resetActiveNetworkDiscovery();
      state.session.name = network.name;
      state.session.accessPoint = network.accessPoint;
      state.session.connected = false;
      log(`${actor} открыл сеть «${network.name}».`, 'system');
      break;
    }
    case 'createNetwork': {
      requireRole(role, 'gm');
      syncActiveNetwork();
      const network = {
        id: `net-${Date.now()}`,
        name: String(payload.name || 'НОВАЯ СЕТЬ').trim().slice(0, 80) || 'НОВАЯ СЕТЬ',
        accessPoint: '',
        nodes: starterNodes()
      };
      normalizeNetworkGraph(network);
      state.networks.push(network);
      state.activeNetworkId = network.id;
      state.nodes = cloneValue(network.nodes);
      state.edges = cloneValue(network.edges);
      state.entryNodeId = network.entryNodeId;
      state.session.name = network.name;
      state.session.accessPoint = network.accessPoint;
      state.session.connected = false;
      state.session.pathfinderPending = null;
      state.runner.floorId = state.entryNodeId;
      state.runner.architectureKnown = false;
      state.runner.pathfinder = null;
      state.battle = null;
      runnerUndoStack.length = 0;
      log(`Мастер создал сеть «${network.name}».`);
      break;
    }
    case 'updateNetwork': {
      requireRole(role, 'gm');
      const network = state.networks.find(item => item.id === payload.id);
      if (!network) throw new Error('Сеть не найдена.');
      network.name = String(payload.name || network.name).trim().slice(0, 80) || network.name;
      if (network.id === state.activeNetworkId) {
        state.session.name = network.name;
        state.session.accessPoint = network.accessPoint;
      }
      log(`Мастер обновил сеть «${network.name}».`);
      break;
    }
    case 'deleteNetwork': {
      requireRole(role, 'gm');
      if (state.networks.length <= 1) throw new Error('Должна остаться хотя бы одна сеть.');
      const index = state.networks.findIndex(item => item.id === payload.id);
      if (index < 0) throw new Error('Сеть не найдена.');
      const [removed] = state.networks.splice(index, 1);
      state.scan.visibleNetworkIds = state.scan.visibleNetworkIds.filter(id => id !== removed.id);
      state.scan.enteredNetworkIds = state.scan.enteredNetworkIds.filter(id => id !== removed.id);
      if (removed.id === state.activeNetworkId) {
        const network = state.networks[0];
        state.activeNetworkId = network.id;
        state.nodes = cloneValue(network.nodes);
        state.edges = cloneValue(network.edges);
        state.entryNodeId = network.entryNodeId;
        state.session.name = network.name;
        state.session.accessPoint = network.accessPoint;
        state.session.connected = false;
        state.session.pathfinderPending = null;
        state.runner.floorId = state.entryNodeId;
        state.runner.architectureKnown = false;
        state.runner.pathfinder = null;
        state.battle = null;
      }
      runnerUndoStack.length = 0;
      log(`Мастер удалил сеть «${removed.name}».`);
      break;
    }
    case 'undoRunnerAction': {
      requireRole(role, 'gm');
      const entry = runnerUndoStack.pop();
      if (!entry) throw new Error('Нет действия Нетраннера, которое можно отменить.');
      for (const key of ['session', 'runner', 'programs', 'nodes', 'battle']) {
        state[key] = revertChangedValues(state[key], entry.before[key], entry.after[key]);
      }
      log(`Мастер отменил последнее действие Нетраннера: ${entry.label}.`, 'system');
      const previous = runnerUndoStack[runnerUndoStack.length - 1];
      if (previous) previous.afterRevision = state.revision + 1;
      break;
    }
    case 'toggleReveal': {
      requireRole(role, 'gm');
      const node = findNode(payload.id);
      node.revealed = !node.revealed;
      if (node.id === state.entryNodeId) node.revealed = true;
      log(`Мастер ${node.revealed ? 'открыл' : 'скрыл'} узел «${node.title}».`, 'system');
      break;
    }
    case 'toggleClear': {
      requireRole(role, 'gm');
      const node = findNode(payload.id);
      node.cleared = !node.cleared;
      log(`${node.title}: ${node.cleared ? 'преодолено' : 'снова активно'}.`, node.cleared ? 'success' : 'system');
      break;
    }
    case 'updateNodeDv': {
      requireRole(role, 'gm');
      const node = findNode(payload.id);
      if (node.type === 'Программа' && node.ice) throw new Error('У Чёрного ЛЬДА нет фиксированной СЛ проверки.');
      const dv = Math.max(0, Math.min(30, Math.floor(Number(payload.dv))));
      if (!Number.isFinite(dv)) throw new Error('Укажите числовую СЛ.');
      node.dv = dv;
      log(`Мастер изменил сложность проверки «${node.title}» на СЛ ${dv}.`);
      break;
    }
    case 'addNode': {
      requireRole(role, 'gm');
      if (!ALLOWED_NODE_TYPES.includes(payload.nodeType)) throw new Error('Допустимы только Пароль, Файл, Управляющий Узел и Программа.');
      const floor = Math.max(1, ...state.nodes.map(node => Number(node.floor) || 0)) + 1;
      const node = { id: `n${Date.now()}`, parentId: null, floor, title: payload.title || 'Новый узел', type: payload.nodeType || 'Пароль', dv: Number(payload.dv || 8), revealed: false, cleared: false, details: payload.details || '' };
      if (node.type === 'Программа') configureEnemyProgram(node, payload.iceCatalogId);
      const previousEdges = state.edges;
      state.nodes.push(node);
      try {
        setNodeEdges(node.id, [state.entryNodeId].filter(Boolean));
        placeNewNode(node, state.entryNodeId, state.edges);
      } catch (error) {
        state.nodes.pop();
        state.edges = previousEdges;
        throw error;
      }
      log(`Мастер добавил узел «${node.title}».`);
      break;
    }
    case 'updateNode': {
      requireRole(role, 'gm');
      const node = findNode(payload.id);
      if (!ALLOWED_NODE_TYPES.includes(payload.nodeType)) throw new Error('Допустимы только Пароль, Файл, Управляющий Узел и Программа.');
      node.title = String(payload.title || node.title).trim().slice(0, 120) || node.title;
      node.type = payload.nodeType;
      node.details = String(payload.details ?? node.details).trim().slice(0, 1000);
      node.dv = Math.max(0, Math.min(30, Number(payload.dv || 0)));
      configureEnemyProgram(node, payload.iceCatalogId);
      if (Array.isArray(payload.edgeIds)) setNodeEdges(node.id, payload.edgeIds);
      log(`Мастер изменил узел «${node.title}».`);
      break;
    }
    case 'setEntryNode': {
      requireRole(role, 'gm');
      const node = findNode(payload.id);
      state.entryNodeId = node.id;
      node.revealed = true;
      if (!state.session.connected) state.runner.floorId = node.id;
      log(`Мастер назначил входом в Архитектуру узел «${node.title}».`, 'system');
      break;
    }
    case 'setNodeOrder': {
      requireRole(role, 'gm');
      const requestedIds = Array.isArray(payload.nodeIds) ? payload.nodeIds : [];
      const validIds = new Set(state.nodes.map(node => node.id));
      if (requestedIds.length !== state.nodes.length || new Set(requestedIds).size !== state.nodes.length || requestedIds.some(id => !validIds.has(id))) {
        throw new Error('Некорректный порядок узлов.');
      }
      requestedIds.forEach((id, index) => { findNode(id).layoutOrder = index; });
      break;
    }
    case 'connectNodes': {
      requireRole(role, 'gm');
      const from = findNode(payload.from);
      const to = findNode(payload.to);
      if (from.id === to.id) throw new Error('Узел нельзя соединить с самим собой.');
      if (state.edges.some(edge => edgeKey(edge.from, edge.to) === edgeKey(from.id, to.id))) throw new Error('Эти узлы уже соединены.');
      const nextEdges = [...state.edges, makeEdge(from.id, to.id, true)];
      assertPlanarGraph(state.nodes, nextEdges);
      state.edges = nextEdges;
      assertTerminalNodes();
      log(`Мастер соединил узлы «${from.title}» и «${to.title}».`, 'system');
      break;
    }
    case 'deleteEdge': {
      requireRole(role, 'gm');
      const edgeIndex = state.edges.findIndex(e =>
        (e.from === payload.from && e.to === payload.to) || (e.from === payload.to && e.to === payload.from)
      );
      if (edgeIndex === -1) throw new Error('Связь не найдена.');
      const remaining = [...state.edges];
      remaining.splice(edgeIndex, 1);
      if (false && !remaining.some(e => e.from === state.entryNodeId || e.to === state.entryNodeId) && remaining.length > 0) {
        throw new Error('Нельзя удалить последнюю связь входного узла.');
      }
      state.edges = remaining;
      assertTerminalNodes();
      log(`Мастер удалил связь.`, 'system');
      break;
    }
    case 'setNodePositions': {
      requireRole(role, 'gm');
      const positions = Array.isArray(payload.positions) ? payload.positions.map(point => ({
        id: String(point.id || ''),
        x: Math.max(5, Math.min(95, Number(point.x))),
        y: Math.max(5, Math.min(95, Number(point.y)))
      })) : [];
      if (positions.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Некорректные координаты узла.');
      assertCrossingFreePositions(state.nodes, state.edges, positions);
      for (const point of positions) {
        const node = findNode(point.id);
        node.layoutX = point.x;
        node.layoutY = point.y;
      }
      break;
    }
    case 'deleteNode': {
      requireRole(role, 'gm');
      if (state.nodes.length <= 1) throw new Error('В Архитектуре должен остаться хотя бы один узел.');
      if (state.entryNodeId === payload.id) throw new Error('Сначала назначьте другой входной узел.');
      if (state.runner.floorId === payload.id) throw new Error('Перед удалением узла переместите Нетраннера.');
      state.nodes = state.nodes.filter(node => node.id !== payload.id);
      state.edges = state.edges.filter(edge => edge.from !== payload.id && edge.to !== payload.id);
      assertTerminalNodes();
      log('Мастер удалил узел Архитектуры.');
      break;
    }
    case 'reset': {
      requireRole(role, 'gm');
      syncActiveNetwork();
      const networks = cloneValue(state.networks);
      const activeNetworkId = state.activeNetworkId;
      Object.assign(state, newState());
      state.networks = networks;
      state.activeNetworkId = networks.some(network => network.id === activeNetworkId) ? activeNetworkId : networks[0].id;
      normalizeNetworks(state);
      state.runner.floorId = state.entryNodeId;
      runnerUndoStack.length = 0;
      log('Мастер сбросил сессию.');
      break;
    }
    default:
      throw new Error('Неизвестное действие.');
  }
  if (['addNode', 'updateNode', 'connectNodes', 'deleteEdge', 'deleteNode'].includes(type)) recalculateEntryNode();
  if (runnerSnapshot) recordRunnerAction(type, payload, runnerSnapshot); saveAndBroadcast();
}
module.exports = { applyAction };
