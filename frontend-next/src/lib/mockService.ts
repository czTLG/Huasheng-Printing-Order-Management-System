import { Order, User, WorkOrder } from '../types';
import { normalizePermissions as normalizePermissionModel } from './permissions';

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
  if (url.startsWith('/api/') && !isJson) {
    const preview = String(data || '').replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`API ${url} returned non-JSON response (${res.status} ${contentType || 'unknown content-type'}): ${preview}`);
  }
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
  const normalized = normalizePermissionModel(String(user?.role || 'ai_sales'), user?.permissions || {});
  return {
    all: !!normalized.all,
    modules: { ...(normalized.modules || {}) },
    ordersStages: Array.isArray(normalized.ordersStages) ? normalized.ordersStages : [],
    boardStages: Array.isArray(normalized.boardStages) ? normalized.boardStages : [],
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
  const operator = String(log?.operated_by || log?.operator || log?.user_name || '系统').trim() || '系统';
  return {
    type: String(log?.event_type || log?.type || '').toUpperCase() || 'EDIT',
    operator,
    operator_name: operator,
    operated_by: operator,
    time: String(log?.created_at || log?.time || ''),
    detail: String(log?.detail || log?.note || ''),
    source: log?.source ? String(log.source) : undefined,
    qty: log?.qty ?? undefined,
    unit: log?.unit ? String(log.unit) : undefined,
    reason: log?.reason ? String(log.reason) : undefined,
    is_rolled_back: Number(log?.rolled_back || 0) === 1 || !!log?.is_rolled_back,
  };
}

