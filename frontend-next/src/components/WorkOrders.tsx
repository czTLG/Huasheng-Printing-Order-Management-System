import React, { useState, useEffect } from 'react';
import { 
  Building2, Printer, Layers, ClipboardList, Box, Search, ChevronLeft, 
  Plus, UploadCloud, AlertCircle, History, Save, FileText, CheckCircle2,
  Trash2, FileDown, Settings, RefreshCw, ExternalLink, Copy, Mail, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';
import { WorkOrder, WorkOrderDraft } from '../types';

const INITIAL_MATERIALS = ['PET', 'PE', 'AL', 'NY', 'CPP', 'BOPP', 'VMPET'];
const INK_OPTIONS = ['里印', '水煮', '蒸煮', '哑油', '表印'];
const HOLE_OPTIONS = ['圆孔', '飞机孔', '手提孔'];
const EDGE_OPTIONS = ['上封', '边封', '下封'];

const DEFAULT_FORM = {
  // Toolbar
  work_no: '',
  salesman: '',
  created_at: new Date().toISOString(),
  sync_order: true,
  draft_status: '未保存',

  // Customer & History
  customer_keyword: '',
  customer_id: '',
  customer_name: '',
  customer_contact: '',
  customer_phone: '',
  customer_email: '',
  history_product_keyword: '',
  history_product_id: '',
  history_fill_mode: '覆盖空字段' as '覆盖空字段' | '全部覆盖',

  // Basic Order Info
  product_name: '',
  product_alias: '',
  bag_type: '',
  order_spec: '',
  order_qty: '',
  order_qty_unit: '个',
  delivery_date: '',
  urgency: '否' as '是' | '否',
  use_case: '',
  order_note: '',

  // Printing Info
  roller: '',
  print_mold: '',
  print_film_size: '',
  print_film_thickness: '',
  print_film_qty: '',
  print_film_unit: 'kg',
  print_qty: '',
  color_count: '',
  ref_color: '',
  ink_requirement: '',
  print_process_note: '',
  print_special_note: '',

  // Lamination Info
  film_type: '普通',
  film_note: '',
  film_ink_requirement: '',
  layer1: { enabled: true, role: '印刷膜', mat: '', size: '', thickness: '', weight: '', unit: 'kg' },
  layer2: { enabled: true, role: '覆膜第一层', mat: '', size: '', thickness: '', weight: '', unit: 'kg' },
  layer3: { enabled: false, role: '覆膜第二层', mat: '', size: '', thickness: '', weight: '', unit: 'kg' },
  layer4: { enabled: false, role: '覆膜第三层', mat: '', size: '', thickness: '', weight: '', unit: 'kg' },

  // Bagging & Delivery
  bag_spec: '',
  bag_edge_type: '',
  zipper_type: '',
  zipper_pos: '',
  tear_type: '',
  hole_type: '',
  hole_count: '',
  outsource_bagging: '否' as '是' | '否',
  outsource_vendor: '',
  delivery_method: '',
  actual_delivery_qty: '',
  other_req: '',

  // Packing & Mail
  pack_type: '',
  box_spec: '',
  box_qty: '',
  mail_to: '',
  mail_cc: '',
  mail_subject: '',
  mail_remark: '',

  // Notes & Attachments
  attachment_list: [] as any[],
  internal_note: '',
  customer_note: '',
  
  // legacy or internal field for date management
  wo_date: new Date().toISOString().split('T')[0],
};

export default function WorkOrders() {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [materials, setMaterials] = useState<string[]>(INITIAL_MATERIALS);
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [historyProducts, setHistoryProducts] = useState<string[]>([]);
  const [metaLoaded, setMetaLoaded] = useState(false);
  
  // List View States
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [totalWorkOrders, setTotalWorkOrders] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [woSearch, setWoSearch] = useState('');
  
  // Drafts & Previews
  const [previewDrafts, setPreviewDrafts] = useState<WorkOrderDraft[]>([]);
  const [showEmailModal, setShowEmailModal] = useState<number | null>(null);

  const currentUser = mockService.getUser();

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    fetchWorkOrders();
    fetchDrafts();
  }, [page, pageSize, woSearch]);

  useEffect(() => {
    const selectedSalesperson = salespersons.find(sp => sp.name === formData.salesman);
    const nextCustomers = Array.isArray(selectedSalesperson?.customers) ? selectedSalesperson.customers : [];
    setCustomers(nextCustomers);

    const exactCustomer = nextCustomers.find((item: any) => item.name === formData.customer_name);
    if (exactCustomer) {
      setFormData(prev => ({
        ...prev,
        bag_type: prev.bag_type || exactCustomer.default_bag_type || '',
        order_spec: prev.order_spec || exactCustomer.default_spec || '',
        use_case: prev.use_case || exactCustomer.default_use_case || '',
        roller: prev.roller || exactCustomer.default_roller || '',
      }));
    }

    const nextHistoryProducts = workOrders
      .filter(row => (!formData.salesman || row.salesperson_name === formData.salesman) && (!formData.customer_name || row.customer_name === formData.customer_name))
      .map(row => row.product_name)
      .filter(Boolean);
    setHistoryProducts([...new Set(nextHistoryProducts)].slice(0, 100));
  }, [formData.salesman, formData.customer_name, salespersons, workOrders]);

  const loadMeta = async () => {
    try {
      const meta = await mockService.getWorkOrderMeta();
      const nextSalespersons = Array.isArray(meta?.salespersons) && meta.salespersons.length
        ? meta.salespersons
        : [{ id: 0, name: currentUser.username || '' }];
      setSalespersons(nextSalespersons);
      const nextMaterials = Array.isArray(meta?.materialOptions?.names) && meta.materialOptions.names.length
        ? meta.materialOptions.names
        : INITIAL_MATERIALS;
      setMaterials(nextMaterials);
      if (meta?.lastEmailTo && !formData.mail_to) {
        setFormData(prev => ({ ...prev, mail_to: String(meta.lastEmailTo || '') }));
      }
      setMetaLoaded(true);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: `加载开单元数据失败：${err?.message || '未知错误'}` } }));
    }
  };

  const fetchWorkOrders = async () => {
    const { rows, total } = await mockService.getWorkOrders({ q: woSearch, page, pageSize });
    setWorkOrders(rows);
    setTotalWorkOrders(total);
  };

  const fetchDrafts = async () => {
    setPreviewDrafts(await mockService.getPreviewDrafts());
  };

  const handleCreate = () => {
    setFormData(DEFAULT_FORM);
    setErrors([]);
    setView('create');
  };

  const handleBack = () => {
    setView('list');
  };

  const validateForm = () => {
    const newErrs: string[] = [];
    if (!formData.salesman) newErrs.push('业务员');
    if (!formData.customer_name) newErrs.push('客户名称');
    if (!formData.product_name) newErrs.push('品名');
    if (!formData.bag_type) newErrs.push('袋型');
    if (!formData.order_spec) newErrs.push('成品规格');
    if (!formData.order_qty) newErrs.push('订单数量');
    if (!formData.delivery_date) newErrs.push('交货日期');
    
    // Process requirements - conditional validation
    if (formData.roller === '') {
       // if printing工序 exists (which is usually implied)
    }

    setErrors(newErrs);
    return newErrs.length === 0;
  };

  const saveToLocalDraft = () => {
    localStorage.setItem(`wo_draft_${currentUser.username}`, JSON.stringify(formData));
    setFormData(prev => ({ ...prev, draft_status: `已保存 (${new Date().toLocaleTimeString()})` }));
    window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '草稿已保存到本地。' } }));
  };

  const restoreFromLocalDraft = () => {
    const draft = localStorage.getItem(`wo_draft_${currentUser.username}`);
    if (draft) {
      setFormData(JSON.parse(draft));
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '已恢复本地草稿。' } }));
    } else {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '未找到可恢复的草稿。' } }));
    }
  };

  const handleClearForm = () => {
    if (confirm('确认清空当前表单？')) {
      setFormData(DEFAULT_FORM);
      setErrors([]);
    }
  };

  const buildPayload = () => {
    const salesperson = salespersons.find(sp => sp.name === formData.salesman);
    const customer = customers.find((item: any) => item.name === formData.customer_name);
    const processRequirements = {
      date: formData.wo_date,
      customerName: formData.customer_name,
      customerContact: formData.customer_contact,
      customerPhone: formData.customer_phone,
      customerEmail: formData.customer_email,
      productName: formData.product_name,
      productAlias: formData.product_alias,
      bagType: formData.bag_type,
      spec: formData.order_spec,
      quantity: formData.order_qty,
      quantityUnit: formData.order_qty_unit,
      deliveryDate: formData.delivery_date,
      urgency: formData.urgency,
      useCase: formData.use_case,
      orderNote: formData.order_note,
      roller: formData.roller,
      printMold: formData.print_mold,
      printFilmSize: formData.print_film_size,
      printFilmThickness: formData.print_film_thickness,
      printFilmQty: formData.print_film_qty,
      printFilmUnit: formData.print_film_unit,
      printQty: formData.print_qty,
      colorCount: formData.color_count,
      refColor: formData.ref_color,
      inkRequirement: formData.ink_requirement,
      printProcessNote: formData.print_process_note,
      printSpecialNote: formData.print_special_note,
      filmType: formData.film_type,
      filmNote: formData.film_note,
      filmInkRequirement: formData.film_ink_requirement,
      layer1: formData.layer1.mat,
      l1Size: formData.layer1.size,
      l1Weight: formData.layer1.weight,
      layer2: formData.layer2.mat,
      l2Size: formData.layer2.size,
      l2Weight: formData.layer2.weight,
      layer3: formData.layer3.enabled ? formData.layer3.mat : '',
      l3Size: formData.layer3.enabled ? formData.layer3.size : '',
      l3Weight: formData.layer3.enabled ? formData.layer3.weight : '',
      layer4: formData.layer4.enabled ? formData.layer4.mat : '',
      l4Size: formData.layer4.enabled ? formData.layer4.size : '',
      l4Weight: formData.layer4.enabled ? formData.layer4.weight : '',
      bagSpec: formData.bag_spec,
      bagEdgeType: formData.bag_edge_type,
      zipperType: formData.zipper_type,
      zipperPos: formData.zipper_pos,
      tearType: formData.tear_type,
      holeType: formData.hole_type,
      holeCount: formData.hole_count,
      outsource: formData.outsource_bagging,
      outsourceVendor: formData.outsource_vendor,
      deliveryMethod: formData.delivery_method,
      actualDeliveryQty: formData.actual_delivery_qty,
      packType: formData.pack_type,
      boxSpec: formData.box_spec,
      boxQty: formData.box_qty,
      mailTo: formData.mail_to,
      mailCc: formData.mail_cc,
      mailSubject: formData.mail_subject,
      mailRemark: formData.mail_remark,
      otherReq: formData.other_req
    };

    return {
      salespersonId: Number(salesperson?.id || 0),
      salespersonName: formData.salesman,
      customerId: customer?.id ? Number(customer.id) : null,
      customerName: formData.customer_name,
      productName: formData.product_name,
      bagType: formData.bag_type,
      spec: formData.order_spec,
      quantity: formData.order_qty,
      deliveryDate: formData.delivery_date,
      roller: formData.roller,
      remark: formData.internal_note || formData.order_note || '',
      processRequirements,
      syncToOrder: formData.sync_order,
      emailTo: formData.mail_to || formData.customer_email || '',
      emailCc: formData.mail_cc || '',
      urgency: formData.urgency === '是' ? 1 : 0,
    };
  };

  const handleSubmit = async (options: { preview?: boolean } = {}) => {
    if (!validateForm()) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '请检查必填项：' + errors.join('、') } }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = buildPayload();

      const res = await mockService.createWorkOrder(payload);
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: `开单成功：${res.workNo}${res.orderId ? '，已同步生成订单 #' + res.orderId : ''}` } }));
        
        if (options.preview) {
           handleExport(res.id, 'pdf');
        }

        setFormData({
          ...DEFAULT_FORM,
          salesman: formData.salesman,
          customer_name: '',
          product_name: '',
          urgency: '否'
        });
        
        fetchWorkOrders();
        setView('list');
      }
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '提交失败：' + err.message } }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreviewNoSubmit = async () => {
    if (!formData.customer_name || !formData.product_name) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '预览前请至少填写客户和品名。' } }));
      return;
    }

    setIsSubmitting(true);
    try {
      const pdfBlob = await mockService.previewWorkOrderPdf(buildPayload());
      const url = URL.createObjectURL(pdfBlob);
      const win = window.open(url, '_blank');
      if (!win) window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '浏览器拦截了弹窗，请允许弹窗后重试。' } }));
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '预览请求已发送，并存入预览未提交记录。' } }));
      fetchDrafts();
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '预览失败：' + err.message } }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExport = async (id: number, format: 'pdf' | 'xls' | 'wps.xls', isDraft = false) => {
    try {
      const blob = await mockService.exportWorkOrder(id, format);
      const url = URL.createObjectURL(blob);
      if (format === 'pdf' || format === 'xls') {
        const win = window.open(url, '_blank');
        if (!win) window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '浏览器拦截了弹窗，请允许弹窗后重试。' } }));
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `work_order_${id}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '处理失败：' + err.message } }));
    }
  };

  const handleSendEmail = async (id: number, to: string, cc = '') => {
    try {
      await mockService.sendWorkOrderEmail(id, to, cc);
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '邮件发送成功' } }));
      setShowEmailModal(null);
      fetchWorkOrders();
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '发送失败：' + err.message } }));
    }
  };

  const handleDeleteDraft = async (id: number) => {
    if (!confirm('确认删除这条预览未提交记录？')) return;
    try {
      await mockService.deletePreviewDraft(id);
      fetchDrafts();
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '删除失败：' + err.message } }));
    }
  };

  const handleCopyBilling = (wo: WorkOrder) => {
    const { id, work_no, order_id, created_at, email_status, salesperson_name, ...rest } = wo;
    const summary = wo.process_requirements || {};
    setFormData({
      ...DEFAULT_FORM,
      work_no: wo.work_no,
      salesman: salesperson_name,
      customer_name: wo.customer_name,
      customer_contact: wo.customer_contact || '',
      customer_phone: wo.customer_phone || '',
      customer_email: wo.customer_email || '',
      product_name: wo.product_name,
      product_alias: wo.product_alias || '',
      bag_type: wo.bag_type,
      order_spec: wo.order_spec || wo.spec,
      order_qty: wo.order_qty || wo.quantity,
      order_qty_unit: wo.order_qty_unit || '个',
      delivery_date: wo.delivery_date || '',
      urgency: (wo.urgency as any === '是' || wo.urgency as any === 1) ? '是' : '否',
      use_case: wo.use_case || '',
      order_note: wo.order_note || '',
      roller: wo.roller,
      print_mold: summary.printMold || '',
      print_film_size: summary.printFilmSize || '',
      print_film_thickness: summary.printFilmThickness || '',
      print_film_qty: String(summary.printFilmQty || ''),
      print_film_unit: summary.printFilmUnit || 'kg',
      print_qty: String(summary.printQty || ''),
      color_count: summary.colorCount || '',
      ref_color: summary.refColor || '',
      ink_requirement: summary.inkRequirement || '',
      print_process_note: summary.printProcessNote || '',
      print_special_note: summary.printSpecialNote || '',
      film_type: summary.filmType || '普通',
      film_note: summary.filmNote || '',
      film_ink_requirement: summary.filmInkRequirement || '',
      layer1: summary.layer1 ? { ...DEFAULT_FORM.layer1, ...summary.layer1, mat: summary.layer1.material || '' } : DEFAULT_FORM.layer1,
      layer2: summary.layer2 ? { ...DEFAULT_FORM.layer2, ...summary.layer2, mat: summary.layer2.material || '' } : DEFAULT_FORM.layer2,
      layer3: summary.layer3 ? { ...DEFAULT_FORM.layer3, ...summary.layer3, mat: summary.layer3.material || '' } : DEFAULT_FORM.layer3,
      layer4: summary.layer4 ? { ...DEFAULT_FORM.layer4, ...summary.layer4, mat: summary.layer4.material || '' } : DEFAULT_FORM.layer4,
      bag_spec: summary.bagSpec || '',
      bag_edge_type: summary.bagEdgeType || '',
      zipper_type: summary.zipperType || '',
      zipper_pos: summary.zipperPos || '',
      tear_type: summary.tearType || '',
      hole_type: summary.holeType || '',
      hole_count: summary.holeCount || '',
      outsource_bagging: (summary.outsourceBagging === '是' || summary.outsourceBagging as any === true) ? '是' : '否',
      outsource_vendor: summary.outsourceVendor || '',
      delivery_method: summary.deliveryMethod || '',
      actual_delivery_qty: summary.actualDeliveryQty || '',
      pack_type: summary.packType || '',
      box_spec: summary.boxSpec || '',
      box_qty: summary.boxQty || '',
      mail_to: summary.mailTo || '',
      mail_cc: summary.mailCc || '',
      mail_subject: summary.mailSubject || '',
      mail_remark: summary.mailRemark || '',
      attachment_list: [],
      internal_note: wo.remark || '',
      customer_note: '',
    });
    setView('create');
    window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '已导入历史记录。' } }));
  };

  const toggleArrayItem = (key: keyof typeof formData, value: string) => {
    const list = formData[key] as string[];
    const newList = list.includes(value) ? list.filter(v => v !== value) : [...list, value];
    setFormData({ ...formData, [key]: newList });
  };

  const spanClass: Record<number, string> = { 4: 'md:col-span-4', 6: 'md:col-span-6', 8: 'md:col-span-8', 9: 'md:col-span-9', 12: 'md:col-span-12', 16: 'md:col-span-16', 24: 'md:col-span-24' };
  const InputField = ({ label, required, children, desc, span = 6 }: { label: string, required?: boolean, children: React.ReactNode, desc?: string, span?: number }) => (
    <div className={cn("flex flex-col gap-1 align-top col-span-24", spanClass[span] || 'md:col-span-6')}>
      <label className="text-[13px] font-black text-slate-800 group h-5 flex items-center">
        {label} {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {desc && <span className="text-[10px] text-slate-500 font-bold leading-tight mt-0.5">{desc}</span>}
    </div>
  );

  const SectionTitle = ({ title, className }: { title: string, className?: string }) => (
    <div className={cn("col-span-full border-b border-slate-200 mb-4 pb-2 flex items-center justify-between", className)}>
      <h2 className="text-[16px] font-black text-slate-800 flex items-center gap-2">
        <div className="w-1.5 h-4 bg-indigo-600 rounded-full" />
        {title}
      </h2>
    </div>
  );

  const ModuleBox = ({ children, bgColor, borderColor }: { children: React.ReactNode, bgColor: string, borderColor: string }) => (
    <div className={cn("p-5 md:p-7 rounded-3xl mb-6 border shadow-sm transition-all hover:shadow-md", bgColor, borderColor)}>
      <div className="grid grid-cols-24 gap-x-6 gap-y-5">
        {children}
      </div>
    </div>
  );

  const FormLabelStyle = "h-10 bg-white border border-slate-200 rounded-lg px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all w-full placeholder:text-slate-400 shadow-sm";
  const SelectLabelStyle = "h-10 bg-white border border-slate-200 rounded-lg px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all w-full appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px_12px] bg-no-repeat bg-[position:right_12px_center] pr-8 shadow-sm";

  if (view === 'create') {
    return (
      <div className="max-w-[1200px] mx-auto bg-slate-50 min-h-screen p-4 md:p-8 pb-32">
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-6">
           
           {/* Section 17.3.1: 顶部工具条 */}
           <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <button type="button" onClick={handleBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-600"/>
                </button>
                <h1 className="text-xl font-black text-slate-900">排产开单管理</h1>
              </div>
              <div className="max-w-4xl grid grid-cols-24 gap-4 items-center">
                <InputField label="开单号" span={6}>
                  <input readOnly value={formData.work_no || '自动生成'} className={cn(FormLabelStyle, "bg-slate-50 text-slate-500")} />
                </InputField>
                <InputField label="业务员" required span={6}>
                  <select required value={formData.salesman} onChange={e => setFormData({...formData, salesman: e.target.value})} className={SelectLabelStyle}>
                      <option value="" disabled hidden>选择业务员</option>
                      {(salespersons.length ? salespersons.map((s: any) => s.name) : []).map((s: string) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </InputField>
                <InputField label="开单时间" span={6}>
                   <input readOnly value={new Date(formData.created_at).toLocaleString()} className={cn(FormLabelStyle, "bg-slate-50 text-slate-400")} />
                </InputField>
                <div className="col-span-6 flex items-center justify-end gap-3 pt-5">
<label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={formData.sync_order} onChange={e => setFormData({...formData, sync_order: e.target.checked})} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                      <span className="text-[12px] font-black text-slate-700">同步生成订单</span>
                   </label>
                   <div className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-500">{formData.draft_status}</div>
                </div>
              </div>
           </div>

           {/* Section 17.3.2: 客户与历史商品快捷区 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="客户与历史商品快捷选择" />
              <InputField label="客户搜索" span={8} desc="输入关键字检索客户库">
                 <div className="relative">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <input 
                      list="workorder-customer-options"
                      value={formData.customer_keyword} 
                      onChange={e => setFormData({...formData, customer_keyword: e.target.value, customer_name: e.target.value})} 
                      placeholder="搜索客户名称..." 
                      className={cn(FormLabelStyle, "pl-9")} 
                   />
                   <datalist id="workorder-customer-options">
                     {customers.map((c: any) => <option key={c.id || c.name} value={c.name} />)}
                   </datalist>
                 </div>
              </InputField>
              <InputField label="客户名称" required span={8}>
                 <input required value={formData.customer_name} onChange={e => setFormData({...formData, customer_name: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="联系人 / 电话" span={4}>
                 <input value={formData.customer_contact} onChange={e => setFormData({...formData, customer_contact: e.target.value})} placeholder="联系人" className={FormLabelStyle} />
              </InputField>
              <InputField label="默认邮箱" span={4}>
                 <input value={formData.customer_email} onChange={e => setFormData({...formData, customer_email: e.target.value})} placeholder="用于发送 PDF" className={FormLabelStyle} />
              </InputField>

              <InputField label="历史商品搜索" span={8} desc="从该客户的历史订单中回填工艺">
                 <div className="relative">
                   <History className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <select 
                      value={formData.history_product_id} 
                      onChange={e => {
                        const val = e.target.value;
                        setFormData({...formData, history_product_id: val, product_name: val});
                      }} 
                      className={cn(SelectLabelStyle, "pl-9")}
                   >
                       <option value="">快速选择历史商品</option>
                       {historyProducts.map(p => <option key={p} value={p}>{p}</option>)}
                   </select>
                 </div>
              </InputField>
              <div className="col-span-16 flex items-center gap-4 pt-5">
                 <label className="text-xs font-bold text-slate-500">回填方式:</label>
                 {['覆盖空字段', '全部覆盖'].map(mode => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer transition-all hover:text-indigo-600">
                       <input 
                         type="radio" 
                         name="fill_mode" 
                         checked={formData.history_fill_mode === mode} 
                         onChange={() => setFormData({...formData, history_fill_mode: mode as any})}
                         className="w-4 h-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
                       />
                       <span className="text-[13px] font-bold text-slate-700">{mode}</span>
                    </label>
                 ))}
                 <button type="button" className="ml-auto h-9 px-4 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-black border border-indigo-100 hover:bg-indigo-100 transition-all">
                    加载完整历史档案
                 </button>
              </div>
           </ModuleBox>

           {/* Section 17.3.3: 基础订单信息区 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="基础订单信息" />
              <InputField label="品名" required span={8}>
                 <input required value={formData.product_name} onChange={e => setFormData({...formData, product_name: e.target.value})} placeholder="例如：鲜美鸭翅半透明袋" className={FormLabelStyle} />
              </InputField>
              <InputField label="商品简称" span={4}>
                 <input value={formData.product_alias} onChange={e => setFormData({...formData, product_alias: e.target.value})} placeholder="缩写/内部代码" className={FormLabelStyle} />
              </InputField>
              <InputField label="袋型" required span={6}>
                 <select required value={formData.bag_type} onChange={e => setFormData({...formData, bag_type: e.target.value})} className={SelectLabelStyle}>
                     <option value="" disabled hidden>请选择袋型</option>
                     {['自立袋', '自立拉链袋', '八边封袋', '三边封袋', '背封袋', '自动包装轴'].map(t => <option key={t} value={t}>{t}</option>)}
                 </select>
              </InputField>
              <InputField label="成品规格" required span={6}>
                 <input required value={formData.order_spec} onChange={e => setFormData({...formData, order_spec: e.target.value})} placeholder="如: 180*260+40" className={FormLabelStyle} />
              </InputField>

              <InputField label="订单数量" required span={4}>
                 <input required type="number" value={formData.order_qty} onChange={e => setFormData({...formData, order_qty: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="数量单位" required span={4}>
                 <select required value={formData.order_qty_unit} onChange={e => setFormData({...formData, order_qty_unit: e.target.value})} className={SelectLabelStyle}>
                     <option value="个">个</option>
                     <option value="只">只</option>
                     <option value="包">包</option>
                     <option value="KG">KG</option>
                 </select>
              </InputField>
              <InputField label="交货日期" required span={6}>
                 <input required type="date" value={formData.delivery_date} onChange={e => setFormData({...formData, delivery_date: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="是否加急" required span={4}>
                 <div className="flex items-center gap-4 h-10">
                    {['是', '否'].map(v => (
                       <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" checked={formData.urgency === v} onChange={() => setFormData({...formData, urgency: v as any})} className="w-4 h-4 border-slate-300 text-rose-600 focus:ring-rose-500" />
                          <span className={cn("text-[13px] font-bold", formData.urgency === '是' && v === '是' ? "text-rose-600" : "text-slate-700")}>{v}</span>
                       </label>
                    ))}
                 </div>
              </InputField>
              <InputField label="用途 / 场景" span={6}>
                 <input value={formData.use_case} onChange={e => setFormData({...formData, use_case: e.target.value})} placeholder="如: 冷冻、蒸煮" className={FormLabelStyle} />
              </InputField>
              <InputField label="订单备注" span={24}>
                 <textarea rows={2} value={formData.order_note} onChange={e => setFormData({...formData, order_note: e.target.value})} placeholder="客户特殊嘱托..." className={cn(FormLabelStyle, "h-auto py-2")} />
              </InputField>
           </ModuleBox>

           {/* Section 17.3.4: 印刷信息区 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="印刷工艺规格" />
              <InputField label="压辊" required={!!formData.print_mold} span={6} desc="规格 C：有印刷时必填">
                 <input value={formData.roller} onChange={e => setFormData({...formData, roller: e.target.value})} placeholder="例如: 80B" className={FormLabelStyle} />
              </InputField>
              <InputField label="印膜材质" required span={6}>
                 <select value={formData.print_mold} onChange={e => setFormData({...formData, print_mold: e.target.value})} className={SelectLabelStyle}>
                     <option value="">请选择材质</option>
                     {materials.map(m => <option key={m} value={m}>{m}</option>)}
                 </select>
              </InputField>
              <InputField label="印刷膜尺寸" span={6}>
                 <input value={formData.print_film_size} onChange={e => setFormData({...formData, print_film_size: e.target.value})} placeholder="例如: 600mm" className={FormLabelStyle} />
              </InputField>
              <InputField label="印刷膜厚度" span={6}>
                 <input value={formData.print_film_thickness} onChange={e => setFormData({...formData, print_film_thickness: e.target.value})} placeholder="例如: 12μ" className={FormLabelStyle} />
              </InputField>

              <InputField label="印刷膜数量" span={4}>
                 <input type="number" value={formData.print_film_qty} onChange={e => setFormData({...formData, print_film_qty: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="印刷膜单位" span={4}>
                 <select value={formData.print_film_unit} onChange={e => setFormData({...formData, print_film_unit: e.target.value})} className={SelectLabelStyle}>
                     <option value="kg">kg</option>
                     <option value="卷">卷</option>
                     <option value="米">米</option>
                 </select>
              </InputField>
              <InputField label="印刷米数" span={4}>
                 <input type="number" value={formData.print_qty} onChange={e => setFormData({...formData, print_qty: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="色数" span={4}>
                 <input value={formData.color_count} onChange={e => setFormData({...formData, color_count: e.target.value})} placeholder="如: 8色" className={FormLabelStyle} />
              </InputField>
              <InputField label="参考色 / 色样" span={8}>
                 <input value={formData.ref_color} onChange={e => setFormData({...formData, ref_color: e.target.value})} placeholder="彩稿 / 标准样..." className={FormLabelStyle} />
              </InputField>

              <InputField label="油墨要求" span={12}>
                 <textarea rows={2} value={formData.ink_requirement} onChange={e => setFormData({...formData, ink_requirement: e.target.value})} placeholder="颜色、环保、食品级要求..." className={cn(FormLabelStyle, "h-auto py-2")} />
              </InputField>
              <InputField label="印刷特殊工艺" span={12}>
                 <textarea rows={2} value={formData.print_special_note} onChange={e => setFormData({...formData, print_special_note: e.target.value})} placeholder="专色、哑光、反印..." className={cn(FormLabelStyle, "h-auto py-2")} />
              </InputField>
              <InputField label="印刷工艺备注" span={24}>
                 <textarea rows={1} value={formData.print_process_note} onChange={e => setFormData({...formData, print_process_note: e.target.value})} className={cn(FormLabelStyle, "h-auto py-1.5")} />
              </InputField>
           </ModuleBox>

           {/* Section 17.3.5: 覆膜结构区 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="覆膜结构标准" />
              <InputField label="覆膜类型" span={6}>
                 <select value={formData.film_type} onChange={e => setFormData({...formData, film_type: e.target.value})} className={SelectLabelStyle}>
                     <option value="普通">普通</option>
                     <option value="蒸煮">蒸煮</option>
                     <option value="高阻隔">高阻隔</option>
                     <option value="冷冻">冷冻</option>
                 </select>
              </InputField>
              <InputField label="覆膜油墨要求" span={9}>
                 <input value={formData.film_ink_requirement} onChange={e => setFormData({...formData, film_ink_requirement: e.target.value})} placeholder="默认同印刷" className={FormLabelStyle} />
              </InputField>
              <InputField label="覆膜工艺要求" span={9}>
                 <input value={formData.film_note} onChange={e => setFormData({...formData, film_note: e.target.value})} placeholder="耐温、强度要求..." className={FormLabelStyle} />
              </InputField>

              <div className="col-span-24 mt-4 overflow-x-auto">
                 <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                       <tr className="bg-slate-50 border-y border-slate-200">
                          <th className="px-4 py-3 text-[12px] font-black text-slate-500 uppercase w-32 tracking-wider">层级角色</th>
                          <th className="px-1 py-3 text-[12px] font-black text-slate-500 uppercase w-12 text-center">启用</th>
                          <th className="px-4 py-3 text-[12px] font-black text-slate-500 uppercase flex-1 tracking-wider">材质规格</th>
                          <th className="px-4 py-3 text-[12px] font-black text-slate-500 uppercase w-32 tracking-wider">尺寸</th>
                          <th className="px-4 py-3 text-[12px] font-black text-slate-500 uppercase w-24 tracking-wider">厚度</th>
                          <th className="px-4 py-3 text-[12px] font-black text-slate-500 uppercase w-32 tracking-wider">数量 / 重量</th>
                          <th className="px-4 py-3 text-[12px] font-black text-slate-500 uppercase w-20 tracking-wider">单位</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                       {[1, 2, 3, 4].map(idx => {
                          const key = `layer${idx}` as 'layer1' | 'layer2' | 'layer3' | 'layer4';
                          const layer = formData[key];
                          return (
                             <tr key={key} className={cn("transition-colors", !layer.enabled && "bg-slate-50/50 opacity-40")}>
                                <td className="px-4 py-3 text-sm font-black text-slate-700">{layer.role}</td>
                                <td className="px-1 py-3 text-center">
                                   <input 
                                      type="checkbox" 
                                      checked={layer.enabled} 
                                      onChange={e => setFormData({...formData, [key]: {...layer, enabled: e.target.checked}})} 
                                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                                   />
                                </td>
                                <td className="px-4 py-3">
                                   <select 
                                      disabled={!layer.enabled}
                                      value={layer.mat} 
                                      onChange={e => setFormData({...formData, [key]: {...layer, mat: e.target.value}})}
                                      className={cn(SelectLabelStyle, "h-9")}
                                   >
                                       <option value="">请选择材质</option>
                                       {materials.map(m => <option key={m} value={m}>{m}</option>)}
                                   </select>
                                </td>
                                <td className="px-4 py-3">
                                   <input 
                                      disabled={!layer.enabled}
                                      value={layer.size} 
                                      onChange={e => setFormData({...formData, [key]: {...layer, size: e.target.value}})}
                                      className={cn(FormLabelStyle, "h-9")} 
                                   />
                                </td>
                                <td className="px-4 py-3">
                                   <input 
                                      disabled={!layer.enabled}
                                      value={layer.thickness} 
                                      onChange={e => setFormData({...formData, [key]: {...layer, thickness: e.target.value}})}
                                      className={cn(FormLabelStyle, "h-9")} 
                                   />
                                </td>
                                <td className="px-4 py-3">
                                   <input 
                                      disabled={!layer.enabled}
                                      value={layer.weight} 
                                      onChange={e => setFormData({...formData, [key]: {...layer, weight: e.target.value}})}
                                      className={cn(FormLabelStyle, "h-9")} 
                                   />
                                </td>
                                <td className="px-4 py-3">
                                   <select 
                                      disabled={!layer.enabled}
                                      value={layer.unit} 
                                      onChange={e => setFormData({...formData, [key]: {...layer, unit: e.target.value}})}
                                      className={cn(SelectLabelStyle, "h-9")}
                                   >
                                       <option value="kg">kg</option>
                                       <option value="卷">卷</option>
                                       <option value="米">米</option>
                                   </select>
                                </td>
                             </tr>
                          )
                       })}
                    </tbody>
                 </table>
              </div>
           </ModuleBox>

           {/* Section 17.3.6: 制袋与交付区 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="制袋与交付参数" />
              <InputField label="制袋规格" span={6} desc="默认继承成品规格">
                 <input value={formData.bag_spec} onChange={e => setFormData({...formData, bag_spec: e.target.value})} placeholder="如: 180*260" className={FormLabelStyle} />
              </InputField>
              <InputField label="封边方式" span={6}>
                 <input value={formData.bag_edge_type} onChange={e => setFormData({...formData, bag_edge_type: e.target.value})} placeholder="如: 三边封、背封" className={FormLabelStyle} />
              </InputField>
              <InputField label="拉链类型" span={6}>
                 <input value={formData.zipper_type} onChange={e => setFormData({...formData, zipper_type: e.target.value})} placeholder="如: 易撕拉链" className={FormLabelStyle} />
              </InputField>
              <InputField label="拉链位置" span={6}>
                 <input value={formData.zipper_pos} onChange={e => setFormData({...formData, zipper_pos: e.target.value})} placeholder="距离袋口 X mm" className={FormLabelStyle} />
              </InputField>

              <InputField label="撕口类型" span={6}>
                 <input value={formData.tear_type} onChange={e => setFormData({...formData, tear_type: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="挂孔类型" span={6}>
                 <input value={formData.hole_type} onChange={e => setFormData({...formData, hole_type: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="挂孔数量" span={6}>
                 <input value={formData.hole_count} onChange={e => setFormData({...formData, hole_count: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="交付方式" span={6}>
                 <select value={formData.delivery_method} onChange={e => setFormData({...formData, delivery_method: e.target.value})} className={SelectLabelStyle}>
                     <option value="">请选择</option>
                     <option value="自提">自提</option>
                     <option value="送货">送货</option>
                     <option value="物流">物流</option>
                 </select>
              </InputField>

              <InputField label="是否外加工" span={4}>
                 <div className="flex items-center gap-4 h-10">
                    {['是', '否'].map(v => (
                       <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" checked={formData.outsource_bagging === v} onChange={() => setFormData({...formData, outsource_bagging: v as any})} className="border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                          <span className="text-[13px] font-bold text-slate-700">{v}</span>
                       </label>
                    ))}
                 </div>
              </InputField>
              <InputField label="外加工厂家" span={8} required={formData.outsource_bagging === '是'}>
                 <input disabled={formData.outsource_bagging !== '是'} value={formData.outsource_vendor} onChange={e => setFormData({...formData, outsource_vendor: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="实交数量" span={4} desc="可后续补录">
                 <input value={formData.actual_delivery_qty} onChange={e => setFormData({...formData, actual_delivery_qty: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="制袋特殊要求" span={8}>
                 <input value={formData.other_req} onChange={e => setFormData({...formData, other_req: e.target.value})} className={FormLabelStyle} />
              </InputField>
           </ModuleBox>
           {/* Section 17.3.7: 装箱规格与标记 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="装箱规格与成品入库" />
              <InputField label="装箱类型" span={6}>
                 <select value={formData.pack_type} onChange={e => setFormData({...formData, pack_type: e.target.value})} className={SelectLabelStyle}>
                     <option value="">请选择</option>
                     <option value="纸箱">纸箱</option>
                     <option value="编织袋">编织袋</option>
                     <option value="托盘">托盘</option>
                 </select>
              </InputField>
              <InputField label="箱规 / 规格" span={12}>
                 <input value={formData.box_spec} onChange={e => setFormData({...formData, box_spec: e.target.value})} placeholder="如: 60*40*30cm" className={FormLabelStyle} />
              </InputField>
              <InputField label="装箱每箱数量" span={6}>
                 <input type="number" value={formData.box_qty} onChange={e => setFormData({...formData, box_qty: e.target.value})} className={FormLabelStyle} />
              </InputField>
           </ModuleBox>

           {/* Section 17.3.8: 邮件发送配置 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="PDF 邮件自动发送配置" />
              <InputField label="收件人邮箱" span={12} desc="多个请用分号分隔">
                 <input value={formData.mail_to} onChange={e => setFormData({...formData, mail_to: e.target.value})} placeholder="email1@example.com; ..." className={FormLabelStyle} />
              </InputField>
              <InputField label="抄送邮箱" span={12}>
                 <input value={formData.mail_cc} onChange={e => setFormData({...formData, mail_cc: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="邮件主题" span={24}>
                 <input value={formData.mail_subject} onChange={e => setFormData({...formData, mail_subject: e.target.value})} placeholder="默认：[排产单] - {客户名} - {品名}" className={FormLabelStyle} />
              </InputField>
              <InputField label="邮件正文 / 备注" span={24}>
                 <textarea rows={2} value={formData.mail_remark} onChange={e => setFormData({...formData, mail_remark: e.target.value})} placeholder="邮件内容补充..." className={cn(FormLabelStyle, "h-auto py-2")} />
              </InputField>
           </ModuleBox>

           {/* Section 17.3.9: 补充备注及附件 */}
           <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
              <SectionTitle title="补充备注及附件" />
              <InputField label="内部生产备注" span={12}>
                 <textarea rows={3} value={formData.internal_note} onChange={e => setFormData({...formData, internal_note: e.target.value})} placeholder="仅内部可见..." className={cn(FormLabelStyle, "h-auto py-2")} />
              </InputField>
              <InputField label="客户可见备注" span={12}>
                 <textarea rows={3} value={formData.customer_note} onChange={e => setFormData({...formData, customer_note: e.target.value})} placeholder="会显示在 PDF 上..." className={cn(FormLabelStyle, "h-auto py-2")} />
              </InputField>
              <div className="col-span-24">
                 <label className="text-xs font-black text-slate-800 mb-2 block">附件附件 (图片 / PDF / 设计稿)</label>
                 <div className="border border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer">
                    <UploadCloud className="w-8 h-8 text-slate-300 mb-2" />
                    <span className="text-sm font-bold text-slate-500">点击上传或将文件拖至此处</span>
                    <span className="text-[11px] text-slate-400 mt-1">支持 JPG, PNG, PDF (最大 20MB)</span>
                 </div>
              </div>
           </ModuleBox>

           {/* Section 17.3.10: 提交及操作区 */}
           <ModuleBox bgColor="bg-slate-100" borderColor="border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-6">
                 <div className="flex flex-wrap items-center gap-6">
                    <button 
                       type="button" 
                       onClick={() => handleSubmit()} 
                       disabled={isSubmitting}
                       className="h-12 px-10 bg-indigo-600 text-white rounded-2xl text-[15px] font-black shadow-lg shadow-indigo-200 hover:shadow-indigo-300 active:scale-95 transition-all flex items-center gap-2"
                    >
                       <Save className="w-5 h-5" />
                       正式提交开单
                    </button>
                    <button 
                       type="button" 
                       onClick={saveToLocalDraft}
                       className="h-12 px-6 bg-white text-slate-700 border border-slate-200 rounded-2xl text-sm font-black hover:bg-slate-50 transition-all"
                    >
                       保存本地草稿
                    </button>
                    <button 
                       type="button" 
                       onClick={handleClearForm}
                       className="h-12 px-6 text-rose-500 font-black text-sm hover:underline"
                    >
                       清空重填
                    </button>
                 </div>
                 <div className="flex items-center gap-4 py-2 px-4 bg-white/50 rounded-xl border border-white">
                    <div className="flex flex-col items-end">
                       <span className="text-[10px] font-black text-slate-400 uppercase">当前业务员</span>
                       <span className="text-xs font-black text-slate-700">{formData.salesman || '未指定'}</span>
                    </div>
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-black">
                       {(formData.salesman || 'U').charAt(0).toUpperCase()}
                    </div>
                 </div>
              </div>
           </ModuleBox>

           {errors.length > 0 && (
             <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="p-4 bg-rose-500 text-white rounded-2xl shadow-2xl flex items-center gap-4">
                   <AlertCircle className="w-6 h-6 shrink-0" />
                   <div className="flex-1">
                      <p className="text-sm font-black whitespace-nowrap">检测到 {errors.length} 个必填项未完善</p>
                      <p className="text-[11px] font-bold opacity-80 truncate">{errors.join('、')}</p>
                   </div>
                   <button onClick={() => setErrors([])} className="p-2 hover:bg-black/10 rounded-lg">
                      <Plus className="w-5 h-5 rotate-45" />
                   </button>
                </div>
             </div>
           )}
        </form>
     </div>
    );
  }

  // --- List View Component ---
  return (
    <div className="space-y-6 lg:p-6 p-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between px-2 gap-3 md:gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2 md:gap-3">
            开单管理作业
          </h1>
          <p className="text-slate-500 mt-1 font-medium text-xs md:text-sm">发起生产作业单、定义工艺参数标准并将制令分配下发</p>
        </div>
        <div className="flex gap-2">
             <button 
               onClick={handleCreate}
               className="flex items-center justify-center gap-2 px-6 h-12 bg-blue-600 text-white rounded-xl text-sm font-black shadow-md hover:bg-blue-700 transition-all uppercase tracking-widest"
             >
                <Plus className="w-5 h-5" />
                立即创建排产开单
             </button>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-3xl p-4 shadow-sm flex gap-4">
          <div className="flex-1 relative">
             <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
             <input 
               value={woSearch}
               onChange={e => setWoSearch(e.target.value)}
               placeholder="搜索制令号、客户、品名、规格..." 
               className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:bg-white focus:border-indigo-500 transition-all outline-none"
             />
          </div>
          <button onClick={fetchWorkOrders} className="w-12 h-12 flex items-center justify-center bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all">
             <RefreshCw className="w-5 h-5" />
          </button>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-slate-900">预览未提交记录</h3>
            <p className="text-xs text-slate-500 mt-1">来自“预览 PDF 不提交”的临时记录，可继续导出或删除。</p>
          </div>
          <button onClick={fetchDrafts} className="h-9 px-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">刷新</button>
        </div>
        {previewDrafts.length === 0 ? (
          <div className="text-xs font-bold text-slate-400 py-6">暂无预览草稿</div>
        ) : (
          <div className="space-y-3">
            {previewDrafts.map((draft: any) => (
              <div key={draft.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-slate-100 rounded-2xl p-4 bg-slate-50/50">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800 truncate">{draft.product_name || '未命名品名'}</div>
                  <div className="text-xs font-bold text-slate-500 mt-1">{draft.customer_name || '-'} | {draft.spec || '-'} | {draft.quantity || '-'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleExport(draft.id, 'pdf', true)} className="h-9 px-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-white">预览 PDF</button>
                  <button onClick={() => handleDeleteDraft(draft.id)} className="h-9 px-3 border border-rose-200 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50">删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hidden md:block overflow-x-auto bg-white rounded-[2rem] border border-slate-100 shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">制令号 / 日期</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">业务 / 客户</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">生产品名</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">规格 / 数量</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workOrders.length === 0 ? (
                <tr>
                   <td colSpan={5} className="px-6 py-16 text-center">
                      <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500 text-sm font-bold">没有数据记录</p>
                   </td>
                </tr>
              ) : (
                workOrders.map(wo => (
                  <tr key={wo.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                       <div className="text-sm font-black text-slate-900 font-mono tracking-tight">{wo.work_no}</div>
                       <div className="text-xs text-slate-400 font-bold mt-1">{new Date(wo.created_at).toLocaleDateString()}</div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="text-xs font-black text-indigo-600 mb-1">{wo.salesperson_name}</div>
                       <div className="text-sm font-bold text-slate-800">{wo.customer_name}</div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="text-sm font-black text-slate-800">{wo.product_name}</div>
                       <div className="text-xs text-slate-400 font-bold mt-1">{wo.bag_type}</div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="text-xs font-black text-slate-900 font-mono bg-slate-100 px-2 py-0.5 rounded inline-block">{wo.spec}</div>
                       <div className="text-xs font-bold text-slate-600 mt-1 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          {Number(wo.quantity).toLocaleString()} PCS
                       </div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleExport(wo.id, 'pdf')} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" title="导出 PDF">
                             <FileText className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleExport(wo.id, 'xls')} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" title="导出 Excel">
                             <FileDown className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleExport(wo.id, 'wps.xls')} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" title="导出 WPS Excel">
                             <Download className="w-4 h-4" />
                          </button>
                          <button onClick={() => setShowEmailModal(wo.id)} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" title="发送邮件">
                             <Mail className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleCopyBilling(wo)} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100">
                             <Copy className="w-4 h-4" />
                          </button>
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalWorkOrders > 0 && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <p className="text-[11px] font-bold text-slate-500 uppercase">
                显示 {Math.min(totalWorkOrders, (page-1)*pageSize + 1)} 到 {Math.min(totalWorkOrders, page*pageSize)} / 共 {totalWorkOrders} 条
              </p>
              <div className="flex gap-2">
                 <button disabled={page === 1} onClick={() => setPage(page - 1)} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                    <ChevronLeft className="w-4 h-4" />
                 </button>
                 <button disabled={page * pageSize >= totalWorkOrders} onClick={() => setPage(page + 1)} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                    <ChevronLeft className="w-4 h-4 rotate-180" />
                 </button>
              </div>
            </div>
          )}
      </div>
      <AnimatePresence>
        {showEmailModal !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setShowEmailModal(null)} />
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative bg-white rounded-3xl border border-slate-200 shadow-xl p-6 w-full max-w-lg space-y-4">
              <h3 className="text-lg font-black text-slate-900">发送开单邮件</h3>
              <input id="wo-mail-to" defaultValue={formData.mail_to || formData.customer_email || ''} placeholder="收件人邮箱，多个用分号分隔" className={FormLabelStyle} />
              <input id="wo-mail-cc" defaultValue={formData.mail_cc || ''} placeholder="抄送邮箱" className={FormLabelStyle} />
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowEmailModal(null)} className="h-10 px-4 border border-slate-200 rounded-xl text-sm font-bold text-slate-600">取消</button>
                <button onClick={() => handleSendEmail(showEmailModal, (document.getElementById('wo-mail-to') as HTMLInputElement)?.value || '', (document.getElementById('wo-mail-cc') as HTMLInputElement)?.value || '')} className="h-10 px-4 bg-indigo-600 text-white rounded-xl text-sm font-black">发送</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
