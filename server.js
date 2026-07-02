const http = require('http');
const fs = require('fs');
const path = require('path');

const { state } = require('./lib/shared');
const { setTopoLoom } = require('./lib/graph');
const { loadState, normalizeNetworks } = require('./lib/state-core');
const { saveAndBroadcast } = require('./lib/state-core');
const { viewFor } = require('./lib/view');
const { applyAction } = require('./lib/actions');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const TOPOLOOM_ROOT = path.join(__dirname, 'node_modules', '@khalidsaidi', 'topoloom', 'dist');

Object.assign(state, normalizeNetworks(loadState()));
state.programs = state.programs.map(program => {
  const programCatalog = require('./lib/constants').programCatalog;
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
const netActionsFor = require('./lib/state-core').netActionsFor;
state.runner.netActionsRemaining = Math.min(state.runner.netActionsRemaining, netActionsFor(state.runner.interface));
if (state.battle?.active && !state.battle.currentTurn) {
  state.battle.currentTurn = state.battle.runnerInitiative >= state.battle.iceInitiative ? 'runner' : 'ice';
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
    const streams = require('./lib/shared').streams;
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
  if (url.pathname.startsWith('/vendor/topoloom/')) {
    const relativePath = url.pathname.slice('/vendor/topoloom/'.length);
    const modulePath = path.join(TOPOLOOM_ROOT, relativePath);
    if (!modulePath.startsWith(TOPOLOOM_ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
    return fs.readFile(modulePath, (error, data) => {
      if (error) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      res.end(data);
    });
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

import('@khalidsaidi/topoloom').then(module => {
  setTopoLoom(module);
  const { assertPlanarGraph } = require('./lib/graph');
  for (const network of state.networks) assertPlanarGraph(network.nodes, network.edges);
  server.listen(PORT, HOST, () => {
    console.log(`NETRUN CONSOLE ready on http://localhost:${PORT}`);
    console.log(`GM:     http://localhost:${PORT}/?role=gm`);
    console.log(`Runner: http://localhost:${PORT}/?role=runner`);
  });
}).catch(error => {
  console.error('Failed to load planar graph engine:', error);
  process.exitCode = 1;
});
