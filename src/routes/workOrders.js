const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { allowRoles } = require('../middleware/auth');
const { db, now, audit } = require('../db');

const router = express.Router();
// 模板锁版规则：见 docs/workorder-template-lock.md（改导出前先对照）
const DEFAULT_WORKORDER_EMAIL = '11759337@qq.com';

function safe(v) { return v === null || v === undefined ? '' : String(v); }
function esc(v) { return safe(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;'); }
function workOrderHtml(row){
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);
  const yn = (v)=> String(v||'').trim() ? '√' : '';
  const holes = String(p.holes||'');
  const edges = String(p.edges||'');
  const printFilmDisplay = composePrintFilmDisplay(p, row.remark || '');
  return `<!doctype html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'/>
  <!--[if gte mso 9]><xml>
  <x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>生产工作表</x:Name><x:WorksheetOptions><x:PageSetup><x:Layout x:Orientation='Portrait'/><x:Header x:Margin='0.2'/><x:Footer x:Margin='0.2'/><x:PageMargins x:Bottom='0.35' x:Left='0.25' x:Right='0.25' x:Top='0.35'/></x:PageSetup><x:FitToPage/><x:Print><x:FitWidth>1</x:FitWidth><x:FitHeight>0</x:FitHeight><x:ValidPrinterInfo/></x:Print><x:Zoom>100</x:Zoom><x:DoNotDisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
  </xml><![endif]-->
  <style>
  @page { size: A4 portrait; margin: 8mm; }
  @page Section1 { size: 595.3pt 841.9pt; mso-page-orientation: portrait; mso-header-margin:5.4pt; mso-footer-margin:5.4pt; mso-page-scale:100; }
  html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{width:560pt;max-width:560pt;margin:8pt auto 0 auto}
  table{border-collapse:collapse;width:560pt;font-family:'Microsoft YaHei',Arial;margin-top:0;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt}
  td,th{border:1px solid #8f99ab;padding:9px 7px;font-size:15px;line-height:1.4;vertical-align:middle;word-break:break-all;mso-number-format:'\@';mso-line-height-rule:exactly}
  tr{height:34px}
  .t{font-size:24px;font-weight:900;text-align:center;border:none !important;line-height:1.25}
  .s{font-weight:800;background:#fafafa}
  .sec{font-weight:900;text-align:left;border:1px solid #7f8899;background:#f3f4f6;font-size:16px;height:38px}
  .c{text-align:center}
  .big{font-size:22px;font-weight:900;padding:12px 9px;line-height:1.45;min-height:46px}
  .film-big{font-size:20px;font-weight:900;text-align:center;padding:12px 9px;line-height:1.45;min-height:46px}
  .prod{font-size:30px;font-weight:900;line-height:1.45;padding:14px 10px;min-height:56px}
  .h36{height:36px}.h40{height:40px}.h46{height:46px}.h52{height:52px}
  .mat16{font-size:14px !important;font-weight:700;text-align:center;line-height:1.25;white-space:normal;word-break:break-all}
  </style></head><body class='Section1'>
  <div class='sheet'><table>
  <colgroup><col style='width:84pt'/><col style='width:112pt'/><col style='width:84pt'/><col style='width:112pt'/><col style='width:84pt'/><col style='width:72pt'/><col style='width:104pt'/><col style='width:76pt'/></colgroup>
  <tr><th class='t' colspan='8' style='border:none;padding-bottom:2px'>潮安区华胜印刷有限公司生产工作表</th></tr>
  <tr><td colspan='8' style='border:none;text-align:right;padding:0 2px 8px 0;font-size:13px;font-weight:700'>压辊：<span style='font-size:18px'>${esc(row.roller||'-')}</span></td></tr>

  <tr><td class='sec' colspan='8'>一、基础信息</td></tr>
  <tr class='h40'><td class='s'>日期</td><td>${esc(p.date || fmtBjTime(row.created_at||'').slice(0,10))}</td><td class='s'>业务员</td><td>${esc(row.salesperson_name)}</td><td class='s'>编号</td><td>${esc(row.work_no||'')}</td><td class='s'>客户</td><td>${esc(row.customer_name)}</td></tr>
  <tr class='h40'><td class='s'>订单ID</td><td>${esc(row.order_id||'')}</td><td class='s'>规格</td><td colspan='5'>${esc(row.spec)}</td></tr>
  <tr><td class='s'>品名</td><td colspan='7' style='font-size:28px;font-weight:900;line-height:1.35;padding:12px 8px;word-break:break-all'>${esc(row.product_name)}</td></tr>

  <tr><td class='sec' colspan='8'>一、印膜信息</td></tr>
  <tr class='h40'><td class='s'>参考色</td><td colspan='3'>${esc(p.refColor||'')}</td><td class='s'>油墨要求</td><td>${esc(p.inkRequirement||'')}</td><td class='s'>交货日期</td><td>${esc(row.delivery_date||'')}</td></tr>
  <tr class='h52'><td class='s'>印膜</td><td colspan='7' class='film-big' style='text-align:center;font-size:20px;font-weight:900'>${esc(printFilmDisplay)}</td></tr>
  <tr class='h40'><td class='s'>订单数量</td><td>${esc(row.quantity||'')}</td><td class='s'>开单数量</td><td colspan='2'>${esc(p.printQty||'')}</td><td class='s'>印刷米数</td><td colspan='2'>${esc(p.printShift||'')}</td></tr>
  <tr class='h46'><td class='s'>备注</td><td colspan='7' class='big'>${esc(row.remark||'')}</td></tr>

  <tr><td class='sec' colspan='8'>二、覆膜工艺</td></tr>
  <tr class='h52'><td class='s'>覆膜工艺</td><td colspan='3'>${esc(p.filmType||'')}</td><td class='s c'>第一层</td><td class='mat16'>${esc(p.layer1||'')}</td><td class='mat16'>${esc(p.l1Size||'')}</td><td class='mat16'>${esc(p.l1Weight||'')}</td></tr>
  <tr class='h52'><td class='s' rowspan='3'>覆膜要求</td><td colspan='3' rowspan='3' style='vertical-align:top'>${esc(p.filmNote||'')}</td><td class='s c'>第二层</td><td class='mat16'>${esc(p.layer2||'')}</td><td class='mat16'>${esc(p.l2Size||'')}</td><td class='mat16'>${esc(p.l2Weight||'')}</td></tr>
  <tr class='h52'><td class='s c'>第三层</td><td class='mat16'>${esc(p.layer3||'')}</td><td class='mat16'>${esc(p.l3Size||'')}</td><td class='mat16'>${esc(p.l3Weight||'')}</td></tr>
  <tr class='h52'><td class='s c'>第四层</td><td class='mat16'>${esc(p.layer4||'')}</td><td class='mat16'>${esc(p.l4Size||'')}</td><td class='mat16'>${esc(p.l4Weight||'')}</td></tr>

  <tr><td class='sec' colspan='8'>三、制袋与交付</td></tr>
  <tr class='h40'><td class='s'>袋型</td><td>${esc(row.bag_type||'')}</td><td class='s'>是否外加工</td><td>${esc(p.outsource||'')}</td><td class='s'></td><td></td><td class='s'></td><td></td></tr>
  <tr class='h40'><td class='s'>拉链位置</td><td>${esc(p.zipPos||'')}</td><td class='s'>撕口位置</td><td>${esc(p.tearPos||'')}</td><td class='s'>挂孔位置</td><td>${esc(p.holePos||'')}</td><td class='s'></td><td></td></tr>
  <tr class='h40'><td class='s'>孔位</td><td colspan='3'>${holes.includes('圆孔')?'√圆孔 ':''}${holes.includes('飞机孔')?'√飞机孔 ':''}${holes.includes('手提孔')?'√手提孔 ':''}</td><td class='s'>封边</td><td colspan='3'>${edges.includes('上封')?'√上封 ':''}${edges.includes('边封')?'√边封 ':''}${edges.includes('下封')?'√下封 ':''}${p.edgeCm?`（${esc(p.edgeCm)}）`:''}</td></tr>
  <tr class='h46'><td class='s'>其它要求</td><td colspan='7'>${esc(p.otherReq||'')}</td></tr>

  <tr><td class='sec' colspan='8'>四、装箱信息</td></tr>
  <tr><td class='s'>装箱类型</td><td>${esc(p.packType||'')}</td><td class='s'>装箱规格</td><td>${esc(p.boxSpec||'')}</td><td class='s'>实际成品数量</td><td>${esc(p.actualQty||'')}</td><td class='s'>装箱人签名</td><td>${esc(p.packerSign||'')}</td></tr>

  <tr><td class='s'>备注</td><td colspan='7'>${esc(row.remark||'')}</td></tr>
  <tr><td class='s'>创建人/时间</td><td colspan='7'>${esc(row.created_by)} / ${esc(fmtBjTime(row.created_at || ''))}</td></tr>
  </table></div></body></html>`;
}

function workOrderHtmlWps(row){
  // WPS 专用：直接输出 SpreadsheetML，避免 HTML 被 WPS 打印引擎误缩放
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);

  const x = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const holes = String(p.holes || '');
  const edges = String(p.edges || '');
  const holeText = `${holes.includes('圆孔')?'√圆孔 ':''}${holes.includes('飞机孔')?'√飞机孔 ':''}${holes.includes('手提孔')?'√手提孔 ':''}`.trim();
  const edgeText = `${edges.includes('上封')?'√上封 ':''}${edges.includes('边封')?'√边封 ':''}${edges.includes('下封')?'√下封 ':''}${p.edgeCm?`（${p.edgeCm}）`:''}`.trim();
  const printFilmDisplay = composePrintFilmDisplay(p, row.remark || '');
  const filmMaxLen = Math.max(String(p.layer1||'').length,String(p.l1Size||'').length,String(p.l1Weight||'').length,String(p.layer2||'').length,String(p.l2Size||'').length,String(p.l2Weight||'').length,String(p.layer3||'').length,String(p.l3Size||'').length,String(p.l3Weight||'').length,String(p.layer4||'').length,String(p.l4Size||'').length,String(p.l4Weight||'').length);
  const filmRowH = filmMaxLen >= 22 ? 56 : (filmMaxLen >= 14 ? 46 : 36);
  const rowXml = (cells, h = 30) => `<Row ss:AutoFitHeight="0" ss:Height="${h}">${cells.map(c=>`<Cell ss:StyleID="${c.s||'sText'}"${c.m?` ss:MergeAcross="${c.m}"`:''}><Data ss:Type="String">${x(c.v||'')}</Data></Cell>`).join('')}</Row>`;

  return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n<Styles>\n<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="12"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8F99AB"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8F99AB"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8F99AB"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8F99AB"/></Borders></Style>\n<Style ss:ID="sTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="18"/></Style>\n<Style ss:ID="sSec"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="13"/><Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/></Style>\n<Style ss:ID="sLabel"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="12"/><Interior ss:Color="#FAFAFA" ss:Pattern="Solid"/></Style>\n<Style ss:ID="sText"><Font ss:FontName="Microsoft YaHei" ss:Size="12"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>\n<Style ss:ID="sRight"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="12"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>\n<Style ss:ID="sMat16"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="16"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>\n<Style ss:ID="sProd"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="22"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>\n<Style ss:ID="sBig"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="16"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>\n<Style ss:ID="sFilmBig"><Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Size="20"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>\n</Styles>\n<Worksheet ss:Name="生产工作表"><Table ss:ExpandedColumnCount="8" x:FullColumns="1" x:FullRows="1" ss:DefaultRowHeight="30">\n<Column ss:Width="84"/><Column ss:Width="112"/><Column ss:Width="84"/><Column ss:Width="112"/><Column ss:Width="84"/><Column ss:Width="72"/><Column ss:Width="104"/><Column ss:Width="76"/>\n${rowXml([{v:'潮安区华胜印刷有限公司生产工作表',s:'sTitle',m:7}],40)}\n${rowXml([{v:'',m:5},{v:`压辊：${row.roller || '-'}`,s:'sRight',m:1}],30)}\n${rowXml([{v:'日期',s:'sLabel'},{v:p.date || fmtBjTime(row.created_at||'').slice(0,10)},{v:'业务员',s:'sLabel'},{v:row.salesperson_name},{v:'编号',s:'sLabel'},{v:row.work_no||''},{v:'客户',s:'sLabel'},{v:row.customer_name}],32)}\n${rowXml([{v:'订单ID',s:'sLabel'},{v:row.order_id||''},{v:'规格',s:'sLabel'},{v:row.spec,m:4}],32)}\n${rowXml([{v:'品名',s:'sLabel'},{v:row.product_name,s:'sProd',m:6}],52)}\n${rowXml([{v:'一、印膜信息',s:'sSec',m:7}],32)}\n${rowXml([{v:'参考色',s:'sLabel'},{v:p.refColor||'',m:2},{v:'油墨要求',s:'sLabel'},{v:p.inkRequirement||''},{v:'交货日期',s:'sLabel'},{v:row.delivery_date||''}],32)}\n${rowXml([{v:'印膜',s:'sLabel'},{v:printFilmDisplay,s:'sFilmBig',m:6}],42)}\n${rowXml([{v:'订单数量',s:'sLabel'},{v:row.quantity||''},{v:'开单数量',s:'sLabel'},{v:p.printQty||'',m:1},{v:'印刷米数',s:'sLabel'},{v:p.printShift||'',m:1}],32)}\n${rowXml([{v:'备注',s:'sLabel'},{v:row.remark||'',s:'sBig',m:6}],42)}\n${rowXml([{v:'二、覆膜工艺',s:'sSec',m:7}],32)}\n${rowXml([{v:'覆膜工艺',s:'sLabel'},{v:p.filmType||'',m:2},{v:'第一层',s:'sLabel'},{v:p.layer1||'',s:'sMat16'},{v:p.l1Size||'',s:'sMat16'},{v:p.l1Weight||'',s:'sMat16'}],filmRowH)}\n${rowXml([{v:'覆膜要求',s:'sLabel'},{v:p.filmNote||'',m:2},{v:'第二层',s:'sLabel'},{v:p.layer2||'',s:'sMat16'},{v:p.l2Size||'',s:'sMat16'},{v:p.l2Weight||'',s:'sMat16'}],filmRowH)}\n${rowXml([{v:'',s:'sLabel'},{v:'',m:2},{v:'第三层',s:'sLabel'},{v:p.layer3||'',s:'sMat16'},{v:p.l3Size||'',s:'sMat16'},{v:p.l3Weight||'',s:'sMat16'}],filmRowH)}\n${rowXml([{v:'',s:'sLabel'},{v:'',m:2},{v:'第四层',s:'sLabel'},{v:p.layer4||'',s:'sMat16'},{v:p.l4Size||'',s:'sMat16'},{v:p.l4Weight||'',s:'sMat16'}],filmRowH)}\n${rowXml([{v:'三、制袋与交付',s:'sSec',m:7}],32)}\n${rowXml([{v:'袋型',s:'sLabel'},{v:row.bag_type||''},{v:'是否外加工',s:'sLabel'},{v:p.outsource||''},{v:'',s:'sLabel'},{v:''},{v:'',s:'sLabel'},{v:''}],32)}\n${rowXml([{v:'拉链位置',s:'sLabel'},{v:p.zipPos||''},{v:'撕口位置',s:'sLabel'},{v:p.tearPos||''},{v:'挂孔位置',s:'sLabel'},{v:p.holePos||''},{v:'',s:'sLabel'},{v:''}],32)}\n${rowXml([{v:'孔位',s:'sLabel'},{v:holeText,m:2},{v:'封边',s:'sLabel'},{v:edgeText,m:2}],32)}\n${rowXml([{v:'其它要求',s:'sLabel'},{v:p.otherReq||'',m:6}],36)}\n${rowXml([{v:'四、装箱信息',s:'sSec',m:7}],32)}\n${rowXml([{v:'装箱类型',s:'sLabel'},{v:p.packType||''},{v:'装箱规格',s:'sLabel'},{v:p.boxSpec||''},{v:'实际成品数量',s:'sLabel'},{v:p.actualQty||''},{v:'装箱人签名',s:'sLabel'},{v:p.packerSign||''}],32)}\n${rowXml([{v:'创建人/时间',s:'sLabel'},{v:`${row.created_by || ''} / ${fmtBjTime(row.created_at || '')}`,m:6}],32)}\n</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Portrait"/><Header x:Margin="0.2"/><Footer x:Margin="0.2"/><PageMargins x:Bottom="0.35" x:Left="0.25" x:Right="0.25" x:Top="0.35"/></PageSetup><FitToPage/><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight><ValidPrinterInfo/></Print><Zoom>100</Zoom></WorksheetOptions></Worksheet></Workbook>`;
}

