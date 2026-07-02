const fs = require('fs');
const path = require('path');
const { state, streams, cloneValue, cloneState } = require('./shared');
const { ALLOWED_NODE_TYPES, HELIOS_NODE_TYPES, icePresets, programCatalog } = require('./constants');
const { normalizeEdges, starterNodes, terminalNodes, entryNodeCandidates } = require('./graph');

const STATE_FILE = path.join(__dirname, '..', 'game-state.json');

function newState() {
  return {
    revision: 1,
    session: { name: 'БАГРОВЫЙ КЛЮЧ', accessPoint: 'Подвальный ретранслятор / 6 м', connected: false, turn: 1, mode: 'НЕТРАН', pathfinderPending: null },
    runner: { name: 'АЛЛОЙ', interface: 4, speedBonus: 0, health: 30, maxHealth: 30, wallet: 500, burning: false, deckSlots: 7, floorId: 'n1', netActionsRemaining: 3, architectureKnown: false, pathfinder: null },
    nodes: [
      { id: 'n1', parentId: null, floor: 1, title: 'Файл', type: 'Файл', dv: 6, revealed: true, cleared: false, details: 'Ценные данные. Копирование найденного Файла не является Сетевым Действием.' },
      { id: 'n2', parentId: 'n1', floor: 2, title: 'Пароль', type: 'Пароль', dv: 8, revealed: false, cleared: false, details: 'Для преодоления требуется успешный «Бэкдор».' },
      { id: 'n3', parentId: 'n2', floor: 3, title: 'Управляющий Узел (Камеры)', type: 'Управляющий Узел', dv: 10, revealed: false, cleared: false, details: 'Управляет камерами на этом этаже.' },
      { id: 'n4', parentId: 'n3', floor: 4, title: 'Пароль', type: 'Пароль', dv: 8, revealed: false, cleared: false, details: 'Второе сетевое препятствие.' },
      { id: 'n5', parentId: 'n4', floor: 5, title: 'Аспид', type: 'Чёрный ЛЁД', dv: 0, revealed: false, cleared: false, active: true, currentRez: icePresets['Аспид'].rez, ice: { ...icePresets['Аспид'], name: 'Аспид' }, details: icePresets['Аспид'].effect },
      { id: 'n6', parentId: 'n5', floor: 6, title: 'Управляющий Узел (Двери Безопасности)', type: 'Управляющий Узел', dv: 10, revealed: false, cleared: false, details: 'Управляет дверьми безопасности здания.' },
      { id: 'n7', parentId: 'n6', floor: 7, title: 'Адская Гончая', type: 'Чёрный ЛЁД', dv: 0, revealed: false, cleared: false, active: true, currentRez: icePresets['Адская Гончая'].rez, ice: { ...icePresets['Адская Гончая'], name: 'Адская Гончая' }, details: icePresets['Адская Гончая'].effect }
    ],
    programs: [
      { id: 'p1', name: 'Доспехи', class: 'Защитная', attack: 0, defense: 0, rez: 7, currentRez: 7, destroyed: false, active: true, effect: 'Снижает урон мозгу на 4, пока активна.' },
      { id: 'p2', name: 'Меч', class: 'Атакующая', attack: 1, defense: 0, rez: 0, currentRez: 0, destroyed: false, active: false, effect: 'Наносит 3d6 урона Чёрному ЛЬДУ, остальным Программам наносит 2d6.' },
      { id: 'p3', name: 'Найдёмся!', class: 'Усиление', attack: 0, defense: 0, rez: 7, currentRez: 7, destroyed: false, active: false, effect: '+2 к проверке «Следопыт», пока активна.' }
    ],
    scan: { pending: false, visibleNetworkIds: [], enteredNetworkIds: [] },
    battle: null,
    log: [{ id: Date.now(), at: new Date().toISOString(), kind: 'system', text: 'Архитектура подготовлена. Ожидание Нетраннера.' }]
  };
}

function loadState() {
  try {
    const defaults = newState();
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const defaultsSession = defaults.session;
    const defaultsRunner = defaults.runner;
    const defaultsScan = defaults.scan;
    const merged = {
      ...defaults, ...saved,
      session: { ...defaultsSession, ...saved.session },
      runner: { ...defaultsRunner, ...saved.runner },
      scan: { ...defaultsScan, ...saved.scan }
    };
    merged.runner.health = Number(saved.runner?.health ?? saved.runner?.brainHP ?? saved.runner?.bodyHP ?? defaultsRunner.health);
    merged.runner.maxHealth = Number(saved.runner?.maxHealth ?? saved.runner?.maxBrainHP ?? saved.runner?.maxBodyHP ?? defaultsRunner.maxHealth);
    merged.runner.wallet = Math.max(0, Math.floor(Number(saved.runner?.wallet ?? defaultsRunner.wallet)));
    delete merged.session.pathfinderReveal;
    delete merged.runner.brainHP;
    delete merged.runner.maxBrainHP;
    delete merged.runner.bodyHP;
    delete merged.runner.maxBodyHP;
    return merged;
  } catch { return newState(); }
}

