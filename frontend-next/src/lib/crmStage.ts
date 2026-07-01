export const CRM_STAGE_LABELS: Record<string, string> = {
  new_unprocessed: '新线索未整理',
  organized: '已整理',
  missing_info: '待补资料',
  technical_check: '技术确认',
  costing: '核价中',
  freight_checking: '物流确认',
  ready_to_quote: '待报价',
  quoted: '已报价',
  quoted_no_reply: '已报价未回复',
  sample_discussion: '样品讨论',
  sample_sent: '样品已寄',
  negotiation: '谈判中',
  ordered: '已下单',
  paused: '暂停',
  invalid: '无效',
  lost: '流失',
};

const CRM_STAGE_ALIASES: Record<string, string> = {
  new: 'new_unprocessed',
  researching: 'organized',
  spec_checking: 'technical_check',
  qualified: 'ready_to_quote',
  sample: 'sample_discussion',
  order: 'ordered',
};

export const CRM_STAGE_OPTIONS = Object.keys(CRM_STAGE_LABELS).map((value) => ({
  value,
  label: CRM_STAGE_LABELS[value],
}));

export function normalizeCrmStage(stage: string) {
  const raw = String(stage || '').trim().toLowerCase();
  if (!raw) return 'new_unprocessed';
  if (CRM_STAGE_LABELS[raw]) return raw;
  return CRM_STAGE_ALIASES[raw] || 'new_unprocessed';
}

export function getCrmStageLabel(stage: string) {
  const normalized = normalizeCrmStage(stage);
  return CRM_STAGE_LABELS[normalized] || normalized;
}