const BAG_TYPES = ['自立拉链','自立','单拉链','八边封','三边封','背封','四边封','自动包','异形'];
const CUSTOMER_BAG_MAP_PATH = path.join(__dirname, '..', '..', 'data', 'customer_bag_map.json');
const PDF_FONT_PATH = path.join(__dirname, '..', '..', 'data', 'fonts', 'NotoSansSC-Regular.otf');
const productOptionsCache = new Map();
let customerBagMapCache = null;
let customerBagMapMtime = 0;
function loadCustomerBagMap(){
  try{
    const st=fs.statSync(CUSTOMER_BAG_MAP_PATH);
    if(!customerBagMapCache || st.mtimeMs!==customerBagMapMtime){
      customerBagMapCache=JSON.parse(fs.readFileSync(CUSTOMER_BAG_MAP_PATH,'utf8'));
      customerBagMapMtime=st.mtimeMs;
    }
  }catch(_){ customerBagMapCache={}; }
  return customerBagMapCache||{};
}

const PRODUCT_PREFILL_MAP_PATH = path.join(__dirname, '..', '..', 'data', 'product_prefill_map.json');
const MATERIAL_OPTIONS_PATH = path.join(__dirname, '..', '..', 'data', 'material_options.json');
let materialOptionsCache = null;
let materialOptionsMtime = 0;
function loadMaterialOptions(){
  try{
    const st=fs.statSync(MATERIAL_OPTIONS_PATH);
    if(!materialOptionsCache || st.mtimeMs!==materialOptionsMtime){
      materialOptionsCache=JSON.parse(fs.readFileSync(MATERIAL_OPTIONS_PATH,'utf8'));
      materialOptionsMtime=st.mtimeMs;
    }
  }catch(_){ materialOptionsCache={ names: [] }; }
  if(!Array.isArray(materialOptionsCache.names)) materialOptionsCache.names=[];
  return materialOptionsCache;
}
function saveMaterialOptions(data={ names: [] }){
  const payload={ names: Array.isArray(data.names)?data.names:[] };
  fs.writeFileSync(MATERIAL_OPTIONS_PATH, JSON.stringify(payload,null,2),'utf8');
  materialOptionsCache=payload;
  try{ materialOptionsMtime=fs.statSync(MATERIAL_OPTIONS_PATH).mtimeMs; }catch(_){ materialOptionsMtime=Date.now(); }
}

