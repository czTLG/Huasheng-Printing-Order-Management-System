import { Order, User, WorkOrder } from '../types';

const USER_STORAGE_KEY = 'newUi.user.v1';

function getToken() {
  return localStorage.getItem('token') || '';
}

function getHeaders(extra: Record<string, string> = {}) {
  const token = getToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const message = typeof data === 'object' && data ? (data.error || data.message) : String(data || `HTTP ${res.status}`);
    if (res.status === 401) {
      localStorage.removeItem(USER_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', code: 401, message } }));
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return data as T;
}

async function apiBlob(url: string, init: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      message = data?.error || data?.message || message;
    } catch {
      try {
        message = await res.text();
      } catch {}
    }
    throw new Error(message);
  }
  return res.blob();
}

function canUseCost(user?: User | null) {
  const name = String(user?.username || '');
  return user?.role === 'super_admin' || ['chenyongjie', 'gavin', 'chenrunyang'].includes(name);
}

function normalizePermissions(user: any): User['permissions'] {
  const raw = user?.permissions || {};
  const modules = { ...(raw.modules || {}) } as Record<string, boolean>;
  if (modules.workorder && !modules.workorders) modules.workorders = true;
  return {
    all: !!raw.all,
    modules,
  };
}

function saveUser(user: any): User {
  const normalized: User = {
    id: Number(user?.id || 0),
    username: String(user?.username || ''),
    full_name: String(user?.name || user?.full_name || user?.username || ''),
    role: String(user?.role || ''),
    status: 'active',
    permissions: normalizePermissions(user),
  };
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    return {
      ...user,
      permissions: normalizePermissions(user),
    };
  } catch {
    return null;
  }
}

function mapOperationLog(log: any) {
  return {
    type: String(log?.event_type || log?.type || '').toUpperCase() || 'EDIT',
    operator: String(log?.operated_by || log?.operator || log?.user_name || '系统'),
    time: String(log?.created_at || log?.time || ''),
    detail: String(log?.detail || log?.note || ''),
    source: log?.source ? String(log.source) : undefined,
    qty: log?.qty ?? undefined,
    unit: log?.unit ? String(log.unit) : undefined,
    reason: log?.reason ? String(log.reason) : undefined,
    is_rolled_back: Number(log?.rolled_back || 0) === 1 || !!log?.is_rolled_back,
  };
}

function mapOrder(row: any): Order {
  const summary = row?.work_order_summary && typeof row.work_order_summary === 'object' ? row.work_order_summary : null;
  let legacyData = row?.legacy_data && typeof row.legacy_data === 'object'
    ? row.legacy_data
    : (row?.legacy_json && typeof row.legacy_json === 'object' ? row.legacy_json : undefined);
  if (!legacyData && typeof row?.legacy_json === 'string') {
    try {
      legacyData = JSON.parse(row.legacy_json || '{}');
    } catch {
      legacyData = undefined;
    }
  }
  return {
    ...row,
    id: Number(row?.id || 0),
    work_no: String(row?.source_work_no || row?.work_no || row?.id || ''),
    customer_name: String(row?.customer_name || ''),
    customer_name_display: row?.customer_name_display ? String(row.customer_name_display) : undefined,
    product_name: row?.product_name ? String(row.product_name) : (summary?.productName ? String(summary.productName) : undefined),
    bag_type: row?.bag_type ? String(row.bag_type) : (summary?.bagType ? String(summary.bagType) : undefined),
    order_spec: String(row?.order_spec || summary?.spec || ''),
    order_qty: row?.order_qty ?? summary?.quantity ?? '',
    roller: row?.roller ? String(row.roller) : (summary?.roller ? String(summary.roller) : ''),
    delivery_date: row?.delivery_date ? String(row.delivery_date) : (summary?.deliveryDate ? String(summary.deliveryDate) : undefined),
    legacy_data: legacyData,
    work_order_summary: summary || undefined,
    operation_logs: Array.isArray(row?.operation_logs) ? row.operation_logs.map(mapOperationLog) : [],
  };
}

function mapWorkOrder(row: any): WorkOrder {
  const p = row?.process_requirements_json || row?.process_requirements || {};
  return {
    ...row,
    salesman: String(row?.salesperson_name || ''),
    order_spec: String(row?.spec || ''),
    order_qty: String(row?.quantity || ''),
    order_qty_unit: String(p?.quantityUnit || '个'),
    urgency: String(p?.urgency || '否'),
    sync_order: Number(row?.sync_to_order || 0) === 1,
    process_requirements: p,
  } as WorkOrder;
}

