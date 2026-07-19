'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/matrix.js'), 'utf8');
const requiredRoutes = [
  "router.get('/ready'",
  "router.post('/inbox/jobs/claim'",
  "router.get('/inbox/workbench'",
  "router.get('/context/search'",
  "router.get('/context/resolve'",
  "router.get('/context/records/:id'",
  "router.get('/work-items'",
  "router.get('/work-items/:id'",
  "router.post('/work-items/:id/relay-preview'"
];

for (const route of requiredRoutes) {
  assert.ok(source.includes(route), `current Matrix surface is missing ${route}`);
}

console.log('matrix relay current surface tests passed');