let productPrefillMapCache = null;
let productPrefillMapMtime = 0;
function loadProductPrefillMap(){
  try{
    const st=fs.statSync(PRODUCT_PREFILL_MAP_PATH);
    if(!productPrefillMapCache || st.mtimeMs!==productPrefillMapMtime){
      productPrefillMapCache=JSON.parse(fs.readFileSync(PRODUCT_PREFILL_MAP_PATH,'utf8'));
      productPrefillMapMtime=st.mtimeMs;
    }
  }catch(_){ productPrefillMapCache={}; }
  return productPrefillMapCache||{};
}

function detectBagType(text=''){
  const t=String(text||'');
  for(const b of BAG_TYPES){ if(t.includes(b)) return b; }
  return '';
}
function stripDateSuffix(text=''){
  return String(text||'')
    .replace(/(20\d{2}[./-]\d{1,2}([./-]\d{1,2})?|\d{1,2}[./-]\d{1,2})\s*$/,'')
    .replace(/\s+/g,' ')
    .trim();
}
function mdDate(ts = new Date()){
  const m = String(ts.getMonth()+1).padStart(2,'0');
  const d = String(ts.getDate()).padStart(2,'0');
  return `${m}.${d}`;
}
function fmtBjTime(ts=''){
  const s = String(ts || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return bj.toISOString().slice(0, 19).replace('T', ' ');
  }
  return s.replace('T', ' ').replace('Z', '');
}

function hydrateLayerFields(rowLike, p = {}) {
  const out = { ...(p || {}) };
  const miss = !(out.l1Size && out.l1Weight && out.l2Size && out.l2Weight && out.l3Size && out.l3Weight && out.l4Size && out.l4Weight);
  if (!miss) return out;
  try {
    const map = loadProductPrefillMap();
    const sales = safe(rowLike.salesperson_name || rowLike.salespersonName || '');
    const customer = safe(rowLike.customer_name || rowLike.customerName || '');
    const productRaw = safe(rowLike.product_name || rowLike.productName || '');
    const product = stripDateSuffix(productRaw);
    const prof = (((map || {})[sales] || {})[customer] || {})[product] || {};
    out.l1Size = out.l1Size || prof.l1Size || '';
    out.l1Weight = out.l1Weight || prof.l1Weight || '';
    out.layer1 = out.layer1 || prof.layer1 || '';
    out.l2Size = out.l2Size || prof.l2Size || '';
    out.l2Weight = out.l2Weight || prof.l2Weight || '';
    out.layer2 = out.layer2 || prof.layer2 || '';
    out.l3Size = out.l3Size || prof.l3Size || '';
    out.l3Weight = out.l3Weight || prof.l3Weight || '';
    out.layer3 = out.layer3 || prof.layer3 || '';
    out.l4Size = out.l4Size || prof.l4Size || '';
    out.l4Weight = out.l4Weight || prof.l4Weight || '';
    out.layer4 = out.layer4 || prof.layer4 || '';
  } catch (_) {}
  return out;
}

function normalizeCustomerName(name=''){
  let s=String(name||'').trim();
  // 去前缀噪声（如“0添加”）
  s=s.replace(/^[0-9零一二三四五六七八九十]+\s*(添加|新增)?/,'');
  // 去括号备注
  s=s.replace(/[（(][^）)]*[）)]/g,'');
  // 去日期尾巴/中间日期（09.29 / 2025.01.03 / 12-26）
  s=s.replace(/(20\d{2}[./-]\d{1,2}([./-]\d{1,2})?|\d{1,2}[./-]\d{1,2})/g,' ');
  // 去重量规格噪声
  s=s.replace(/\d+(\.\d+)?\s*(克|千克|kg|KG|g|G)/g,' ');
  // 去袋型词
  BAG_TYPES.forEach(b=>{ s=s.replace(new RegExp(b,'g'),' '); });
  // 去常见修饰词
  s=s.replace(/有文字|无文字|新版|改版|通用|包装袋|生产单|样品|按样|\+|，|,|\s+/g,' ');
  s=s.trim();
  // 取首个主体词作为客户名（避免把口味/日期并入客户）
  const parts = s.split(/[\s、,，]+/).filter(Boolean);
  if (parts.length > 0) s = parts[0];
  // 再兜底：保留前1段连续中文英文数字
  const m = s.match(/[\u4e00-\u9fffA-Za-z0-9]{2,12}/);
  if (m) s = m[0];
  return s.trim();
}

function saveWorkOrderImage({ imageUrl = '', imageDataUrl = '', workNo = '' }) {
  let finalUrl = '';
  const inUrl = String(imageUrl || '').trim();
  const inData = String(imageDataUrl || '').trim();
  if (inUrl) {
    if (!/^https?:\/\//i.test(inUrl) && !inUrl.startsWith('/uploads/')) {
      throw new Error('图片地址必须是 http(s) 或 /uploads/ 开头');
    }
    finalUrl = inUrl;
  } else if (inData) {
    const m = inData.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
    if (!m) throw new Error('图片格式仅支持 png/jpeg/webp 的 dataUrl');
    const mime = m[1].toLowerCase();
    const b64 = m[3];
    const ext = mime.includes('png') ? 'png' : (mime.includes('webp') ? 'webp' : 'jpg');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 6 * 1024 * 1024) throw new Error('图片不能超过6MB');
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'orders');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${Date.now()}_${(workNo || 'wo').replace(/[^\w-]/g, '')}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    finalUrl = `/uploads/orders/${fileName}`;
  }
  return finalUrl;
}


function normalizeMaterialName(name=''){
  return String(name||'').trim().replace(/\s+/g,' ').toUpperCase();
}
function normalizeLayerSize(size=''){
  const raw=String(size||'').trim().toLowerCase().replace(/\s+/g,'');
  if(!raw) return '';
  const m=raw.match(/^(\d+(?:\.\d+)?)[x×\*](\d+(?:\.\d+)?)(c|cm|㎝)?$/i);
  if(m){
    const unit=(m[3]||'c').toLowerCase()==='cm'?'cm':'c';
    return `${m[1]}*${m[2]}${unit}`;
  }
  return raw.replace(/[x×]/g,'*');
}
function normalizeLayerWeightText(weight=''){
  const raw=String(weight||'').trim().toLowerCase().replace(/\s+/g,'');
  if(!raw) return '';
  const m=raw.match(/^(\d+(?:\.\d+)?)(kg|千克|公斤|g|克|吨|t|米|m|粒)?$/i);
  if(!m) return raw;
  const n=Number(m[1]);
  if(!Number.isFinite(n) || n<=0) return '';
  const u=(m[2]||'kg').toLowerCase();
  if(u==='克' || u==='g') return `${n}g`;
  if(u==='吨' || u==='t') return `${n}吨`;
  if(u==='米' || u==='m') return `${n}米`;
  if(u==='粒') return `${n}粒`;
  return `${n}kg`;
}

function validateLayerTriples(_p = {}) {
  const p = _p || {};
  const errs = [];
  for (let i = 1; i <= 4; i++) {
    const layer = String(p[`layer${i}`] || '').trim();
    const size = String(p[`l${i}Size`] || '').trim();
    const weight = String(p[`l${i}Weight`] || '').trim();
    if (size && !/^[0-9]+(?:\.[0-9]+)?[x×*][0-9]+(?:\.[0-9]+)?(?:c|cm|㎝)?$/i.test(size.replace(/\s+/g, ''))) {
      errs.push(`第${i}层尺寸格式建议为 55*10c`);
    }
    if (weight && !/^[0-9]+(?:\.[0-9]+)?\s*(kg|千克|公斤|g|克|吨|t|米|m|粒)?$/i.test(weight)) {
      errs.push(`第${i}层数量仅支持数字+单位（kg/g/吨/米/粒）`);
    }
    if ((layer || weight) && !size) {
      errs.push(`第${i}层已填写材质/重量时，需填写尺寸`);
    }
  }
  return errs;
}

function inferPrintFilmText(p = {}, remark = '') {
  const direct = p.printFilm || p.printMold || p.print_film || p.print_mold || '';
  if (String(direct).trim()) return String(direct).trim();
  const fromRemark = (String(remark || '').match(/印膜[:：]\s*([^；,，\n]+)/) || [])[1] || '';
  if (String(fromRemark).trim()) return String(fromRemark).trim();

  const qty = String(p.printQty || p.print_qty || '').trim();
  // 历史口径里常把“材料尺寸 + 印多少米/粒”写在印刷数量字段
  const size = (qty.match(/([A-Za-z\u4e00-\u9fa5]+\s*\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?\s*c?)/) || [])[1] || '';
  const run = (qty.match(/(\d+(?:\.\d+)?\s*(?:米|m|M|粒))/) || [])[1] || '';
  if (size && run) return `${size.replace(/\s+/g,'')} ${run}`;
  if (qty) return qty;
  return '';
}

function composePrintFilmDisplay(p = {}, remark = '') {
  const material = String(p.printMold || '').trim();
  const size = String(p.printFilmSize || '').trim();
  const qtyRaw = String(p.printFilmQty || '').trim();
  const unit = String(p.printFilmUnit || '').trim();
  const qtyWithUnit = qtyRaw ? (unit && !qtyRaw.endsWith(unit) ? `${qtyRaw}${unit}` : qtyRaw) : '';

  if (material && qtyWithUnit && size) {
    // 数量与规格之间保留 3 个半角空格
    return `${material}  ${qtyWithUnit}   ${size}`;
  }
  if (material && qtyWithUnit) return `${material}  ${qtyWithUnit}`;
  if (material && size) return `${material}　　　${size}`;

  return String(p.printFilm || p.printMold || p.printQty || inferPrintFilmText(p, remark) || '').trim();
}