function normalizeNetworkGraph(network) {
  network.nodes = Array.isArray(network.nodes) && network.nodes.length ? network.nodes : starterNodes();
  network.nodes.forEach((node, index) => {
    const heliosType = network.name === 'HELIOS DEEP STORAGE' ? HELIOS_NODE_TYPES[node.title] : null;
    node.type = heliosType || (ALLOWED_NODE_TYPES.includes(node.type) ? node.type : 'Программа');
    delete node.ice;
    delete node.currentRez;
    delete node.active;
    node.floor = Number.isFinite(Number(node.floor)) ? Number(node.floor) : index + 1;
    node.layoutOrder = Number.isFinite(Number(node.layoutOrder)) ? Number(node.layoutOrder) : index;
    if (Number.isFinite(Number(node.layoutX))) node.layoutX = Number(node.layoutX);
    if (Number.isFinite(Number(node.layoutY))) node.layoutY = Number(node.layoutY);
  });
  network.edges = normalizeEdges(network.nodes, network.edges);
  const entryCandidates = entryNodeCandidates(network.nodes, network.edges);
  network.entryNodeId = entryCandidates.length === 1 ? entryCandidates[0].id : null;
  const entry = network.nodes.find(node => node.id === network.entryNodeId);
  if (entry) entry.revealed = true;
  return network;
}

function normalizeNetworks(source) {
  if (!Array.isArray(source.networks) || !source.networks.length) {
    const id = `net-${Date.now()}`;
    source.networks = [{ id, name: source.session.name, accessPoint: source.session.accessPoint, nodes: cloneValue(source.nodes), edges: cloneValue(source.edges), entryNodeId: source.entryNodeId }];
    source.activeNetworkId = id;
  }
  source.networks.forEach(normalizeNetworkGraph);
  if (!source.networks.some(network => network.id === source.activeNetworkId)) source.activeNetworkId = source.networks[0].id;
  source.scan = source.scan && typeof source.scan === 'object' ? source.scan : { pending: false, visibleNetworkIds: [], enteredNetworkIds: [] };
  source.scan.pending = Boolean(source.scan.pending);
  source.scan.visibleNetworkIds = Array.isArray(source.scan.visibleNetworkIds)
    ? source.scan.visibleNetworkIds.filter(id => source.networks.some(network => network.id === id))
    : [];
  source.scan.enteredNetworkIds = Array.isArray(source.scan.enteredNetworkIds)
    ? source.scan.enteredNetworkIds.filter(id => source.networks.some(network => network.id === id))
    : [];
  if (!source.scan.visibleNetworkIds.includes(source.activeNetworkId)) {
    source.session.connected = false;
    source.battle = null;
  }
  const active = source.networks.find(network => network.id === source.activeNetworkId);
  normalizeNetworkGraph(active);
  source.nodes = cloneValue(active.nodes);
  source.edges = cloneValue(active.edges);
  source.entryNodeId = active.entryNodeId;
  source.nodes.forEach(node => { node.revealed = false; });
  const entry = source.nodes.find(node => node.id === source.entryNodeId);
  if (entry) entry.revealed = true;
  if (!source.nodes.some(node => node.id === source.runner.floorId)) source.runner.floorId = source.entryNodeId;
  source.session.name = active.name;
  source.session.accessPoint = active.accessPoint;
  return source;
}

function syncActiveNetwork() {
  const active = state.networks.find(network => network.id === state.activeNetworkId);
  if (!active) return;
  active.name = state.session.name;
  active.accessPoint = state.session.accessPoint;
  active.nodes = cloneValue(state.nodes);
  active.edges = cloneValue(state.edges);
  active.entryNodeId = state.entryNodeId;
}

function log(text, kind = 'system') {
  state.log.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), kind, text });
  state.log = state.log.slice(0, 80);
}

function netActionsFor(rank) {
  if (rank >= 10) return 5;
  if (rank >= 7) return 4;
  if (rank >= 4) return 3;
  return 2;
}

function requireRole(role, expected) {
  if (role !== expected) throw new Error('Это действие доступно только Мастеру.');
}

function requireRunner(role) {
  if (role !== 'runner') throw new Error('Это действие доступно только Нетраннеру.');
}

function requireLastFloorForVirus() {
  const current = state.nodes.find(item => item.id === state.runner.floorId);
  if (!terminalNodes().some(node => node.id === current.id)) throw new Error('«Вирус» можно установить только в терминальном узле Архитектуры.');
}

function requireFunctionContext(label) {
  const current = state.nodes.find(item => item.id === state.runner.floorId);
  if (label === 'Управление' && current.type !== 'Управляющий Узел') {
    throw new Error('«Управление» можно применить только в узле с Управляющим Узлом.');
  }
  if (label === 'Опознание' && current.type !== 'Файл') {
    throw new Error('«Опознание» можно применить только в узле с Файлом.');
  }
  if (['Разряд', 'Ускользнуть'].includes(label) && !state.battle?.active) {
    throw new Error(`«${label}» можно применить только во время боя.`);
  }
  if (label === 'Вирус') requireLastFloorForVirus();
}

function programSlots(program) {
  return Number(program.slots || (program.class === 'Чёрный ЛЁД' ? 2 : 1));
}

function usedDeckSlots() {
  return state.programs.reduce((total, program) => total + programSlots(program), 0);
}

function networkSummaries() {
  return state.networks.map(network => ({
    id: network.id, name: network.name, accessPoint: network.accessPoint,
    floorCount: network.nodes.length, nodeCount: network.nodes.length
  }));
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function saveAndBroadcast() {
  const { viewFor } = require('./view');
  saveState();
  state.revision = (state.revision || 0) + 1;
  for (const res of streams) {
    try {
      res.write(`event: state\ndata: ${JSON.stringify(viewFor(res.role))}\n\n`);
    } catch {}
  }
}

module.exports = {
  STATE_FILE, newState, loadState, normalizeNetworks, normalizeNetworkGraph,
  syncActiveNetwork, log, netActionsFor,
  requireRole, requireRunner, requireFunctionContext, requireLastFloorForVirus,
  programSlots, usedDeckSlots, networkSummaries, saveState, saveAndBroadcast
};
