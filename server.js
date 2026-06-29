const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'game-state.json');

const icePresets = {
  'Аспид': { perception: 4, speed: 6, attack: 2, defense: 2, rez: 15, effect: 'Уничтожает одну случайную Программу из Кибердеки Нетраннера.' },
  'Великан': { perception: 2, speed: 2, attack: 8, defense: 4, rez: 25, effect: 'Наносит 3d6 урона мозгу и выбрасывает Нетраннера из текущего «лифта».' },
  'Адская Гончая': { perception: 6, speed: 6, attack: 6, defense: 2, rez: 20, effect: 'Наносит 2d6 урона мозгу; Кибердека и одежда загораются, нанося 2 урона в конце Хода до тушения Мясным Действием.' }
};

const programCatalog = [
  { catalogId: 'eraser', name: 'Стиратель', class: 'Усиление', category: 'Усиления', cost: 20, availability: 'Повседневная', attack: 0, defense: 0, rez: 7, effect: '+2 ко всем проверкам «Плащ», пока Программа активна.' },
  { catalogId: 'see-ya', name: 'Найдёмся!', class: 'Усиление', category: 'Усиления', cost: 20, availability: 'Повседневная', attack: 0, defense: 0, rez: 7, effect: '+2 ко всем проверкам «Первопроходец», пока Программа активна.' },
  { catalogId: 'speedy-gonzalvez', name: 'Быстрый Гонзалес', class: 'Усиление', category: 'Усиления', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 7, effect: '+2 к Скорости, пока Программа активна.' },
  { catalogId: 'worm', name: 'Червь', class: 'Усиление', category: 'Усиления', cost: 50, availability: 'Дорогая', attack: 0, defense: 0, rez: 7, effect: '+2 ко всем проверкам «Бэкдор», пока Программа активна.' },
  { catalogId: 'armor', name: 'Доспехи', class: 'Защитная', category: 'Защитные', cost: 50, availability: 'Дорогая', attack: 0, defense: 0, rez: 7, effect: 'Снижает весь получаемый урон мозгу на 4, пока активна. Одновременно может работать только одна копия; каждая копия используется один раз за забег.' },
  { catalogId: 'flak', name: 'Зенитка', class: 'Защитная', category: 'Защитные', cost: 50, availability: 'Дорогая', attack: 0, defense: 0, rez: 7, effect: 'Снижает АТК всех вражеских атакующих Программ, не являющихся Чёрным ЛЬДОМ, до 0. Одновременно может работать только одна копия; каждая копия используется один раз за забег.' },
  { catalogId: 'shield', name: 'Щит', class: 'Защитная', category: 'Защитные', cost: 20, availability: 'Повседневная', attack: 0, defense: 0, rez: 7, effect: 'Блокирует первый успешный урон мозгу от Программы, не являющейся Чёрным ЛЬДОМ, затем деактивируется. Одновременно работает одна копия; каждая копия используется один раз за забег.' },
  { catalogId: 'banhammer', name: 'Банхаммер', class: 'Атакующая', category: 'Атакующие против программ', target: 'Программы', cost: 50, availability: 'Дорогая', attack: 1, defense: 0, rez: 0, effect: 'Наносит 3d6 урона REZ обычной Программе или 2d6 Чёрному ЛЬДУ.' },
  { catalogId: 'sword', name: 'Меч', class: 'Атакующая', category: 'Атакующие против программ', target: 'Программы', cost: 50, availability: 'Дорогая', attack: 1, defense: 0, rez: 0, effect: 'Наносит 3d6 урона REZ Чёрному ЛЬДУ или 2d6 обычной Программе.' },
  { catalogId: 'deckkrash', name: 'Деколом', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 0, effect: 'Принудительно и небезопасно отключает вражеского Нетраннера; тот получает эффекты всего встреченного активного Чёрного ЛЬДА.' },
  { catalogId: 'hellbolt', name: 'Адская стрела', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 2, defense: 0, rez: 0, effect: 'Наносит 2d6 урона мозгу. Неизолированная кибердека и одежда загораются и наносят 2 урона в конце каждого Хода до тушения Мясным Действием; эффект не складывается.' },
  { catalogId: 'nervescrub', name: 'Нервотрёп', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 0, effect: 'На час снижает INT, REF и DEX цели на 1d6, минимум до 1; постоянных последствий нет.' },
  { catalogId: 'poison-flatline', name: 'Смертельный Яд', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 0, effect: 'Уничтожает случайную обычную Программу в кибердеке вражеского Нетраннера.' },
  { catalogId: 'superglue', name: 'Суперклей', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 2, defense: 0, rez: 0, effect: 'На 1d6 Раундов запрещает цели двигаться глубже или безопасно отключаться; небезопасное отключение возможно. Каждая копия используется один раз за забег.' },
  { catalogId: 'vrizzbolt', name: 'Спираль', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 50, availability: 'Дорогая', attack: 1, defense: 0, rez: 0, effect: 'Наносит 1d6 урона мозгу и уменьшает Сетевые Действия цели на следующем Ходу на 1, минимум до 2.' },
  { catalogId: 'asp-ice', name: 'Аспид', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 100, availability: 'Премиум', perception: 4, speed: 6, attack: 2, defense: 2, rez: 15, effect: 'Уничтожает одну случайную Программу из Кибердеки вражеского Нетраннера.' },
  { catalogId: 'giant-ice', name: 'Великан', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 1000, availability: 'Очень дорогое', perception: 2, speed: 2, attack: 8, defense: 4, rez: 25, damageDice: 3, effect: 'Наносит 3d6 урона мозгу и выбрасывает Нетраннера из текущего «забега». Нетраннер испытывает эффекты всего активированного Чёрного ЛЬДА, с которым столкнулся в Архитектуре, кроме Великана.' },
  { catalogId: 'hellhound-ice', name: 'Адская Гончая', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 500, availability: 'Дорогое', perception: 6, speed: 6, attack: 6, defense: 2, rez: 20, damageDice: 2, effect: 'Наносит 2d6 урона мозгу. Кибердека без термоизоляции загорается вместе с одеждой Нетраннера; в конце каждого своего Хода Нетраннер получает 2 урона, пока не потратит Мясное Действие, чтобы потушить себя. Эффект не складывается.' },
  { catalogId: 'kraken-ice', name: 'Кракен', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 1000, availability: 'Очень дорогое', perception: 6, speed: 2, attack: 8, defense: 4, rez: 30, damageDice: 3, effect: 'Наносит 3d6 урона мозгу. В течение двух Ходов Нетраннер не может двигаться вглубь Архитектуры и безопасно отключаться; небезопасное отключение всё ещё возможно.' },
  { catalogId: 'lich-ice', name: 'Лич', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 500, availability: 'Дорогое', perception: 8, speed: 2, attack: 6, defense: 2, rez: 25, effect: 'ИНТ, РЕА и ЛВК вражеского Нетраннера в течение следующего часа снижаются на 1d6, минимум до 1. Воздействие в основном психосоматическое и спустя час проходит.' },
  { catalogId: 'raven-ice', name: 'Ворон', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 50, availability: 'Ценное', perception: 6, speed: 4, attack: 4, defense: 2, rez: 15, damageDice: 1, effect: 'Отключает одну случайную Защитную Программу из активированных Программ вражеского Нетраннера, затем наносит 1d6 урона мозгу Раннеру.' },
  { catalogId: 'scorpion-ice', name: 'Скорпион', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 100, availability: 'Премиум', perception: 2, speed: 6, attack: 2, defense: 2, rez: 15, effect: 'СКО вражеского Нетраннера в течение часа снижается на 1d6, минимум до 1. Воздействие психологическое и спустя час проходит.' },
  { catalogId: 'skunk-ice', name: 'Скунс', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 500, availability: 'Дорогое', perception: 2, speed: 4, attack: 4, defense: 2, rez: 10, effect: 'Вражеский Раннер получает −2 ко всем проверкам «Ускользнуть», пока эта Программа активирована. Каждый Скунс воздействует только на одного Нетраннера, но эффекты нескольких Скунсов складываются.' },
  { catalogId: 'wisp-ice', name: 'Висп', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 50, availability: 'Ценное', perception: 4, speed: 4, attack: 4, defense: 2, rez: 15, damageDice: 1, effect: 'Наносит 1d6 урона мозгу Нетраннера и уменьшает количество Сетевых Действий, которые Нетраннер может сделать в следующий Ход, на 1, минимум до 2.' },
  { catalogId: 'dragon-ice', name: 'Дракон', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Программ', target: 'Программы', slots: 2, cost: 1000, availability: 'Очень дорогая', perception: 6, speed: 4, attack: 6, defense: 6, rez: 30, damageDice: 6, effect: 'Наносит 6d6 урона Программе. Если урона хватает для деактивации, Программа уничтожается.' },
  { catalogId: 'killer-ice', name: 'Убийца', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Программ', target: 'Программы', slots: 2, cost: 500, availability: 'Дорогая', perception: 4, speed: 8, attack: 6, defense: 2, rez: 20, damageDice: 4, effect: 'Наносит 4d6 урона Программе. Если урона хватает для деактивации, Программа уничтожается.' },
  { catalogId: 'sabertooth-ice', name: 'Саблезубый', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Программ', target: 'Программы', slots: 2, cost: 1000, availability: 'Очень дорогая', perception: 8, speed: 6, attack: 6, defense: 2, rez: 25, damageDice: 6, effect: 'Наносит 6d6 урона Программе. Если урона хватает для деактивации, Программа уничтожается.' }
];

function newState() {
  return {
    revision: 1,
    session: { name: 'БАГРОВЫЙ КЛЮЧ', accessPoint: 'Подвальный ретранслятор / 6 м', connected: false, turn: 1, mode: 'НЕТРАН', pathfinderReveal: { mode: 'result', table: '1-4:1, 5-7:3, 8-9:5, 10+:7' } },
    runner: { name: 'АЛЛОЙ', interface: 4, speedBonus: 0, health: 30, maxHealth: 30, wallet: 500, burning: false, deckSlots: 7, floorId: 'n1', netActionsRemaining: 2, architectureKnown: false, pathfinder: null },
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
    const merged = { ...defaults, ...saved, session: { ...defaults.session, ...saved.session }, runner: { ...defaults.runner, ...saved.runner }, scan: { ...defaults.scan, ...saved.scan } };
    merged.runner.health = Number(saved.runner?.health ?? saved.runner?.brainHP ?? saved.runner?.bodyHP ?? defaults.runner.health);
    merged.runner.maxHealth = Number(saved.runner?.maxHealth ?? saved.runner?.maxBrainHP ?? saved.runner?.maxBodyHP ?? defaults.runner.maxHealth);
    merged.runner.wallet = Math.max(0, Math.floor(Number(saved.runner?.wallet ?? defaults.runner.wallet)));
    delete merged.runner.brainHP;
    delete merged.runner.maxBrainHP;
    delete merged.runner.bodyHP;
    delete merged.runner.maxBodyHP;
    return merged;
  }
  catch { return newState(); }
}

function starterNodes() {
  return [{ id: `n${Date.now()}`, parentId: null, floor: 1, title: 'Точка доступа', type: 'Пароль', dv: 6, revealed: true, cleared: false, details: 'Входной узел новой Архитектуры.' }];
}

function normalizeNetworks(source) {
  if (!Array.isArray(source.networks) || !source.networks.length) {
    const id = `net-${Date.now()}`;
    source.networks = [{ id, name: source.session.name, accessPoint: source.session.accessPoint, nodes: cloneValue(source.nodes) }];
    source.activeNetworkId = id;
  }
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
  active.nodes = Array.isArray(active.nodes) && active.nodes.length ? active.nodes : starterNodes();
  source.nodes = cloneValue(active.nodes);
  source.session.name = active.name;
  source.session.accessPoint = active.accessPoint;
  return source;
}

let state = normalizeNetworks(loadState());
state.programs = state.programs.map(program => {
  const template = program.catalogId ? programCatalog.find(item => item.catalogId === program.catalogId) : null;
  if (!template) return program;
  return {
    ...program,
    ...template,
    id: program.id,
    currentRez: program.destroyed ? 0 : Math.min(Number(program.currentRez ?? template.rez), template.rez),
    destroyed: Boolean(program.destroyed),
    active: Boolean(program.active)
  };
});
state.runner.netActionsRemaining = Math.min(state.runner.netActionsRemaining, netActionsFor(state.runner.interface));
const runnerUndoStack = [];
const streams = new Set();

function cloneState(source = state) {
  return JSON.parse(JSON.stringify(source));
}

function cloneValue(source) {
  return source === undefined ? undefined : JSON.parse(JSON.stringify(source));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function revertChangedValues(current, before, after) {
  if (sameValue(before, after)) return current;
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current) && before.length === after.length && current.length === after.length) {
    return current.map((value, index) => revertChangedValues(value, before[index], after[index]));
  }
  const objects = [current, before, after].every(value => value && typeof value === 'object' && !Array.isArray(value));
  if (objects) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      result[key] = revertChangedValues(current[key], before[key], after[key]);
    }
    return result;
  }
  return sameValue(current, after) ? cloneValue(before) : current;
}