function historyProfileByProduct(salespersonName = '', customerName = '') {
  const rows = db.prepare(`
    SELECT product_name, process_requirements_json, remark, updated_at, id
    FROM work_orders
    WHERE salesperson_name=? AND customer_name=?
    ORDER BY id DESC
    LIMIT 1200
  `).all(String(salespersonName || ''), String(customerName || ''));
  const out = {};
  rows.forEach(r => {
    const key = stripDateSuffix(r.product_name || '');
    if (!key || out[key]) return;
    let p = {};
    try { p = JSON.parse(r.process_requirements_json || '{}'); } catch {}
    const film = inferPrintFilmText(p, r.remark || '');
    out[key] = {
      printMold: film,
      printFilm: film,
      remark: r.remark || p.remark || '',
      printQty: p.printQty || p.print_qty || '',
      printShift: p.printShift || ''
    };
  });
  return out;
}

async function sendWorkOrderEmail({ workNo = '', to = '', cc = '', row = {}, p = {} }) {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user || '';
  if (!host || !user || !pass || !from) {
    return { ok: false, error: '未配置SMTP（SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM）' };
  }

  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  const lines = [
    `开单号：${workNo}`,
    `客户：${safe(row.customer_name)}`,
    `品名：${safe(row.product_name)}`,
    `袋型：${safe(row.bag_type)}`,
    `规格：${safe(row.spec)}`,
    `订单数量：${safe(row.quantity)}`,
    `压辊：${safe(row.roller || p.roller || '-')}`,
    `印膜：${safe(composePrintFilmDisplay(p, row.remark || ''))}`,
    `备注：${safe(row.remark || '')}`
  ];

  const rowLike = { ...row, process_requirements_json: JSON.stringify(p || {}) };
  const xlsHtml = workOrderHtml(rowLike);
  const pdfBuf = await generateWorkOrderPdfBuffer(rowLike, p || {});

  await transporter.sendMail({
    from,
    to,
    cc: cc || undefined,
    subject: `生产开单通知 ${workNo}`,
    text: lines.join('\n'),
    html: xlsHtml,
    attachments: [
      { filename: `work_order_${workNo}.xls`, content: Buffer.from(xlsHtml, 'utf8'), contentType: 'application/vnd.ms-excel' },
      { filename: `work_order_${workNo}.pdf`, content: pdfBuf, contentType: 'application/pdf' }
    ]
  });
  return { ok: true };
}

function nextWorkNo(salespersonId, salespersonCode = 'YW') {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const code = (salespersonCode || `YW${String(salespersonId || '').padStart(2, '0')}`).toUpperCase();
  const prefix = `${code}-${ym}-`;
  const row = db.prepare('SELECT work_no FROM work_orders WHERE work_no LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`);
  let seq = 1;
  if (row && row.work_no) {
    const m = String(row.work_no).match(/-(\d{4})$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

router.get('/meta', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const salespersons = db.prepare('SELECT id, name, code, active FROM salespersons WHERE active=1 ORDER BY name').all();
  const customers = db.prepare('SELECT id, salesperson_id, name, contact, phone, default_bag_type, default_spec, default_use_case, default_roller, notes FROM customers WHERE active=1 ORDER BY name').all();
  const bySales = {};
  salespersons.forEach(s => { bySales[s.id] = { ...s, customers: [] }; });

  const map = loadCustomerBagMap();
  customers.forEach(c => {
    if (!bySales[c.salesperson_id]) return;
    const salesName = bySales[c.salesperson_id].name;
    const bagNameOptions = (map[salesName] && map[salesName][c.name]) ? map[salesName][c.name] : {};
    const bagTypes = Object.keys(bagNameOptions).filter(x=>x && x!=='未识别');
    bySales[c.salesperson_id].customers.push({
      id: c.id,
      salesperson_id: c.salesperson_id,
      name: c.name,
      rawNames: [c.name],
      bagTypes: bagTypes.length ? bagTypes : BAG_TYPES,
      bagNameOptions,
      default_spec: c.default_spec || '',
      default_use_case: c.default_use_case || '',
      default_roller: c.default_roller || '',
      notes: c.notes || ''
    });
  });

  Object.values(bySales).forEach(s => s.customers.sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN')));

  const lastMail = db.prepare(`
    SELECT email_to
    FROM work_orders
    WHERE created_by = ? AND email_to IS NOT NULL AND TRIM(email_to) <> ''
    ORDER BY id DESC
    LIMIT 1
  `).get(req.user.userName || '');

  const materialNameMap = new Map();
  const sizeMap = new Map();
  const weightMap = new Map();
  const addCount = (m, k) => { const key = String(k || '').trim(); if(!key) return; m.set(key, (m.get(key)||0)+1); };

  const rows = db.prepare('SELECT process_requirements_json FROM work_orders ORDER BY id DESC LIMIT 3000').all();
  rows.forEach(r=>{
    let p={};
    try{ p=JSON.parse(r.process_requirements_json||'{}'); }catch(_){ p={}; }
    for(let i=1;i<=4;i++){
      const n=normalizeMaterialName(p[`layer${i}`]||'');
      const sz=normalizeLayerSize(p[`l${i}Size`]||'');
      const w=normalizeLayerWeightText(p[`l${i}Weight`]||'');
      if(n) addCount(materialNameMap, n);
      if(sz) addCount(sizeMap, sz);
      if(w) addCount(weightMap, w);
    }
  });

  // 回退1：历史商品预填映射
  try {
    const pf = loadProductPrefillMap();
    Object.keys(pf||{}).forEach(sales=>{
      const byCus = pf[sales] || {};
      Object.keys(byCus).forEach(cus=>{
        const byProd = byCus[cus] || {};
        Object.keys(byProd).forEach(prod=>{
          const x = byProd[prod] || {};
          for(let i=1;i<=4;i++){
            const n=normalizeMaterialName(x[`layer${i}`]||'');
            const sz=normalizeLayerSize(x[`l${i}Size`]||'');
            const w=normalizeLayerWeightText(x[`l${i}Weight`]||'');
            if(n) addCount(materialNameMap, n);
            if(sz) addCount(sizeMap, sz);
            if(w) addCount(weightMap, w);
          }
        });
      });
    });
  } catch(_) {}

  const customMaterialOptions = loadMaterialOptions();
  (customMaterialOptions.names||[]).forEach(x=>addCount(materialNameMap, normalizeMaterialName(x)));

  // 回退2：兜底常用材料，保证下拉不为空
  ['PE','PET','VMPET','CPP','BOPP','NY','AL','MOPP','珠光膜','乳白PE'].forEach(x=>addCount(materialNameMap, normalizeMaterialName(x)));

  const toSorted=(m)=>[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,120).map(x=>x[0]);

  res.json({
    salespersons: Object.values(bySales),
    lastEmailTo: String(lastMail?.email_to || ''),
    materialOptions: {
      names: toSorted(materialNameMap),
      sizes: toSorted(sizeMap),
      weights: toSorted(weightMap)
    },
    bagPrefillDict: {
      '自立拉链': { filmType: '双组', packType: '纸箱', holes: '无', edges: '上封/边封/下封' },
      '自立': { filmType: '双组', packType: '纸箱', holes: '无', edges: '上封/边封/下封' },
      '三边封': { filmType: '普通', packType: '纸箱', holes: '无', edges: '上封/边封/下封' },
      '八边封': { filmType: '双组', packType: '纸箱', holes: '无', edges: '上封/边封/下封' },
      '背封': { filmType: '普通', packType: '编织袋', holes: '无', edges: '上封/下封' },
      '四边封': { filmType: '普通', packType: '纸箱', holes: '无', edges: '上封/边封/下封' },
      '自动包': { filmType: '普通', packType: '编织袋', holes: '无', edges: '上封/下封' },
      '异形': { filmType: '双组', packType: '纸箱', holes: '无', edges: '上封/边封/下封' }
    }
  });
});


router.post('/material-options', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const raw = String(req.body?.name || '').trim();
  const name = normalizeMaterialName(raw);
  if (!name) return res.status(400).json({ error: '材料名称不能为空' });
  const data = loadMaterialOptions();
  const arr = Array.isArray(data.names) ? data.names.map(x=>normalizeMaterialName(x)).filter(Boolean) : [];
  if (!arr.includes(name)) arr.unshift(name);
  saveMaterialOptions({ names: arr.slice(0, 500) });
  audit({ role: req.user.role, userName: req.user.userName, action: 'add_material_option', resourceType: 'work_order_material', resourceId: name, detail: name });
  res.json({ ok: true, name, names: arr.slice(0,500) });
});

router.post('/material-options/delete', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const raw = String(req.body?.name || '').trim();
  const name = normalizeMaterialName(raw);
  if (!name) return res.status(400).json({ error: '材料名称不能为空' });
  const data = loadMaterialOptions();
  const arr = Array.isArray(data.names) ? data.names.map(x=>normalizeMaterialName(x)).filter(Boolean) : [];
  const next = arr.filter(x => x !== name);
  saveMaterialOptions({ names: next.slice(0, 500) });
  audit({ role: req.user.role, userName: req.user.userName, action: 'delete_material_option', resourceType: 'work_order_material', resourceId: name, detail: name });
  res.json({ ok: true, name, names: next.slice(0,500) });
});

router.get('/product-options', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const salespersonId = Number(req.query.salespersonId || 0);
  const customerId = Number(req.query.customerId || 0);
  const limit = Math.min(800, Math.max(20, Number(req.query.limit || 300)));
  const q = String(req.query.q || '').trim();
  if (!salespersonId || !customerId) return res.json({ products: [], profiles: {}, truncated: false, total: 0 });
  const ck = `${salespersonId}:${customerId}:${limit}:${q}`;
  const hit = productOptionsCache.get(ck);
  if (hit && (Date.now() - hit.ts) < 5 * 60 * 1000) return res.json(hit.data);
  const sp = db.prepare('SELECT id, name FROM salespersons WHERE id=?').get(salespersonId);
  const cu = db.prepare('SELECT id, name FROM customers WHERE id=?').get(customerId);
  if (!sp || !cu) return res.json({ products: [], profiles: {}, truncated: false, total: 0 });

  const map = loadProductPrefillMap();
  const obj = (((map||{})[sp.name]||{})[cu.name]||{});

  const rowsRecent = db.prepare(`
    SELECT product_name, process_requirements_json, remark, updated_at, created_at
    FROM work_orders
    WHERE salesperson_id=? AND customer_id=?
    ORDER BY id DESC
    LIMIT 1200
  `).all(salespersonId, customerId);
  const lastAtMap = new Map();
  const recentProfileMap = new Map();
  rowsRecent.forEach(r => {
    const k = stripDateSuffix(r.product_name || '');
    if (!k) return;
    if (!lastAtMap.has(k)) lastAtMap.set(k, String(r.updated_at || r.created_at || ''));
    if (recentProfileMap.has(k)) return;
    let pr = {};
    try { pr = JSON.parse(r.process_requirements_json || '{}'); } catch (_) { pr = {}; }
    recentProfileMap.set(k, {
      layer1: normalizeMaterialName(pr.layer1 || pr.mat1 || ''),
      layer2: normalizeMaterialName(pr.layer2 || pr.mat2 || ''),
      layer3: normalizeMaterialName(pr.layer3 || pr.mat3 || ''),
      layer4: normalizeMaterialName(pr.layer4 || pr.mat4 || ''),
      l1Size: normalizeLayerSize(pr.l1Size || pr.l1_size || pr.size1 || ''),
      l2Size: normalizeLayerSize(pr.l2Size || pr.l2_size || pr.size2 || ''),
      l3Size: normalizeLayerSize(pr.l3Size || pr.l3_size || pr.size3 || ''),
      l4Size: normalizeLayerSize(pr.l4Size || pr.l4_size || pr.size4 || ''),
      l1Weight: normalizeLayerWeightText(pr.l1Weight || pr.l1_weight || pr.weight1 || ''),
      l2Weight: normalizeLayerWeightText(pr.l2Weight || pr.l2_weight || pr.weight2 || ''),
      l3Weight: normalizeLayerWeightText(pr.l3Weight || pr.l3_weight || pr.weight3 || ''),
      l4Weight: normalizeLayerWeightText(pr.l4Weight || pr.l4_weight || pr.weight4 || ''),
      filmType: pr.filmType || pr.film_type || '',
      filmNote: pr.filmNote || pr.film_note || '',
      printQty: pr.printQty || pr.print_qty || '',
      printShift: pr.printShift || pr.print_shift || '',
      printMold: pr.printMold || pr.printFilm || pr.print_film || '',
      remark: String(r.remark || '')
    });
  });

  let names = [...new Set([
    ...Object.keys(obj || {}),
    ...rowsRecent.map(r => stripDateSuffix(r.product_name || '')).filter(Boolean)
  ])].sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
  if (q) names = names.filter(n => String(n).includes(q));
  const total = names.length;
  const truncated = names.length > limit;
  if (truncated) names = names.slice(0, limit);

  const profiles = {};
  names.forEach(name => {
    const base = obj[name] || {};
    const recent = recentProfileMap.get(name) || {};
    profiles[name] = {
      ...recent,
      ...base,
      layer1: normalizeMaterialName(base.layer1 || base.mat1 || recent.layer1 || ''),
      layer2: normalizeMaterialName(base.layer2 || base.mat2 || recent.layer2 || ''),
      layer3: normalizeMaterialName(base.layer3 || base.mat3 || recent.layer3 || ''),
      layer4: normalizeMaterialName(base.layer4 || base.mat4 || recent.layer4 || ''),
      l1Size: normalizeLayerSize(base.l1Size || base.l1_size || recent.l1Size || ''),
      l2Size: normalizeLayerSize(base.l2Size || base.l2_size || recent.l2Size || ''),
      l3Size: normalizeLayerSize(base.l3Size || base.l3_size || recent.l3Size || ''),
      l4Size: normalizeLayerSize(base.l4Size || base.l4_size || recent.l4Size || ''),
      l1Weight: normalizeLayerWeightText(base.l1Weight || base.l1_weight || recent.l1Weight || ''),
      l2Weight: normalizeLayerWeightText(base.l2Weight || base.l2_weight || recent.l2Weight || ''),
      l3Weight: normalizeLayerWeightText(base.l3Weight || base.l3_weight || recent.l3Weight || ''),
      l4Weight: normalizeLayerWeightText(base.l4Weight || base.l4_weight || recent.l4Weight || ''),
      printMold: base.printMold || base.printFilm || recent.printMold || base.printQty || '',
      printFilm: base.printFilm || base.printMold || recent.printMold || base.printQty || '',
      remark: base.remark || recent.remark || '',
      printQty: base.printQty || recent.printQty || '',
      printShift: base.printShift || recent.printShift || '',
      lastUsedAt: String(base.lastUsedAt || base.updated_at || base.created_at || lastAtMap.get(name) || '')
    };
  });
  const payload = { products: names, profiles, truncated, total };
  productOptionsCache.set(ck, { ts: Date.now(), data: payload });
  if (productOptionsCache.size > 200) {
    const first = productOptionsCache.keys().next().value;
    if (first) productOptionsCache.delete(first);
  }
  res.json(payload);
});

router.get('/last-print-qty', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const salespersonId = Number(req.query.salespersonId || 0);
  const customerId = Number(req.query.customerId || 0);
  const productName = String(req.query.productName || '').trim();
  if (!salespersonId || !customerId || !productName) return res.json({ lastPrintQty: '' });

  const rows = db.prepare(`
    SELECT product_name, process_requirements_json, updated_at, created_at
    FROM work_orders
    WHERE salesperson_id=? AND customer_id=?
    ORDER BY id DESC
    LIMIT 120
  `).all(salespersonId, customerId);

  const target = stripDateSuffix(productName);
  let hit = '';
  for (const r of rows) {
    const pn = stripDateSuffix(r.product_name || '');
    if (pn !== target) continue;
    let p = {};
    try { p = JSON.parse(r.process_requirements_json || '{}'); } catch (_) { p = {}; }
    const qty = String(p.printQty || p.print_qty || '').trim();
    if (qty) { hit = qty; break; }
  }
  res.json({ lastPrintQty: hit });
});