export const mockService = {
  async login(username: string, password: string) {
    const data = await api<{ ok: boolean; token: string; user: any }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem('token', data.token);
    return saveUser(data.user);
  },

  async loadCurrentUser() {
    const data = await api<{ ok: boolean; user: any }>('/api/auth/me');
    return saveUser(data.user);
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem(USER_STORAGE_KEY);
  },

  getUser(): User {
    const user = loadUser();
    return user || {
      id: 0,
      username: '',
      full_name: '',
      role: '',
      status: 'inactive',
      permissions: { all: false, modules: {} },
    };
  },

  canUseCost() {
    return canUseCost(loadUser());
  },

  async getOrders(): Promise<Order[]> {
    const data = await api<any>('/api/orders');
    const rows = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);
    return rows.map(mapOrder);
  },

  async getTodayStageCompletions(): Promise<Record<string, number>> {
    const data = await api<any>('/api/orders/today-stage-completions');
    return data || {};
  },

  async getOrdersPage(params: { q?: string; page?: number; pageSize?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; status?: string; updatedFrom?: string } = {}) {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    if (params.sortBy) search.set('sortBy', params.sortBy);
    if (params.sortOrder) search.set('sortOrder', params.sortOrder);
    if (params.status) search.set('status', params.status);
    if (params.updatedFrom) search.set('updatedFrom', params.updatedFrom);
    const data = await api<any>(`/api/orders?${search.toString()}`);
    return {
      rows: Array.isArray(data?.rows) ? data.rows.map(mapOrder) : [],
      total: Number(data?.total || 0),
      page: Number(data?.page || params.page || 1),
      pageSize: Number(data?.pageSize || params.pageSize || 20),
    };
  },

  async getOrderDetail(id: string | number): Promise<Order> {
    const data = await api<any>(`/api/orders/${id}/detail`);
    return mapOrder(data);
  },

  async nextProcess(id: string | number, data: any) {
    return api(`/api/orders/${id}/next`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    });
  },

  async rollbackProcess(id: string | number, reason?: string) {
    return api(`/api/orders/${id}/rollback-last-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || '' }),
    });
  },

  async updateOrderFull(id: string | number, data: Partial<Order>) {
    return api(`/api/orders/${id}/full`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    });
  },

  async updateWorkOrderFull(id: string | number, data: any) {
    return api(`/api/orders/${id}/work-order-full`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    });
  },

  async toggleSubscribe(id: string | number, subscribe: boolean) {
    if (subscribe) {
      return api(`/api/orders/${id}/subscribe`, { method: 'POST' });
    }
    return api(`/api/orders/${id}/subscribe`, { method: 'DELETE' });
  },

  async updatePriority(id: string | number, priority: number) {
    return api(`/api/orders/${id}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    });
  },

  async updateImage(id: string | number, imageUrl: string) {
    return api(`/api/orders/${id}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl }),
    });
  },

  async deleteImage(id: string | number) {
    return api(`/api/orders/${id}/image`, { method: 'DELETE' });
  },

  async deleteOrder(id: string | number) {
    return api(`/api/orders/${id}`, { method: 'DELETE' });
  },

  async getWorkOrders(params: { q?: string; page?: number; pageSize?: number } = {}) {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const data = await api<any>(`/api/work-orders?${search.toString()}`);
    return {
      rows: Array.isArray(data?.rows) ? data.rows.map(mapWorkOrder) : [],
      total: Number(data?.total || 0),
    };
  },

  async getPreviewDrafts() {
    const data = await api<any>('/api/work-orders/preview-drafts');
    return Array.isArray(data?.rows) ? data.rows : [];
  },

  async deletePreviewDraft(id: number | string) {
    return api<any>(`/api/work-orders/preview-drafts/${id}`, { method: 'DELETE' });
  },

  async getWorkOrderMeta() {
    return api<any>('/api/work-orders/meta');
  },

  async createWorkOrder(payload: any) {
    return api<any>('/api/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async previewWorkOrderPdf(payload: any) {
    return apiBlob('/api/work-orders/preview.pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async exportWorkOrder(id: number | string, format: 'pdf' | 'xls' | 'wps.xls') {
    const ext = format === 'pdf' ? 'export.pdf' : format === 'xls' ? 'export.xls' : 'export.wps.xls';
    return apiBlob(`/api/work-orders/${id}/${ext}`);
  },

  async sendWorkOrderEmail(id: number | string, to: string, cc = '') {
    return api<any>(`/api/work-orders/${id}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, cc }),
    });
  },

  async getMaterialPrices() {
    return api<any[]>('/api/cost/material-prices');
  },

  async calculateCost(costType: string, input: any, withTrace = true) {
    return api<any>('/api/cost/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ costType, input, withTrace }),
    });
  },

  async getCostSnapshots(kind: 'case' | 'history') {
    return api<any[]>(`/api/cost/snapshots?kind=${kind}`);
  },

  async saveCostSnapshot(payload: { kind: 'case' | 'history'; name?: string; costType: string; input: any; result?: any }) {
    return api<any>('/api/cost/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async deleteCostSnapshot(id: number | string) {
    return api<any>(`/api/cost/snapshots/${id}`, { method: 'DELETE' });
  },

  async exportCost(format: 'pdf' | 'xls', payload: { costType: string; input: any; result: any }) {
    return apiBlob(`/api/cost/export.${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async sendCostEmail(payload: { costType: string; input: any; result: any; to: string; cc?: string }) {
    return api<any>('/api/cost/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getCostEmailLogs() {
    return api<any>('/api/cost/email-logs');
  },

  async getBossDashboard() {
    return api('/api/orders/stats/boss-dashboard');
  },

  async getTodayStats() {
    return api('/api/auth/dashboard/today');
  },

  async getStatsDashboard() {
    return api('/api/stats/dashboard');
  },

  async getStatsTrend(days = 30) {
    return api(`/api/stats/trend?days=${days}`);
  },

  async getStatsStageFlow(days = 14) {
    return api(`/api/stats/stage-flow?days=${days}`);
  },

  async getStatsCustomerRank(limit = 5) {
    return api(`/api/stats/customer-rank?limit=${limit}`);
  },

  async getStatsBagtypeDist() {
    return api('/api/stats/bagtype-dist');
  },

  async getUsers() {
    return api('/api/auth/users');
  },

  async getAuditLogs() {
    return api<any[]>('/api/system/audit-logs');
  },

  async getPackageConfig() {
    return api<any>('/api/system/package/config');
  },

  async buildPackage() {
    return api<any>('/api/system/package/build', { method: 'POST' });
  },

  async registerUser(username: string, password: string, fullName: string) {
    return api<any>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, fullName }),
    });
  },

  async deleteUser(id: number | string) {
    return api<any>(`/api/auth/users/${id}`, { method: 'DELETE' });
  },

  async updateUserPermissions(id: number | string, data: { role?: string; permissions?: any }) {
    return api<any>(`/api/auth/users/${id}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
};