function mapAuditLog(log: any) {
  const username = String(log?.username || log?.user_name || log?.user || log?.operated_by || '').trim();
  const role = String(log?.role || '').trim();
  return {
    ...log,
    id: Number(log?.id || 0),
    username: username || role || '系统',
    user: username || role || '系统',
    detail: String(log?.detail || log?.description || ''),
    action: String(log?.action || log?.event_type || ''),
    ip: String(log?.ip || log?.ip_address || ''),
    created_at: String(log?.created_at || ''),
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

  async getBoardPanel(): Promise<{ rows: Order[]; summary: Array<{ status: string; total: number; urgent: number }>; cachedSeconds: number }> {
    const data = await api<any>('/api/orders/board/panel');
    const rows = Array.isArray(data?.rows) ? data.rows.map(mapOrder) : [];
    const summary = Array.isArray(data?.summary) ? data.summary.map((item: any) => ({
      status: String(item?.status || ''),
      total: Number(item?.total || 0),
      urgent: Number(item?.urgent || 0),
    })) : [];
    return {
      rows,
      summary,
      cachedSeconds: Number(data?.cachedSeconds || 0),
    };
  },

  async getBoardSummary(): Promise<Array<{ status: string; total: number; urgent: number }>> {
    const data = await api<any>('/api/orders/board/summary');
    return Array.isArray(data) ? data.map((item: any) => ({
      status: String(item?.status || ''),
      total: Number(item?.total || 0),
      urgent: Number(item?.urgent || 0),
    })) : [];
  },

  async getTodayStageCompletions(): Promise<Record<string, number>> {
    const data = await api<any>('/api/orders/today-stage-completions');
    return data || {};
  },

  async getOrderSummary(params: { q?: string; status?: string; updatedFrom?: string; roller?: string; urgentOnly?: boolean; stayMinDays?: number; abnormal?: boolean } = {}) {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.status) search.set('status', params.status);
    if (params.updatedFrom) search.set('updatedFrom', params.updatedFrom);
    if (params.roller) search.set('roller', params.roller);
    if (params.urgentOnly) search.set('urgentOnly', 'true');
    if (params.stayMinDays) search.set('stayMinDays', String(params.stayMinDays));
    if (params.abnormal) search.set('abnormal', 'true');
    const data = await api<any>(`/api/orders/summary?${search.toString()}`);
    return {
      total: Number(data?.total || 0),
      urgentCount: Number(data?.urgentCount || 0),
      avgStayDays: Number(data?.avgStayDays || 0),
      stageCounts: data?.stageCounts || {},
    };
  },

  async getOrdersPage(params: { q?: string; page?: number; pageSize?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; status?: string; updatedFrom?: string; roller?: string; urgentOnly?: boolean; stayMinDays?: number; abnormal?: boolean } = {}) {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    if (params.sortBy) search.set('sortBy', params.sortBy);
    if (params.sortOrder) search.set('sortOrder', params.sortOrder);
    if (params.status) search.set('status', params.status);
    if (params.updatedFrom) search.set('updatedFrom', params.updatedFrom);
    if (params.roller) search.set('roller', params.roller);
    if (params.urgentOnly) search.set('urgentOnly', 'true');
    if (params.stayMinDays) search.set('stayMinDays', String(params.stayMinDays));
    if (params.abnormal) search.set('abnormal', 'true');
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

  async searchWorkOrderProducts(q: string, mode: 'all' | 'any' = 'all') {
    return api<any>(`/api/work-orders/product-search?q=${encodeURIComponent(q)}&mode=${mode}`);
  },

  async addMaterialOption(name: string) {
    return api<any>('/api/work-orders/material-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  async deleteMaterialOption(name: string) {
    return api<any>('/api/work-orders/material-options/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  async createWorkOrderCustomer(data: { salespersonId: number; customerName: string; productName?: string }) {
    return api<any>('/api/work-orders/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async renameWorkOrderCustomer(id: number, name: string) {
    return api<any>(`/api/work-orders/customers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  async previewWorkOrderExcel(id: number | string) {
    return apiBlob(`/api/work-orders/${id}/preview.xls`);
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

  async renameCostSnapshot(id: number | string, name: string) {
    return api<any>(`/api/cost/snapshots/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
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

  async parseForeignCosting(text: string) {
    return api<any>('/api/foreign-costing-assistant/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  },

  async createForeignCostingDraft(payload: any) {
    return api<any>('/api/foreign-costing-assistant/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async saveForeignCostingReview(payload: any) {
    return api<any>('/api/foreign-costing-assistant/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async getCrmDashboard() {
    const ret = await api<any>('/api/crm/dashboard');
    if (!ret || typeof ret !== 'object' || !ret.summary || !Array.isArray(ret.today_tasks)) {
      throw new Error('CRM dashboard API returned an invalid response shape.');
    }
    return ret;
  },

  async listCrmCustomers(params: { q?: string; sortBy?: string; sortDirection?: string } = {}) {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.sortBy) search.set('sortBy', params.sortBy);
    if (params.sortDirection) search.set('sortDirection', params.sortDirection);
    return api<any>(`/api/crm/customers?${search.toString()}`);
  },

  async createCrmCustomer(payload: any) {
    return api<any>('/api/crm/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getCrmCustomer(id: number | string) {
    return api<any>(`/api/crm/customers/${id}`);
  },

  async getCrmWorkbench() {
    return api<any>('/api/crm/workbench');
  },

  async getFatherReviewTasks(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/father-review-tasks?${search.toString()}`);
  },

  async getFatherReviewTask(id: number | string) {
    return api<any>(`/api/crm/father-review-tasks/${id}`);
  },

  async replyFatherReviewTask(id: number | string, payload: any) {
    return api<any>(`/api/crm/father-review-tasks/${id}/reply`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async markFatherTaskSalesHandled(id: number | string, payload: any = {}) {
    return api<any>(`/api/crm/father-review-tasks/${id}/sales-handled`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async generateReplyDraftFromFatherTask(id: number | string, payload: any = {}) {
    return api<any>(`/api/crm/father-review-tasks/${id}/generate-reply-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async generateReplyDraftFromMessage(id: number | string, payload: any = {}) {
    return api<any>(`/api/crm/messages/${id}/generate-reply-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async generateReplyDraftFromInquiry(id: number | string, payload: any = {}) {
    return api<any>(`/api/crm/inquiries/${id}/generate-reply-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async listCrmReplyDrafts(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/reply-drafts?${search.toString()}`);
  },

  async getCrmReplyDraft(id: number | string) {
    return api<any>(`/api/crm/reply-drafts/${id}`);
  },

  async updateCrmReplyDraft(id: number | string, payload: any) {
    return api<any>(`/api/crm/reply-drafts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async approveCrmReplyDraft(id: number | string) {
    return api<any>(`/api/crm/reply-drafts/${id}/approve`, { method: 'PATCH' });
  },

  async markCrmReplyDraftSentManually(id: number | string) {
    return api<any>(`/api/crm/reply-drafts/${id}/mark-sent-manually`, { method: 'PATCH' });
  },

  async listCrmWhatsappMessages(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/messages?${search.toString()}`);
  },

  async getCrmWhatsappMessage(id: number | string) {
    return api<any>(`/api/crm/messages/${id}`);
  },

  async parseCrmMessage(id: number | string) {
    return api<any>(`/api/crm/messages/${id}/ai-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },

  async updateInquiryFromCrmMessage(id: number | string, interpretationId: number | string) {
    return api<any>(`/api/crm/messages/${id}/update-inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interpretation_id: interpretationId }),
    });
  },

  async createFatherTaskFromCrmMessage(id: number | string, payload: any = {}) {
    return api<any>(`/api/crm/messages/${id}/father-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async updateCrmCustomer(id: number | string, payload: any) {
    return api<any>(`/api/crm/customers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCustomerCommunications(id: number | string) {
    return api<any>(`/api/crm/customers/${id}/communications`);
  },

  async createCustomerCommunication(id: number | string, payload: any) {
    return api<any>(`/api/crm/customers/${id}/communications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCustomerResearchNotes(id: number | string) {
    return api<any>(`/api/crm/customers/${id}/research-notes`);
  },

  async createCustomerResearchNote(id: number | string, payload: any) {
    return api<any>(`/api/crm/customers/${id}/research-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async updateCustomerResearchNote(customerId: number | string, noteId: number | string, payload: any) {
    return api<any>(`/api/crm/customers/${customerId}/research-notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getCustomerPriority(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/customer-priority?${search.toString()}`);
  },

  async syncCrmEmail(payload: any) {
    return api<any>('/api/crm/email/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCrmEmailSyncRuns() {
    return api<any>('/api/crm/email/sync-runs');
  },

  async getCrmEmailConfigStatus() {
    return api<any>('/api/crm/email/config-status');
  },

  async listCrmEmailMessages(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/email/messages?${search.toString()}`);
  },

  async getCrmEmailMessage(id: number | string) {
    return api<any>(`/api/crm/email/messages/${id}`);
  },

  async getCrmEmailThread(id: number | string) {
    return api<any>(`/api/crm/email/messages/${id}/thread`);
  },

  async parseCrmEmailMessage(id: number | string) {
    return api<any>(`/api/crm/email/messages/${id}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },

  async importCrmEmailMessageToCrm(id: number | string) {
    return api<any>(`/api/crm/email/messages/${id}/import-to-crm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },

  async batchImportCrmEmailMessagesToCrm(payload: any) {
    return api<any>('/api/crm/email/import-to-crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },

  async parseUnprocessedCrmEmails(limit = 50) {
    return api<any>('/api/crm/email/parse-unprocessed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    });
  },

  async listCrmImportSuggestions(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/import-suggestions?${search.toString()}`);
  },

  async getCrmImportSuggestion(id: number | string) {
    return api<any>(`/api/crm/import-suggestions/${id}`);
  },

  async getCrmImportSuggestionPreview(id: number | string) {
    return api<any>(`/api/crm/import-suggestions/${id}/preview`);
  },

  async applyCrmImportSuggestion(id: number | string, payload: any) {
    return api<any>(`/api/crm/import-suggestions/${id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCrmQuoteSuggestions() {
    return api<any>('/api/crm/email/quote-suggestions');
  },

  async updateCrmImportSuggestion(id: number | string, payload: any) {
    return api<any>(`/api/crm/import-suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCrmInquiries(params: { q?: string; status?: string; priority?: string } = {}) {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.status) search.set('status', params.status);
    if (params.priority) search.set('priority', params.priority);
    return api<any>(`/api/crm/inquiries?${search.toString()}`);
  },

  async createCrmInquiry(payload: any) {
    return api<any>('/api/crm/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getCrmInquiry(id: number | string) {
    return api<any>(`/api/crm/inquiries/${id}`);
  },

  async listCrmInquiryFatherTasks(id: number | string) {
    return api<any>(`/api/crm/inquiries/${id}/father-tasks`);
  },

  async createCrmInquiryFatherTask(id: number | string, payload: any = {}) {
    return api<any>(`/api/crm/inquiries/${id}/father-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async saveCrmFatherTaskReply(id: number | string, fatherReplyCn: string) {
    return api<any>(`/api/crm/father-review-tasks/${id}/reply`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ father_reply_cn: fatherReplyCn }),
    });
  },

  async listCrmInquiryCostingDrafts(id: number | string) {
    return api<any>(`/api/crm/inquiries/${id}/costing-drafts`);
  },

  async getCrmInquiryQuoteReadiness(id: number | string) {
    return api<any>(`/api/crm/inquiries/${id}/quote-readiness`);
  },

  async recalculateCrmInquiryQuoteReadiness(id: number | string) {
    return api<any>(`/api/crm/inquiries/${id}/recalculate-quote-readiness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },

  async listCustomerImportSuggestions(customerId: number | string) {
    return api<any>(`/api/crm/customers/${customerId}/import-suggestions`);
  },

  async listCustomerEmailConversations(customerId: number | string) {
    return api<any>(`/api/crm/customers/${customerId}/email-conversations`);
  },

  async updateCrmInquiry(id: number | string, payload: any) {
    return api<any>(`/api/crm/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listInquirySpecifications(id: number | string) {
    return api<any>(`/api/crm/inquiries/${id}/specifications`);
  },

  async createInquirySpecification(id: number | string, payload: any) {
    return api<any>(`/api/crm/inquiries/${id}/specifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getSpecification(id: number | string) {
    return api<any>(`/api/crm/specifications/${id}`);
  },

  async createSpecificationLayer(id: number | string, payload: any) {
    return api<any>(`/api/crm/specifications/${id}/layers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCrmAuditLogs(params: { resourceType?: string; action?: string; user?: string } = {}) {
    const search = new URLSearchParams();
    if (params.resourceType) search.set('resourceType', params.resourceType);
    if (params.action) search.set('action', params.action);
    if (params.user) search.set('user', params.user);
    return api<any>(`/api/crm/audit-logs?${search.toString()}`);
  },

  async createCostingRequest(inquiryId: number | string, payload: any) {
    return api<any>(`/api/crm/inquiries/${inquiryId}/costing-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listCostingRequests(params: { q?: string; status?: string; urgency?: string; assigned_to?: string; customer_id?: string | number; inquiry_id?: string | number } = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/costing-requests?${search.toString()}`);
  },

  async getCostingRequest(id: number | string) {
    return api<any>(`/api/crm/costing-requests/${id}`);
  },

  async updateCostingRequest(id: number | string, payload: any) {
    return api<any>(`/api/crm/costing-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getCostingPrefill(inquiryId: number | string) {
    return api<any>(`/api/crm/inquiries/${inquiryId}/costing-prefill`);
  },

  async createFreightQuote(inquiryId: number | string, payload: any) {
    return api<any>(`/api/crm/inquiries/${inquiryId}/freight-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listFreightQuotes(params: Record<string, any> = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value));
    });
    return api<any>(`/api/crm/freight-quotes?${search.toString()}`);
  },

  async getFreightQuote(id: number | string) {
    return api<any>(`/api/crm/freight-quotes/${id}`);
  },

  async updateFreightQuote(id: number | string, payload: any) {
    return api<any>(`/api/crm/freight-quotes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async listInquiryFreightQuotes(inquiryId: number | string) {
    return api<any>(`/api/crm/inquiries/${inquiryId}/freight-quotes`);
  },

  async getFreightPrefill(inquiryId: number | string) {
    return api<any>(`/api/crm/inquiries/${inquiryId}/freight-prefill`);
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
    const data = await api<any[]>('/api/system/audit-logs');
    return Array.isArray(data) ? data.map(mapAuditLog) : [];
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