router.get('/product-search', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const qRaw = String(req.query.q || '').trim();
  if (!qRaw) return res.json({ items: [] });
  const mode = String(req.query.mode || 'all') === 'any' ? 'any' : 'all'; // all=全部关键词（默认）

  const norm = (s = '') => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）\-_,，。·]/g, '');
  const q = norm(qRaw);
  const map = loadProductPrefillMap();
  const rows = [];

  const recentRows = db.prepare(`
    SELECT salesperson_name, customer_name, product_name, updated_at, created_at
    FROM work_orders
    ORDER BY id DESC
    LIMIT 3000
  `).all();
  const productLastAtMap = new Map();
  const customerLastAtMap = new Map();
  recentRows.forEach(r => {
    const sales = String(r.salesperson_name || '').trim();
    const customer = String(r.customer_name || '').trim();
    const product = String(stripDateSuffix(r.product_name || '')).trim();
    const ts = String(r.updated_at || r.created_at || '').trim();
    if (!sales || !customer || !ts) return;
    const ck = `${sales}__${customer}`;
    if (!customerLastAtMap.has(ck)) customerLastAtMap.set(ck, ts);
    if (!product) return;
    const pk = `${sales}__${customer}__${product}`;
    if (!productLastAtMap.has(pk)) productLastAtMap.set(pk, ts);
  });

  const splitTokens = (text = '') => {
    const base = String(text || '').trim();
    const byBlank = base.split(/\s+/).map(norm).filter(Boolean);
    if (byBlank.length > 1) return [...new Set(byBlank)];

    const n = q.length;
    const arr = [];
    // 无空格中文输入时，自动生成 2~4 字短词，支持“思红薯条”匹配“思红/薯条”
    for (let len = 2; len <= Math.min(4, n); len++) {
      for (let i = 0; i + len <= n; i++) arr.push(q.slice(i, i + len));
    }
    arr.push(q);
    return [...new Set(arr)].filter(x => x.length >= 2 || x === q);
  };

  const tokens = splitTokens(qRaw);
  const scoreText = (txtRaw = '') => {
    const txt = norm(txtRaw);
    if (!txt) return { score: 0, hits: [] };
    const matched = tokens.filter(t => t && txt.includes(t));
    if (mode === 'all' && tokens.length && matched.length < tokens.length) return { score: 0, hits: [] };
    if (mode === 'any' && matched.length === 0 && !txt.includes(q)) return { score: 0, hits: [] };

    let s = 0;
    if (txt.includes(q)) s += 120;
    matched.forEach(t => { s += Math.max(8, t.length * 6); });
    if (matched.length >= 2) s += matched.length * 10;
    return { score: s, hits: [...new Set(matched)] };
  };

  Object.entries(map || {}).forEach(([salesName, customers]) => {
    Object.entries(customers || {}).forEach(([customerName, products]) => {
      const customerText = `${salesName} ${customerName}`;
      const cHit = scoreText(customerText);
      if (cHit.score > 0) {
        const ck = `${salesName}__${customerName}`;
        rows.push({ kind: 'customer', salesName, customerName, productName: '', bagType: '', spec: '', lastUsedAt: String(customerLastAtMap.get(ck) || ''), _score: cHit.score + 5, _hits: cHit.hits });
      }
      Object.entries(products || {}).forEach(([productName, profile]) => {
        const txt = `${salesName} ${customerName} ${productName}`;
        const h1 = scoreText(txt);
        const h2 = scoreText(productName);
        const pScore = h1.score + h2.score * 0.35;
        if (pScore > 0) {
          const pk = `${salesName}__${customerName}__${stripDateSuffix(productName || '')}`;
          const productLastAt = String(productLastAtMap.get(pk) || '');
          const profileLastAt = String(profile?.lastUsedAt || profile?.updated_at || profile?.created_at || '');
          const tProfile = new Date(profileLastAt.replace(' ', 'T')).getTime() || 0;
          const tProduct = new Date(productLastAt.replace(' ', 'T')).getTime() || 0;
          // 商品开单时间优先按“商品维度”取值；不再回退客户时间，避免同客户所有商品显示同一时间
          const finalLastAt = tProduct > 0
            ? (tProduct >= tProfile ? productLastAt : profileLastAt)
            : (tProfile > 0 ? profileLastAt : '');
          rows.push({
            kind: 'product',
            salesName,
            customerName,
            productName,
            bagType: profile?.bagType || '',
            spec: profile?.spec || '',
            lastUsedAt: String(finalLastAt || ''),
            _score: pScore,
            _hits: [...new Set([...(h1.hits||[]), ...(h2.hits||[])])]
          });
        }
      });
    });
  });

  // 去重（同销售+客户+商品只留最高分）
  const bestMap = new Map();
  rows.forEach(x => {
    const key = `${x.kind}__${x.salesName}__${x.customerName}__${x.productName || ''}`;
    const old = bestMap.get(key);
    if (!old || Number(x._score || 0) > Number(old._score || 0)) bestMap.set(key, x);
  });

  const items = [...bestMap.values()];
  items.sort((a, b) => {
    const ta = new Date(String(a.lastUsedAt || '').replace(' ', 'T')).getTime() || 0;
    const tb = new Date(String(b.lastUsedAt || '').replace(' ', 'T')).getTime() || 0;
    if (ta !== tb) return tb - ta; // 越新越靠前
    const sa = Number(a._score || 0), sb = Number(b._score || 0);
    if (sa !== sb) return sb - sa;
    if (a.kind !== b.kind) return a.kind === 'product' ? -1 : 1;
    return String((a.productName || a.customerName)).localeCompare(String((b.productName || b.customerName)), 'zh-CN');
  });

  res.json({ items: items.slice(0, 160).map(({ _score, _hits, ...rest }) => ({ ...rest, hits: _hits || [] })) });
});