function runnerActionLabel(type, payload) {
  if (payload?.label) return String(payload.label);
  if (type === 'nextTurn') return 'завершение Хода';
  if (type === 'move') return `перемещение на этаж ${state.nodes.find(node => node.id === payload.id)?.floor || '?'}`;
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

function netActionsFor(rank) {
  if (rank >= 10) return 4;
  if (rank >= 7) return 3;
  if (rank >= 4) return 2;
  return 1;
}

function programSlots(program) {
  return Number(program.slots || (program.class === 'Чёрный ЛЁД' ? 2 : 1));
}

function usedDeckSlots() {
  return state.programs.reduce((total, program) => total + programSlots(program), 0);
}

function log(text, kind = 'system') {
  state.log.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), kind, text });
  state.log = state.log.slice(0, 80);
}

function saveAndBroadcast() {
  syncActiveNetwork();
  state.revision += 1;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  for (const client of streams) {
    client.write(`event: state\ndata: ${JSON.stringify(viewFor(client.role))}\n\n`);
  }
}

function syncActiveNetwork() {
  const active = state.networks.find(network => network.id === state.activeNetworkId);
  if (!active) return;
  active.name = state.session.name;
  active.accessPoint = state.session.accessPoint;
  active.nodes = cloneValue(state.nodes);
}

