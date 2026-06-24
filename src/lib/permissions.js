const model = require('../../shared/permissions-model.json');

const MODULE_KEYS = Array.isArray(model.moduleKeys) ? model.moduleKeys.slice() : [];
const DEFAULTS = model.defaultsByRole || {};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function defaultPermissionsByRole(role = 'ai_sales') {
  const key = String(role || 'default');
  const hit = DEFAULTS[key] || DEFAULTS.default || { modules: {} };
  return clone(hit);
}

function normalizePermissions(role = 'ai_sales', permissions) {
  const defaults = defaultPermissionsByRole(role);
  if (!permissions || typeof permissions !== 'object') return defaults;
  if (permissions.all) return { all: true };

  const baseModules = {};
  MODULE_KEYS.forEach((key) => {
    baseModules[key] = !!(defaults.modules && defaults.modules[key]);
  });
  const mergedModules = { ...baseModules, ...(permissions.modules || {}) };

  const uniq = (arr = []) => [...new Set(arr.filter(Boolean))];
  return {
    modules: mergedModules,
    ordersStages: uniq(Array.isArray(permissions.ordersStages) ? permissions.ordersStages : (defaults.ordersStages || [])),
    boardStages: uniq(Array.isArray(permissions.boardStages) ? permissions.boardStages : (defaults.boardStages || [])),
  };
}

module.exports = {
  MODULE_KEYS,
  defaultPermissionsByRole,
  normalizePermissions,
};