router.get('/', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const salespersonId = Number(req.query.salespersonId || 0);
  const customerId = Number(req.query.customerId || 0);
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSizeRaw = Number(req.query.pageSize || 20);
  const pageSize = [10, 20].includes(pageSizeRaw) ? pageSizeRaw : 20;
  const where = [];
  const params = [];
  if (salespersonId) { where.push('salesperson_id = ?'); params.push(salespersonId); }
  if (customerId) { where.push('customer_id = ?'); params.push(customerId); }
  if (q) {
    where.push('(work_no LIKE ? OR customer_name LIKE ? OR product_name LIKE ? OR spec LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM work_orders ${whereSql}`).get(...params).c;
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`SELECT * FROM work_orders ${whereSql} ORDER BY datetime(COALESCE(created_at, updated_at)) DESC, id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  res.json({
    total,
    page,
    pageSize,
    rows: rows.map(r => ({ ...r, process_requirements_json: JSON.parse(r.process_requirements_json || '{}') }))
  });
});

router.get('/preview-drafts', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const salespersonId = Number(req.query.salespersonId || 0);
  const q = String(req.query.q || '').trim();
  const where = ['created_by = ?'];
  const params = [req.user.userName || ''];
  if (salespersonId) { where.push('salesperson_id = ?'); params.push(salespersonId); }
  if (q) {
    where.push('(customer_name LIKE ? OR product_name LIKE ? OR spec LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db.prepare(`SELECT * FROM work_order_preview_drafts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 80`).all(...params);
  res.json({
    rows: rows.map(r => {
      let payload = {};
      try { payload = JSON.parse(r.payload_json || '{}'); } catch {}
      return { ...r, payload_json: payload };
    })
  });
});

router.delete('/preview-drafts/:id', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id 必填' });
  const hit = db.prepare('SELECT id FROM work_order_preview_drafts WHERE id=? AND created_by=?').get(id, req.user.userName || '');
  if (!hit) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM work_order_preview_drafts WHERE id=?').run(id);
  res.json({ ok: true, id });
});

router.get('/preview-drafts/:id', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id 必填' });
  const row = db.prepare('SELECT * FROM work_order_preview_drafts WHERE id=? AND created_by=?').get(id, req.user.userName || '');
  if (!row) return res.status(404).json({ error: '记录不存在' });
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch {}
  res.json({ ok: true, row: { ...row, payload_json: payload } });
});

router.post('/customers', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const { salespersonId, name, contact = '', phone = '', defaultBagType = '', defaultSpec = '', defaultUseCase = '', defaultRoller = '', notes = '' } = req.body || {};
  if (!salespersonId || !name) return res.status(400).json({ error: 'salespersonId/name 必填' });
  const ts = now();
  const ret = db.prepare(`
    INSERT INTO customers (salesperson_id, name, contact, phone, default_bag_type, default_spec, default_use_case, default_roller, notes, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(salesperson_id, name) DO UPDATE SET
      contact=excluded.contact,
      phone=excluded.phone,
      default_bag_type=excluded.default_bag_type,
      default_spec=excluded.default_spec,
      default_use_case=excluded.default_use_case,
      default_roller=excluded.default_roller,
      notes=excluded.notes,
      updated_at=excluded.updated_at
  `).run(Number(salespersonId), String(name).trim(), contact, phone, defaultBagType, defaultSpec, defaultUseCase, defaultRoller, notes, ts, ts);
  res.json({ ok: true, id: ret.lastInsertRowid || null });
});

router.patch('/customers/:id', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  const salespersonId = Number(req.body?.salespersonId || 0);
  const name = String(req.body?.name || '').trim();
  if (!id || !salespersonId || !name) return res.status(400).json({ error: 'id/salespersonId/name 必填' });
  const row = db.prepare('SELECT id FROM customers WHERE id=? AND salesperson_id=?').get(id, salespersonId);
  if (!row) return res.status(404).json({ error: '客户不存在' });
  db.prepare('UPDATE customers SET name=?, updated_at=? WHERE id=?').run(name, now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: 'rename_customer', resourceType: 'customer', resourceId: id, detail: name });
  res.json({ ok: true, id, name });
});

router.post('/', allowRoles('super_admin', 'manager', 'ai_sales'), async (req, res) => {
  const {
    salespersonId,
    customerId = null,
    customerName,
    productName,
    bagType,
    spec,
    quantity,
    deliveryDate = '',
    roller = '',
    remark = '',
    processRequirements = {},
    syncToOrder = false,
    emailTo = '',
    emailCc = '',
    imageUrl = '',
    imageDataUrl = '',
    urgency = 0
  } = req.body || {};

  if (!salespersonId || !customerName || !productName || !bagType || !spec || !quantity || !roller) {
    return res.status(400).json({ error: '业务员/客户/品名/袋型/规格/数量/压辊 必填' });
  }
  const prReq = processRequirements || {};
  if (!String(prReq.printMold || '').trim() || !String(prReq.printFilmSize || '').trim() || !(Number(prReq.printFilmQty || 0) > 0) || !String(prReq.printFilmUnit || '').trim()) {
    return res.status(400).json({ error: '印膜材料/印膜尺寸/印膜数量/印膜单位 必填' });
  }

  const sp = db.prepare('SELECT id, name, code FROM salespersons WHERE id=?').get(Number(salespersonId));
  if (!sp) return res.status(400).json({ error: '业务员不存在' });

  const ts = now();
  const workNo = nextWorkNo(sp.id, sp.code || `YW${sp.id}`);
  const baseName = stripDateSuffix(String(productName).trim());
  const saveDate = mdDate(new Date());
  const productNameSaved = `${baseName} ${saveDate}`.trim();
  const processReq = hydrateLayerFields({ salesperson_name: sp.name, customer_name: customerName, product_name: productNameSaved }, processRequirements || {});
  for (let i = 1; i <= 4; i++) {
    processReq[`layer${i}`] = normalizeMaterialName(processReq[`layer${i}`] || '');
    processReq[`l${i}Size`] = normalizeLayerSize(processReq[`l${i}Size`] || '');
    processReq[`l${i}Weight`] = normalizeLayerWeightText(processReq[`l${i}Weight`] || '');
  }
  const finalImageUrl = saveWorkOrderImage({ imageUrl, imageDataUrl, workNo });
  const resolvedEmailTo = String(emailTo || '').trim() || DEFAULT_WORKORDER_EMAIL;
  const resolvedEmailCc = String(emailCc || '').trim();

  const ret = db.prepare(`
    INSERT INTO work_orders (
      work_no, salesperson_id, customer_id, salesperson_name, customer_name, product_name, bag_type, spec, quantity,
      delivery_date, roller, remark, process_requirements_json, order_image_url,
      created_by, created_at, updated_at, sync_to_order, email_to, email_cc, email_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workNo,
    Number(sp.id),
    customerId ? Number(customerId) : null,
    sp.name,
    String(customerName).trim(),
    productNameSaved,
    String(bagType).trim(),
    String(spec).trim(),
    String(quantity).trim(),
    String(deliveryDate || ''),
    String(roller || ''),
    String(remark || ''),
    JSON.stringify(processReq || {}),
    finalImageUrl,
    req.user.userName,
    ts,
    ts,
    syncToOrder ? 1 : 0,
    resolvedEmailTo,
    resolvedEmailCc,
    'pending'
  );

  const workOrderId = ret.lastInsertRowid;
  let emailStatus = 'pending';
  let emailError = '';
  const sendRet = await sendWorkOrderEmail({
    workNo,
    to: resolvedEmailTo,
    cc: resolvedEmailCc,
    row: {
      customer_name: customerName,
      product_name: productNameSaved,
      bag_type: bagType,
      spec,
      quantity,
      roller,
      remark,
      created_by: req.user.userName,
      created_at: ts,
      delivery_date: String(deliveryDate || '')
    },
    p: processReq || {}
  }).catch(e => ({ ok: false, error: e?.message || '邮件发送失败' }));
  if (sendRet?.ok) {
    emailStatus = 'sent';
    audit({ role: req.user.role, userName: req.user.userName, action: 'work_order_mail_sent', resourceType: 'work_order', resourceId: workOrderId, detail: `to=${resolvedEmailTo};cc=${resolvedEmailCc || ''}` });
  } else {
    emailStatus = 'send_failed';
    emailError = String(sendRet?.error || '邮件发送失败');
  }
  db.prepare('UPDATE work_orders SET email_to=?, email_cc=?, email_status=?, email_error=?, updated_at=? WHERE id=?')
    .run(resolvedEmailTo, resolvedEmailCc, emailStatus, emailError, now(), workOrderId);

  let orderId = null;
  if (syncToOrder) {
    const useCase = [
      `品名：${productNameSaved}`,
      `规格：${spec}`,
      `数量：${quantity}`,
      roller ? `滚筒：${roller}` : '',
      remark ? `备注：${remark}` : ''
    ].filter(Boolean).join('；');

    const o = db.prepare(`
      INSERT INTO orders (
        customer_name, bag_type, use_case, size_json, order_qty, order_spec,
        status, urgency,
        assigned_print_worker, assigned_lamination_worker, assigned_bagging_worker, assigned_shipping_worker,
        created_by, start_time, created_at, updated_at
      ) VALUES (?, ?, ?, '{}', ?, ?, '印刷', ?, '', '', '', '', ?, ?, ?, ?)
    `).run(
      String(customerName).trim(),
      String(bagType).trim(),
      useCase,
      String(quantity).trim(),
      String(spec).trim(),
      Number(urgency)===1?1:0,
      req.user.userName,
      ts,
      ts,
      ts
    );
    orderId = o.lastInsertRowid;
    if (finalImageUrl) {
      db.prepare('UPDATE orders SET order_image_url=?, updated_at=? WHERE id=?').run(finalImageUrl, now(), orderId);
    }
    db.prepare('UPDATE work_orders SET order_id=?, sync_to_order=1, updated_at=?, email_status=?, email_error=? WHERE id=?')
      .run(orderId, now(), emailStatus, emailError, workOrderId);
  }

  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'create_work_order',
    resourceType: 'work_order',
    resourceId: workOrderId,
    detail: `${workNo}${orderId ? ` -> order#${orderId}` : ''}`
  });

  res.json({ ok: true, id: workOrderId, workNo, orderId, productNameSaved, emailQueued: true, emailTo: resolvedEmailTo, emailStatus });
});