function networkSummaries() {
  return state.networks.map(network => ({
    id: network.id,
    name: network.name,
    accessPoint: network.accessPoint,
    floorCount: network.nodes.length
  }));
}

function viewFor(role) {
  if (role === 'gm') return { ...state, networks: networkSummaries(), role, icePresets, programCatalog, deckSlotsUsed: usedDeckSlots(), totalFloors: state.nodes.length, canUndoRunnerAction: runnerUndoStack.length > 0 };
  const activeVisible = state.scan.visibleNetworkIds.includes(state.activeNetworkId);
  const activeEntered = state.scan.enteredNetworkIds.includes(state.activeNetworkId);
  return {
    ...state,
    networks: networkSummaries()
      .filter(network => state.scan.visibleNetworkIds.includes(network.id))
      .map(network => state.scan.enteredNetworkIds.includes(network.id) ? network : { ...network, floorCount: null }),
    activeNetworkId: activeVisible ? state.activeNetworkId : null,
    session: activeVisible
      ? state.session
      : { ...state.session, name: 'СЕТЬ НЕ ВЫБРАНА', accessPoint: 'Запросите сканирование и выберите обнаруженную Сеть.', connected: false },
    role,
    icePresets: undefined,
    programCatalog,
    deckSlotsUsed: usedDeckSlots(),
    totalFloors: activeVisible && activeEntered && state.runner.architectureKnown ? state.nodes.length : null,
    nodes: activeVisible && activeEntered ? state.nodes.filter(node => node.revealed || node.id === state.runner.floorId) : [],
    battle: activeVisible ? state.battle : null
  };
}

