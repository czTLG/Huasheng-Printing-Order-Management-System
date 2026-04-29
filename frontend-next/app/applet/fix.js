const fs = require('fs');

let c = fs.readFileSync('src/components/WorkOrders.tsx', 'utf8');

c = c.replace(
  '                       <div className="w-16 font-black text-slate-800 text-sm whitespace-nowrap ml           {/* 模块 5：制袋与交付 */}\\n           <ModuleBox bgColor="bg-cyan-50/40" borderColor="border-cyan-100">',
  '                       <div className="w-16 font-black text-slate-800 text-sm whitespace-nowrap ml-2">{titles[idx-1]}</div>\\n                       <select value={layer.mat} onChange={e => setFormData({...formData, [key]: {...layer, mat: e.target.value}})} className={cn(SelectLabelStyle, "flex-1")} >\\n                          <option value="" disabled hidden>请选择材质</option>\\n                          {materials.map(m => <option key={m} value={m}>{m}</option>)}\\n                       </select>\\n                       <input value={layer.size} onChange={e => setFormData({...formData, [key]: {...layer, size: e.target.value}})} placeholder="尺寸 (如: 55*10c仅数字)" className={cn(FormLabelStyle, "flex-1")} />\\n                       <input type="number" value={layer.weight} onChange={e => setFormData({...formData, [key]: {...layer, weight: e.target.value}})} placeholder="数量 (如: 1420仅数字)" className={cn(FormLabelStyle, "flex-1")} />\\n                       <select value={layer.unit} onChange={e => setFormData({...formData, [key]: {...layer, unit: e.target.value}})} className={cn(SelectLabelStyle, "w-24 shrink-0")}>\\n                          <option value="kn">kn</option>\\n                          <option value="kg">kg</option>\\n                       </select>\\n                    </div>\\n                 )\\n              })}\\n           </div>\\n           </ModuleBox>\\n\\n           {/* 模块 5：制袋与交付 */}\\n           <ModuleBox bgColor="bg-cyan-50/40" borderColor="border-cyan-100">'
);

c = c.replace(
  '           </ModuleBox>s"           {/* 模块 6：装箱信息 */}',
  '           </ModuleBox>\\n\\n           {/* 模块 6：装箱信息 */}'
);

const dupStr = `           {/* 模块 6：装箱信息 */}
           <SectionTitle title="6. 装箱信息" />
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
              <InputField label="装箱类型">
                 <select value={formData.wo_pack_type} onChange={e => setFormData({...formData, wo_pack_type: e.target.value})} className={SelectLabelStyle}>
                     <option value="" disabled hidden>请选择</option>
                     <option value="纸箱">纸箱</option>
                     <option value="编织袋">编织袋</option>
                     <option value="编织袋+纸箱">编织袋+纸箱</option>
                 </select>
              </InputField>
              <InputField label="装箱规格">
                 <input value={formData.wo_box_spec} onChange={e => setFormData({...formData, wo_box_spec: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="实际成品数量">
                 <input type="number" value={formData.wo_actual_qty} onChange={e => setFormData({...formData, wo_actual_qty: e.target.value})} className={FormLabelStyle} />
              </InputField>
              <InputField label="装箱人签名">
                 <input value={formData.wo_packer_sign} onChange={e => setFormData({...formData, wo_packer_sign: e.target.value})} className={FormLabelStyle} />
              </InputField>
           </div>

           {/* 模块 7：提交 / 操作区 */}
           <SectionTitle title="7. 提交 / 操作区" />
           <div className="flex flex-col gap-6 bg-slate-50/50 p-6 rounded-2xl border border-slate-200">`;

c = c.replace(dupStr, '');

fs.writeFileSync('src/components/WorkOrders.tsx', c);
