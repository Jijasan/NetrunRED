const { state, runnerUndoStack } = require('./shared');
const { networkSummaries, usedDeckSlots } = require('./state-core');
const { terminalNodes, entryNodeCandidates } = require('./graph');
const { programCatalog, icePresets } = require('./constants');

function viewFor(role) {
  const entryCandidates = entryNodeCandidates();
  const topologyWarning = entryCandidates.length === 1 ? null : `Network has ${entryCandidates.length} nodes without incoming edges. Exactly one entry is required.`;
  if (role === 'gm') return { ...state, networks: networkSummaries(), role, icePresets, programCatalog, deckSlotsUsed: usedDeckSlots(), totalFloors: state.nodes.length, terminalNodeIds: terminalNodes().map(node => node.id), canUndoRunnerAction: runnerUndoStack.length > 0, topologyWarning };
  const activeVisible = state.scan.visibleNetworkIds.includes(state.activeNetworkId);
  const activeEntered = state.scan.enteredNetworkIds.includes(state.activeNetworkId);
  const visibleNodeIds = new Set(activeVisible && activeEntered ? state.nodes.filter(node => node.revealed || node.id === state.runner.floorId).map(node => node.id) : []);
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
    programCatalog: undefined,
    deckSlotsUsed: usedDeckSlots(),
    topologyWarning,
    totalFloors: activeVisible && activeEntered && state.runner.architectureKnown ? state.nodes.length : null,
    terminalNodeIds: activeVisible && activeEntered ? terminalNodes().map(node => node.id).filter(id => visibleNodeIds.has(id)) : [],
    nodes: activeVisible && activeEntered ? state.nodes.filter(node => visibleNodeIds.has(node.id)) : [],
    edges: activeVisible && activeEntered ? state.edges.filter(edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)) : [],
    battle: activeVisible ? state.battle : null
  };
}

module.exports = { viewFor };
