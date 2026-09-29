(() => {
  'use strict';
  const KEY = 'bcl-fg-wms-v1';
  const THEME_KEY = 'bcl-fg-wms-theme';
  const TYPES = { receive: 'รับเข้า', issue: 'เบิกจ่าย', move: 'ย้ายตำแหน่ง', count: 'ตรวจนับ' };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clean = (v) => String(v ?? '').trim();
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const round = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  const fmt = (n) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 }).format(n);
  const time = (v) => new Date(v).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = () => localDate(new Date());
  const in90 = () => { const d = new Date(); d.setDate(d.getDate() + 90); return localDate(d); };
  let state = { version: 1, batches: [], events: [] };
  let toastTimer;

  function toast(message, error = false) {
    const el = $('#toast'); el.textContent = message; el.className = `show${error ? ' error' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 4300);
  }
  function applyTheme(theme, save = false) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const button = $('#theme-toggle');
    const label = dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(dark));
    button.querySelector('span').textContent = dark ? 'โหมดสว่าง' : 'โหมดมืด';
    if (save) localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }
  try { applyTheme(localStorage.getItem(THEME_KEY) || 'light'); }
  catch (_) { applyTheme('light'); }
  function validateData(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.batches) || !Array.isArray(data.events)) throw Error('ไฟล์ JSON ไม่ใช่ข้อมูล FG WMS เวอร์ชัน 1');
    const ids = new Set(), pallets = new Set();
    for (const b of data.batches) {
      if (!b || !['id','sku','name','lot','unit','location','pallet'].every(k => typeof b[k] === 'string' && b[k].trim()) || !Number.isFinite(b.quantity) || b.quantity < 0) throw Error('ข้อมูลชุดจัดเก็บไม่ถูกต้อง');
      if (ids.has(b.id) || pallets.has(b.pallet.toUpperCase())) throw Error('รหัสชุดจัดเก็บซ้ำในไฟล์');
      ids.add(b.id); pallets.add(b.pallet.toUpperCase());
    }
    for (const e of data.events) if (!e || typeof e.id !== 'string' || !TYPES[e.type] || typeof e.at !== 'string' || typeof e.document !== 'string') throw Error('ประวัติรายการไม่ถูกต้อง');
    return data;
  }
  try { const saved = localStorage.getItem(KEY); if (saved) state = validateData(JSON.parse(saved)); }
  catch (e) { toast(`อ่านข้อมูลเดิมไม่ได้: ${e.message}`, true); }
  function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function commit(batchChanges, event) {
    const previous = structuredClone(state);
    try { batchChanges(); state.events.unshift(event); persist(); render(); toast('บันทึกรายการแล้ว'); }
    catch (e) { state = previous; toast(`บันทึกไม่สำเร็จ: ${e.message}`, true); throw e; }
  }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function event(type, f, b, qty, extra = {}) { return { id: uuid(), type, at: new Date().toISOString(), document: clean(f.document), sku: b.sku, name: b.name, lot: b.lot, pallet: b.pallet, location: b.location, quantity: qty, unit: b.unit, ...extra }; }
  function fields(form) { return Object.fromEntries(new FormData(form).entries()); }
  function required(...values) { if (values.some(v => !clean(v))) throw Error('กรอกข้อมูลจำเป็นให้ครบ'); }
  function positive(value) { const n = Number(value); if (!Number.isFinite(n) || n <= 0 || round(n) <= 0 || n !== round(n)) throw Error('จำนวนต้องมากกว่า 0 และมีทศนิยมไม่เกิน 3 ตำแหน่ง'); return n; }
  function nonnegative(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n !== round(n)) throw Error('ยอดตรวจนับต้องไม่ติดลบและมีทศนิยมไม่เกิน 3 ตำแหน่ง'); return n; }
  function batch(id) { const b = state.batches.find(x => x.id === id && x.quantity > 0); if (!b) throw Error('ไม่พบชุดจัดเก็บที่มีคงเหลือ'); return b; }
  function active() { return state.batches.filter(b => b.quantity > 0); }
  function status(b) { if (!b.expiry) return ['ปกติ','']; if (b.expiry < today()) return ['หมดอายุ','danger']; if (b.expiry <= in90()) return ['ใกล้หมดอายุ','warning']; return ['ปกติ','']; }
  function warn(e) { toast(e.message || String(e), true); }

  $('#receive-form').addEventListener('submit', (ev) => {
    ev.preventDefault(); try {
      const f = fields(ev.currentTarget); required(f.document,f.sku,f.name,f.lot,f.unit,f.location,f.pallet);
      const qty = positive(f.quantity); const sku = clean(f.sku).toUpperCase(); const pallet = clean(f.pallet).toUpperCase();
      if (state.batches.some(b => b.pallet.toUpperCase() === pallet)) throw Error('รหัสพาเลต / ชุดจัดเก็บนี้มีอยู่แล้ว');
      if (state.batches.some(b => b.sku.toUpperCase() === sku && b.unit.toLowerCase() !== clean(f.unit).toLowerCase())) throw Error('SKU นี้มีหน่วยนับต่างจากข้อมูลเดิม');
      if (f.manufactured && f.expiry && f.manufactured > f.expiry) throw Error('วันหมดอายุต้องไม่ก่อนวันที่ผลิต');
      const b = { id:uuid(), sku, name:clean(f.name), lot:clean(f.lot), quantity:qty, unit:clean(f.unit), location:clean(f.location).toUpperCase(), pallet, manufactured:f.manufactured || '', expiry:f.expiry || '', receivedAt:new Date().toISOString() };
      commit(() => state.batches.push(b), event('receive',f,b,qty,{ note:clean(f.note) })); ev.currentTarget.reset();
    } catch (e) { warn(e); }
  });
  $('#issue-form').addEventListener('submit', (ev) => {
    ev.preventDefault(); try {
      const f = fields(ev.currentTarget); required(f.document,f.batch,f.destination); const b = batch(f.batch), qty = positive(f.quantity);
      if (qty > b.quantity) throw Error(`ยอดเบิกเกินคงเหลือ ${fmt(b.quantity)} ${b.unit}`);
      if (b.expiry && b.expiry < today()) throw Error('ชุดนี้หมดอายุแล้ว ไม่สามารถเบิกจ่ายได้');
      const record = event('issue',f,b,-qty,{ destination:clean(f.destination), note:clean(f.note) });
      commit(() => b.quantity = round(b.quantity - qty), record); ev.currentTarget.reset();
    } catch (e) { warn(e); }
  });
  $('#move-form').addEventListener('submit', (ev) => {
    ev.preventDefault(); try {
      const f = fields(ev.currentTarget); required(f.document,f.batch,f.location,f.pallet); const b = batch(f.batch), qty = positive(f.quantity), targetPallet = clean(f.pallet).toUpperCase(), targetLocation = clean(f.location).toUpperCase();
      if (qty > b.quantity) throw Error(`ยอดย้ายเกินคงเหลือ ${fmt(b.quantity)} ${b.unit}`);
      if (targetPallet === b.pallet && targetLocation === b.location) throw Error('ปลายทางต้องต่างจากต้นทาง');
      if (state.batches.some(x => x.pallet.toUpperCase() === targetPallet && x.id !== b.id)) throw Error('รหัสชุดปลายทางมีอยู่แล้ว');
      if (qty < b.quantity && targetPallet === b.pallet) throw Error('เมื่อแบ่งชุด ต้องใช้รหัสชุดปลายทางใหม่');
      const record = event('move',f,b,qty,{ destination:targetLocation, targetPallet });
      commit(() => { if (qty === b.quantity) { b.location = targetLocation; b.pallet = targetPallet; } else { b.quantity = round(b.quantity - qty); state.batches.push({ ...b, id:uuid(), quantity:qty, location:targetLocation, pallet:targetPallet }); } }, record);
      ev.currentTarget.reset();
    } catch (e) { warn(e); }
  });
  $('#count-form').addEventListener('submit', (ev) => {
    ev.preventDefault(); try {
      const f = fields(ev.currentTarget); required(f.document,f.batch,f.counter,f.note); const b = batch(f.batch), qty = nonnegative(f.quantity), diff = round(qty - b.quantity);
      const record = event('count',f,b,diff,{ counted:qty, previous:b.quantity, counter:clean(f.counter), note:clean(f.note) });
      commit(() => b.quantity = qty, record); ev.currentTarget.reset();
    } catch (e) { warn(e); }
  });

  function table(headers, rows, empty = 'ยังไม่มีข้อมูล') { return rows.length ? `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : `<div class="empty">${empty}</div>`; }
  function renderDashboard() {
    const batches = active(); const skus = new Set(batches.map(b => b.sku));
    const units = new Set(batches.map(b => b.unit.toLowerCase()));
    $('#kpi-qty').textContent = units.size > 1 ? '—' : fmt(round(batches.reduce((n,b) => n + b.quantity,0)));
    $('#kpi-qty').nextElementSibling.textContent = units.size > 1 ? 'หลายหน่วย ดูแยกตาม SKU' : (batches[0]?.unit || 'หน่วย');
    $('#kpi-sku').textContent = fmt(skus.size); $('#kpi-pallet').textContent = fmt(batches.length);
    $('#kpi-expiring').textContent = fmt(batches.filter(b => b.expiry && b.expiry >= today() && b.expiry <= in90()).length);
    const grouped = new Map(); for (const b of batches) { const g = grouped.get(b.sku) || {name:b.name,qty:0,unit:b.unit,lots:new Set()}; g.qty = round(g.qty+b.quantity); g.lots.add(b.lot); grouped.set(b.sku,g); }
    $('#dashboard-products').innerHTML = table(['SKU','สินค้า','คงเหลือ','ล็อต'], [...grouped].slice(0,8).map(([sku,g])=>`<tr><td><code>${esc(sku)}</code></td><td>${esc(g.name)}</td><td class="num">${fmt(g.qty)} ${esc(g.unit)}</td><td class="num">${g.lots.size}</td></tr>`), 'ยังไม่มีสต็อก FG เริ่มจากเมนูรับเข้าและจัดเก็บ');
    $('#dashboard-activity').innerHTML = state.events.length ? state.events.slice(0,6).map(e=>`<div class="activity"><span class="time">${esc(time(e.at))}</span><strong>${esc(TYPES[e.type])} · ${esc(e.document)}</strong><small>${esc(e.sku)} / Lot ${esc(e.lot)} · ${fmt(e.quantity)} ${esc(e.unit)}</small></div>`).join('') : '<div class="empty">ยังไม่มีรายการเคลื่อนไหว</div>';
  }
  function renderStock() {
    const q = clean($('#stock-search').value).toLowerCase(), filter = $('#stock-filter').value;
    const list = state.batches.filter(b => { const s = status(b)[1]; return (!q || [b.sku,b.name,b.lot,b.location,b.pallet].some(v=>v.toLowerCase().includes(q))) && (filter === 'all' || (filter === 'available' ? b.quantity > 0 : filter === 'expiring' ? s === 'warning' : s === 'danger')); });
    $('#stock-table').innerHTML = table(['SKU / สินค้า','Lot','ชุดจัดเก็บ','ตำแหน่ง','วันหมดอายุ','คงเหลือ','สถานะ'], list.map(b=>{const [label,cls]=status(b);return `<tr><td><strong>${esc(b.sku)}</strong><br>${esc(b.name)}</td><td>${esc(b.lot)}</td><td><code>${esc(b.pallet)}</code></td><td><code>${esc(b.location)}</code></td><td>${esc(b.expiry || '—')}</td><td class="num">${fmt(b.quantity)} ${esc(b.unit)}</td><td><span class="status ${cls}">${b.quantity ? label : 'หมดสต็อก'}</span></td></tr>`;}), 'ไม่พบชุดจัดเก็บตามเงื่อนไข');
  }
  function renderSelections() {
    const list = active().sort((a,b)=>(a.expiry || '9999').localeCompare(b.expiry || '9999'));
    const options = '<option value="">เลือกชุดจัดเก็บ</option>' + list.map(b=>`<option value="${esc(b.id)}">${esc(b.pallet)} · ${esc(b.sku)} · Lot ${esc(b.lot)} · ${fmt(b.quantity)} ${esc(b.unit)}</option>`).join('');
    for (const id of ['issue','move','count']) { const el = $(`#${id}-batch`), selected=el.value; el.innerHTML=options; if (list.some(b=>b.id===selected)) el.value=selected; renderSelectionDetail(id); }
  }
  function renderSelectionDetail(id) { const selected = state.batches.find(b=>b.id===$(`#${id}-batch`).value); $(`#${id}-detail`).textContent = selected ? `สินค้า: ${selected.name} | Lot: ${selected.lot} | ตำแหน่ง: ${selected.location} | คงเหลือ: ${fmt(selected.quantity)} ${selected.unit} | หมดอายุ: ${selected.expiry || 'ไม่ระบุ'}` : 'เลือกชุดจัดเก็บเพื่อดูรายละเอียด'; }
  function renderHistory() {
    const q=clean($('#history-search').value).toLowerCase(); const list=state.events.filter(e=>!q || [e.document,e.sku,e.name,e.lot,e.pallet,e.location,e.destination,e.targetPallet].some(v=>clean(v).toLowerCase().includes(q)));
    $('#history-table').innerHTML=table(['วันเวลา','รายการ / เอกสาร','สินค้า / Lot','ชุด / ตำแหน่ง','จำนวนเปลี่ยน','รายละเอียด'],list.map(e=>`<tr><td>${esc(time(e.at))}</td><td><strong>${esc(TYPES[e.type])}</strong><br>${esc(e.document)}</td><td>${esc(e.sku)}<br>Lot ${esc(e.lot)}</td><td>${esc(e.pallet)}<br>${esc(e.location)}</td><td class="num">${e.quantity>0?'+':''}${fmt(e.quantity)} ${esc(e.unit)}</td><td>${esc(e.destination || '')}${e.targetPallet ? ` / ${esc(e.targetPallet)}` : ''}${e.counter ? ` / ผู้ตรวจ ${esc(e.counter)}` : ''}${e.note ? `<br>${esc(e.note)}` : ''}</td></tr>`),'ยังไม่มีประวัติรายการ');
  }
  function render() { renderDashboard(); renderStock(); renderSelections(); renderHistory(); }
  function page(id) { $$('.page').forEach(x=>x.classList.toggle('active',x.id===id)); $$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===id)); $('#top-title').textContent = $(`#nav button[data-page="${id}"] span`).textContent; location.hash=id; window.scrollTo(0,0); }
  $$('#nav button').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
  $$('[data-go]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.go)));
  for (const id of ['issue','move','count']) $(`#${id}-batch`).addEventListener('change',()=>renderSelectionDetail(id));
  $('#stock-search').addEventListener('input',renderStock); $('#stock-filter').addEventListener('change',renderStock); $('#history-search').addEventListener('input',renderHistory);
  $('#theme-toggle').addEventListener('click', () => {
    try { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true); }
    catch (e) { toast(`บันทึกธีมไม่สำเร็จ: ${e.message}`, true); }
  });
  $('#export-btn').addEventListener('click',()=>{ const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=`FG-WMS-backup-${today()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); });
  $('#import-file').addEventListener('change',async ev=>{ const file=ev.target.files[0]; if(!file)return; try { const data=validateData(JSON.parse(await file.text())); if(!confirm('นำเข้าจะเขียนทับข้อมูล FG WMS ในเบราว์เซอร์นี้ ต้องการดำเนินการหรือไม่?')) return; const old=state; state=data; try{persist();render();toast('นำเข้าข้อมูลแล้ว');}catch(e){state=old;throw e;} }catch(e){toast(`นำเข้าไม่สำเร็จ: ${e.message}`,true);}finally{ev.target.value='';} });
  render(); const initial=location.hash.slice(1); if ($(`#nav button[data-page="${initial}"]`)) page(initial);
})();
