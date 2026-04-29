const fs = require('fs');

let c = fs.readFileSync('src/components/WorkOrders.tsx', 'utf8');

const t1 = `                       <div className="w-16 font-black text-slate-800 text-sm whitespace-nowrap ml           {/* 模块 5：制袋与交付 */}
           <ModuleBox bgColor="bg-cyan-50/40" borderColor="border-cyan-100">`;

const r1 = `                       <div className="w-16 font-black text-slate-800 text-sm whitespace-nowrap ml-2">{titles[idx-1]}</div>
                       <select value={layer.mat} onChange={e => setFormData({...formData, [key]: {...layer, mat: e.target.value}})} className={cn(SelectLabelStyle, "flex-1")} >
                          <option value="" disabled hidden>请选择材质</option>
                          {materials.map(m => <option key={m} value={m}>{m}</option>)}
                       </select>
                       <input value={layer.size} onChange={e => setFormData({...formData, [key]: {...layer, size: e.target.value}})} placeholder="尺寸 (如: 55*10c仅数字)" className={cn(FormLabelStyle, "flex-1")} />
                       <input type="number" value={layer.weight} onChange={e => setFormData({...formData, [key]: {...layer, weight: e.target.value}})} placeholder="数量 (如: 1420仅数字)" className={cn(FormLabelStyle, "flex-1")} />
                       <select value={layer.unit} onChange={e => setFormData({...formData, [key]: {...layer, unit: e.target.value}})} className={cn(SelectLabelStyle, "w-24 shrink-0")}>
                          <option value="kn">kn</option>
                          <option value="kg">kg</option>
                       </select>
                    </div>
                 )
              })}
           </div>
           </ModuleBox>

           {/* 模块 5：制袋与交付 */}
           <ModuleBox bgColor="bg-cyan-50/40" borderColor="border-cyan-100">`;

c = c.replace(t1, r1);

const t2 = `           </ModuleBox>s"           {/* 模块 6：装箱信息 */}
           <ModuleBox bgColor="bg-rose-50/40" borderColor="border-rose-100">`;

const r2 = `           </ModuleBox>

           {/* 模块 6：装箱信息 */}
           <ModuleBox bgColor="bg-rose-50/40" borderColor="border-rose-100">`;

c = c.replace(t2, r2);

const duplicateText = `
           {/* 模块 6：装箱信息 */}
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

const r3 = `           <div className="flex flex-col gap-6">`;

if (c.includes(duplicateText)) {
  c = c.replace(duplicateText, r3);
}

fs.writeFileSync('src/components/WorkOrders.tsx', c);