router.post('/:id/send-email', allowRoles('super_admin', 'manager', 'ai_sales'), async (req, res) => {
  const id = Number(req.params.id || 0);
  const to = String(req.body?.to || '').trim();
  const cc = String(req.body?.cc || '').trim();
  if (!id || !to) return res.status(400).json({ error: '开单ID和收件邮箱必填' });
  const row = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '开单不存在' });
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);

  const ret = await sendWorkOrderEmail({ workNo: row.work_no || String(row.id), to, cc, row, p }).catch(e => ({ ok: false, error: e?.message || '发送失败' }));
  const status = ret?.ok ? 'sent' : 'send_failed';
  const err = ret?.ok ? '' : String(ret?.error || '发送失败');
  db.prepare('UPDATE work_orders SET email_to=?, email_cc=?, email_status=?, email_error=?, updated_at=? WHERE id=?')
    .run(to, cc, status, err, now(), id);
  audit({ role: req.user.role, userName: req.user.userName, action: ret?.ok ? 'work_order_mail_sent_manual' : 'work_order_mail_send_failed', resourceType: 'work_order', resourceId: id, detail: `to=${to};cc=${cc};status=${status}` });
  if (!ret?.ok) return res.status(500).json({ ok: false, error: err });
  res.json({ ok: true, status: 'sent' });
});

router.get('/:id/preview.xls', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '开单不存在' });
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);
  const issues = validateLayerTriples(p);
  if (issues.length) return res.status(400).json({ error: `预览已拦截：${issues.join('；')}` });
  const html = workOrderHtml(row);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/:id/export.wps.xls', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '开单不存在' });
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);
  const issues = validateLayerTriples(p);
  if (issues.length) return res.status(400).json({ error: `导出已拦截：${issues.join('；')}` });
  const html = workOrderHtmlWps(row);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="work_order_${row.work_no || row.id}_wps.xls"`);
  res.send(html);
});

router.get('/:id/export.xls', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '开单不存在' });
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);
  const issues = validateLayerTriples(p);
  if (issues.length) return res.status(400).json({ error: `导出已拦截：${issues.join('；')}` });
  // 普通Excel与WPS专用Excel统一边框样式（使用同一WPS模板）
  const html = workOrderHtmlWps(row);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="work_order_${row.work_no || row.id}.xls"`);
  res.send(html);
});

