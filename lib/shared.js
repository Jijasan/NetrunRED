const state = {};
const streams = new Set();
const runnerUndoStack = [];

function getState() { return state; }

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

function edgeKey(a, b) {
  return [a, b].sort().join('::');
}

function makeEdge(a, b, directed = false) {
  return { from: a, to: b, ...(directed ? { directed: true } : {}) };
}

module.exports = {
  state, getState, streams, runnerUndoStack,
  cloneState, cloneValue, sameValue, revertChangedValues,
  edgeKey, makeEdge
};
