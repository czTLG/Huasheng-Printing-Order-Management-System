import React from 'react';
import { HelpCircle } from 'lucide-react';

const TERMS: Record<string, { zh: string; caution?: string }> = {
  EXW: { zh: '工厂交货价，不含主运费、清关和目的地费用。' },
  FOB: { zh: '装运港船上交货，卖方负责装船前费用。' },
  CIF: { zh: '成本加保险加运费，通常到目的港。' },
  CFR: { zh: '成本加运费，不含保险。' },
  DDP: { zh: '完税后交货，卖方承担较多目的地责任。', caution: '实际费用以货代、清关行或当地海关最终确认为准。' },
  DDU: { zh: '未完税交货，税费通常由买方承担。', caution: '实际费用以货代、清关行或当地海关最终确认为准。' },
  FCA: { zh: '货交承运人，适合多种运输方式。' },
  LCL: { zh: '拼箱运输，按体积或重量分摊。' },
  FCL: { zh: '整箱运输，适合货量较大。' },
  '20GP': { zh: '20 尺普柜。' },
  '40HQ': { zh: '40 尺高柜。' },
  THC: { zh: '码头操作费。', caution: '实际费用以货代、清关行或当地海关最终确认为准。' },
  'DOC Fee': { zh: '单证处理费。' },
  'Destination Charge': { zh: '目的港本地费用。', caution: '实际费用以货代、清关行或当地海关最终确认为准。' },
  'Customs Clearance': { zh: '报关清关费用。', caution: '实际费用以货代、清关行或当地海关最终确认为准。' },
  Duty: { zh: '进口关税。', caution: '实际费用以货代、清关行或当地海关最终确认为准。' },
  GST: { zh: '商品与服务税。', caution: '实际费用以当地税务规则为准。' },
  VAT: { zh: '增值税。', caution: '实际费用以当地税务规则为准。' },
  'Sales Tax': { zh: '销售税。', caution: '实际费用以当地税务规则为准。' },
  'HS Code': { zh: '海关商品编码，用于税则和清关归类。' },
  MOQ: { zh: '最小起订量。' },
  'Lead Time': { zh: '交期，从确认到可发货的周期。' },
  'Payment Terms': { zh: '付款条款。' },
  Deposit: { zh: '定金。' },
  'Balance Before Shipment': { zh: '出货前付清尾款。' },
  'Quote Validity': { zh: '报价有效期。' },
  'Unit Price': { zh: '单价。' },
  'Total Amount': { zh: '总金额。' },
  PET: { zh: '聚酯薄膜，常作外层印刷层。' },
  BOPP: { zh: '双向拉伸聚丙烯薄膜。' },
  CPP: { zh: '流延聚丙烯，常作内层热封。' },
  PE: { zh: '聚乙烯，常作热封层。' },
  VMPET: { zh: '镀铝聚酯，提供阻隔和遮光。' },
  AL: { zh: '铝箔，高阻隔材料。' },
  RCPP: { zh: '蒸煮级 CPP。' },
  PA: { zh: '尼龙，耐穿刺性较好。' },
  Micron: { zh: '微米，薄膜厚度单位。' },
  'C / 丝': { zh: '国内常用厚度单位，需和微米换算确认。' },
  'Gravure Printing': { zh: '凹版印刷。' },
  Lamination: { zh: '复合，将多层材料粘合。' },
  'Roll Film': { zh: '卷膜，用于自动包装机。' },
  Pouch: { zh: '袋型成品包装。' },
};

export default function CrmTermTooltip({ term }: { term: string }) {
  const item = TERMS[term];
  if (!item) return null;
  return (
    <span className="group relative inline-flex items-center align-middle">
      <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
      <span className="pointer-events-none absolute left-1/2 top-full z-20 hidden w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-lg group-hover:block">
        <span className="block font-bold text-slate-900 mb-1">{term}</span>
        <span className="block">{item.zh}</span>
        {item.caution ? <span className="block mt-2 text-amber-700">{item.caution}</span> : null}
      </span>
    </span>
  );
}
