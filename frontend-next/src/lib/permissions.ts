import permissionModel from '../../../shared/permissions-model.json';

type PermissionsShape = {
  all?: boolean;
  modules?: Record<string, boolean>;
  ordersStages?: string[];
  boardStages?: string[];
};

export const MODULE_KEYS = (permissionModel.moduleKeys || []) as string[];

const DEFAULTS = (permissionModel.defaultsByRole || {}) as Record<string, PermissionsShape>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function defaultPermissionsByRole(role = 'ai_sales'): PermissionsShape {
  return clone(DEFAULTS[role] || DEFAULTS.default || { modules: {} });
}

export function normalizePermissions(role = 'ai_sales', permissions: any): PermissionsShape {
  const defaults = defaultPermissionsByRole(role);
  if (!permissions || typeof permissions !== 'object') return defaults;
  if (permissions.all) return { all: true };

  const baseModules: Record<string, boolean> = {};
  MODULE_KEYS.forEach((key) => {
    baseModules[key] = !!defaults.modules?.[key];
  });

  return {
    all: false,
    modules: { ...baseModules, ...(permissions.modules || {}) },
    ordersStages: Array.isArray(permissions.ordersStages) ? permissions.ordersStages : (defaults.ordersStages || []),
    boardStages: Array.isArray(permissions.boardStages) ? permissions.boardStages : (defaults.boardStages || []),
  };
}

export function getVisibleModuleKeys(user: { role?: string; permissions?: PermissionsShape } | null | undefined): string[] {
  if (!user) return [];
  const normalized = normalizePermissions(user.role || 'ai_sales', user.permissions);
  if (normalized.all || user.role === 'super_admin') return [...MODULE_KEYS];
  return MODULE_KEYS.filter((key) => !!normalized.modules?.[key]);
}
