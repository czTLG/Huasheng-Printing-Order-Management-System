'use strict';
const assert=require('node:assert');const fs=require('node:fs');
const route=fs.readFileSync(require.resolve('../src/routes/matrix'),'utf8');const client=fs.readFileSync(require.resolve('../.runtime/vm_debug_ci/workspace/scripts/matrix-client'),'utf8');const server=fs.readFileSync(require.resolve('../src/server'),'utf8');
for(const value of ['/thread-routes/prepare','/thread-routes/resume','/thread-routes/:id/approve','/thread-routes/:id/preview','/thread-routes/:id/send'])assert.ok(route.includes(value),`missing ${value}`);
for(const value of ['prepareThreadRoute','resumeThreadRoute','approveThreadRoute','previewThreadRoute','confirmThreadRoute'])assert.ok(client.includes(value),`missing ${value}`);
for(const value of ['createMatrixThreadRoute','createMatrixThreadPreview','createMatrixThreadDelivery'])assert.ok(server.includes(value),`missing ${value}`);
console.log('matrix thread api tests passed');