function requireRole(role, expected) {
  if (role !== expected) throw new Error('Это действие доступно только Мастеру.');
}

function requireRunner(role) {
  if (role !== 'runner') throw new Error('Это действие доступно только Нетраннеру.');
}

function findNode(id) {
  const node = state.nodes.find(item => item.id === id);
  if (!node) throw new Error('Узел Архитектуры не найден.');
  return node;
}

function requireLastFloorForVirus() {
  const current = findNode(state.runner.floorId);
  const lastFloor = Math.max(...state.nodes.map(node => Number(node.floor) || 0));
  if (current.floor !== lastFloor) throw new Error('«Вирус» можно установить только на последнем этаже Архитектуры.');
}

function requireFunctionContext(label) {
  const current = findNode(state.runner.floorId);
  if (label === 'Управление' && current.type !== 'Управляющий Узел') {
    throw new Error('«Управление» можно применить только на этаже с Управляющим Узлом.');
  }
  if (label === 'Опознание' && current.type !== 'Файл') {
    throw new Error('«Опознание» можно применить только на этаже с Файлом.');
  }
  if (['Разряд', 'Ускользнуть'].includes(label) && !state.battle?.active) {
    throw new Error(`«${label}» можно применить только во время боя.`);
  }
  if (label === 'Вирус') requireLastFloorForVirus();
}

function parseRevealTable(source) {
  const entries = String(source || '').split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
  const rules = entries.map(entry => {
    const match = entry.match(/^(\d+)\s*(?:(?:-\s*(\d+))|(\+))?\s*[:=]\s*(\d+)$/);
    if (!match) throw new Error(`Неверная строка таблицы: «${entry}». Используйте формат 1-4:1 или 10+:7.`);
    const min = Number(match[1]);
    const max = match[3] ? null : Number(match[2] || match[1]);
    const floors = Number(match[4]);
    if (min < 0 || (max !== null && max < min) || floors < 1) throw new Error(`Недопустимый диапазон: «${entry}».`);
    return { min, max, floors };
  }).sort((a, b) => a.min - b.min);
  if (!rules.length) throw new Error('Добавьте хотя бы один диапазон открытия этажей.');
  return rules;
}

function pathfinderFloorBudget(result) {
  const config = state.session.pathfinderReveal || { mode: 'result' };
  if (config.mode !== 'table') return { floors: Math.max(1, Math.floor(result)), source: 'result' };
  const rule = parseRevealTable(config.table).find(item => result >= item.min && (item.max === null || result <= item.max));
  return rule ? { floors: rule.floors, source: 'table' } : { floors: Math.max(1, Math.floor(result)), source: 'fallback' };
}

function rollDice(count = 1, sides = 6) {
  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i += 1) {
    const value = 1 + Math.floor(Math.random() * sides);
    rolls.push(value);
    total += value;
  }
  return { total, rolls };
}

function rollD10(firstRoll, criticalRoll) {
  const roll = value => value == null ? 1 + Math.floor(Math.random() * 10) : Number(value);
  const first = roll(firstRoll);
  if (!Number.isInteger(first) || first < 1 || first > 10) throw new Error('Результат D10 должен быть целым числом от 1 до 10.');

  if (first !== 1 && first !== 10) return { first, critical: null, total: first };

  if (firstRoll != null && criticalRoll == null) throw new Error('После критического результата 1 или 10 нужен дополнительный бросок D10.');
  const critical = roll(criticalRoll);
  if (!Number.isInteger(critical) || critical < 1 || critical > 10) throw new Error('Дополнительный результат D10 должен быть целым числом от 1 до 10.');
  return { first, critical, total: first === 10 ? first + critical : first - critical };
}

function formatD10(result, physical = false) {
  const source = physical ? 'физ. ' : '';
  if (result.critical == null) return `d10(${source}${result.first})`;
  const operator = result.first === 10 ? '+' : '−';
  return `d10(${source}${result.first}${operator}${result.critical}=${result.total})`;
}

function applyDamage(amount, source) {
  const armor = state.programs.find(program => (program.name === 'Доспехи' || program.catalogId === 'armor') && program.active && !program.destroyed);
  const reduced = Math.max(0, amount - (armor ? 4 : 0));
  state.runner.health = Math.max(0, state.runner.health - reduced);
  log(`${source}: урон ${amount}${armor ? ' − 4 от «Доспехов»' : ''} = ${reduced}. Здоровье: ${state.runner.health}.`, 'damage');
  if (state.runner.health === 0) {
    state.session.connected = false;
    if (state.battle) state.battle.active = false;
    state.programs.filter(program => program.class === 'Чёрный ЛЁД').forEach(program => { program.active = false; program.targetNodeId = null; });
    log('Здоровье Нетраннера упало до 0. Соединение разорвано.', 'damage');
  }
}

