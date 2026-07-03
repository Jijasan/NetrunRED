const { state, cloneState, cloneValue } = require('./shared');
const { programCatalog } = require('./constants');
const { log, requireRole, requireRunner } = require('./state-core');
const { findNode } = require('./graph');

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
function rollDamage(count, physicalRolls) {
  if (physicalRolls == null) return rollDice(count, 6);
  if (!Array.isArray(physicalRolls) || physicalRolls.length !== count || physicalRolls.some(value => !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 6)) {
    throw new Error(`Введите ровно ${count} результатов d6 от 1 до 6.`);
  }
  const rolls = physicalRolls.map(Number);
  return { rolls, total: rolls.reduce((sum, value) => sum + value, 0) };
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

function applyIceEffect(node, reason = 'Атака Чёрного ЛЬДА', physicalDamageRolls = null) {
  const ice = node.ice;
  if (ice.target === 'Программы') {
    const candidates = state.programs.filter(program => program.active && !program.destroyed && program.class !== 'Чёрный ЛЁД');
    if (!candidates.length) {
      log(`${reason}: у Чёрного ЛЬДА нет активной Программы-цели.`, 'success');
      return;
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const damage = rollDamage(Number(ice.damageDice || 1), physicalDamageRolls);
    target.currentRez = Math.max(0, Number(target.currentRez ?? target.rez ?? 0) - damage.total);
    log(`${reason}: ${ice.name} атакует «${target.name}» и наносит ${damage.total} урона REZ [${damage.rolls.join('+')}].`, 'damage');
    if (target.currentRez === 0) {
      target.active = false;
      target.destroyed = true;
      log(`«${target.name}» деактивирована и уничтожена Чёрным ЛЬДОМ.`, 'damage');
    }
    return;
  }
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
    const damage = rollDamage(3, physicalDamageRolls);
    applyDamage(damage.total, `${reason}: Великан [${damage.rolls.join('+')}]`);
    state.session.connected = false;
    if (state.battle) state.battle.active = false;
    state.programs.filter(program => program.class === 'Чёрный ЛЁД').forEach(program => { program.active = false; program.targetNodeId = null; });
    log('Великан выбросил Нетраннера из текущего забега.', 'damage');
    return;
  }
  if (node.ice.name === 'Адская Гончая') {
    const damage = rollDamage(2, physicalDamageRolls);
    applyDamage(damage.total, `${reason}: Адская Гончая [${damage.rolls.join('+')}]`);
    state.runner.burning = true;
    log('Кибердека и одежда загорелись: 2 урона Здоровью в конце каждого Хода до тушения Мясным Действием.', 'damage');
    return;
  }
  if (ice.name === 'Ворон') {
    const defenses = state.programs.filter(program => program.class === 'Защитная' && program.active && !program.destroyed);
    if (defenses.length) {
      const disabled = defenses[Math.floor(Math.random() * defenses.length)];
      disabled.active = false;
      log(`${reason}: Ворон деактивировал «${disabled.name}».`, 'damage');
    }
  }
  const damageDice = Number(ice.damageDice || 0);
  if (damageDice > 0) {
    const damage = rollDamage(damageDice, physicalDamageRolls);
    applyDamage(damage.total, `${reason}: ${ice.name} [${damage.rolls.join('+')}]`);
  }
  if (ice.name === 'Висп') state.runner.nextTurnActionPenalty = Math.max(1, Number(state.runner.nextTurnActionPenalty || 0));
  if (ice.name === 'Кракен') state.runner.netMovementLockedTurns = Math.max(2, Number(state.runner.netMovementLockedTurns || 0));
  if (['Лич', 'Скорпион'].includes(ice.name)) {
    const penalty = rollDice(1, 6).total;
    state.runner.statusEffects = Array.isArray(state.runner.statusEffects) ? state.runner.statusEffects : [];
    state.runner.statusEffects.push({ source: ice.name, penalty, duration: '1 час' });
    log(`${reason}: ${ice.name} накладывает штраф ${penalty} на 1 час (${ice.name === 'Лич' ? 'INT, REF и DEX' : 'MOVE'}; минимум 1).`, 'damage');
  }
}

function startIceEncounter(node, rolls = {}) {
  node.currentRez = Number.isFinite(node.currentRez) ? node.currentRez : node.ice.rez;
  const runnerDie = rollD10(rolls.runnerD10, rolls.runnerCriticalD10);
  const iceDie = rollD10(rolls.iceD10, rolls.iceCriticalD10);
  const runnerTotal = state.runner.interface + state.runner.speedBonus + runnerDie.total;
  const iceTotal = node.ice.speed + iceDie.total;
  const currentTurn = runnerTotal >= iceTotal ? 'runner' : 'ice';
  state.battle = { active: true, nodeId: node.id, round: 1, slideUsed: false, runnerInitiative: runnerTotal, iceInitiative: iceTotal, currentTurn, ambushHit: iceTotal > runnerTotal };
  log(`Встреча с «${node.title}»: Нетраннер ${state.runner.interface}+${state.runner.speedBonus}+${formatD10(runnerDie)}=${runnerTotal}; ЛЁД ${node.ice.speed}+${formatD10(iceDie)}=${iceTotal}.`, 'turn');
  if (iceTotal > runnerTotal) applyIceEffect(node, 'Засада', rolls.damageRolls);
  else log('Нетраннер выиграл встречную проверку Скорости и избежал эффекта засады.', 'success');
}

function battleInitiativeOrder() {
  if (!state.battle?.active) return [];
  const friendlyIce = state.programs
    .filter(program => program.class === 'Чёрный ЛЁД' && program.active && !program.destroyed && program.targetNodeId === state.battle.nodeId)
    .map(program => `runnerIce:${program.id}`);
  const baseOrder = state.battle.runnerInitiative >= state.battle.iceInitiative ? ['runner', 'ice'] : ['ice', 'runner'];
  return [...friendlyIce, ...baseOrder];
}

function ensureBattleTurn() {
  const order = battleInitiativeOrder();
  if (order.length && !order.includes(state.battle.currentTurn)) state.battle.currentTurn = order[0];
  return order;
}

function advanceBattleTurn() {
  const order = ensureBattleTurn();
  if (!order.length) return;
  const currentIndex = order.indexOf(state.battle.currentTurn);
  const nextIndex = (currentIndex + 1) % order.length;
  if (nextIndex === 0) state.battle.round += 1;
  state.battle.currentTurn = order[nextIndex];
  state.battle.slideUsed = false;
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

function handleBattleAction(role, payload) {
  if (!state.battle?.active) throw new Error('Сейчас нет активного боя в СЕТИ.');
  const node = findNode(state.battle.nodeId);
  ensureBattleTurn();
  if (payload.kind === 'iceAttack') {
    requireRole(role, 'gm');
    if (state.battle.currentTurn !== 'ice') throw new Error('Сейчас не Ход вражеского Чёрного ЛЬДА.');
    const iceDie = rollD10(payload.attackerD10, payload.attackerCriticalD10);
    const runnerDie = rollD10(payload.defenderD10, payload.defenderCriticalD10);
    const attack = node.ice.attack + iceDie.total;
    const defense = state.runner.interface + runnerDie.total;
    log(`Атака ЛЬДА: АТК ${node.ice.attack}+${formatD10(iceDie)}=${attack} против Интерфейса ${state.runner.interface}+${formatD10(runnerDie)}=${defense}.`, 'roll');
    if (attack > defense) applyIceEffect(node, 'Атака Чёрного ЛЬДА', payload.damageRolls);
    else log(`«${node.title}» промахнулся.`, 'success');
    if (state.battle?.active) advanceBattleTurn();
    return;
  }
  requireRunner(role);
  if (payload.kind === 'extinguish') {
    if (state.battle.currentTurn !== 'runner') throw new Error('Потушить огонь можно в Ход Нетраннера.');
    if (!state.runner.burning) throw new Error('Нетраннер не горит.');
    state.runner.burning = false;
    log('Нетраннер потратил Мясное Действие и потушил огонь.', 'success');
    return;
  }
  if (!state.session.connected) throw new Error('Нетраннер должен быть подключён к Архитектуре.');
  if (payload.kind === 'runnerIce') {
    const program = state.programs.find(item => item.id === payload.programId);
    if (!program || program.class !== 'Чёрный ЛЁД' || program.destroyed) throw new Error('Выберите загруженный Чёрный ЛЁД.');
    if (program.target !== 'Программы') throw new Error('Чёрный ЛЁД против Людей можно активировать только на вражеского Нетраннера. На этом боевом слое такой цели нет.');
    if (!program.active) {
      if (state.battle.currentTurn !== 'runner') throw new Error('Активировать Чёрный ЛЁД можно в Ход Нетраннера.');
      if (state.runner.netActionsRemaining < 1) throw new Error('Для активации Чёрного ЛЬДА требуется Сетевое Действие.');
      state.runner.netActionsRemaining -= 1;
      program.active = true;
      program.currentRez = program.rez;
      program.targetNodeId = node.id;
      program.lastAttackRound = 0;
      log(`${state.runner.name} активировал «${program.name}» на цель «${node.title}». Чёрный ЛЁД занимает вершину Очереди Инициативы.`, 'action');
    } else if (state.battle.currentTurn !== `runnerIce:${program.id}`) throw new Error(`Сейчас не Ход «${program.name}».`);
    if (program.targetNodeId !== node.id) throw new Error('Этот Чёрный ЛЁД назначен на другую цель.');
    if (program.lastAttackRound === state.battle.round) throw new Error('Этот Чёрный ЛЁД уже атаковал в текущем Раунде.');
    const attackerDie = rollD10(payload.attackerD10, payload.attackerCriticalD10);
    const defenderDie = rollD10(payload.defenderD10, payload.defenderCriticalD10);
    const attack = program.attack + attackerDie.total;
    const defense = node.ice.defense + defenderDie.total;
    program.lastAttackRound = state.battle.round;
    log(`${program.name}: АТК ${program.attack}+${formatD10(attackerDie)}=${attack} против ЗАЩ ${node.ice.defense}+${formatD10(defenderDie)}=${defense}.`, 'roll');
    if (attack > defense) {
      const damage = rollDamage(Number(program.damageDice || 4), payload.damageRolls);
      damageIce(node, damage.total, `${program.name} [${damage.rolls.join('+')}]`);
    } else log(`«${program.name}» промахнулся.`, 'damage');
    if (state.battle?.active && program.active && state.battle.currentTurn === `runnerIce:${program.id}`) advanceBattleTurn();
    return;
  }
  if (state.battle.currentTurn !== 'runner') throw new Error('Сейчас не Ход Нетраннера.');
  if (state.runner.netActionsRemaining < 1) throw new Error('В этом Ходу не осталось Сетевых Действий.');
  if (payload.kind === 'slide') {
    if (state.battle.slideUsed) throw new Error('«Ускользнуть» можно попытаться только один раз за Ход.');
    state.battle.slideUsed = true;
    state.runner.netActionsRemaining -= 1;
    const runnerDie = rollD10(payload.attackerD10, payload.attackerCriticalD10);
    const iceDie = rollD10(payload.defenderD10, payload.defenderCriticalD10);
    const skunkPenalty = node.ice.name === 'Скунс' ? 2 : 0;
    const runnerTotal = state.runner.interface + runnerDie.total - skunkPenalty;
    const iceTotal = node.ice.perception + iceDie.total;
    log(`Ускользнуть: Интерфейс ${state.runner.interface}+${formatD10(runnerDie)}${skunkPenalty ? '−2 Скунс' : ''}=${runnerTotal} против Восприятия ${node.ice.perception}+${formatD10(iceDie)}=${iceTotal}.`, 'roll');
    if (runnerTotal > iceTotal) {
      state.battle.active = false;
      state.programs.filter(program => program.class === 'Чёрный ЛЁД' && program.targetNodeId === node.id).forEach(program => {
        program.active = false;
        program.targetNodeId = null;
      });
      log(`Нетраннер ускользнул от «${node.title}». ЛЁД остаётся в засаде в этом узле.`, 'success');
    } else log('Ускользнуть не удалось.', 'damage');
    return;
  }
  if (payload.kind === 'zap') {
    state.runner.netActionsRemaining -= 1;
    const runnerDie = rollD10(payload.attackerD10, payload.attackerCriticalD10);
    const iceDie = rollD10(payload.defenderD10, payload.defenderCriticalD10);
    const attack = state.runner.interface + runnerDie.total;
    const defense = node.ice.defense + iceDie.total;
    log(`Разряд: Интерфейс ${state.runner.interface}+${formatD10(runnerDie)}=${attack} против ЗАЩ ${node.ice.defense}+${formatD10(iceDie)}=${defense}.`, 'roll');
    if (attack > defense) damageIce(node, rollDamage(1, payload.damageRolls).total, 'Разряд');
    else log('Разряд промахнулся.', 'damage');
    return;
  }
  if (payload.kind === 'program') {
    const program = state.programs.find(item => item.id === payload.programId);
    if (!program || program.destroyed || !program.active || program.class !== 'Атакующая' || program.target === 'Нетраннеры') throw new Error('Выберите активную Атакующую Программу против Программ.');
    state.runner.netActionsRemaining -= 1;
    const runnerDie = rollD10(payload.attackerD10, payload.attackerCriticalD10);
    const iceDie = rollD10(payload.defenderD10, payload.defenderCriticalD10);
    const attack = state.runner.interface + program.attack + runnerDie.total;
    const defense = node.ice.defense + iceDie.total;
    log(`${program.name}: Интерфейс ${state.runner.interface}+АТК ${program.attack}+${formatD10(runnerDie)}=${attack} против ЗАЩ ${node.ice.defense}+${formatD10(iceDie)}=${defense}.`, 'roll');
    if (attack > defense) {
      const damage = program.name === 'Меч' || program.catalogId === 'sword' ? rollDamage(3, payload.damageRolls) : rollDamage(2, payload.damageRolls);
      damageIce(node, damage.total, `${program.name} [${damage.rolls.join('+')}]`);
    } else log(`«${program.name}» промахнулся.`, 'damage');
    program.active = false;
    return;
  }
  throw new Error('Неизвестное боевое действие.');
}

module.exports = {
  rollDice, rollD10, formatD10, applyDamage, applyIceEffect,
  startIceEncounter, battleInitiativeOrder, ensureBattleTurn,
  advanceBattleTurn, damageIce, handleBattleAction
};
