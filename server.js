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

function newState() {
  return {
    revision: 1,
    session: { name: 'БАГРОВЫЙ КЛЮЧ', accessPoint: 'Подвальный ретранслятор / 6 м', connected: false, turn: 1, mode: 'НЕТРАН', pathfinderReveal: { mode: 'result', table: '1-4:1, 5-7:3, 8-9:5, 10+:7' } },
    runner: { name: 'АЛЛОЙ', interface: 4, speedBonus: 0, brainHP: 30, maxBrainHP: 30, floorId: 'n1', netActionsRemaining: 3, architectureKnown: false, pathfinder: null },
    nodes: [
      { id: 'n1', parentId: null, floor: 1, title: 'Файл', type: 'Файл', dv: 6, revealed: true, cleared: false, details: 'Ценные данные. Копирование найденного Файла не является Сетевым Действием.' },
      { id: 'n2', parentId: 'n1', floor: 2, title: 'Пароль', type: 'Пароль', dv: 8, revealed: false, cleared: false, details: 'Для преодоления требуется успешный «Бэкдор».' },
      { id: 'n3', parentId: 'n2', floor: 3, title: 'Управляющий Узел (Камеры)', type: 'Управляющий Узел', dv: 10, revealed: false, cleared: false, details: 'Управляет камерами на этом этаже.' },
      { id: 'n4', parentId: 'n3', floor: 4, title: 'Пароль', type: 'Пароль', dv: 8, revealed: false, cleared: false, details: 'Второе сетевое препятствие.' },
      { id: 'n5', parentId: 'n4', floor: 5, title: 'Аспид', type: 'Чёрный ЛЁД', dv: 0, revealed: false, cleared: false, active: true, ice: { ...icePresets['Аспид'], name: 'Аспид' }, details: icePresets['Аспид'].effect },
      { id: 'n6', parentId: 'n5', floor: 6, title: 'Управляющий Узел (Двери Безопасности)', type: 'Управляющий Узел', dv: 10, revealed: false, cleared: false, details: 'Управляет дверьми безопасности здания.' },
      { id: 'n7', parentId: 'n6', floor: 7, title: 'Адская Гончая', type: 'Чёрный ЛЁД', dv: 0, revealed: false, cleared: false, active: true, ice: { ...icePresets['Адская Гончая'], name: 'Адская Гончая' }, details: icePresets['Адская Гончая'].effect }
    ],
    programs: [
      { id: 'p1', name: 'Доспехи', class: 'Защитная', attack: 0, defense: 0, rez: 7, active: true, effect: 'Снижает урон мозгу на 4, пока активна.' },
      { id: 'p2', name: 'Меч', class: 'Атакующая', attack: 1, defense: 0, rez: 7, active: false, effect: 'Атакующая Программа против Программ.' },
      { id: 'p3', name: 'Найдёмся!', class: 'Усиление', attack: 0, defense: 0, rez: 7, active: false, effect: '+2 к проверке «Следопыт», пока активна.' }
    ],
    log: [{ id: Date.now(), at: new Date().toISOString(), kind: 'system', text: 'Архитектура подготовлена. Ожидание Нетраннера.' }]
  };
}

function loadState() {
  try {
    const defaults = newState();
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...defaults, ...saved, session: { ...defaults.session, ...saved.session }, runner: { ...defaults.runner, ...saved.runner } };
  }
  catch { return newState(); }
}

let state = loadState();
const streams = new Set();

function netActionsFor(rank) {
  if (rank >= 10) return 5;
  if (rank >= 7) return 4;
  if (rank >= 4) return 3;
  return 2;
}

function log(text, kind = 'system') {
  state.log.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), kind, text });
  state.log = state.log.slice(0, 80);
}

function saveAndBroadcast() {
  state.revision += 1;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  for (const client of streams) {
    client.write(`event: state\ndata: ${JSON.stringify(viewFor(client.role))}\n\n`);
  }
}

function viewFor(role) {
  if (role === 'gm') return { ...state, role, icePresets, totalFloors: state.nodes.length };
  return {
    ...state,
    role,
    icePresets: undefined,
    totalFloors: state.runner.architectureKnown ? state.nodes.length : null,
    nodes: state.nodes.filter(node => node.revealed || node.id === state.runner.floorId)
  };
}

function requireRole(role, expected) {
  if (role !== expected) throw new Error('Это действие доступно только Мастеру.');
}

