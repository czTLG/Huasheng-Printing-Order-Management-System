import React, { useState, useEffect } from 'react';
import {
  Building2, Printer, Layers, ClipboardList, Box, Search, ChevronLeft,
  Plus, UploadCloud, AlertCircle, History, Save, FileText, CheckCircle2,
  Trash2, FileDown, Settings, RefreshCw, ExternalLink, Copy, Mail, Download,
  X, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';
import { WorkOrder, WorkOrderDraft } from '../types';

const INITIAL_MATERIALS = ['PET', 'PE', 'AL', 'NY', 'CPP', 'BOPP', 'VMPET'];
const ROLLER_OPTIONS = ['55', '65', '75', '80', '90', '105'];
const REF_COLOR_OPTIONS = ['按彩稿', '按打样膜', '按原膜样', '按样品袋'];
const BAG_TYPE_OPTIONS = ['自立', '自立拉链', '单拉链', '八边封', '三边封', '背封', '侧边封袋', '四边封', '异形袋', '自动包'];

const DEFAULT_FORM = {
  wo_date: new Date().toISOString().split('T')[0],
  work_no: '',
  salesman: '',
  created_at: new Date().toISOString(),
  sync_order: true,
  draft_status: '未保存',

  customer_id: '',
  customer_name: '',
  customer_contact: '',
  customer_phone: '',
  customer_email: '',

  product_name: '',
  order_spec: '',
  order_qty: '',
  delivery_date: '',
  urgency: '0' as '0' | '1',
  bag_type: '',

  image_url: '',
  image_file: null as File | null,

  roller: '',
  print_mold: '',
  print_film_size: '',
  print_film_qty: '',
  print_film_unit: 'kg',
  print_qty: '',
  ref_color: '',
  ink_inner: false,
  ink_water: false,
  ink_boil: false,
  ink_matte: false,
  ink_surface: false,
  print_shift: '',

  film_type: '',
  film_note: '',
  layer1: { mat: '', size: '', weight: '', unit: 'kg' },
  layer2: { mat: '', size: '', weight: '', unit: 'kg' },
  layer3: { mat: '', size: '', weight: '', unit: 'kg' },
  layer4: { mat: '', size: '', weight: '', unit: 'kg' },

  outsource_bagging: '否' as '是' | '否',
  zipper_pos: '',
  tear_pos: '',
  hole_pos: '',
  hole_round: false,
  hole_plane: false,
  hole_handle: false,
  edge_top: false,
  edge_side: false,
  edge_bottom: false,
  edge_cm: '',
  other_req: '',
  remark: '',
  mail_to_list: [''] as string[],

  pack_type: '',
  box_spec: '',
  actual_delivery_qty: '',
  packer_sign: '',

  internal_note: '',
  customer_note: '',
  attachment_list: [] as any[],
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

  // Global search
  const [globalSearchQ, setGlobalSearchQ] = useState('');
  const [searchMode, setSearchMode] = useState<'all' | 'any'>('all');
  const [searchKws, setSearchKws] = useState<string[]>(['']);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchCards, setShowSearchCards] = useState(false);

  // New customer panel
  const [showNewPanel, setShowNewPanel] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerSalesperson, setNewCustomerSalesperson] = useState('');
  const [newCustomerProduct, setNewCustomerProduct] = useState('');

  // List View States
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [totalWorkOrders, setTotalWorkOrders] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [woSearch, setWoSearch] = useState('');

  // Drafts & Previews
  const [previewDrafts, setPreviewDrafts] = useState<WorkOrderDraft[]>([]);
  const [showEmailModal, setShowEmailModal] = useState<number | null>(null);
  const [exportOpenId, setExportOpenId] = useState<number | null>(null);
  const [exportAction, setExportAction] = useState('');

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
        bag_type: prev.bag_type || exactCustomer.default_spec ? prev.bag_type : '',
        order_spec: prev.order_spec || exactCustomer.default_spec || '',
        roller: prev.roller || exactCustomer.default_roller || '',
      }));
    }
  }, [formData.salesman, formData.customer_name, salespersons]);

  useEffect(() => {
    const nextHistoryProducts = workOrders
      .filter(row => (!formData.salesman || row.salesperson_name === formData.salesman) && (!formData.customer_name || row.customer_name === formData.customer_name))
      .map(row => row.product_name)
      .filter(Boolean);
    setHistoryProducts([...new Set(nextHistoryProducts)].slice(0, 100));
  }, [formData.salesman, formData.customer_name, workOrders]);

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
      if (meta?.lastEmailTo && !formData.mail_to_list[0]) {
        setFormData(prev => ({ ...prev, mail_to_list: [String(meta.lastEmailTo || '')] }));
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
    setSearchResults([]);
    setShowSearchCards(false);
    setShowNewPanel(false);
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
    if (!formData.order_spec) newErrs.push('成品规格');
    if (!formData.order_qty) newErrs.push('订单数量');
    if (!formData.bag_type) newErrs.push('袋型');
    if (!formData.print_mold) newErrs.push('印膜材料');
    if (!formData.print_film_size) newErrs.push('印膜尺寸');
    if (!formData.print_film_qty) newErrs.push('印膜数量');
    if (!formData.roller) newErrs.push('压辊');
    setErrors(newErrs);
    return newErrs.length === 0;
  };

  // Global product search
  const handleGlobalSearch = async () => {
    const kws = searchKws.filter(k => k.trim());
    if (!kws.length) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '请输入搜索关键词' } }));
      return;
    }
    try {
      const q = kws.join(' ');
      const data = await mockService.searchWorkOrderProducts(q, searchMode);
      setSearchResults(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      setShowSearchCards(true);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '搜索失败：' + err.message } }));
    }
  };

  const chooseSearchResult = (val: string) => {
    const item = searchResults.find((r: any) => String(r.id || r.product_name || '') === val || r.product_name === val);
    if (item) {
      setFormData(prev => ({
        ...prev,
        customer_name: item.customer_name || prev.customer_name,
        product_name: item.product_name || prev.product_name,
        bag_type: item.bag_type || prev.bag_type,
        order_spec: item.spec || item.order_spec || prev.order_spec,
        roller: item.roller || prev.roller,
      }));
    }
  };

  // Load history products
  const loadHistoryProducts = () => {
    const nextHistoryProducts = workOrders
      .filter(row => (!formData.salesman || row.salesperson_name === formData.salesman) && (!formData.customer_name || row.customer_name === formData.customer_name))
      .map(row => row.product_name)
      .filter(Boolean);
    setHistoryProducts([...new Set(nextHistoryProducts)].slice(0, 100));
  };

  // When a history product is selected, backfill from the matching work order
  const handleHistoryProductPick = (productName: string) => {
    if (!productName) return;
    setFormData(prev => ({ ...prev, product_name: productName }));
    const match = workOrders.find(wo =>
      wo.product_name === productName &&
      wo.customer_name === formData.customer_name
    );
    if (match && match.process_requirements) {
      const s = match.process_requirements;
      setFormData(prev => ({
        ...prev,
        bag_type: s.bagType || prev.bag_type,
        order_spec: s.spec || prev.order_spec,
        roller: s.roller || prev.roller,
        print_mold: s.printMold || prev.print_mold,
        print_film_size: s.printFilmSize || prev.print_film_size,
        print_film_qty: String(s.printFilmQty || prev.print_film_qty),
        print_film_unit: s.printFilmUnit || prev.print_film_unit,
        print_qty: String(s.printQty || prev.print_qty),
        ref_color: s.refColor || prev.ref_color,
        print_shift: s.printShift || prev.print_shift,
        film_type: s.filmType || prev.film_type,
        film_note: s.filmNote || prev.film_note,
        layer1: s.layer1 ? { mat: s.layer1.material || '', size: s.layer1.size || '', weight: s.layer1.weight || '', unit: s.layer1.unit || 'kg' } : prev.layer1,
        layer2: s.layer2 ? { mat: s.layer2.material || '', size: s.layer2.size || '', weight: s.layer2.weight || '', unit: s.layer2.unit || 'kg' } : prev.layer2,
        layer3: s.layer3 ? { mat: s.layer3.material || '', size: s.layer3.size || '', weight: s.layer3.weight || '', unit: s.layer3.unit || 'kg' } : prev.layer3,
        layer4: s.layer4 ? { mat: s.layer4.material || '', size: s.layer4.size || '', weight: s.layer4.weight || '', unit: s.layer4.unit || 'kg' } : prev.layer4,
        zipper_pos: s.zipperPos || s.zipPos || prev.zipper_pos,
        tear_pos: s.tearPos || prev.tear_pos,
        hole_pos: s.holePos || prev.hole_pos,
        edge_cm: s.edgeCm || prev.edge_cm,
        outsource_bagging: s.outsourceBagging === '是' ? '是' : '否',
        pack_type: s.packType || prev.pack_type,
        box_spec: s.boxSpec || prev.box_spec,
        other_req: s.otherReq || prev.other_req,
        remark: s.remark || prev.remark,
      }));
    }
  };

  // Add/remove material option
  const handleAddMaterial = async () => {
    const name = prompt('输入新材料名称（如：珠光膜）：');
    if (!name || !name.trim()) return;
    try {
      await mockService.addMaterialOption(name.trim());
      setMaterials(prev => [...new Set([...prev, name.trim()])]);
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: `已添加材料：${name.trim()}` } }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '添加失败：' + err.message } }));
    }
  };

  const handleDeleteMaterial = async () => {
    const name = prompt('输入要删除的材料名称：');
    if (!name || !name.trim()) return;
    try {
      await mockService.deleteMaterialOption(name.trim());
      setMaterials(prev => prev.filter(m => m !== name.trim()));
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: `已删除材料：${name.trim()}` } }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '删除失败：' + err.message } }));
    }
  };

  // New customer
  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim()) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '请输入客户名称' } }));
      return;
    }
    const sp = salespersons.find(s => s.name === (newCustomerSalesperson || formData.salesman));
    try {
      await mockService.createWorkOrderCustomer({
        salespersonId: Number(sp?.id || 0),
        customerName: newCustomerName.trim(),
        productName: newCustomerProduct.trim() || undefined,
      });
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: `已创建客户：${newCustomerName.trim()}` } }));
      setNewCustomerName('');
      setNewCustomerProduct('');
      setShowNewPanel(false);
      await loadMeta();
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '创建失败：' + err.message } }));
    }
  };

  // Rename customer
  const handleRenameCustomer = async () => {
    if (!formData.customer_name) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '请先选择客户' } }));
      return;
    }
    const newName = prompt('修改客户名称：', formData.customer_name);
    if (!newName || !newName.trim() || newName.trim() === formData.customer_name) return;
    const customer = customers.find((c: any) => c.name === formData.customer_name);
    if (!customer?.id) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '未找到该客户记录' } }));
      return;
    }
    try {
      await mockService.renameWorkOrderCustomer(customer.id, newName.trim());
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: `客户已更名为：${newName.trim()}` } }));
      setFormData(prev => ({ ...prev, customer_name: newName.trim() }));
      await loadMeta();
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '修改失败：' + err.message } }));
    }
  };

  const saveToLocalDraft = (showTip = true) => {
    localStorage.setItem(`wo_draft_${currentUser.username}`, JSON.stringify(formData));
    setFormData(prev => ({ ...prev, draft_status: `已保存 (${new Date().toLocaleTimeString()})` }));
    if (showTip) window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '草稿已保存到本地。' } }));
  };

  const restoreFromLocalDraft = (showTip = true) => {
    const draft = localStorage.getItem(`wo_draft_${currentUser.username}`);
    if (draft) {
      setFormData(JSON.parse(draft));
      if (showTip) window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '已恢复本地草稿。' } }));
    } else {
      if (showTip) window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '未找到可恢复的草稿。' } }));
    }
  };

  const handleClearForm = (showTip = true) => {
    if (showTip && !confirm('确认清空当前表单？')) return;
    setFormData(DEFAULT_FORM);
    setErrors([]);
  };

  const buildPayload = () => {
    const salesperson = salespersons.find(sp => sp.name === formData.salesman);
    const customer = customers.find((item: any) => item.name === formData.customer_name);

    const inkParts: string[] = [];
    if (formData.ink_inner) inkParts.push('里印');
    if (formData.ink_water) inkParts.push('水煮');
    if (formData.ink_boil) inkParts.push('蒸煮');
    if (formData.ink_matte) inkParts.push('哑油');
    if (formData.ink_surface) inkParts.push('表印');

    const holeParts: string[] = [];
    if (formData.hole_round) holeParts.push('圆孔');
    if (formData.hole_plane) holeParts.push('飞机孔');
    if (formData.hole_handle) holeParts.push('手提孔');

    const edgeParts: string[] = [];
    if (formData.edge_top) edgeParts.push('上封');
    if (formData.edge_side) edgeParts.push('边封');
    if (formData.edge_bottom) edgeParts.push('下封');

    const processRequirements = {
      date: formData.wo_date,
      customerName: formData.customer_name,
      customerContact: formData.customer_contact,
      customerPhone: formData.customer_phone,
      customerEmail: formData.customer_email,
      productName: formData.product_name,
      bagType: formData.bag_type,
      spec: formData.order_spec,
      quantity: formData.order_qty,
      deliveryDate: formData.delivery_date,
      urgency: formData.urgency,
      roller: formData.roller,
      printMold: formData.print_mold,
      printFilmSize: formData.print_film_size,
      printFilmQty: formData.print_film_qty,
      printFilmUnit: formData.print_film_unit,
      printQty: formData.print_qty,
      refColor: formData.ref_color,
      inkRequirement: inkParts.join('/'),
      printShift: formData.print_shift,
      filmType: formData.film_type,
      filmNote: formData.film_note,
      layer1: formData.layer1.mat,
      l1Size: formData.layer1.size,
      l1Weight: formData.layer1.weight,
      layer1Unit: formData.layer1.unit,
      layer2: formData.layer2.mat,
      l2Size: formData.layer2.size,
      l2Weight: formData.layer2.weight,
      layer2Unit: formData.layer2.unit,
      layer3: formData.layer3.mat,
      l3Size: formData.layer3.size,
      l3Weight: formData.layer3.weight,
      layer3Unit: formData.layer3.unit,
      layer4: formData.layer4.mat,
      l4Size: formData.layer4.size,
      l4Weight: formData.layer4.weight,
      layer4Unit: formData.layer4.unit,
      outsource: formData.outsource_bagging,
      outsourceVendor: '',
      bagSpec: formData.order_spec,
      zipperPos: formData.zipper_pos,
      tearPos: formData.tear_pos,
      holePos: formData.hole_pos,
      holes: holeParts.join('/'),
      edges: edgeParts.join('/'),
      edgeCm: formData.edge_cm,
      otherReq: formData.other_req,
      remark: formData.remark,
      mailTo: formData.mail_to_list.filter(e => e.trim()).join(';'),
      packType: formData.pack_type,
      boxSpec: formData.box_spec,
      actualQty: formData.actual_delivery_qty,
      packerSign: formData.packer_sign,
      imageUrl: formData.image_url,
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
      remark: formData.remark || formData.internal_note || '',
      processRequirements,
      syncToOrder: formData.sync_order,
      emailTo: formData.mail_to_list.filter(e => e.trim()).join(';') || formData.customer_email || '',
      emailCc: '',
      urgency: formData.urgency === '1' ? 1 : 0,
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
        const msg = `开单成功：${res.workNo}${res.orderId ? '，已同步生成订单 #' + res.orderId : ''}`;
        window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: msg } }));

        if (options.preview && res.id) {
          handleExport(res.id, 'pdf');
        }

        setFormData({
          ...DEFAULT_FORM,
          salesman: formData.salesman,
          customer_name: '',
          product_name: '',
          urgency: '0',
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

  const handleExportAction = async (id: number, action: string) => {
    setExportOpenId(null);
    setExportAction('');
    try {
      let blob: Blob;
      if (action === 'preview_excel') {
        blob = await mockService.previewWorkOrderExcel(id);
      } else if (action === 'preview_pdf') {
        blob = await mockService.exportWorkOrder(id, 'pdf');
      } else if (action === 'export_xls') {
        blob = await mockService.exportWorkOrder(id, 'xls');
      } else if (action === 'export_wps') {
        blob = await mockService.exportWorkOrder(id, 'wps.xls');
      } else if (action === 'export_pdf') {
        blob = await mockService.exportWorkOrder(id, 'pdf');
      } else {
        return;
      }
      const url = URL.createObjectURL(blob);
      if (action.startsWith('preview_')) {
        const win = window.open(url, '_blank');
        if (!win) window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '浏览器拦截了弹窗，请允许弹窗后重试。' } }));
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `work_order_${id}.${action === 'export_wps' ? 'wps.xls' : action === 'export_xls' ? 'xls' : 'pdf'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '操作失败：' + err.message } }));
    }
  };

  const handleExport = async (id: number, format: 'pdf' | 'xls' | 'wps.xls') => {
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
    const summary = wo.process_requirements || {};
    setFormData({
      ...DEFAULT_FORM,
      work_no: wo.work_no,
      salesman: wo.salesperson_name,
      customer_name: wo.customer_name,
      customer_contact: wo.customer_contact || '',
      customer_phone: wo.customer_phone || '',
      customer_email: wo.customer_email || '',
      product_name: wo.product_name,
      bag_type: wo.bag_type,
      order_spec: wo.order_spec || wo.spec,
      order_qty: wo.order_qty || wo.quantity,
      delivery_date: wo.delivery_date || '',
      urgency: (wo.urgency as any === '是' || wo.urgency as any === 1 || wo.urgency as any === '1') ? '1' : '0',
      roller: wo.roller,
      print_mold: summary.printMold || '',
      print_film_size: summary.printFilmSize || '',
      print_film_qty: String(summary.printFilmQty || ''),
      print_film_unit: summary.printFilmUnit || 'kg',
      print_qty: String(summary.printQty || ''),
      ref_color: summary.refColor || '',
      print_shift: summary.printShift || '',
      film_type: summary.filmType || '',
      film_note: summary.filmNote || '',
      layer1: summary.layer1 ? { mat: summary.layer1.material || '', size: summary.layer1.size || '', weight: summary.layer1.weight || '', unit: summary.layer1.unit || 'kg' } : DEFAULT_FORM.layer1,
      layer2: summary.layer2 ? { mat: summary.layer2.material || '', size: summary.layer2.size || '', weight: summary.layer2.weight || '', unit: summary.layer2.unit || 'kg' } : DEFAULT_FORM.layer2,
      layer3: summary.layer3 ? { mat: summary.layer3.material || '', size: summary.layer3.size || '', weight: summary.layer3.weight || '', unit: summary.layer3.unit || 'kg' } : DEFAULT_FORM.layer3,
      layer4: summary.layer4 ? { mat: summary.layer4.material || '', size: summary.layer4.size || '', weight: summary.layer4.weight || '', unit: summary.layer4.unit || 'kg' } : DEFAULT_FORM.layer4,
      outsource_bagging: (summary.outsourceBagging === '是' || summary.outsource as any === '是') ? '是' : '否',
      zipper_pos: summary.zipperPos || summary.zipPos || '',
      tear_pos: summary.tearPos || '',
      hole_pos: summary.holePos || '',
      edge_cm: summary.edgeCm || '',
      pack_type: summary.packType || '',
      box_spec: summary.boxSpec || '',
      actual_delivery_qty: summary.actualDeliveryQty || '',
      packer_sign: summary.packerSign || '',
      other_req: summary.otherReq || '',
      remark: summary.remark || wo.remark || '',
      image_url: summary.imageUrl || '',
      mail_to_list: summary.mailTo ? summary.mailTo.split(';').filter(Boolean) : [''],
    });
    setView('create');
    window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '已导入历史记录。' } }));
  };

  // Auto-save draft on field change
  const updateForm = (patch: Partial<typeof formData>) => {
    setFormData(prev => {
      const next = { ...prev, ...patch };
      setTimeout(() => {
        try { localStorage.setItem(`wo_draft_${currentUser.username}`, JSON.stringify(next)); } catch (_) {}
      }, 100);
      return next;
    });
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

          {/* Toolbar */}
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
                <select required value={formData.salesman} onChange={e => updateForm({ salesman: e.target.value })} className={SelectLabelStyle}>
                  <option value="" disabled hidden>选择业务员</option>
                  {(salespersons.length ? salespersons.map((s: any) => s.name) : []).map((s: string) => <option key={s} value={s}>{s}</option>)}
                </select>
              </InputField>
              <InputField label="开单时间" span={6}>
                <input readOnly value={new Date(formData.created_at).toLocaleString()} className={cn(FormLabelStyle, "bg-slate-50 text-slate-400")} />
              </InputField>
              <div className="col-span-6 flex items-center justify-end gap-3 pt-5">
                <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                  <input type="checkbox" checked={formData.sync_order} onChange={e => updateForm({ sync_order: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className="text-[12px] font-black text-slate-700">同步生成订单并发邮件</span>
                </label>
                <div className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-500">{formData.draft_status}</div>
              </div>
            </div>
          </div>

          {/* Global Search */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-7">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-black text-slate-800 flex items-center gap-2">
                <div className="w-1.5 h-4 bg-cyan-600 rounded-full" />
                全局搜索（客户/商品）
              </h2>
            </div>
            <div className="grid grid-cols-24 gap-x-6 gap-y-4">
              <div className="col-span-24 md:col-span-16">
                <div className="flex flex-col gap-3">
                  {searchKws.map((kw, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={kw}
                        onChange={e => {
                          const next = [...searchKws];
                          next[i] = e.target.value;
                          setSearchKws(next);
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleGlobalSearch(); } }}
                        placeholder={`关键词${i + 1}，如：${i === 0 ? '思宏' : '薯条'}`}
                        className={FormLabelStyle}
                      />
                      {searchKws.length > 1 && (
                        <button type="button" onClick={() => setSearchKws(prev => prev.filter((_, j) => j !== i))} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-[12px] font-bold text-slate-500">匹配方式</span>
                    <select value={searchMode} onChange={e => setSearchMode(e.target.value as 'all' | 'any')} className="h-9 px-3 border border-slate-200 rounded-lg text-[13px] font-bold text-slate-700">
                      <option value="all">全部关键词（默认）</option>
                      <option value="any">任一关键词</option>
                    </select>
                    <button type="button" onClick={() => setSearchKws(prev => [...prev, ''])} className="h-9 px-3 bg-cyan-600 text-white rounded-lg text-[12px] font-black hover:bg-cyan-700 transition-all">
                      + 添加关键词
                    </button>
                  </div>
                </div>
              </div>
              <div className="col-span-24 md:col-span-8">
                <label className="text-[13px] font-black text-slate-800 h-5 flex items-center mb-1">搜索结果（自动对接）</label>
                <select
                  onChange={e => chooseSearchResult(e.target.value)}
                  className={SelectLabelStyle}
                >
                  <option value="">先搜索再选择</option>
                  {searchResults.map((r: any, i: number) => (
                    <option key={i} value={r.product_name || r.id}>
                      {r.customer_name || ''} - {r.product_name || ''} {r.bag_type ? `[${r.bag_type}]` : ''} {r.spec || r.order_spec || ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-24 flex items-center gap-4">
                <button type="button" onClick={handleGlobalSearch} className="h-10 px-6 bg-cyan-600 text-white rounded-xl text-[13px] font-black hover:bg-cyan-700 transition-all">
                  搜索
                </button>
                <span className="text-[11px] text-slate-400 font-bold">可输入"客户名+关键字"（如：永旺 锅巴）。结果会显示袋型和规格，便于区分相似商品。</span>
              </div>
            </div>
            {showSearchCards && searchResults.length > 0 && (
              <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
                {searchResults.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 border border-slate-100 rounded-xl bg-slate-50 hover:bg-indigo-50 transition-colors cursor-pointer"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        customer_name: r.customer_name || prev.customer_name,
                        product_name: r.product_name || prev.product_name,
                        bag_type: r.bag_type || prev.bag_type,
                        order_spec: r.spec || r.order_spec || prev.order_spec,
                        roller: r.roller || prev.roller,
                      }));
                    }}
                  >
                    <div>
                      <span className="text-[13px] font-black text-slate-800">{r.customer_name} — {r.product_name}</span>
                      <span className="text-[11px] text-slate-500 ml-3">{r.bag_type} | {r.spec || r.order_spec} | 辊:{r.roller || '-'}</span>
                    </div>
                    <span className="text-[10px] font-bold text-indigo-500">点击回填</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 1: 业务员 / 客户 */}
          <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
            <SectionTitle title="1) 选择业务员 / 客户" />
            <InputField label="业务员" required span={6}>
              <select required value={formData.salesman} onChange={e => updateForm({ salesman: e.target.value })} className={SelectLabelStyle}>
                <option value="" disabled hidden>请选择业务员</option>
                {(salespersons.length ? salespersons.map((s: any) => s.name) : []).map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
            </InputField>
            <InputField label="客户" required span={6}>
              <select required value={formData.customer_name} onChange={e => updateForm({ customer_name: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择客户</option>
                {customers.map((c: any) => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}
              </select>
            </InputField>
            <InputField label="商品名（历史）" span={6}>
              <select
                value=""
                onChange={e => handleHistoryProductPick(e.target.value)}
                className={SelectLabelStyle}
              >
                <option value="">请先点"加载历史商品"</option>
                {historyProducts.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </InputField>
            <InputField label="历史商品" span={3}>
              <button type="button" onClick={loadHistoryProducts} className="h-10 w-full bg-cyan-600 text-white rounded-lg text-[12px] font-black hover:bg-cyan-700 transition-all">
                加载历史商品
              </button>
            </InputField>
            <InputField label="新增档案" span={3}>
              <button type="button" onClick={() => setShowNewPanel(!showNewPanel)} className="h-10 w-full bg-teal-600 text-white rounded-lg text-[12px] font-black hover:bg-teal-700 transition-all">
                + 新增客户/商品
              </button>
            </InputField>
            <InputField label="客户维护" span={3}>
              <button type="button" onClick={handleRenameCustomer} className="h-10 w-full bg-purple-600 text-white rounded-lg text-[12px] font-black hover:bg-purple-700 transition-all">
                修改当前客户名
              </button>
            </InputField>

            {showNewPanel && (
              <div className="col-span-24 mt-2 p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50">
                <h4 className="text-[14px] font-black text-slate-700 mb-3">新增客户/商品（手工建档）</h4>
                <div className="grid grid-cols-24 gap-4">
                  <div className="col-span-24 md:col-span-6">
                    <label className="text-[12px] font-bold text-slate-600 block mb-1">归属业务员 <span className="text-red-500">*</span></label>
                    <select value={newCustomerSalesperson || formData.salesman} onChange={e => setNewCustomerSalesperson(e.target.value)} className={SelectLabelStyle}>
                      <option value="">请选择业务员</option>
                      {salespersons.map((s: any) => <option key={s.id || s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-24 md:col-span-6">
                    <label className="text-[12px] font-bold text-slate-600 block mb-1">客户名 <span className="text-red-500">*</span></label>
                    <input value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder="输入新客户名称" className={FormLabelStyle} />
                  </div>
                  <div className="col-span-24 md:col-span-6">
                    <label className="text-[12px] font-bold text-slate-600 block mb-1">商品名（可选）</label>
                    <input value={newCustomerProduct} onChange={e => setNewCustomerProduct(e.target.value)} placeholder="可先录入一个商品名" className={FormLabelStyle} />
                  </div>
                  <div className="col-span-24 md:col-span-6 flex items-end">
                    <button type="button" onClick={handleCreateCustomer} className="h-10 px-6 bg-teal-600 text-white rounded-lg text-[12px] font-black hover:bg-teal-700 transition-all">
                      保存客户
                    </button>
                  </div>
                </div>
              </div>
            )}
          </ModuleBox>

          {/* Section 2: 基础信息 */}
          <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
            <SectionTitle title="2) 基础信息" />
            <InputField label="日期" span={4}>
              <input type="date" value={formData.wo_date} onChange={e => updateForm({ wo_date: e.target.value })} className={FormLabelStyle} />
            </InputField>
            <InputField label="品名" required span={8}>
              <input required value={formData.product_name} onChange={e => updateForm({ product_name: e.target.value })} placeholder="可从上方历史商品选择后自动填入" className={FormLabelStyle} />
            </InputField>
            <InputField label="规格" required span={6}>
              <input required value={formData.order_spec} onChange={e => updateForm({ order_spec: e.target.value })} placeholder="例如：20*30" className={FormLabelStyle} />
            </InputField>
            <InputField label="要求数量" required span={6}>
              <input required value={formData.order_qty} onChange={e => updateForm({ order_qty: e.target.value })} placeholder="例如：10000" className={FormLabelStyle} />
            </InputField>
            <InputField label="袋型图片URL" span={12}>
              <input value={formData.image_url} onChange={e => updateForm({ image_url: e.target.value })} placeholder="可选：粘贴图片URL" className={FormLabelStyle} />
            </InputField>
            <InputField label="上传袋型图片" span={12}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={e => updateForm({ image_file: e.target.files?.[0] || null })}
                className="h-10 text-[13px] text-slate-600 file:h-8 file:mr-3 file:px-3 file:rounded-lg file:border-0 file:text-[12px] file:font-bold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100"
              />
            </InputField>
          </ModuleBox>

          {/* Section 3: 印刷信息 */}
          <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
            <SectionTitle title="3) 印刷信息" />
            <InputField label="印膜材料" required span={6}>
              <select required value={formData.print_mold} onChange={e => updateForm({ print_mold: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择印膜材料</option>
                {materials.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </InputField>
            <InputField label="印膜尺寸" required span={6}>
              <input required value={formData.print_film_size} onChange={e => updateForm({ print_film_size: e.target.value })} placeholder="例如：55*10c" className={FormLabelStyle} />
            </InputField>
            <InputField label="印膜数量" required span={4}>
              <input required type="number" step="0.01" min="0" value={formData.print_film_qty} onChange={e => updateForm({ print_film_qty: e.target.value })} placeholder="仅填数字，如 1200" className={FormLabelStyle} />
            </InputField>
            <InputField label="印膜单位" required span={4}>
              <select required value={formData.print_film_unit} onChange={e => updateForm({ print_film_unit: e.target.value })} className={SelectLabelStyle}>
                <option value="kg">kg</option>
                <option value="米">米</option>
                <option value="粒">粒</option>
              </select>
            </InputField>
            <InputField label="印刷数量" span={4}>
              <input type="number" step="0.01" min="0" value={formData.print_qty} onChange={e => updateForm({ print_qty: e.target.value })} placeholder="仅填数字" className={FormLabelStyle} />
            </InputField>
            <InputField label="压辊" required span={6}>
              <select required value={formData.roller} onChange={e => updateForm({ roller: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择压辊</option>
                {ROLLER_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </InputField>
            <InputField label="参考色" span={6}>
              <select value={formData.ref_color} onChange={e => updateForm({ ref_color: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择</option>
                {REF_COLOR_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </InputField>
            <InputField label="油墨要求（多选）" span={12}>
              <div className="flex flex-wrap gap-3 h-10 items-center">
                {[
                  { key: 'ink_inner', label: '里印' },
                  { key: 'ink_water', label: '水煮' },
                  { key: 'ink_boil', label: '蒸煮' },
                  { key: 'ink_matte', label: '哑油' },
                  { key: 'ink_surface', label: '表印' },
                ].map(ink => (
                  <label key={ink.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(formData as any)[ink.key] || false}
                      onChange={e => updateForm({ [ink.key]: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-[12px] font-bold text-slate-600">{ink.label}</span>
                  </label>
                ))}
              </div>
            </InputField>
            <InputField label="印刷米数" span={6}>
              <input value={formData.print_shift} onChange={e => updateForm({ print_shift: e.target.value })} placeholder="例如：6000米（可不填）" className={FormLabelStyle} />
            </InputField>
          </ModuleBox>

          {/* Section 4: 覆膜工艺 */}
          <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
            <SectionTitle title="4) 覆膜工艺（每层一行：材质 / 尺寸 / 重量）" />
            <InputField label="覆膜工艺" span={6}>
              <select value={formData.film_type} onChange={e => updateForm({ film_type: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择</option>
                <option value="蒸煮">蒸煮</option>
                <option value="双组">双组</option>
                <option value="普通">普通</option>
              </select>
            </InputField>
            <InputField label="快捷备注" span={12}>
              <input value={formData.film_note} onChange={e => updateForm({ film_note: e.target.value })} placeholder="如：双组√ / 覆膜要求..." className={FormLabelStyle} />
            </InputField>
            <InputField label="材料字典维护" span={6}>
              <div className="flex gap-2">
                <button type="button" onClick={handleAddMaterial} className="h-10 px-3 bg-purple-600 text-white rounded-lg text-[11px] font-black hover:bg-purple-700 transition-all">
                  + 新增材料
                </button>
                <button type="button" onClick={handleDeleteMaterial} className="h-10 px-3 bg-red-600 text-white rounded-lg text-[11px] font-black hover:bg-red-700 transition-all">
                  - 删除材料
                </button>
              </div>
            </InputField>

            {/* Layer rows */}
            {[1, 2, 3, 4].map(idx => {
              const key = `layer${idx}` as 'layer1' | 'layer2' | 'layer3' | 'layer4';
              const layer = formData[key];
              const borderColors = ['border-l-blue-500', 'border-l-emerald-500', 'border-l-amber-500', 'border-l-purple-500'];
              const bgColors = ['bg-blue-50/30', 'bg-emerald-50/30', 'bg-amber-50/30', 'bg-purple-50/30'];
              return (
                <div key={key} className={cn("col-span-24 grid grid-cols-24 gap-4 border-l-4 pl-4 py-2 rounded-r-lg", borderColors[idx - 1], bgColors[idx - 1])}>
                  <InputField label={`第${['一','二','三','四'][idx-1]}层材质`} span={8}>
                    <select value={layer.mat} onChange={e => updateForm({ [key]: { ...layer, mat: e.target.value } } as any)} className={SelectLabelStyle}>
                      <option value="">请选择材质</option>
                      {materials.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </InputField>
                  <InputField label={`第${['一','二','三','四'][idx-1]}层尺寸`} span={8}>
                    <input
                      value={layer.size}
                      onChange={e => updateForm({ [key]: { ...layer, size: e.target.value } } as any)}
                      placeholder={idx === 1 ? '如：55*10c（仅支持 数字*数字c/cm）' : '如：55.5*8c'}
                      list="wo_size_options"
                      className={FormLabelStyle}
                    />
                  </InputField>
                  <InputField label={`第${['一','二','三','四'][idx-1]}层数量`} span={8}>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={layer.weight}
                        onChange={e => updateForm({ [key]: { ...layer, weight: e.target.value } } as any)}
                        placeholder={idx === 1 ? '如：1420（仅数字）' : '如：850（仅数字）'}
                        className={FormLabelStyle}
                      />
                      <select
                        value={layer.unit}
                        onChange={e => updateForm({ [key]: { ...layer, unit: e.target.value } } as any)}
                        className={cn(SelectLabelStyle, "w-20 shrink-0")}
                      >
                        <option value="kg">kg</option>
                        <option value="米">米</option>
                        <option value="粒">粒</option>
                      </select>
                    </div>
                  </InputField>
                </div>
              );
            })}
            <datalist id="wo_size_options">
              {['55*10c', '55.5*8c', '56*10c', '60*10c', '65*10c', '70*10c', '75*10c', '80*10c'].map(s => <option key={s} value={s} />)}
            </datalist>
          </ModuleBox>

          {/* Section 5: 制袋与交付 */}
          <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
            <SectionTitle title="5) 制袋与交付" />
            <InputField label="交货日期" span={6}>
              <input type="date" value={formData.delivery_date} onChange={e => updateForm({ delivery_date: e.target.value })} className={FormLabelStyle} />
            </InputField>
            <InputField label="是否外加工" span={6}>
              <select value={formData.outsource_bagging} onChange={e => updateForm({ outsource_bagging: e.target.value as '是' | '否' })} className={SelectLabelStyle}>
                <option value="否">否</option>
                <option value="是">是</option>
              </select>
            </InputField>
            <InputField label="袋型" required span={6}>
              <select required value={formData.bag_type} onChange={e => updateForm({ bag_type: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择袋型</option>
                {BAG_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </InputField>
            <InputField label="拉链位置" span={6}>
              <input value={formData.zipper_pos} onChange={e => updateForm({ zipper_pos: e.target.value })} placeholder="距离袋口 X mm" className={FormLabelStyle} />
            </InputField>
            <InputField label="撕口位置" span={6}>
              <input value={formData.tear_pos} onChange={e => updateForm({ tear_pos: e.target.value })} placeholder="如：左上角" className={FormLabelStyle} />
            </InputField>
            <InputField label="挂孔位置" span={6}>
              <input value={formData.hole_pos} onChange={e => updateForm({ hole_pos: e.target.value })} placeholder="如：距顶20mm" className={FormLabelStyle} />
            </InputField>
            <InputField label="孔位选项（勾选）" span={12}>
              <div className="flex flex-wrap gap-3 h-10 items-center">
                {[
                  { key: 'hole_round', label: '圆孔' },
                  { key: 'hole_plane', label: '飞机孔' },
                  { key: 'hole_handle', label: '手提孔' },
                ].map(h => (
                  <label key={h.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(formData as any)[h.key] || false}
                      onChange={e => updateForm({ [h.key]: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-[12px] font-bold text-slate-600">{h.label}</span>
                  </label>
                ))}
              </div>
            </InputField>
            <InputField label="封边选项（勾选）" span={12}>
              <div className="flex flex-wrap gap-3 h-10 items-center">
                {[
                  { key: 'edge_top', label: '上封' },
                  { key: 'edge_side', label: '边封' },
                  { key: 'edge_bottom', label: '下封' },
                ].map(e => (
                  <label key={e.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(formData as any)[e.key] || false}
                      onChange={ev => updateForm({ [e.key]: ev.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-[12px] font-bold text-slate-600">{e.label}</span>
                  </label>
                ))}
              </div>
            </InputField>
            <InputField label="封边数值（cm）" span={6}>
              <input value={formData.edge_cm} onChange={e => updateForm({ edge_cm: e.target.value })} placeholder="如：各1厘米 / 上1 下1" className={FormLabelStyle} />
            </InputField>
            <InputField label="其它要求" span={12}>
              <input value={formData.other_req} onChange={e => updateForm({ other_req: e.target.value })} placeholder="如：耐高温、食品级" className={FormLabelStyle} />
            </InputField>
            <InputField label="备注" span={12}>
              <input value={formData.remark} onChange={e => updateForm({ remark: e.target.value })} placeholder="生产备注..." className={FormLabelStyle} />
            </InputField>
            <InputField label="邮件To（同步订单后发送，可多个）" span={24}>
              <div className="flex flex-col gap-2">
                {formData.mail_to_list.map((email, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={email}
                      onChange={e => {
                        const next = [...formData.mail_to_list];
                        next[i] = e.target.value;
                        updateForm({ mail_to_list: next });
                      }}
                      placeholder={`收件邮箱${i + 1}`}
                      className={FormLabelStyle}
                    />
                    {formData.mail_to_list.length > 1 && (
                      <button type="button" onClick={() => updateForm({ mail_to_list: formData.mail_to_list.filter((_, j) => j !== i) })} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => updateForm({ mail_to_list: [...formData.mail_to_list, ''] })} className="h-9 px-3 bg-cyan-600 text-white rounded-lg text-[11px] font-black hover:bg-cyan-700 transition-all w-fit">
                  + 添加收件邮箱
                </button>
              </div>
            </InputField>
          </ModuleBox>

          {/* Section 6: 装箱信息 */}
          <ModuleBox bgColor="bg-white" borderColor="border-slate-200">
            <SectionTitle title="6) 装箱信息" />
            <InputField label="装箱类型" span={6}>
              <select value={formData.pack_type} onChange={e => updateForm({ pack_type: e.target.value })} className={SelectLabelStyle}>
                <option value="">请选择</option>
                <option value="纸箱">纸箱</option>
                <option value="编织袋">编织袋</option>
                <option value="打版">打版</option>
              </select>
            </InputField>
            <InputField label="装箱规格" span={6}>
              <input value={formData.box_spec} onChange={e => updateForm({ box_spec: e.target.value })} placeholder="如：60*40*30cm" className={FormLabelStyle} />
            </InputField>
            <InputField label="实际成品数量" span={6}>
              <input value={formData.actual_delivery_qty} onChange={e => updateForm({ actual_delivery_qty: e.target.value })} placeholder="可后续补录" className={FormLabelStyle} />
            </InputField>
            <InputField label="装箱人签名" span={6}>
              <input value={formData.packer_sign} onChange={e => updateForm({ packer_sign: e.target.value })} placeholder="签名" className={FormLabelStyle} />
            </InputField>
          </ModuleBox>

          {/* Action Buttons */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-7">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                <input type="checkbox" checked={formData.sync_order} onChange={e => updateForm({ sync_order: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-[13px] font-bold text-slate-700">同步生成订单并发邮件</span>
              </label>
              <div className="w-36">
                <select value={formData.urgency} onChange={e => updateForm({ urgency: e.target.value as '0' | '1' })} className={SelectLabelStyle}>
                  <option value="0">普通</option>
                  <option value="1">加急</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-3 ml-auto">
                <button type="button" onClick={() => handleSubmit()} disabled={isSubmitting}
                  className="h-12 px-8 bg-indigo-600 text-white rounded-2xl text-[14px] font-black shadow-lg shadow-indigo-200 hover:shadow-indigo-300 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-60">
                  <Save className="w-5 h-5" />
                  提交开单
                </button>
                <button type="button" onClick={() => handleSubmit({ preview: true })} disabled={isSubmitting}
                  className="h-12 px-6 bg-cyan-700 text-white rounded-2xl text-[13px] font-black hover:bg-cyan-800 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-60">
                  <Eye className="w-5 h-5" />
                  提交并预览PDF
                </button>
                <button type="button" onClick={handlePreviewNoSubmit} disabled={isSubmitting}
                  className="h-12 px-6 bg-sky-600 text-white rounded-2xl text-[13px] font-black hover:bg-sky-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-60">
                  <FileText className="w-5 h-5" />
                  预览PDF(不提交)
                </button>
                <button type="button" onClick={() => saveToLocalDraft(true)}
                  className="h-12 px-5 bg-teal-600 text-white rounded-2xl text-[13px] font-black hover:bg-teal-700 active:scale-95 transition-all">
                  保存草稿
                </button>
                <button type="button" onClick={() => restoreFromLocalDraft(true)}
                  className="h-12 px-5 bg-slate-600 text-white rounded-2xl text-[13px] font-black hover:bg-slate-700 active:scale-95 transition-all">
                  恢复草稿
                </button>
                <button type="button" onClick={() => handleClearForm(true)}
                  className="h-12 px-5 bg-red-800 text-white rounded-2xl text-[13px] font-black hover:bg-red-900 active:scale-95 transition-all">
                  清空表单
                </button>
                <button type="button" onClick={fetchWorkOrders}
                  className="h-12 px-5 bg-slate-500 text-white rounded-2xl text-[13px] font-black hover:bg-slate-600 active:scale-95 transition-all">
                  刷新列表
                </button>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-400 font-bold">提示：优先"选历史商品"，系统会自动预填袋型/工艺/日期，你只改差异项即可。</div>
          </div>

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
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); fetchWorkOrders(); } }}
            placeholder="搜索开单号、客户、品名、规格..."
            className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:bg-white focus:border-indigo-500 transition-all outline-none"
          />
        </div>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="h-12 px-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-indigo-500">
          <option value="20">每页20条</option>
          <option value="50">每页50条</option>
          <option value="100">每页100条</option>
        </select>
        <button onClick={() => { setPage(1); fetchWorkOrders(); }} className="h-12 px-4 bg-slate-100 text-slate-600 rounded-2xl text-sm font-black hover:bg-slate-200 transition-all">
          搜索
        </button>
        <button onClick={fetchWorkOrders} className="w-12 h-12 flex items-center justify-center bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-slate-900">预览未提交记录</h3>
            <p className="text-xs text-slate-500 mt-1">来自"预览 PDF 不提交"的临时记录，可继续导出或删除。</p>
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
                  <button onClick={() => handleExport(draft.id, 'pdf')} className="h-9 px-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-white">预览 PDF</button>
                  <button onClick={() => handleDeleteDraft(draft.id)} className="h-9 px-3 border border-rose-200 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50">删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto bg-white rounded-[2rem] border border-slate-100 shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">制令号 / 日期</th>
              <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">业务 / 客户</th>
              <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">生产品名</th>
              <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">规格 / 数量</th>
              <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase">邮件状态</th>
              <th className="px-6 py-4 text-[11px] font-black text-slate-500 uppercase text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {workOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center">
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
                    {wo.email_status === 'sent' ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">已发送</span>
                    ) : wo.email_status === 'pending' ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">待发送</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleCopyBilling(wo)} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" title="复制开单">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={() => setShowEmailModal(wo.id)} className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" title="发送邮件">
                        <Mail className="w-4 h-4" />
                      </button>
                      <div className="relative">
                        <select
                          value={exportOpenId === wo.id ? exportAction : ''}
                          onChange={e => {
                            const val = e.target.value;
                            if (val) {
                              setExportOpenId(wo.id);
                              setExportAction(val);
                              handleExportAction(wo.id, val);
                            }
                          }}
                          className="h-9 px-3 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-600 bg-white outline-none"
                        >
                          <option value="">导出/预览</option>
                          <option value="preview_excel">预览Excel</option>
                          <option value="export_xls">导出Excel</option>
                          <option value="export_wps">WPS专用Excel</option>
                          <option value="preview_pdf">预览PDF</option>
                          <option value="export_pdf">导出PDF</option>
                        </select>
                      </div>
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
              第{page}页 · 共 {totalWorkOrders} 条
            </p>
            <div className="flex items-center gap-2">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="number"
                min={1}
                value={page}
                onChange={e => { const v = Number(e.target.value); if (v > 0) setPage(v); }}
                className="w-14 h-9 text-center border border-slate-200 rounded-lg text-[12px] font-bold"
              />
              <button disabled={page * pageSize >= totalWorkOrders} onClick={() => setPage(page + 1)} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                <ChevronLeft className="w-4 h-4 rotate-180" />
              </button>
              <button onClick={() => { setPage(1); fetchWorkOrders(); }} className="h-9 px-3 bg-slate-500 text-white rounded-lg text-[11px] font-bold hover:bg-slate-600">
                跳转
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {workOrders.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm font-bold">没有数据记录</p>
          </div>
        ) : (
          workOrders.map(wo => (
            <div key={wo.id} className="bg-white border border-slate-100 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <b className="text-sm text-slate-900">{wo.work_no || '-'}</b>
                <span className="text-[11px] text-slate-400">{new Date(wo.created_at).toLocaleDateString()}</span>
              </div>
              <div className="text-xs text-slate-500">
                <span className="text-indigo-600 font-bold">{wo.salesperson_name}</span> | {wo.customer_name}
              </div>
              <div className="text-sm font-bold text-slate-800">{wo.product_name}</div>
              <div className="text-xs text-slate-400">{wo.bag_type} | {wo.spec} | 数量:{wo.quantity || '-'}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => handleCopyBilling(wo)} className="h-8 px-3 bg-cyan-600 text-white rounded-lg text-[11px] font-bold">复制开单</button>
                <button onClick={() => setShowEmailModal(wo.id)} className="h-8 px-3 bg-purple-600 text-white rounded-lg text-[11px] font-bold">发邮件</button>
                <select
                  onChange={e => { if (e.target.value) handleExportAction(wo.id, e.target.value); e.target.value = ''; }}
                  className="h-8 px-2 bg-slate-500 text-white rounded-lg text-[11px] font-bold"
                >
                  <option value="">导出/预览</option>
                  <option value="preview_excel">预览Excel</option>
                  <option value="export_xls">导出Excel</option>
                  <option value="export_wps">WPS专用Excel</option>
                  <option value="preview_pdf">预览PDF</option>
                  <option value="export_pdf">导出PDF</option>
                </select>
              </div>
            </div>
          ))
        )}
        {totalWorkOrders > 0 && (
          <div className="flex items-center justify-between bg-white rounded-2xl p-4 border border-slate-100">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="p-2 border border-slate-200 rounded-lg disabled:opacity-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-bold text-slate-500">第{page}页 / 共{totalWorkOrders}条</span>
            <button disabled={page * pageSize >= totalWorkOrders} onClick={() => setPage(page + 1)} className="p-2 border border-slate-200 rounded-lg disabled:opacity-50">
              <ChevronLeft className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showEmailModal !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setShowEmailModal(null)} />
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative bg-white rounded-3xl border border-slate-200 shadow-xl p-6 w-full max-w-lg space-y-4">
              <h3 className="text-lg font-black text-slate-900">发送开单邮件</h3>
              <input id="wo-mail-to" defaultValue={formData.mail_to_list.filter(e => e.trim()).join(';') || formData.customer_email || ''} placeholder="收件人邮箱，多个用分号分隔" className={FormLabelStyle} />
              <input id="wo-mail-cc" defaultValue="" placeholder="抄送邮箱" className={FormLabelStyle} />
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