function applyIceEffect(node, reason = 'Атака Чёрного ЛЬДА') {
  if (node.ice.name === 'Аспид') {
    const candidates = state.programs.filter(program => !program.destroyed);
    if (candidates.length) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      target.destroyed = true;
      target.active = false;
      target.currentRez = 0;
      log(`${reason}: Аспид уничтожил случайную Программу «${target.name}».`, 'damage');
    }
    return;
  }
  if (node.ice.name === 'Великан') {
    const damage = rollDice(3, 6);
    applyDamage(damage.total, `${reason}: Великан [${damage.rolls.join('+')}]`);
    state.session.connected = false;
    if (state.battle) state.battle.active = false;
    state.programs.filter(program => program.class === 'Чёрный ЛЁД').forEach(program => { program.active = false; program.targetNodeId = null; });
    log('Великан выбросил Нетраннера из текущего забега.', 'damage');
    return;
  }
  if (node.ice.name === 'Адская Гончая') {
    const damage = rollDice(2, 6);
    applyDamage(damage.total, `${reason}: Адская Гончая [${damage.rolls.join('+')}]`);
    state.runner.burning = true;
    log('Кибердека и одежда загорелись: 2 урона Здоровью в конце каждого Хода до тушения Мясным Действием.', 'damage');
  }
}

function startIceEncounter(node) {
  node.currentRez = Number.isFinite(node.currentRez) ? node.currentRez : node.ice.rez;
  const runnerDie = rollD10();
  const iceDie = rollD10();
  const runnerTotal = state.runner.interface + state.runner.speedBonus + runnerDie.total;
  const iceTotal = node.ice.speed + iceDie.total;
  state.battle = { active: true, nodeId: node.id, round: 1, slideUsed: false, runnerInitiative: runnerTotal, iceInitiative: iceTotal, ambushHit: iceTotal > runnerTotal };
  log(`Встреча с «${node.title}»: Нетраннер ${state.runner.interface}+${state.runner.speedBonus}+${formatD10(runnerDie)}=${runnerTotal}; ЛЁД ${node.ice.speed}+${formatD10(iceDie)}=${iceTotal}.`, 'turn');
  if (iceTotal > runnerTotal) applyIceEffect(node, 'Засада');
  else log('Нетраннер выиграл встречную проверку Скорости и избежал эффекта засады.', 'success');
}

function damageIce(node, amount, source) {
  node.currentRez = Math.max(0, node.currentRez - amount);
  log(`${source}: «${node.title}» получает ${amount} урона REZ. Осталось REZ ${node.currentRez}/${node.ice.rez}.`, 'damage');
  if (node.currentRez === 0) {
    node.cleared = true;
    node.active = false;
    state.battle.active = false;
    state.programs.filter(program => program.class === 'Чёрный ЛЁД' && program.targetNodeId === node.id).forEach(program => {
      program.active = false;
      program.targetNodeId = null;
    });
    log(`«${node.title}» деактивирован. Этаж преодолён.`, 'success');
  }
}

