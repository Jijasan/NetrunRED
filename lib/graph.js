const { state, edgeKey, makeEdge } = require('./shared');
let topoLoom = null;

function setTopoLoom(module) { topoLoom = module; }

function normalizeEdges(nodes, sourceEdges) {
  const ids = new Set(nodes.map(node => node.id));
  const seen = new Set();
  const edges = [];
  const add = (from, to, directed = false) => {
    if (!ids.has(from) || !ids.has(to) || from === to) return;
    const key = edgeKey(from, to);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(makeEdge(from, to, directed));
  };
  if (Array.isArray(sourceEdges)) {
    sourceEdges.forEach(edge => add(edge.from, edge.to, edge.directed === true));
  }
  if (!edges.length) {
    nodes.forEach((node, index) => {
      if (node.parentId) add(node.parentId, node.id);
      else if (index > 0) add(nodes[index - 1].id, node.id);
    });
  }
  return edges;
}

function graphNeighbors(nodeId, edges = state.edges) {
  return edges.reduce((neighbors, edge) => {
    if (edge.from === nodeId) neighbors.push(edge.to);
    if (edge.to === nodeId) neighbors.push(edge.from);
    return neighbors;
  }, []);
}

function entryNodeCandidates(nodes = state.nodes, edges = state.edges) {
  const incomingNodeIds = new Set(edges.map(edge => edge.to));
  return nodes.filter(node => !incomingNodeIds.has(node.id));
}

function recalculateEntryNode() {
  const candidates = entryNodeCandidates();
  state.entryNodeId = candidates.length === 1 ? candidates[0].id : null;
  if (candidates.length === 1) candidates[0].revealed = true;
  if (candidates.length !== 1) {
    state.session.connected = false;
    state.battle = null;
  }
  return candidates;
}

function isBlockingNode(node) {
  return !node.cleared && (node.type === 'Пароль' || (node.type === 'Программа' && node.ice));
}

function terminalNodes() {
  return state.nodes.filter(node => {
    const degree = graphNeighbors(node.id).length;
    return node.id === state.entryNodeId ? state.nodes.length === 1 : degree <= 1;
  });
}

function assertTerminalNodes() {
  const terminals = terminalNodes();
  if (!terminals.length) throw new Error('Архитектура должна содержать хотя бы один терминальный узел.');
}

function canReachNode(fromId, toId) {
  if (fromId === toId) return true;
  const revealedIds = new Set(state.nodes.filter(node => node.revealed).map(node => node.id));
  const queue = [fromId];
  const seen = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const nextId of graphNeighbors(id)) {
      if (seen.has(nextId) || !revealedIds.has(nextId)) continue;
      const next = state.nodes.find(node => node.id === nextId);
      if (!next) continue;
      if (nextId !== toId && nextId !== fromId && isBlockingNode(next)) continue;
      if (nextId === toId) return true;
      seen.add(nextId);
      queue.push(nextId);
    }
  }
  return false;
}

function setNodeEdges(nodeId, edgeIds) {
  const validIds = new Set(state.nodes.map(node => node.id));
  const requested = Array.isArray(edgeIds) ? edgeIds : [];
  const nextEdges = state.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);
  for (const otherId of requested) {
    if (!validIds.has(otherId) || otherId === nodeId) continue;
    if (!nextEdges.some(edge => edgeKey(edge.from, edge.to) === edgeKey(nodeId, otherId))) {
      nextEdges.push(makeEdge(otherId, nodeId, true));
    }
  }
  assertPlanarGraph(state.nodes, nextEdges);
  state.edges = nextEdges;
  assertTerminalNodes();
}

function assertPlanarGraph(nodes, edges) {
  if (!topoLoom || nodes.length < 5) return;
  const builder = new topoLoom.graph.GraphBuilder();
  const vertices = new Map(nodes.map(node => [node.id, builder.addVertex(node.id)]));
  for (const edge of edges) builder.addEdge(vertices.get(edge.from), vertices.get(edge.to));
  const result = topoLoom.planarity.testPlanarity(builder.build());
  if (!result.planar) throw new Error(`Эта связь сделает сеть непланарной (${result.witness.type}).`);
}

function segmentsCross(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-8 && cdA * cdB < -1e-8;
}

function assertCrossingFreePositions(nodes, edges, positions) {
  const points = new Map(positions.map(point => [point.id, point]));
  if (points.size !== nodes.length || nodes.some(node => !points.has(node.id))) throw new Error('Не заданы позиции всех узлов.');
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const first = edges[i];
      const second = edges[j];
      if ([first.from, first.to].some(id => id === second.from || id === second.to)) continue;
      if (segmentsCross(points.get(first.from), points.get(first.to), points.get(second.from), points.get(second.to))) {
        throw new Error('Позиция отклонена: рёбра пересекаются.');
      }
    }
  }
}

function placeNewNode(node, anchorId, edges) {
  const positioned = state.nodes.filter(item => item.id !== node.id && Number.isFinite(Number(item.layoutX)) && Number.isFinite(Number(item.layoutY)));
  const anchor = positioned.find(item => item.id === anchorId);
  if (!anchor || positioned.length !== state.nodes.length - 1) {
    node.layoutX = 50;
    node.layoutY = 20;
    return;
  }
  const candidateRadii = [12, 18, 24, 30, 36, 42];
  for (const radius of candidateRadii) {
    for (let step = 0; step < 16; step += 1) {
      const angle = Math.PI / 2 + step * Math.PI / 8;
      const candidate = { id: node.id, x: Math.max(10, Math.min(90, Number(anchor.layoutX) + Math.cos(angle) * radius)), y: Math.max(7, Math.min(93, Number(anchor.layoutY) + Math.sin(angle) * radius * 0.72)) };
      if (!positioned.every(item => Math.hypot(candidate.x - Number(item.layoutX), candidate.y - Number(item.layoutY)) >= 11)) continue;
      try {
        assertCrossingFreePositions(state.nodes, edges, [...positioned.map(item => ({ id: item.id, x: Number(item.layoutX), y: Number(item.layoutY) })), candidate]);
        node.layoutX = candidate.x;
        node.layoutY = candidate.y;
        return;
      } catch {}
    }
  }
  throw new Error('Не удалось найти свободную позицию для нового узла рядом со входом.');
}

function starterNodes() {
  const id = `n${Date.now()}`;
  return [{ id, parentId: null, floor: 1, title: 'Точка доступа', type: 'Пароль', dv: 6, revealed: true, cleared: false, details: 'Входной узел новой Архитектуры.' }];
}

function findNode(id) {
  const node = state.nodes.find(item => item.id === id);
  if (!node) throw new Error('Узел Архитектуры не найден.');
  return node;
}

function resetActiveNetworkDiscovery() {
  state.nodes.forEach(node => { node.revealed = false; });
  const entryNode = state.nodes.find(node => node.id === state.entryNodeId) || state.nodes[0];
  if (entryNode) entryNode.revealed = true;
  state.runner.floorId = entryNode?.id || null;
  state.runner.architectureKnown = false;
  state.runner.pathfinder = null;
  state.session.pathfinderPending = null;
  state.battle = null;
}

module.exports = {
  normalizeEdges, graphNeighbors, entryNodeCandidates, recalculateEntryNode, isBlockingNode, terminalNodes,
  assertTerminalNodes, canReachNode, setNodeEdges, assertPlanarGraph,
  segmentsCross, assertCrossingFreePositions, placeNewNode,
  starterNodes, findNode, resetActiveNetworkDiscovery, setTopoLoom
};