function findNode(id) {
  const node = state.nodes.find(item => item.id === id);
  if (!node) throw new Error('Узел Архитектуры не найден.');
  return node;
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

function applyAction(role, type, payload = {}) {
  const actor = role === 'gm' ? 'Мастер' : state.runner.name;
  switch (type) {
    case 'connect':
      state.session.connected = Boolean(payload.connected);
      log(payload.connected ? `${actor} подключился к Архитектуре.` : `${actor} безопасно отключился.`, payload.connected ? 'success' : 'system');
      break;
    case 'nextTurn':
      state.session.turn += 1;
      state.runner.netActionsRemaining = netActionsFor(state.runner.interface);
      log(`Ход ${state.session.turn}. Сетевые Действия восстановлены: ${state.runner.netActionsRemaining}.`, 'turn');
      break;
    case 'spendAction':
      if (!state.session.connected) throw new Error('Подключитесь к Архитектуре перед использованием Сетевых Действий.');
      if (state.runner.netActionsRemaining < 1) throw new Error('В этом Ходу не осталось Сетевых Действий.');
      state.runner.netActionsRemaining -= 1;
      log(`${actor}: ${String(payload.label || 'Сетевое Действие')} (осталось ${state.runner.netActionsRemaining}).`, 'action');
      break;
    case 'meatAction':
      log(`${actor}: ${String(payload.label || 'Мясное Действие')} (Мясное Действие; Сетевые Действия не расходуются).`, 'action');
      break;
    case 'roll': { 
      const d10 = 1 + Math.floor(Math.random() * 10);
      const bonus = Number(payload.bonus || 0);
      const total = d10 + bonus;
      let dv = Number(payload.dv || 0);
      let backdoorTarget = null;
      if (payload.label === 'Бэкдор') {
        backdoorTarget = findNode(state.runner.floorId);
        if (backdoorTarget.type !== 'Пароль') throw new Error('«Бэкдор» можно применить только на этаже с Паролем.');
        dv = Number(backdoorTarget.dv || 0);
      }
      log(`${actor}, ${payload.label || 'проверка'}: d10 ${d10} + ${bonus} = ${total}${dv ? ` против СЛ ${dv} — ${total > dv ? 'УСПЕХ' : 'ПРОВАЛ'}` : ''}.`, total > dv && dv ? 'success' : 'roll');
      if (backdoorTarget && total > dv) {
        backdoorTarget.cleared = true;
        log(`Бэкдор: Пароль на этаже ${backdoorTarget.floor} преодолён.`, 'success');
      }
      if (payload.label === 'Первопроходец') {
        state.runner.architectureKnown = true;
        const ordered = [...state.nodes].sort((a, b) => a.floor - b.floor);
        const budget = pathfinderFloorBudget(total);
        const floorBudget = budget.floors;
        let visibleSlice = ordered.slice(0, floorBudget);
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
      const target = findNode(payload.id);
      if (role !== 'gm' && !target.revealed) throw new Error('Этот этаж ещё не обнаружен.');
      if (role !== 'gm' && target.floor > findNode(state.runner.floorId).floor) {
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
      break;
    }
    case 'toggleProgram': {
      const program = state.programs.find(item => item.id === payload.id);
      if (!program) throw new Error('Программа не найдена.');
      if (state.runner.netActionsRemaining < 1) throw new Error('Активация или деактивация Программы требует Сетевого Действия.');
      state.runner.netActionsRemaining -= 1;
      program.active = !program.active;
      log(`${actor} ${program.active ? 'активировал' : 'деактивировал'} Программу «${program.name}».`, 'action');
      break;
    }
    case 'damage':
      state.runner.brainHP = Math.max(0, Math.min(state.runner.maxBrainHP, state.runner.brainHP + Number(payload.amount || 0)));
      log(`${actor}: Здоровье мозга ${Number(payload.amount || 0) >= 0 ? '+' : ''}${Number(payload.amount || 0)} → ${state.runner.brainHP}.`, 'damage');
      break;
    case 'updateRunner':
      requireRole(role, 'gm');
      Object.assign(state.runner, payload);
      state.runner.interface = Math.max(1, Math.min(10, Number(state.runner.interface)));
      state.runner.maxBrainHP = Math.max(1, Number(state.runner.maxBrainHP));
      state.runner.brainHP = Math.max(0, Math.min(state.runner.maxBrainHP, Number(state.runner.brainHP)));
      state.runner.netActionsRemaining = Math.min(state.runner.netActionsRemaining, netActionsFor(state.runner.interface));
      log('Мастер обновил параметры Нетраннера.');
      break;
    case 'updateSession':
      requireRole(role, 'gm');
      Object.assign(state.session, payload);
      log('Мастер обновил параметры сессии.');
      break;
    case 'updatePathfinderReveal': {
      requireRole(role, 'gm');
      const mode = payload.mode === 'table' ? 'table' : 'result';
      const table = String(payload.table || '').trim();
      if (mode === 'table') parseRevealTable(table);
      state.session.pathfinderReveal = { mode, table };
      log(mode === 'table' ? `Мастер установил таблицу открытия этажей: ${table}.` : 'Мастер включил книжный режим: число этажей равно результату проверки.');
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
      const dv = Math.max(0, Math.min(30, Math.floor(Number(payload.dv))));
      if (!Number.isFinite(dv)) throw new Error('Укажите числовую СЛ.');
      node.dv = dv;
      log(`Мастер установил СЛ ${dv} для этажа ${node.floor}: ${node.title}.`);
      break;
    }
    case 'addNode': {
      requireRole(role, 'gm');
      const floor = Math.max(1, ...state.nodes.map(node => Number(node.floor) || 0)) + 1;
      const parentId = payload.parentId || state.nodes[state.nodes.length - 1]?.id || null;
      const node = { id: `n${Date.now()}`, parentId, floor, title: payload.title || 'Новый этаж', type: payload.nodeType || 'Пароль', dv: Number(payload.dv || 8), revealed: false, cleared: false, details: payload.details || '' };
      if (node.type === 'Чёрный ЛЁД') node.ice = { ...icePresets[payload.iceName || 'Аспид'], name: payload.iceName || 'Аспид' };
      state.nodes.push(node);
      log(`Мастер добавил этаж ${floor}: ${node.title}.`);
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
      state = newState();
      log('Мастер сбросил сессию.');
      break;
    default:
      throw new Error('Неизвестное действие.');
  }
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