function applyAction(role, type, payload = {}) {
  const actor = role === 'gm' ? 'Мастер' : state.runner.name;
  const undoableRunnerActions = ['nextTurn', 'spendAction', 'meatAction', 'roll', 'move', 'toggleProgram', 'downloadProgram', 'deleteProgram', 'battleAction'];
  const runnerSnapshot = role === 'runner' && undoableRunnerActions.includes(type) ? cloneState() : null;
  switch (type) {
    case 'connect':
      if (role === 'runner' && payload.connected && !state.scan.visibleNetworkIds.includes(state.activeNetworkId)) {
        throw new Error('Сначала обнаружьте Сеть сканированием и выберите её.');
      }
      if (role === 'runner' && payload.connected && !state.scan.enteredNetworkIds.includes(state.activeNetworkId)) {
        state.scan.enteredNetworkIds.push(state.activeNetworkId);
      }
      state.session.connected = Boolean(payload.connected);
      log(payload.connected ? `${actor} подключился к Архитектуре.` : `${actor} безопасно отключился.`, payload.connected ? 'success' : 'system');
      break;
    case 'nextTurn':
      requireRunner(role);
      state.session.turn += 1;
      state.runner.netActionsRemaining = netActionsFor(state.runner.interface);
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
        if (currentForRoll.type !== 'Пароль') throw new Error('«Бэкдор» можно применить только на этаже с Паролем.');
        backdoorTarget = currentForRoll;
      }
      log(`${actor}, ${payload.label || 'проверка'}: ${d10Tag} + ${bonus} = ${total}${dv ? ` против СЛ ${dv} — ${total > dv ? 'УСПЕХ' : 'ПРОВАЛ'}` : ''}.`, total > dv && dv ? 'success' : 'roll');
      if (backdoorTarget && total > dv) {
        backdoorTarget.cleared = true;
        log(`Бэкдор: Пароль на этаже ${backdoorTarget.floor} преодолён.`, 'success');
      }
      if (payload.label === 'Первопроходец') {
        const curNode = findNode(state.runner.floorId);
        const lastRevealed = state.nodes.reduce((max, n) => n.revealed ? Math.max(max, n.floor) : max, 0);
        if (!curNode || curNode.floor !== lastRevealed) throw new Error('Первопроходца можно запускать только с последнего открытого этажа.');
        state.runner.architectureKnown = true;
        const ordered = [...state.nodes].sort((a, b) => a.floor - b.floor);
        const budget = pathfinderFloorBudget(total);
        const floorBudget = budget.floors;
        const startIdx = ordered.findIndex(n => n.floor > lastRevealed);
        const from = startIdx >= 0 ? startIdx : ordered.length;
        let visibleSlice = ordered.slice(from, from + floorBudget);
        const blockerIndex = visibleSlice.findIndex(node => node.type === 'Пароль' && Number(node.dv || 0) > total);
        if (blockerIndex >= 0) visibleSlice = visibleSlice.slice(0, blockerIndex + 1);
        const newlyRevealed = visibleSlice.filter(node => !node.revealed).length;
        visibleSlice.forEach(node => { node.revealed = true; });
        const blocker = blockerIndex >= 0 ? visibleSlice[visibleSlice.length - 1] : null;
        const last = visibleSlice[visibleSlice.length - 1];
        state.runner.pathfinder = {
          result: total,
          floorBudget,
          revealMode: budget.source,
          openedByResult: visibleSlice.length,
          newlyRevealed,
          lastFloor: last?.floor || 1,
          stoppedBy: blocker?.title || null,
          stoppedDv: blocker?.dv || null
        };
        log(`Первопроходец ${total}: лимит по настройке ${floorBudget}, открыто этажей ${visibleSlice.length}, новых ${newlyRevealed}${blocker ? `; обзор остановлен на «${blocker.title}» СЛ ${blocker.dv}` : ''}.`, 'success');
      }
      break;
    }
    case 'move': {
      if (role === 'gm') throw new Error('Перемещать Нетраннера между этажами может только сам Нетраннер.');
      const target = findNode(payload.id);
      const current = findNode(state.runner.floorId);
      if (state.battle?.active && state.battle.nodeId === current.id && target.id !== current.id) {
        throw new Error(`Нельзя покинуть этаж во время боя с «${current.title}». Сначала завершите бой.`);
      }
      if (!target.revealed) throw new Error('Этот этаж ещё не обнаружен.');
      if (target.floor > current.floor) {
        const route = [];
        let cursor = target;
        while (cursor) {
          route.unshift(cursor);
          cursor = cursor.parentId ? state.nodes.find(item => item.id === cursor.parentId) : null;
        }
        const targetIndex = route.findIndex(item => item.id === target.id);
        const blocking = route.slice(0, targetIndex).find(item => ['Пароль', 'Чёрный ЛЁД'].includes(item.type) && !item.cleared);
        if (blocking) throw new Error(`${blocking.title} блокирует перемещение, пока препятствие не преодолено.`);
      }
      state.runner.floorId = target.id;
      log(`${actor} переместился на этаж ${target.floor}: ${target.title}.`, 'move');
      if (target.type === 'Чёрный ЛЁД' && target.active !== false && !target.cleared) startIceEncounter(target);
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
      if (!state.battle?.active) throw new Error('Сейчас нет активного боя в СЕТИ.');
      const node = findNode(state.battle.nodeId);
      if (payload.kind === 'iceAttack') {
        requireRole(role, 'gm');
        const iceDie = rollD10();
        const runnerDie = rollD10();
        const attack = node.ice.attack + iceDie.total;
        const defense = state.runner.interface + runnerDie.total;
        log(`Атака ЛЬДА: АТК ${node.ice.attack}+${formatD10(iceDie)}=${attack} против Интерфейса ${state.runner.interface}+${formatD10(runnerDie)}=${defense}.`, 'roll');
        if (attack > defense) applyIceEffect(node);
        else log(`«${node.title}» промахнулся.`, 'success');
        state.battle.round += 1;
        break;
      }
      requireRunner(role);
      if (payload.kind === 'extinguish') {
        if (!state.runner.burning) throw new Error('Нетраннер не горит.');
        state.runner.burning = false;
        log('Нетраннер потратил Мясное Действие и потушил огонь.', 'success');
        break;
      }
      if (!state.session.connected) throw new Error('Нетраннер должен быть подключён к Архитектуре.');
      if (payload.kind === 'runnerIce') {
        const program = state.programs.find(item => item.id === payload.programId);
        if (!program || program.class !== 'Чёрный ЛЁД' || program.destroyed) throw new Error('Выберите загруженный Чёрный ЛЁД.');
        if (program.target !== 'Программы') throw new Error('Чёрный ЛЁД против Людей можно активировать только на вражеского Нетраннера. На этом боевом слое такой цели нет.');
        if (!program.active) {
          if (state.runner.netActionsRemaining < 1) throw new Error('Для активации Чёрного ЛЬДА требуется Сетевое Действие.');
          state.runner.netActionsRemaining -= 1;
          program.active = true;
          program.currentRez = program.rez;
          program.targetNodeId = node.id;
          program.lastAttackRound = 0;
          log(`${actor} активировал «${program.name}» на цель «${node.title}». Чёрный ЛЁД занимает вершину Очереди Инициативы.`, 'action');
          break;
        }
        if (program.targetNodeId !== node.id) throw new Error('Этот Чёрный ЛЁД назначен на другую цель.');
        if (program.lastAttackRound === state.battle.round) throw new Error('Этот Чёрный ЛЁД уже атаковал в текущем Раунде.');
        const attackerDie = rollD10();
        const defenderDie = rollD10();
        const attack = program.attack + attackerDie.total;
        const defense = node.ice.defense + defenderDie.total;
        program.lastAttackRound = state.battle.round;
        log(`${program.name}: АТК ${program.attack}+${formatD10(attackerDie)}=${attack} против ЗАЩ ${node.ice.defense}+${formatD10(defenderDie)}=${defense}.`, 'roll');
        if (attack > defense) {
          const damage = rollDice(Number(program.damageDice || 4), 6);
          damageIce(node, damage.total, `${program.name} [${damage.rolls.join('+')}]`);
        } else log(`«${program.name}» промахнулся.`, 'damage');
        break;
      }
      if (state.runner.netActionsRemaining < 1) throw new Error('В этом Ходу не осталось Сетевых Действий.');
      if (payload.kind === 'slide') {
        if (state.battle.slideUsed) throw new Error('«Ускользнуть» можно попытаться только один раз за Ход.');
        state.battle.slideUsed = true;
        state.runner.netActionsRemaining -= 1;
        const runnerDie = rollD10();
        const iceDie = rollD10();
        const runnerTotal = state.runner.interface + runnerDie.total;
        const iceTotal = node.ice.perception + iceDie.total;
        log(`Ускользнуть: Интерфейс ${state.runner.interface}+${formatD10(runnerDie)}=${runnerTotal} против Восприятия ${node.ice.perception}+${formatD10(iceDie)}=${iceTotal}.`, 'roll');
        if (runnerTotal > iceTotal) {
          state.battle.active = false;
          state.programs.filter(program => program.class === 'Чёрный ЛЁД' && program.targetNodeId === node.id).forEach(program => {
            program.active = false;
            program.targetNodeId = null;
          });
          log(`Нетраннер ускользнул от «${node.title}». ЛЁД остаётся в засаде на этом этаже.`, 'success');
        } else log('Ускользнуть не удалось.', 'damage');
        break;
      }
      if (payload.kind === 'zap') {
        state.runner.netActionsRemaining -= 1;
        const runnerDie = rollD10();
        const iceDie = rollD10();
        const attack = state.runner.interface + runnerDie.total;
        const defense = node.ice.defense + iceDie.total;
        log(`Разряд: Интерфейс ${state.runner.interface}+${formatD10(runnerDie)}=${attack} против ЗАЩ ${node.ice.defense}+${formatD10(iceDie)}=${defense}.`, 'roll');
        if (attack > defense) damageIce(node, rollDice(1, 6).total, 'Разряд');
        else log('Разряд промахнулся.', 'damage');
        break;
      }
      if (payload.kind === 'program') {
        const program = state.programs.find(item => item.id === payload.programId);
        if (!program || program.destroyed || !program.active || program.class !== 'Атакующая' || program.target === 'Нетраннеры') throw new Error('Выберите активную Атакующую Программу против Программ.');
        state.runner.netActionsRemaining -= 1;
        const runnerDie = rollD10();
        const iceDie = rollD10();
        const attack = state.runner.interface + program.attack + runnerDie.total;
        const defense = node.ice.defense + iceDie.total;
        log(`${program.name}: Интерфейс ${state.runner.interface}+АТК ${program.attack}+${formatD10(runnerDie)}=${attack} против ЗАЩ ${node.ice.defense}+${formatD10(iceDie)}=${defense}.`, 'roll');
        if (attack > defense) {
          const damage = program.name === 'Меч' || program.catalogId === 'sword' ? rollDice(3, 6) : rollDice(2, 6);
          damageIce(node, damage.total, `${program.name} [${damage.rolls.join('+')}]`);
        } else log(`«${program.name}» промахнулся.`, 'damage');
        program.active = false;
        break;
      }
      throw new Error('Неизвестное боевое действие.');
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
      state.session.name = network.name;
      state.session.accessPoint = network.accessPoint;
      state.session.connected = false;
      state.runner.floorId = state.nodes[0].id;
      state.runner.architectureKnown = false;
      state.runner.pathfinder = null;
      state.battle = null;
      runnerUndoStack.length = 0;
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
      state.networks.push(network);
      state.activeNetworkId = network.id;
      state.nodes = cloneValue(network.nodes);
      state.session.name = network.name;
      state.session.accessPoint = network.accessPoint;
      state.session.connected = false;
      state.runner.floorId = state.nodes[0].id;
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
        state.session.name = network.name;
        state.session.accessPoint = network.accessPoint;
        state.session.connected = false;
        state.runner.floorId = state.nodes[0].id;
        state.runner.architectureKnown = false;
        state.runner.pathfinder = null;
        state.battle = null;
      }
      runnerUndoStack.length = 0;
      log(`Мастер удалил сеть «${removed.name}».`);
      break;
    }
    case 'updatePathfinderReveal': {
      requireRole(role, 'gm');
      const mode = payload.mode === 'table' ? 'table' : 'result';
      const table = String(payload.table || '').trim();
      if (mode === 'table') parseRevealTable(table);
      state.session.pathfinderReveal = { mode, table };
      log(mode === 'table' ? `Мастер установил таблицу открытия этажей: ${table}.` : 'Мастер включил книжный режим: число этажей равно результату проверки.');
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
      log(`Мастер ${node.revealed ? 'открыл' : 'скрыл'} этаж ${node.floor}.`, 'system');
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
      if (node.type === 'Чёрный ЛЁД') throw new Error('У Чёрного ЛЬДА нет фиксированной СЛ проверки.');
      const dv = Math.max(0, Math.min(30, Math.floor(Number(payload.dv))));
      if (!Number.isFinite(dv)) throw new Error('Укажите числовую СЛ.');
      node.dv = dv;
      log(`Мастер изменил сложность проверки «${node.title}» на СЛ ${dv}.`);
      break;
    }
    case 'addNode': {
      requireRole(role, 'gm');
      const floor = Math.max(1, ...state.nodes.map(node => Number(node.floor) || 0)) + 1;
      const parentId = payload.parentId || state.nodes[state.nodes.length - 1]?.id || null;
      const node = { id: `n${Date.now()}`, parentId, floor, title: payload.title || 'Новый этаж', type: payload.nodeType || 'Пароль', dv: Number(payload.dv || 8), revealed: false, cleared: false, details: payload.details || '' };
      if (node.type === 'Чёрный ЛЁД') {
        node.ice = { ...icePresets[payload.iceName || 'Аспид'], name: payload.iceName || 'Аспид' };
        node.currentRez = node.ice.rez;
        node.active = true;
      }
      state.nodes.push(node);
      log(`Мастер добавил этаж ${floor}: ${node.title}.`);
      break;
    }
    case 'updateNode': {
      requireRole(role, 'gm');
      const node = findNode(payload.id);
      const previousType = node.type;
      node.title = String(payload.title || node.title).trim().slice(0, 120) || node.title;
      node.type = ['Пароль', 'Файл', 'Управляющий Узел', 'Чёрный ЛЁД'].includes(payload.nodeType) ? payload.nodeType : node.type;
      node.details = String(payload.details ?? node.details).trim().slice(0, 1000);
      node.dv = Math.max(0, Math.min(30, Number(payload.dv || 0)));
      if (node.type === 'Чёрный ЛЁД') {
        const iceName = icePresets[payload.iceName] ? payload.iceName : (node.ice?.name || 'Аспид');
        node.ice = { ...icePresets[iceName], name: iceName };
        node.currentRez = node.ice.rez;
        node.active = true;
      } else if (previousType === 'Чёрный ЛЁД') {
        delete node.ice;
        delete node.currentRez;
        delete node.active;
      }
      log(`Мастер изменил этаж ${node.floor}: ${node.title}.`);
      break;
    }
    case 'deleteNode':
      requireRole(role, 'gm');
      if (state.nodes.length <= 1) throw new Error('В Архитектуре должен остаться хотя бы один этаж.');
      if (state.runner.floorId === payload.id) throw new Error('Перед удалением этажа переместите Нетраннера.');
      state.nodes = state.nodes.filter(node => node.id !== payload.id);
      for (const node of state.nodes) if (node.parentId === payload.id) node.parentId = null;
      log('Мастер удалил этаж Архитектуры.');
      break;
    case 'reset':
      requireRole(role, 'gm');
      syncActiveNetwork();
      {
        const networks = cloneValue(state.networks);
        const activeNetworkId = state.activeNetworkId;
        state = newState();
        state.networks = networks;
        state.activeNetworkId = networks.some(network => network.id === activeNetworkId)
          ? activeNetworkId
          : networks[0].id;
        state = normalizeNetworks(state);
        state.runner.floorId = state.nodes[0].id;
      }
      runnerUndoStack.length = 0;
      log('Мастер сбросил сессию.');
      break;
    default:
      throw new Error('Неизвестное действие.');
  }
  if (runnerSnapshot) recordRunnerAction(type, payload, runnerSnapshot);
  saveAndBroadcast();
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(viewFor(url.searchParams.get('role') === 'gm' ? 'gm' : 'runner')));
  }
  if (url.pathname === '/events') {
    const role = url.searchParams.get('role') === 'gm' ? 'gm' : 'runner';
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.role = role;
    streams.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(viewFor(role))}\n\n`);
    req.on('close', () => streams.delete(res));
    return;
  }
  if (url.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { if (body.length < 100_000) body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        applyAction(data.role === 'gm' ? 'gm' : 'runner', data.type, data.payload);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }

  let filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'content-type': mime[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
      'expires': '0'
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NETRUN CONSOLE ready on http://localhost:${PORT}`);
  console.log(`GM:     http://localhost:${PORT}/?role=gm`);
  console.log(`Runner: http://localhost:${PORT}/?role=runner`);
});
