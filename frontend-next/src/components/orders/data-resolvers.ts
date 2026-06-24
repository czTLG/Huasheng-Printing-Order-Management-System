import { Order, OrderStatus } from '../../types';

export const COMPLETED_LABELS: Record<string, string> = {
  印刷: '新添加',
  复膜: '已印刷',
  制袋: '已复膜',
  发货: '已制袋',
  完成: '已发货',
};

export function getProductName(order: Order) {
  if (order.work_order_summary && typeof order.work_order_summary === 'object' && order.work_order_summary.productName) {
    return order.work_order_summary.productName;
  }
  if (order.use_case) {
    const match = order.use_case.match(/(?:品名|用途)[:：]\s*([^；;\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  if (order.legacy_data?.name) {
    return String(order.legacy_data.name).trim();
  }
  if (order.legacy_data?.old_product) {
    return String(order.legacy_data.old_product).trim();
  }
  if (order.product_name) {
    return order.product_name;
  }
  const customerName = String(order.customer_name_display || order.customer_name || '').trim();
  if (customerName && !/^备注[:：]/.test(customerName)) {
    return customerName;
  }
  return '';
}

export function getCustomerName(order: Order) {
  if (order.is_legacy_imported) {
    return order.customer_name_display || order.work_order_summary?.customerName || order.legacy_data?.old_customer || '';
  }
  return order.customer_name_display || order.work_order_summary?.customerName || order.customer_name;
}

export function getSpec(order: Order) {
  if (order.work_order_summary && typeof order.work_order_summary === 'object' && order.work_order_summary.spec) {
    return order.work_order_summary.spec;
  }
  if (order.use_case) {
    const match = order.use_case.match(/规格：([^；;]+)/);
    if (match && match[1]) return match[1].trim();
  }
  return order.order_spec || '';
}

export function getQty(order: Order) {
  if (order.work_order_summary && typeof order.work_order_summary === 'object') {
    return order.work_order_summary.quantity || order.order_qty || 0;
  }
  return order.order_qty || 0;
}

export function getRoller(order: Order) {
  if (order.work_order_summary && typeof order.work_order_summary === 'object') {
    const summaryRoller = String(order.work_order_summary.roller || '').trim();
    if (summaryRoller) return summaryRoller;
  }
  if (order.roller) {
    return String(order.roller).trim();
  }
  if (order.use_case) {
    const match = order.use_case.match(/(?:滚筒|压辊)[:：]\s*([^；;\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  if (order.legacy_data?.roller) {
    return String(order.legacy_data.roller).trim();
  }
  return '';
}

export function calculateStayDays(order: Order) {
  const startTime = new Date(order.start_time || order.created_at).getTime();
  if (Number.isNaN(startTime)) return 0;
  return Math.floor((Date.now() - startTime) / (1000 * 60 * 60 * 24));
}

export function isAbnormal(order: Order) {
  const name = getProductName(order);
  const spec = getSpec(order);
  const qty = getQty(order);
  const summary = order.work_order_summary;

  return [
    !name || name === '未定义品名',
    name?.startsWith('备注：'),
    !spec || spec === '--',
    !qty,
    order.status === '印刷' && !summary?.printMold && !order.wo_print_mold,
    order.status === '印刷' && !summary?.printFilmSize && !order.wo_print_film_size,
    order.status === '印刷' && !summary?.quantity && !order.wo_print_qty
  ].some(Boolean);
}

export function getStatusAction(status: OrderStatus) {
  switch (status) {
    case '印刷':
      return { label: '完成印刷', next: '复膜', canRollback: false };
    case '复膜':
      return { label: '完成覆膜', next: '制袋', canRollback: true, rollbackLabel: '回退印刷' };
    case '制袋':
      return { label: '完成制袋', next: '发货', canRollback: true, rollbackLabel: '回退覆膜' };
    case '发货':
      return { label: '完成发货', next: '完成', canRollback: true, rollbackLabel: '回退制袋' };
    case '完成':
      return { label: null, next: null, canRollback: true, rollbackLabel: '回退制袋' };
    default:
      return { label: null, next: null, canRollback: false };
  }
}
