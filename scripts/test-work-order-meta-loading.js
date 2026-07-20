'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-next/src/components/WorkOrders.tsx'),
  'utf8'
);

assert.doesNotMatch(
  source,
  /useEffect\(\(\) => \{\s*loadMeta\(\);\s*\}, \[\]\);/s,
  'list mount must not request create-form metadata'
);
assert.match(
  source,
  /const metaRequestRef = useRef<Promise<void> \| null>\(null\)/,
  'metadata loading must coalesce concurrent requests'
);
assert.match(
  source,
  /const handleCreate = \(\) => \{[\s\S]*?void loadMeta\(\);[\s\S]*?setView\('create'\)/,
  'create intent must trigger metadata loading without blocking the screen'
);

console.log('work-order metadata loading regression passed');