function fillWorkOrderPdfDoc(doc, row, p = {}) {
  try { if (fs.existsSync(PDF_FONT_PATH)) doc.font(PDF_FONT_PATH); } catch {}

  const width = doc.page.width - 90;
  const left = Math.round((doc.page.width - width) / 2);
  const top = 16;
  let y = top;
  const rowH = 28;
  const CW = [Math.round(width*0.12), Math.round(width*0.21), Math.round(width*0.12), Math.round(width*0.175), Math.round(width*0.18), width - Math.round(width*0.12) - Math.round(width*0.21) - Math.round(width*0.12) - Math.round(width*0.175) - Math.round(width*0.18)];
  const printFilmDisplay = composePrintFilmDisplay(p, row.remark || '');
  const drawRow = (cells, widths, header = false, rh = rowH) => {
    let x = left;
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i];
      const txt = String(cells[i] || '');
      const layerCenter = txt === '第一层' || txt === '第二层' || txt === '第三层';
      doc.lineWidth(header ? 1.3 : 1);
      doc.rect(x, y, w, rh).stroke('#5b6475');
      const fs = layerCenter ? 11 : (header ? 10.5 : 10);
      doc.fillColor('#111').fontSize(fs).text(txt, x + 4, y + 8, { width: w - 8, height: rh - 8, align: layerCenter ? 'center' : 'left' });
      x += w;
    }
    y += rh;
  };
  const drawSection = (title) => {
    doc.lineWidth(1.8);
    doc.rect(left, y, width, 24).stroke('#5b6475');
    doc.fillColor('#111').fontSize(11).text(String(title || ''), left + 6, y + 6, { width: width - 12, align: 'left' });
    y += 24;
  };
  const drawBigLabelValue = (label, value, rh = 38, valueFs = 14, labelFs = 11, valueAlign = 'left') => {
    doc.lineWidth(1);
    doc.rect(left, y, CW[0], rh).stroke('#5b6475');
    doc.fillColor('#111').fontSize(labelFs).text(String(label || ''), left + 4, y + 11, { width: CW[0] - 8, align: 'center' });
    doc.rect(left + CW[0], y, width - CW[0], rh).stroke('#5b6475');
    const valuePadX = valueAlign === 'center' ? 2 : 6;
    const valuePadTop = valueAlign === 'center' ? 8 : 10;
    doc.fillColor('#111').fontSize(valueFs).text(String(value || ''), left + CW[0] + valuePadX, y + valuePadTop, { width: width - CW[0] - valuePadX * 2, align: valueAlign });
    y += rh;
  };

  doc.fillColor('#111').fontSize(18).text('潮安区华胜印刷有限公司生产工作表', left, y + 8, { width, align: 'center' });
  const rollerLabel='压辊：';
  const rollerValue=String(row.roller || '-');
  const valueW = doc.fontSize(16).widthOfString(rollerValue);
  const rightX = left + width - 6;
  const valueX = rightX - valueW;
  const labelW = doc.fontSize(11).widthOfString(rollerLabel);
  const labelX = valueX - labelW - 1;
  const rollerY = y + 14;
  doc.fontSize(11).fillColor('#111').text(rollerLabel, labelX, rollerY, { lineBreak:false });
  doc.fontSize(16).fillColor('#111').text(rollerValue, valueX, rollerY - 2, { lineBreak:false });
  y += 34;

  drawRow(['日期', p.date || fmtBjTime(row.created_at || '').slice(0, 10), '业务员', row.salesperson_name, '编号', row.work_no || ''], CW, true);
  drawRow(['客户', row.customer_name || '', '订单ID', row.order_id || '', '规格', row.spec || ''], CW);
  const productText = String(row.product_name || '');
  const productW = width - CW[0] - 12;
  const productFontSize = 22;
  const productTextH = Math.max(32, Math.ceil(doc.fontSize(productFontSize).heightOfString(productText, { width: productW, align: 'left' })));
  const productRowH = Math.max(52, productTextH + 16);
  doc.rect(left, y, CW[0], productRowH).stroke('#5b6475');
  doc.fillColor('#111').fontSize(12).text('品名', left + 4, y + Math.max(10, (productRowH - 16) / 2), { width: CW[0] - 8, align: 'center' });
  doc.rect(left + CW[0], y, width - CW[0], productRowH).stroke('#5b6475');
  doc.fillColor('#111').fontSize(productFontSize).text(productText, left + CW[0] + 6, y + 8, { width: productW, align: 'left' });
  y += productRowH;

  drawSection('一、印膜信息');
  drawRow(['参考色', p.refColor || '', '油墨要求', p.inkRequirement || '', '交货日期', row.delivery_date || ''], CW);
  drawBigLabelValue('印膜', printFilmDisplay, 40, 20, 12, 'center');
  drawRow(['订单数量', row.quantity || '', '开单数量', p.printQty || '', '印刷米数', p.printShift || ''], CW);
  drawBigLabelValue('备注', row.remark || '');

  drawSection('二、覆膜工艺');
  // 第一层：材质/规格/数量（长文本自动增高）
  const filmMaxPdfLen = Math.max(String(p.layer1||'').length,String(p.l1Size||'').length,String(p.l1Weight||'').length,String(p.layer2||'').length,String(p.l2Size||'').length,String(p.l2Weight||'').length,String(p.layer3||'').length,String(p.l3Size||'').length,String(p.l3Weight||'').length,String(p.layer4||'').length,String(p.l4Size||'').length,String(p.l4Weight||'').length);
  const filmRh = filmMaxPdfLen >= 22 ? 44 : (filmMaxPdfLen >= 14 ? 36 : rowH);
  drawRow(['覆膜工艺', `${p.filmType || ''}`, '第一层', '', '', ''], CW, false, filmRh);
  const rowY1 = y - filmRh;
  let x1 = left + CW[0] + CW[1] + CW[2];
  [String(p.layer1||''), String(p.l1Size||''), String(p.l1Weight||'')].forEach((txt, idx) => {
    const w = CW[3 + idx];
    doc.fillColor('#111').fontSize(13).text(txt, x1 + 4, rowY1 + 4, { width: w - 8, height: filmRh - 8, align: 'center' });
    x1 += w;
  });

  // 合并“覆膜要求”三行；右侧保留四列给第二/三/四层（层级、材质、规格、数量）
  const rh2 = filmRh;
  const mergedLeftW = CW[0] + CW[1];
  doc.rect(left, y, CW[0], rh2 * 3).stroke('#5b6475');
  doc.fillColor('#111').fontSize(11).text('覆膜要求', left + 4, y + 16, { width: CW[0] - 8, align: 'center' });
  doc.rect(left + CW[0], y, CW[1], rh2 * 3).stroke('#5b6475');
  doc.fillColor('#111').fontSize(11).text(String(p.filmNote || ''), left + CW[0] + 6, y + 6, { width: CW[1] - 12, align: 'left' });

  const rightStartX2 = left + mergedLeftW;
  const drawFilmLayerRow = (offset, title, mat, size, weight) => {
    const yy = y + offset * rh2;
    doc.rect(rightStartX2, yy, CW[2], rh2).stroke('#5b6475');
    doc.fillColor('#111').fontSize(11).text(title, rightStartX2 + 4, yy + 8, { width: CW[2] - 8, align: 'center' });
    doc.rect(rightStartX2 + CW[2], yy, CW[3], rh2).stroke('#5b6475');
    doc.fillColor('#111').fontSize(13).text(`${mat || ''}`, rightStartX2 + CW[2] + 4, yy + 5, { width: CW[3] - 8, align: 'center' });
    doc.rect(rightStartX2 + CW[2] + CW[3], yy, CW[4], rh2).stroke('#5b6475');
    doc.fillColor('#111').fontSize(13).text(`${size || ''}`, rightStartX2 + CW[2] + CW[3] + 4, yy + 5, { width: CW[4] - 8, align: 'center' });
    doc.rect(rightStartX2 + CW[2] + CW[3] + CW[4], yy, CW[5], rh2).stroke('#5b6475');
    doc.fillColor('#111').fontSize(13).text(`${weight || ''}`, rightStartX2 + CW[2] + CW[3] + CW[4] + 4, yy + 5, { width: CW[5] - 8, align: 'center' });
  };
  drawFilmLayerRow(0, '第二层', p.layer2, p.l2Size, p.l2Weight);
  drawFilmLayerRow(1, '第三层', p.layer3, p.l3Size, p.l3Weight);
  drawFilmLayerRow(2, '第四层', p.layer4, p.l4Size, p.l4Weight);
  y += rh2 * 3;

  drawSection('三、制袋与交付');
  drawRow(['袋型', row.bag_type || '', '是否外加工', p.outsource || '', '', ''], CW);
  drawRow(['拉链位置', p.zipPos || '', '撕口位置', p.tearPos || '', '挂孔位置', p.holePos || ''], CW);
  drawRow(['孔位', p.holes || '', '封边', `${p.edges || ''}${p.edgeCm ? `（${p.edgeCm}）` : ''}`, '', ''], CW);
  drawRow(['其它要求', p.otherReq || '', '', '', '', ''], CW);

  drawSection('四、装箱信息');
  drawRow(['装箱类型', p.packType || '', '装箱规格', p.boxSpec || '', '实际成品数量', p.actualQty || ''], CW);
  drawRow(['装箱人签名', p.packerSign || '', '创建人/时间', `${row.created_by || ''} / ${fmtBjTime(row.created_at || '')}`, '',''], CW);
}

function renderWorkOrderPdf(res, row, p = {}, fileTag = '') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="work_order_${fileTag || row.work_no || row.id || 'preview'}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 16 });
  doc.pipe(res);
  fillWorkOrderPdfDoc(doc, row, p);
  doc.end();
}

function generateWorkOrderPdfBuffer(row, p = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 16 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    fillWorkOrderPdfDoc(doc, row, p);
    doc.end();
  });
}

router.post('/preview.pdf', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const {
    salespersonId,
    salespersonName = '',
    customerName = '',
    productName = '',
    bagType = '',
    spec = '',
    quantity = '',
    deliveryDate = '',
    roller = '',
    remark = '',
    processRequirements = {}
  } = req.body || {};

  const sid = Number(salespersonId || 0);
  const sp = sid ? db.prepare('SELECT id, name FROM salespersons WHERE id=?').get(sid) : null;
  const spName = salespersonName || sp?.name || '';
  if (!spName || !customerName || !productName || !bagType || !spec || !quantity || !roller) {
    return res.status(400).json({ error: '预览需填写：业务员/客户/品名/袋型/规格/数量/压辊' });
  }
  const pReq = hydrateLayerFields({ salesperson_name: spName, customer_name: customerName, product_name: productName }, processRequirements || {});
  if (!String(pReq?.printMold || '').trim() || !String(pReq?.printFilmSize || '').trim() || !(Number(pReq?.printFilmQty || 0) > 0) || !String(pReq?.printFilmUnit || '').trim()) {
    return res.status(400).json({ error: '预览需填写：印膜材料/印膜尺寸/印膜数量/印膜单位' });
  }
  const row = {
    id: 0,
    work_no: '预览稿',
    salesperson_name: spName,
    customer_name: String(customerName || ''),
    product_name: String(productName || ''),
    bag_type: String(bagType || ''),
    spec: String(spec || ''),
    quantity: String(quantity || ''),
    delivery_date: String(deliveryDate || ''),
    roller: String(roller || ''),
    remark: String(remark || ''),
    order_id: '',
    email_status: '',
    created_by: req.user?.userName || 'preview',
    created_at: now()
  };
  let p = hydrateLayerFields(row, processRequirements || {});
  const issues = validateLayerTriples(p);
  if (issues.length) return res.status(400).json({ error: `预览已拦截：${issues.join('；')}` });

  // 记录“预览未提交”草稿，便于后续补提交/导入/删除
  const ts = now();
  const payload = {
    salespersonId: sid || null,
    salespersonName: spName,
    customerName: String(customerName || ''),
    productName: String(productName || ''),
    bagType: String(bagType || ''),
    spec: String(spec || ''),
    quantity: String(quantity || ''),
    deliveryDate: String(deliveryDate || ''),
    roller: String(roller || ''),
    remark: String(remark || ''),
    processRequirements: pReq || {}
  };
  db.prepare(`
    INSERT INTO work_order_preview_drafts (
      salesperson_id, salesperson_name, customer_name, product_name, bag_type, spec, quantity, roller,
      payload_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sid || null,
    spName,
    String(customerName || ''),
    String(productName || ''),
    String(bagType || ''),
    String(spec || ''),
    String(quantity || ''),
    String(roller || ''),
    JSON.stringify(payload),
    req.user?.userName || 'preview',
    ts,
    ts
  );

  renderWorkOrderPdf(res, row, p, 'preview');
});

router.get('/:id/export.pdf', allowRoles('super_admin', 'manager', 'ai_sales'), (req, res) => {
  const id = Number(req.params.id || 0);
  const row = db.prepare('SELECT * FROM work_orders WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '开单不存在' });
  let p = {};
  try { p = JSON.parse(row.process_requirements_json || '{}'); } catch {}
  p = hydrateLayerFields(row, p);
  const issues = validateLayerTriples(p);
  if (issues.length) return res.status(400).json({ error: `导出已拦截：${issues.join('；')}` });
  renderWorkOrderPdf(res, row, p);
});

module.exports = router;
