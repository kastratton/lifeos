/* ==========================================================================
   LifeOS — single-file application logic
   Vanilla JS, no build step, no frameworks. Data lives in localStorage.
   ========================================================================== */

/* ---------------------------------------------------------------------- */
/* Storage layer                                                          */
/* ---------------------------------------------------------------------- */
const DB_KEY = 'lifeos_data_v1';

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function defaultData(){
  return {
    settings: {
      theme: 'dark',
      medicationReorderDays: 7,
      categories: {
        income: ['Salary','Freelance','Investments','Other'],
        expense: ['Housing','Groceries','Utilities','Transport','Subscriptions','Entertainment','Other'],
        asset: ['Property','Vehicle','Savings','Investments','Other'],
        liability: ['Mortgage','Loan','Credit Card','Other'],
        contract: ['Mobile','Sim','Broadband','TV','Insurance','Other']
      },
      contactCustomFields: [] // [{id,label,type}]
    },
    income: [],
    expenses: [],
    assets: [],
    liabilities: [],
    nonMonthlyExpenses: [],
    contacts: [],
    todoSections: [],
    noteSections: [],
    medications: [],
    properties: [],
    vehicles: [],
    contracts: []
  };
}

let DB = loadDB();

function loadDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(!raw) return defaultData();
    const parsed = JSON.parse(raw);
    // shallow-merge with defaults so new fields introduced later don't break old data
    const d = defaultData();
    for(const k in d){
      if(parsed[k] === undefined) parsed[k] = d[k];
    }
    parsed.settings = Object.assign({}, d.settings, parsed.settings || {});
    parsed.settings.categories = Object.assign({}, d.settings.categories, (parsed.settings||{}).categories || {});
    return parsed;
  }catch(e){
    console.error('Failed to load LifeOS data, starting fresh.', e);
    return defaultData();
  }
}

function saveDB(){
  localStorage.setItem(DB_KEY, JSON.stringify(DB));
}

/* ---------------------------------------------------------------------- */
/* Utils                                                                  */
/* ---------------------------------------------------------------------- */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtMoney(n){
  n = Number(n)||0;
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return (neg? '-£':'£') + s;
}
function fmtDate(iso){
  if(!iso) return '—';
  const d = new Date(iso+'T00:00:00');
  if(isNaN(d)) return '—';
  return d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function daysBetween(a,b){ // a,b: Date objects, returns b-a in whole days
  return Math.round((b.setHours(0,0,0,0) - a.setHours(0,0,0,0)) / 86400000);
}
function parseISO(iso){ return new Date(iso+'T00:00:00'); }
function addFrequency(iso, freq, times){
  times = times || 1;
  const d = parseISO(iso);
  for(let i=0;i<times;i++){
    switch(freq){
      case 'daily': d.setDate(d.getDate()+1); break;
      case 'weekly': d.setDate(d.getDate()+7); break;
      case 'fortnightly': d.setDate(d.getDate()+14); break;
      case 'monthly': d.setMonth(d.getMonth()+1); break;
      case 'quarterly': d.setMonth(d.getMonth()+3); break;
      case 'sixmonthly': d.setMonth(d.getMonth()+6); break;
      case 'annually': d.setFullYear(d.getFullYear()+1); break;
      default: d.setMonth(d.getMonth()+1);
    }
  }
  return d.toISOString().slice(0,10);
}
const FREQ_LABELS = {daily:'Daily',weekly:'Weekly',fortnightly:'Fortnightly',monthly:'Monthly',quarterly:'Quarterly',sixmonthly:'Every 6 months',annually:'Annually'};

function timeLivedString(startISO, endISO){
  if(!startISO) return '—';
  const start = parseISO(startISO);
  const end = endISO ? parseISO(endISO) : new Date();
  let months = (end.getFullYear()-start.getFullYear())*12 + (end.getMonth()-start.getMonth());
  if(end.getDate() < start.getDate()) months--;
  if(months < 0) months = 0;
  const years = Math.floor(months/12);
  const remMonths = months % 12;
  const parts = [];
  if(years) parts.push(years + (years===1?' year':' years'));
  parts.push(remMonths + (remMonths===1?' month':' months'));
  return parts.join(' and ');
}

function nextBirthdayInfo(day, month, year){
  // month: 1-12
  if(!day || !month) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  let by = now.getFullYear();
  let next = new Date(by, month-1, day);
  if(next < now){ next = new Date(by+1, month-1, day); }
  const days = Math.round((next - now)/86400000);
  let age = null;
  if(year){ age = next.getFullYear() - year; }
  return {date: next, days, age};
}

function sumBy(arr, key){ return (arr||[]).reduce((s,i)=> s + (Number(i[key])||0), 0); }

/* ---------------------------------------------------------------------- */
/* Toast                                                                  */
/* ---------------------------------------------------------------------- */
function toast(msg){
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=> el.remove(), 2600);
}

/* ---------------------------------------------------------------------- */
/* Confirm dialog (lightweight, reuses modal)                             */
/* ---------------------------------------------------------------------- */
function confirmDialog(message, onYes){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" id="confirmOverlay">
      <div class="modal" style="max-width:380px;">
        <div class="modal-head"><h2>Are you sure?</h2></div>
        <p style="font-size:14px;color:var(--ink-soft);margin:0 0 18px;">${message}</p>
        <div class="form-actions">
          <button class="btn secondary" id="confirmNo">Cancel</button>
          <button class="btn danger" id="confirmYes">Delete</button>
        </div>
      </div>
    </div>`;
  document.getElementById('confirmOverlay').addEventListener('click', e=>{ if(e.target.id==='confirmOverlay') closeModal(); });
  document.getElementById('confirmNo').onclick = closeModal;
  document.getElementById('confirmYes').onclick = ()=>{ closeModal(); onYes(); };
}
function closeModal(){ document.getElementById('modalRoot').innerHTML = ''; }

/* ---------------------------------------------------------------------- */
/* Generic form builder                                                   */
/* fields: [{key,label,type:'text'|'number'|'date'|'time'|'select'|'textarea'|'checkbox', options?, required?, step?, colspan?}] */
/* ---------------------------------------------------------------------- */
function fieldHtml(f, val){
  val = (val === undefined || val === null) ? '' : val;
  const req = f.required ? 'required' : '';
  let inner = '';
  if(f.type === 'select'){
    inner = `<select id="f_${f.key}" ${req}>` +
      (f.placeholder ? `<option value="">${f.placeholder}</option>` : '') +
      f.options.map(o=>{
        const ov = typeof o === 'object' ? o.value : o;
        const ol = typeof o === 'object' ? o.label : o;
        return `<option value="${escAttr(ov)}" ${String(val)===String(ov)?'selected':''}>${escHtml(ol)}</option>`;
      }).join('') + `</select>`;
  } else if(f.type === 'textarea'){
    inner = `<textarea id="f_${f.key}" ${req}>${escHtml(val)}</textarea>`;
  } else if(f.type === 'checkbox'){
    return `<div class="field checkbox-field"><input type="checkbox" id="f_${f.key}" ${val?'checked':''}><label for="f_${f.key}" style="margin:0;">${f.label}</label></div>`;
  } else {
    inner = `<input type="${f.type}" id="f_${f.key}" value="${escAttr(val)}" ${f.step?`step="${f.step}"`:''} ${req} placeholder="${f.placeholder||''}">`;
  }
  return `<div class="field"><label for="f_${f.key}">${f.label}</label>${inner}</div>`;
}
function escHtml(s){ return String(s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function escAttr(s){ return String(s).replace(/"/g,'&quot;'); }

function readFieldValue(f){
  const el = document.getElementById('f_'+f.key);
  if(!el) return undefined;
  if(f.type === 'checkbox') return el.checked;
  if(f.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value;
}

/**
 * openForm({title, fields, values, wide, onSubmit(data), extraHtml, afterRender})
 */
function openForm(cfg){
  const root = document.getElementById('modalRoot');
  const values = cfg.values || {};
  root.innerHTML = `
    <div class="modal-overlay" id="formOverlay">
      <div class="modal ${cfg.wide?'wide':''}">
        <div class="modal-head">
          <h2>${cfg.title}</h2>
          <button class="modal-close" id="formClose">✕</button>
        </div>
        <form id="theForm">
          ${cfg.extraHtml ? cfg.extraHtml : ''}
          <div id="fieldsWrap">
            ${cfg.fields.map(f=> fieldHtml(f, values[f.key])).join('')}
          </div>
          <div class="form-actions">
            <button type="button" class="btn secondary" id="formCancel">Cancel</button>
            <button type="submit" class="btn">${cfg.submitLabel || 'Save'}</button>
          </div>
        </form>
      </div>
    </div>`;
  document.getElementById('formOverlay').addEventListener('click', e=>{ if(e.target.id==='formOverlay') closeModal(); });
  document.getElementById('formClose').onclick = closeModal;
  document.getElementById('formCancel').onclick = closeModal;
  if(cfg.afterRender) cfg.afterRender(root);
  document.getElementById('theForm').addEventListener('submit', e=>{
    e.preventDefault();
    const data = {};
    cfg.fields.forEach(f=>{ data[f.key] = readFieldValue(f); });
    cfg.onSubmit(data);
  });
}

/* ---------------------------------------------------------------------- */
/* Router + Nav                                                           */
/* ---------------------------------------------------------------------- */
const PAGES = [
  {id:'dashboard', label:'Dashboard', icon:'⌂', render: renderDashboard},
  {id:'budget', label:'Budget', icon:'£', render: renderBudget},
  {id:'networth', label:'Net Worth', icon:'◈', render: renderNetWorth},
  {id:'nonmonthly', label:'Non-monthly Expenses', icon:'▤', render: renderNonMonthly},
  {id:'contacts', label:'Contacts', icon:'☎', render: renderContacts},
  {id:'birthdays', label:'Birthdays', icon:'✦', render: renderBirthdays},
  {id:'todos', label:'Todo List', icon:'☑', render: renderTodos},
  {id:'notes', label:'Notes', icon:'✎', render: renderNotes},
  {id:'health', label:'Health', icon:'✚', render: renderHealth},
  {id:'home', label:'Home', icon:'⌘', render: renderHome},
  {id:'vehicles', label:'Vehicles', icon:'⛛', render: renderVehicles},
  {id:'contracts', label:'Contracts', icon:'✎', render: renderContracts},
];

function buildNav(){
  const nav = document.getElementById('navList');
  nav.innerHTML = PAGES.map(p=>`<button class="nav-item" data-page="${p.id}"><span class="nav-ico">${p.icon}</span>${p.label}</button>`).join('');
  nav.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{ location.hash = '#/' + btn.dataset.page; closeSidebar(); });
  });
}

function currentPageId(){
  const h = location.hash.replace('#/','');
  return PAGES.find(p=>p.id===h) ? h : 'dashboard';
}

function route(){
  const id = currentPageId();
  document.querySelectorAll('.nav-item').forEach(b=> b.classList.toggle('active', b.dataset.page===id));
  const page = PAGES.find(p=>p.id===id);
  document.getElementById('pageTitle').textContent = page.label;
  document.getElementById('content').innerHTML = '';
  page.render(document.getElementById('content'));
  window.scrollTo(0,0);
}
window.addEventListener('hashchange', route);

/* sidebar mobile toggle */
function openSidebar(){ document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
function closeSidebar(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }

/* theme */
function applyTheme(){
  document.documentElement.setAttribute('data-theme', DB.settings.theme);
  document.getElementById('themeToggleIcon').textContent = DB.settings.theme==='dark' ? '☀' : '🌙';
  document.getElementById('themeToggleLabel').textContent = DB.settings.theme==='dark' ? 'Light mode' : 'Dark mode';
}
function toggleTheme(){
  DB.settings.theme = DB.settings.theme === 'dark' ? 'light' : 'dark';
  saveDB(); applyTheme();
}

/* ---------------------------------------------------------------------- */
/* Reusable "simple CRUD list" renderer — used by budget / net worth /    */
/* non-monthly / contracts sections                                      */
/* ---------------------------------------------------------------------- */
function renderSimpleList(container, opts){
  // opts: {items, renderItem(item), onAdd(), onEdit(item), onDelete(item), emptyTitle, emptyBody}
  if(!opts.items.length){
    container.innerHTML = `<div class="empty-state"><b>${opts.emptyTitle}</b>${opts.emptyBody}</div>`;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'card-list';
  opts.items.forEach(item=>{
    const row = document.createElement('div');
    row.className = 'item-card';
    row.innerHTML = opts.renderItem(item);
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.innerHTML = `<button class="btn secondary small" data-act="edit">Edit</button><button class="btn danger small" data-act="del">Delete</button>`;
    actions.querySelector('[data-act=edit]').onclick = ()=> opts.onEdit(item);
    actions.querySelector('[data-act=del]').onclick = ()=> confirmDialog('This will permanently delete this entry.', ()=> opts.onDelete(item));
    row.appendChild(actions);
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
}

function categoryOptions(type){ return DB.settings.categories[type] || []; }

/* ---------------------------------------------------------------------- */
/* Dashboard                                                              */
/* ---------------------------------------------------------------------- */
function renderDashboard(container){
  const income = sumBy(DB.income,'amount');
  const expenses = sumBy(DB.expenses,'amount');
  const surplus = income - expenses;
  const assets = sumBy(DB.assets,'amount');
  const liabilities = sumBy(DB.liabilities,'amount');
  const netWorth = assets - liabilities;

  let html = `<div class="stat-row">
    <a href="#/budget" class="quick-link">
      <div class="stat-card"><div class="label">Monthly surplus</div><div class="value ${surplus<0?'negative':'positive'}">${fmtMoney(surplus)}</div></div>
    </a>
    <a href="#/networth" class="quick-link">
      <div class="stat-card"><div class="label">Net worth</div><div class="value ${netWorth<0?'negative':'positive'}">${fmtMoney(netWorth)}</div></div>
    </a>
  </div>`;

  // Upcoming non-monthly expenses (next 3 months)
  const horizon = new Date(); horizon.setMonth(horizon.getMonth()+3);
  const nmOccurrences = [];
  DB.nonMonthlyExpenses.forEach(e=>{
    if(!e.nextPaymentDate) return;
    let d = e.nextPaymentDate;
    let guard = 0;
    while(parseISO(d) <= horizon && guard < 40){
      if(parseISO(d) >= new Date(new Date().setHours(0,0,0,0))){
        nmOccurrences.push({date:d, description:e.description, amount:e.amount, category:e.category});
      }
      d = addFrequency(d, e.frequency, 1);
      guard++;
    }
  });
  nmOccurrences.sort((a,b)=> a.date.localeCompare(b.date));
  html += `<div class="section"><div class="section-head"><h2>Upcoming non-monthly expenses</h2><span class="hint">Next 3 months</span></div>`;
  if(!nmOccurrences.length){
    html += `<div class="empty-state">Nothing due in the next 3 months.</div>`;
  } else {
    html += `<div class="card-list">` + nmOccurrences.slice(0,20).map(o=>`
      <div class="item-card"><div class="main-info"><div class="title">${escHtml(o.description)}</div><div class="sub">${fmtDate(o.date)} · ${escHtml(o.category||'')}</div></div><div class="amount">${fmtMoney(o.amount)}</div></div>`).join('') + `</div>`;
  }
  html += `</div>`;

  // Upcoming todos
  const allTodos = [];
  DB.todoSections.forEach(s=> s.todos.forEach(t=> allTodos.push(Object.assign({sectionName:s.name}, t))));
  const upcomingTodos = allTodos.filter(t=> !t.completed && t.dueDate).sort((a,b)=>{
    const da = a.dueDate + (a.dueTime||'00:00');
    const db_ = b.dueDate + (b.dueTime||'00:00');
    return da.localeCompare(db_);
  }).slice(0,20);
  html += `<div class="section"><div class="section-head"><h2>Upcoming to-dos</h2></div>`;
  if(!upcomingTodos.length){
    html += `<div class="empty-state">No upcoming to-dos with a due date.</div>`;
  } else {
    html += `<div class="card-list">` + upcomingTodos.map(t=>`
      <div class="item-card"><div class="main-info"><div class="title">${escHtml(t.text)}</div><div class="sub">${escHtml(t.sectionName)}</div></div><div class="sub">${fmtDate(t.dueDate)}${t.dueTime?' · '+t.dueTime:''}</div></div>`).join('') + `</div>`;
  }
  html += `</div>`;

  // Upcoming birthdays (3 months)
  const bdays = DB.contacts.map(c=>{
    const info = nextBirthdayInfo(c.dobDay, c.dobMonth, c.dobYear);
    if(!info) return null;
    return Object.assign({contact:c}, info);
  }).filter(x=> x && x.days <= 92).sort((a,b)=> a.days-b.days);
  html += `<div class="section"><div class="section-head"><h2>Upcoming birthdays</h2><span class="hint">Next 3 months</span></div>`;
  if(!bdays.length){
    html += `<div class="empty-state">No birthdays in the next 3 months.</div>`;
  } else {
    html += `<div class="card-grid">` + bdays.map(b=>`
      <div class="bday-card"><div class="bday-avatar">${initialsOf(b.contact)}</div>
      <div><div class="title">${contactName(b.contact)}</div><div class="sub">${b.date.toLocaleDateString(undefined,{day:'numeric',month:'long'})}${b.age!=null? ' · turning '+b.age : ''}</div></div>
      <div class="bday-days"><b>${b.days===0?'Today':b.days}</b><span>${b.days===0?'':'days'}</span></div></div>`).join('') + `</div>`;
  }
  html += `</div>`;

  // Upcoming contracts ending in next 3 months
  const endingContracts = DB.contracts.filter(c=> c.endDate && parseISO(c.endDate) >= new Date(new Date().setHours(0,0,0,0)) && parseISO(c.endDate) <= horizon)
    .sort((a,b)=> a.endDate.localeCompare(b.endDate));
  html += `<div class="section"><div class="section-head"><h2>Contracts ending soon</h2><span class="hint">Next 3 months</span></div>`;
  if(!endingContracts.length){
    html += `<div class="empty-state">No contracts ending in the next 3 months.</div>`;
  } else {
    html += `<div class="card-grid">` + endingContracts.map(c=>`
      <div class="thing-card"><h3>${escHtml(c.supplierName)}</h3>
      <div class="kv"><span>Ends</span><b>${fmtDate(c.endDate)}</b></div>
      <div class="kv"><span>Value</span><b>${fmtMoney(c.value)}</b></div>
      <div class="kv"><span>Category</span><b>${escHtml(c.category||'—')}</b></div></div>`).join('') + `</div>`;
  }
  html += `</div>`;

  container.innerHTML = html;
}
function contactName(c){ return [c.firstName,c.surname].filter(Boolean).join(' ') || 'Unnamed contact'; }
function initialsOf(c){ return ((c.firstName||'?')[0] + (c.surname||'')[0]||'').toUpperCase(); }

/* ---------------------------------------------------------------------- */
/* Budget                                                                 */
/* ---------------------------------------------------------------------- */
function renderBudget(container){
  const income = sumBy(DB.income,'amount');
  const expenses = sumBy(DB.expenses,'amount');
  const surplus = income - expenses;
  container.innerHTML = `<div class="stat-row">
    <div class="stat-card"><div class="label">Income</div><div class="value positive">${fmtMoney(income)}</div></div>
    <div class="stat-card"><div class="label">Expenses</div><div class="value negative">${fmtMoney(expenses)}</div></div>
    <div class="stat-card"><div class="label">Surplus</div><div class="value ${surplus<0?'negative':'positive'}">${fmtMoney(surplus)}</div></div>
  </div>
  <div class="section" id="incomeSection"></div>
  <div class="section" id="expenseSection"></div>`;

  renderMoneyList(document.getElementById('incomeSection'), 'income', 'Income', DB.income);
  renderMoneyList(document.getElementById('expenseSection'), 'expenses', 'Expenses', DB.expenses);
}

function renderMoneyList(el, listKey, title, items){
  el.innerHTML = `<div class="section-head"><h2>${title}</h2><button class="btn small" id="add_${listKey}">+ Add ${title.replace(/s$/,'')}</button></div><div id="wrap_${listKey}"></div>`;
  const wrap = document.getElementById('wrap_'+listKey);
  const catType = listKey === 'income' ? 'income' : 'expense';
  renderSimpleList(wrap, {
    items,
    emptyTitle: `No ${title.toLowerCase()} yet`,
    emptyBody: `Add your first entry to start tracking.`,
    renderItem: (i)=> `<div class="main-info"><div class="title">${escHtml(i.description)}</div><div class="sub">${escHtml(i.category||'Uncategorised')}</div></div><div class="amount">${fmtMoney(i.amount)}</div>`,
    onEdit: (i)=> openMoneyForm(listKey, title, catType, i),
    onDelete: (i)=>{ DB[listKey] = DB[listKey].filter(x=>x.id!==i.id); saveDB(); route(); toast('Deleted.'); }
  });
  document.getElementById('add_'+listKey).onclick = ()=> openMoneyForm(listKey, title, catType, null);
}

function openMoneyForm(listKey, title, catType, existing){
  openForm({
    title: existing ? `Edit ${title.replace(/s$/,'')}` : `Add ${title.replace(/s$/,'')}`,
    fields: [
      {key:'description', label:'Description', type:'text', required:true},
      {key:'category', label:'Category', type:'select', options: categoryOptions(catType), placeholder:'Select a category'},
      {key:'amount', label:'Amount (£ / month)', type:'number', step:'0.01', required:true},
    ],
    values: existing || {},
    onSubmit: (data)=>{
      if(existing){
        Object.assign(existing, data);
      } else {
        DB[listKey].push(Object.assign({id:uid(), type:catType}, data));
      }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Net Worth                                                              */
/* ---------------------------------------------------------------------- */
function renderNetWorth(container){
  const assets = sumBy(DB.assets,'amount');
  const liabilities = sumBy(DB.liabilities,'amount');
  const net = assets - liabilities;
  container.innerHTML = `<div class="stat-row">
    <div class="stat-card"><div class="label">Assets</div><div class="value positive">${fmtMoney(assets)}</div></div>
    <div class="stat-card"><div class="label">Liabilities</div><div class="value negative">${fmtMoney(liabilities)}</div></div>
    <div class="stat-card"><div class="label">Net Worth</div><div class="value ${net<0?'negative':'positive'}">${fmtMoney(net)}</div></div>
  </div>
  <div class="section" id="assetSection"></div>
  <div class="section" id="liabilitySection"></div>`;

  renderMoneyList2(document.getElementById('assetSection'), 'assets', 'Assets', DB.assets, 'asset');
  renderMoneyList2(document.getElementById('liabilitySection'), 'liabilities', 'Liabilities', DB.liabilities, 'liability');
}
function renderMoneyList2(el, listKey, title, items, catType){
  el.innerHTML = `<div class="section-head"><h2>${title}</h2><button class="btn small" id="add_${listKey}">+ Add ${title.replace(/s$/,'')}</button></div><div id="wrap_${listKey}"></div>`;
  const wrap = document.getElementById('wrap_'+listKey);
  renderSimpleList(wrap, {
    items,
    emptyTitle: `No ${title.toLowerCase()} yet`,
    emptyBody: `Add your first entry to start tracking.`,
    renderItem: (i)=> `<div class="main-info"><div class="title">${escHtml(i.description)}</div><div class="sub">${escHtml(i.category||'Uncategorised')}</div></div><div class="amount">${fmtMoney(i.amount)}</div>`,
    onEdit: (i)=> openMoneyForm2(listKey, title, catType, i),
    onDelete: (i)=>{ DB[listKey] = DB[listKey].filter(x=>x.id!==i.id); saveDB(); route(); toast('Deleted.'); }
  });
  document.getElementById('add_'+listKey).onclick = ()=> openMoneyForm2(listKey, title, catType, null);
}
function openMoneyForm2(listKey, title, catType, existing){
  openForm({
    title: existing ? `Edit ${title.replace(/s$/,'')}` : `Add ${title.replace(/s$/,'')}`,
    fields: [
      {key:'description', label:'Description', type:'text', required:true},
      {key:'category', label:'Category', type:'select', options: categoryOptions(catType), placeholder:'Select a category'},
      {key:'amount', label:'Amount (£)', type:'number', step:'0.01', required:true},
    ],
    values: existing || {},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing, data); }
      else { DB[listKey].push(Object.assign({id:uid(), type:catType}, data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Non-monthly expenses                                                   */
/* ---------------------------------------------------------------------- */
function renderNonMonthly(container){
  const total = sumBy(DB.nonMonthlyExpenses,'amount');
  container.innerHTML = `<div class="stat-row">
    <div class="stat-card"><div class="label">Total (per occurrence, summed)</div><div class="value">${fmtMoney(total)}</div></div>
  </div>
  <div class="section"><div class="section-head"><h2>Non-monthly expenses</h2><button class="btn small" id="addNM">+ Add expense</button></div><div id="nmWrap"></div></div>`;

  renderSimpleList(document.getElementById('nmWrap'), {
    items: DB.nonMonthlyExpenses,
    emptyTitle: 'No non-monthly expenses yet',
    emptyBody: 'Add expenses like insurance, MOT, or annual subscriptions.',
    renderItem: (i)=> `<div class="main-info"><div class="title">${escHtml(i.description)}</div><div class="sub">${escHtml(i.category||'Uncategorised')} · ${FREQ_LABELS[i.frequency]||''} · next ${fmtDate(i.nextPaymentDate)}</div></div><div class="amount">${fmtMoney(i.amount)}</div>`,
    onEdit: (i)=> openNMForm(i),
    onDelete: (i)=>{ DB.nonMonthlyExpenses = DB.nonMonthlyExpenses.filter(x=>x.id!==i.id); saveDB(); route(); toast('Deleted.'); }
  });
  document.getElementById('addNM').onclick = ()=> openNMForm(null);
}
function openNMForm(existing){
  openForm({
    title: existing ? 'Edit non-monthly expense' : 'Add non-monthly expense',
    fields: [
      {key:'description', label:'Description', type:'text', required:true},
      {key:'category', label:'Category', type:'select', options: categoryOptions('expense'), placeholder:'Select a category'},
      {key:'amount', label:'Amount (£)', type:'number', step:'0.01', required:true},
      {key:'frequency', label:'Payment frequency', type:'select', required:true, options:[
        {value:'daily',label:'Daily'},{value:'weekly',label:'Weekly'},{value:'fortnightly',label:'Fortnightly'},
        {value:'monthly',label:'Monthly'},{value:'quarterly',label:'Quarterly'},{value:'sixmonthly',label:'Every 6 months'},{value:'annually',label:'Annually'}]},
      {key:'nextPaymentDate', label:'Next payment date', type:'date', required:true},
    ],
    values: existing || {frequency:'annually'},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing, data); }
      else { DB.nonMonthlyExpenses.push(Object.assign({id:uid()}, data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Contracts                                                              */
/* ---------------------------------------------------------------------- */
function renderContracts(container){
  container.innerHTML = `<div class="section"><div class="section-head"><h2>Contracts</h2><button class="btn small" id="addContract">+ Add contract</button></div><div id="contractWrap"></div></div>`;
  const wrap = document.getElementById('contractWrap');
  if(!DB.contracts.length){
    wrap.innerHTML = `<div class="empty-state"><b>No contracts yet</b>Track broadband, mobile, insurance and more.</div>`;
  } else {
    const sorted = [...DB.contracts].sort((a,b)=> (a.endDate||'9999').localeCompare(b.endDate||'9999'));
    wrap.innerHTML = `<div class="card-grid">` + sorted.map(c=>`
      <div class="thing-card" data-id="${c.id}">
        <h3>${escHtml(c.supplierName)}</h3>
        <span class="tag">${escHtml(c.category||'Other')}</span>
        <div class="kv"><span>Start</span><b>${fmtDate(c.startDate)}</b></div>
        <div class="kv"><span>End</span><b>${fmtDate(c.endDate)}</b></div>
        <div class="kv"><span>Value</span><b>${fmtMoney(c.value)}</b></div>
        <div class="actions"><button class="btn secondary small" data-act="edit">Edit</button><button class="btn danger small" data-act="del">Delete</button></div>
      </div>`).join('') + `</div>`;
    wrap.querySelectorAll('.thing-card').forEach(card=>{
      const c = DB.contracts.find(x=>x.id===card.dataset.id);
      card.querySelector('[data-act=edit]').onclick = ()=> openContractForm(c);
      card.querySelector('[data-act=del]').onclick = ()=> confirmDialog('This will permanently delete this contract.', ()=>{ DB.contracts = DB.contracts.filter(x=>x.id!==c.id); saveDB(); route(); toast('Deleted.'); });
    });
  }
  document.getElementById('addContract').onclick = ()=> openContractForm(null);
}
function openContractForm(existing){
  openForm({
    title: existing? 'Edit contract' : 'Add contract',
    fields: [
      {key:'supplierName', label:'Supplier name', type:'text', required:true},
      {key:'category', label:'Category', type:'select', options: categoryOptions('contract'), placeholder:'Select a category'},
      {key:'startDate', label:'Contract start date', type:'date'},
      {key:'endDate', label:'Contract end date', type:'date'},
      {key:'value', label:'Contract value (£)', type:'number', step:'0.01'},
    ],
    values: existing || {},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing,data); } else { DB.contracts.push(Object.assign({id:uid()},data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Home (properties)                                                      */
/* ---------------------------------------------------------------------- */
function renderHome(container){
  container.innerHTML = `<div class="section"><div class="section-head"><h2>Properties</h2><button class="btn small" id="addProp">+ Add property</button></div><div id="propWrap"></div></div>`;
  const wrap = document.getElementById('propWrap');
  if(!DB.properties.length){
    wrap.innerHTML = `<div class="empty-state"><b>No properties yet</b>Add homes you currently own or have owned.</div>`;
  } else {
    wrap.innerHTML = `<div class="card-grid">` + DB.properties.map(p=>{
      const lived = timeLivedString(p.purchaseDate, p.currentlyOwned ? null : p.movedOutDate);
      return `<div class="thing-card" data-id="${p.id}">
        <h3>${escHtml(p.name)}</h3>
        <span class="tag ${p.currentlyOwned?'':'amber'}">${p.currentlyOwned?'Currently owned':'Previously owned'}</span>
        <div class="kv"><span>Address</span><b>${escHtml(p.address||'—')}</b></div>
        <div class="kv"><span>Purchased</span><b>${fmtDate(p.purchaseDate)}</b></div>
        <div class="kv"><span>Time ${p.currentlyOwned?'lived':'owned'}</span><b>${lived}</b></div>
        ${!p.currentlyOwned? `<div class="kv"><span>Moved out</span><b>${fmtDate(p.movedOutDate)}</b></div>`:''}
        <div class="kv"><span>Purchase price</span><b>${fmtMoney(p.purchasePrice)}</b></div>
        <div class="kv"><span>Current value</span><b>${fmtMoney(p.currentValue)}</b></div>
        <div class="kv"><span>Mortgage advance</span><b>${fmtMoney(p.totalMortgageAdvance)}</b></div>
        <div class="kv"><span>Outstanding mortgage</span><b>${p.outstandingMortgage?'Yes':'No'}</b></div>
        ${p.outstandingMortgage? `<div class="kv"><span>Rate</span><b>${p.currentMortgageRate!=null? p.currentMortgageRate+'%':'—'}</b></div>`:''}
        <div class="actions"><button class="btn secondary small" data-act="edit">Edit</button><button class="btn danger small" data-act="del">Delete</button></div>
      </div>`;
    }).join('') + `</div>`;
    wrap.querySelectorAll('.thing-card').forEach(card=>{
      const p = DB.properties.find(x=>x.id===card.dataset.id);
      card.querySelector('[data-act=edit]').onclick = ()=> openPropertyForm(p);
      card.querySelector('[data-act=del]').onclick = ()=> confirmDialog('This will permanently delete this property.', ()=>{ DB.properties = DB.properties.filter(x=>x.id!==p.id); saveDB(); route(); toast('Deleted.'); });
    });
  }
  document.getElementById('addProp').onclick = ()=> openPropertyForm(null);
}
function openPropertyForm(existing){
  const fields = [
    {key:'name', label:'Property name', type:'text', required:true},
    {key:'address', label:'Address', type:'text'},
    {key:'currentlyOwned', label:'Currently owned', type:'checkbox'},
    {key:'purchaseDate', label:'Purchase date', type:'date'},
    {key:'movedOutDate', label:'Moved out date', type:'date'},
    {key:'purchasePrice', label:'Purchase price (£)', type:'number', step:'0.01'},
    {key:'currentValue', label:'Current value (£)', type:'number', step:'0.01'},
    {key:'totalMortgageAdvance', label:'Total mortgage advance (£)', type:'number', step:'0.01'},
    {key:'outstandingMortgage', label:'Outstanding mortgage', type:'checkbox'},
    {key:'currentMortgageRate', label:'Current mortgage rate (%)', type:'number', step:'0.01'},
  ];
  openForm({
    title: existing? 'Edit property' : 'Add property',
    fields,
    values: existing || {currentlyOwned:true},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing,data); } else { DB.properties.push(Object.assign({id:uid()},data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Vehicles                                                                */
/* ---------------------------------------------------------------------- */
function renderVehicles(container){
  container.innerHTML = `<div class="section"><div class="section-head"><h2>Vehicles</h2><button class="btn small" id="addVeh">+ Add vehicle</button></div><div id="vehWrap"></div></div>`;
  const wrap = document.getElementById('vehWrap');
  if(!DB.vehicles.length){
    wrap.innerHTML = `<div class="empty-state"><b>No vehicles yet</b>Add vehicles you currently own or have owned.</div>`;
  } else {
    wrap.innerHTML = `<div class="card-grid">` + DB.vehicles.map(v=>{
      const lived = timeLivedString(v.purchaseDate, v.currentlyOwned ? null : v.soldDate);
      return `<div class="thing-card" data-id="${v.id}">
        <h3>${escHtml(v.name)}</h3>
        <span class="tag ${v.currentlyOwned?'':'amber'}">${v.currentlyOwned?'Currently owned':'Previously owned'}</span>
        <div class="kv"><span>Type</span><b>${escHtml(v.type||'—')}</b></div>
        <div class="kv"><span>Registration</span><b>${escHtml(v.registration||'—')}</b></div>
        <div class="kv"><span>Purchased</span><b>${fmtDate(v.purchaseDate)}</b></div>
        <div class="kv"><span>Time owned</span><b>${lived}</b></div>
        ${!v.currentlyOwned? `<div class="kv"><span>Sold</span><b>${fmtDate(v.soldDate)}</b></div>`:''}
        <div class="kv"><span>Purchase price</span><b>${fmtMoney(v.purchasePrice)}</b></div>
        <div class="actions"><button class="btn secondary small" data-act="edit">Edit</button><button class="btn danger small" data-act="del">Delete</button></div>
      </div>`;
    }).join('') + `</div>`;
    wrap.querySelectorAll('.thing-card').forEach(card=>{
      const v = DB.vehicles.find(x=>x.id===card.dataset.id);
      card.querySelector('[data-act=edit]').onclick = ()=> openVehicleForm(v);
      card.querySelector('[data-act=del]').onclick = ()=> confirmDialog('This will permanently delete this vehicle.', ()=>{ DB.vehicles = DB.vehicles.filter(x=>x.id!==v.id); saveDB(); route(); toast('Deleted.'); });
    });
  }
  document.getElementById('addVeh').onclick = ()=> openVehicleForm(null);
}
function openVehicleForm(existing){
  const fields = [
    {key:'name', label:'Vehicle name', type:'text', required:true},
    {key:'type', label:'Vehicle type', type:'text'},
    {key:'registration', label:'Registration', type:'text'},
    {key:'currentlyOwned', label:'Currently owned', type:'checkbox'},
    {key:'purchaseDate', label:'Purchase date', type:'date'},
    {key:'soldDate', label:'Sold date', type:'date'},
    {key:'purchasePrice', label:'Purchase price (£)', type:'number', step:'0.01'},
  ];
  openForm({
    title: existing? 'Edit vehicle' : 'Add vehicle',
    fields,
    values: existing || {currentlyOwned:true},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing,data); } else { DB.vehicles.push(Object.assign({id:uid()},data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Birthdays (carousel page)                                              */
/* ---------------------------------------------------------------------- */
function renderBirthdays(container){
  const withInfo = DB.contacts.map(c=>{
    const info = nextBirthdayInfo(c.dobDay, c.dobMonth, c.dobYear);
    return info ? Object.assign({contact:c}, info) : null;
  }).filter(Boolean).sort((a,b)=> a.days - b.days);

  if(!withInfo.length){
    container.innerHTML = `<div class="empty-state"><b>No birthdays recorded</b>Add a date of birth to a contact to see them here.</div>`;
    return;
  }
  container.innerHTML = `<div class="card-grid">` + withInfo.map(b=>`
    <div class="bday-card"><div class="bday-avatar">${initialsOf(b.contact)}</div>
    <div><div class="title">${contactName(b.contact)}</div><div class="sub">${b.date.toLocaleDateString(undefined,{day:'numeric',month:'long'})}${b.age!=null?' · turning '+b.age:''}</div></div>
    <div class="bday-days"><b>${b.days===0?'Today':b.days}</b><span>${b.days===0?'':'days to go'}</span></div></div>`).join('') + `</div>`;
}

/* ---------------------------------------------------------------------- */
/* Todo list                                                              */
/* ---------------------------------------------------------------------- */
function renderTodos(container){
  container.innerHTML = `<div class="section-head"><h2 style="visibility:hidden">.</h2><button class="btn small" id="addSection">+ Add section</button></div><div id="todoSections"></div>`;
  const wrap = document.getElementById('todoSections');
  if(!DB.todoSections.length){
    wrap.innerHTML = `<div class="empty-state"><b>No sections yet</b>Create a section to start adding to-dos.</div>`;
  } else {
    DB.todoSections.forEach(sec=>{
      const card = document.createElement('div');
      card.className = 'section-card';
      const sorted = [...sec.todos].sort((a,b)=>{
        if(!!a.completed !== !!b.completed) return a.completed?1:-1;
        return (a.dueDate||'9999').localeCompare(b.dueDate||'9999');
      });
      card.innerHTML = `<div class="section-card-head"><h3>${escHtml(sec.name)}</h3>
        <div class="row-actions">
          <button class="btn secondary small" data-act="addTodo">+ To-do</button>
          <button class="btn secondary small" data-act="editSec">Rename</button>
          <button class="btn danger small" data-act="delSec">Delete</button>
        </div></div>
        <div class="todoList">${sorted.length ? sorted.map(t=>todoRowHtml(t)).join('') : '<div class="empty-state" style="padding:14px;">No to-dos in this section.</div>'}</div>`;
      wrap.appendChild(card);
      card.querySelector('[data-act=addTodo]').onclick = ()=> openTodoForm(sec, null);
      card.querySelector('[data-act=editSec]').onclick = ()=> openSectionForm('todoSections', sec);
      card.querySelector('[data-act=delSec]').onclick = ()=> confirmDialog('This deletes the section and all its to-dos.', ()=>{ DB.todoSections = DB.todoSections.filter(s=>s.id!==sec.id); saveDB(); route(); toast('Deleted.'); });
      card.querySelectorAll('.todo-row').forEach(row=>{
        const t = sec.todos.find(x=>x.id===row.dataset.id);
        row.querySelector('input[type=checkbox]').onchange = (e)=> toggleTodo(sec, t, e.target.checked);
        row.querySelector('.txt').onclick = ()=> openTodoForm(sec, t);
        row.querySelector('[data-act=del]').onclick = (ev)=>{ ev.stopPropagation(); confirmDialog('Delete this to-do?', ()=>{ sec.todos = sec.todos.filter(x=>x.id!==t.id); saveDB(); route(); toast('Deleted.'); }); };
      });
    });
  }
  document.getElementById('addSection').onclick = ()=> openSectionForm('todoSections', null);
}
function todoRowHtml(t){
  return `<div class="todo-row ${t.completed?'done':''}" data-id="${t.id}">
    <input type="checkbox" ${t.completed?'checked':''}>
    <span class="txt">${escHtml(t.text)}</span>
    ${t.repeat && t.repeat!=='none' ? `<span class="tag">${FREQ_LABELS[t.repeat]}</span>` : ''}
    <span class="todo-due">${t.dueDate? fmtDate(t.dueDate) + (t.dueTime?' · '+t.dueTime:'') : ''}</span>
    <button class="icon-btn" style="width:26px;height:26px;" data-act="del">✕</button>
  </div>`;
}
function toggleTodo(sec, t, checked){
  if(checked && t.repeat && t.repeat !== 'none' && t.dueDate){
    t.dueDate = addFrequency(t.dueDate, t.repeat, 1);
    t.completed = false;
    toast('Marked done — rescheduled for ' + fmtDate(t.dueDate));
  } else {
    t.completed = checked;
  }
  saveDB(); route();
}
function openSectionForm(listKey, existing){
  openForm({
    title: existing ? 'Rename section' : 'Add section',
    fields: [{key:'name', label:'Section name', type:'text', required:true}],
    values: existing || {},
    onSubmit: (data)=>{
      if(existing){ existing.name = data.name; }
      else { DB[listKey].push({id:uid(), name:data.name, todos: listKey==='todoSections'?[]:undefined, notes: listKey==='noteSections'?[]:undefined}); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}
function openTodoForm(sec, existing){
  openForm({
    title: existing? 'Edit to-do' : 'Add to-do',
    fields: [
      {key:'text', label:'To-do', type:'text', required:true},
      {key:'dueDate', label:'Due date', type:'date'},
      {key:'dueTime', label:'Due time', type:'time'},
      {key:'repeat', label:'Repeat', type:'select', options:[
        {value:'none',label:'Does not repeat'},{value:'daily',label:'Daily'},{value:'weekly',label:'Weekly'},
        {value:'fortnightly',label:'Fortnightly'},{value:'monthly',label:'Monthly'},{value:'quarterly',label:'Quarterly'},
        {value:'sixmonthly',label:'Every 6 months'},{value:'annually',label:'Yearly'}]},
    ],
    values: existing || {repeat:'none'},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing, data); }
      else { sec.todos.push(Object.assign({id:uid(), completed:false}, data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Notes                                                                  */
/* ---------------------------------------------------------------------- */
function renderNotes(container){
  container.innerHTML = `<div class="section-head"><h2 style="visibility:hidden">.</h2><button class="btn small" id="addNSection">+ Add section</button></div><div id="noteSections"></div>`;
  const wrap = document.getElementById('noteSections');
  if(!DB.noteSections.length){
    wrap.innerHTML = `<div class="empty-state"><b>No sections yet</b>Create a section to start writing notes.</div>`;
  } else {
    DB.noteSections.forEach(sec=>{
      const card = document.createElement('div');
      card.className = 'section-card';
      card.innerHTML = `<div class="section-card-head"><h3>${escHtml(sec.name)}</h3>
        <div class="row-actions">
          <button class="btn secondary small" data-act="addNote">+ Note</button>
          <button class="btn secondary small" data-act="editSec">Rename</button>
          <button class="btn danger small" data-act="delSec">Delete</button>
        </div></div>
        <div class="card-grid">${sec.notes.length ? sec.notes.map(n=>`
          <div class="note-card" data-id="${n.id}"><h4>${escHtml(n.heading||'Untitled')}</h4><p>${escHtml(n.body||'')}</p><div class="meta">Edited ${fmtDate(n.editedDate)}</div></div>`).join('') : '<div class="empty-state" style="padding:14px;">No notes in this section.</div>'}</div>`;
      wrap.appendChild(card);
      card.querySelector('[data-act=addNote]').onclick = ()=> openNoteForm(sec, null);
      card.querySelector('[data-act=editSec]').onclick = ()=> openSectionForm('noteSections', sec);
      card.querySelector('[data-act=delSec]').onclick = ()=> confirmDialog('This deletes the section and all its notes.', ()=>{ DB.noteSections = DB.noteSections.filter(s=>s.id!==sec.id); saveDB(); route(); toast('Deleted.'); });
      card.querySelectorAll('.note-card').forEach(nc=>{
        const n = sec.notes.find(x=>x.id===nc.dataset.id);
        nc.onclick = ()=> openNoteForm(sec, n);
      });
    });
  }
  document.getElementById('addNSection').onclick = ()=> openSectionForm('noteSections', null);
}
function openNoteForm(sec, existing){
  const otherSections = DB.noteSections.filter(s=>s.id!==sec.id);
  openForm({
    title: existing? 'Edit note' : 'Add note',
    wide: true,
    fields: [
      {key:'heading', label:'Heading', type:'text', required:true},
      {key:'body', label:'Body (plain text / markdown)', type:'textarea'},
      ...(existing && otherSections.length ? [{key:'moveTo', label:'Move to section', type:'select', options:[{value:'', label:sec.name+' (current)'}, ...otherSections.map(s=>({value:s.id,label:s.name}))]}] : [])
    ],
    values: existing || {},
    onSubmit: (data)=>{
      const now = todayISO();
      if(existing){
        existing.heading = data.heading; existing.body = data.body; existing.editedDate = now;
        if(data.moveTo){
          const target = DB.noteSections.find(s=>s.id===data.moveTo);
          sec.notes = sec.notes.filter(n=>n.id!==existing.id);
          target.notes.push(existing);
        }
      } else {
        sec.notes.push({id:uid(), heading:data.heading, body:data.body, createdDate:now, editedDate:now});
      }
      saveDB(); closeModal(); route(); toast('Saved.');
    },
    extraHtml: existing ? `<div class="field-row" style="margin-bottom:8px;"><div style="font-size:12px;color:var(--ink-faint);">Created ${fmtDate(existing.createdDate)}</div><div style="font-size:12px;color:var(--ink-faint);text-align:right;">Last edited ${fmtDate(existing.editedDate)}</div></div>` : ''
  });
  if(existing){
    // add delete button
    setTimeout(()=>{
      const actions = document.querySelector('.form-actions');
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn danger'; del.textContent = 'Delete note'; del.style.marginRight = 'auto';
      del.onclick = ()=> confirmDialog('Delete this note?', ()=>{ sec.notes = sec.notes.filter(n=>n.id!==existing.id); saveDB(); closeModal(); route(); toast('Deleted.'); });
      actions.prepend(del);
    },0);
  }
}

/* ---------------------------------------------------------------------- */
/* Health — medications                                                   */
/* ---------------------------------------------------------------------- */
function computeMedStock(med){
  const rx = [...(med.prescriptions||[])].sort((a,b)=> a.date.localeCompare(b.date));
  if(!rx.length) return null;
  let stock = 0;
  let lastDate = null;
  rx.forEach(p=>{
    if(lastDate){
      const days = daysBetween(parseISO(lastDate), parseISO(p.date));
      stock -= days * (med.dosePerDay||0);
    }
    stock += Number(p.quantity)||0;
    lastDate = p.date;
  });
  const today = new Date();
  const daysSinceLast = daysBetween(parseISO(lastDate), new Date(today));
  stock -= daysSinceLast * (med.dosePerDay||0);
  const dose = Number(med.dosePerDay) || 0;
  let runOutDays = dose > 0 ? Math.floor(stock / dose) : null;
  const runOutDate = new Date(); if(runOutDays!=null) runOutDate.setDate(runOutDate.getDate() + runOutDays);
  const reorderLead = DB.settings.medicationReorderDays || 0;
  const daysUntilReorder = runOutDays!=null ? (runOutDays - reorderLead) : null;
  return {stock, runOutDays, runOutDate, daysUntilReorder};
}

function renderHealth(container){
  container.innerHTML = `<div class="section-head"><h2 style="visibility:hidden">.</h2>
    <div class="row-actions">
      <button class="btn secondary small" id="reorderPref">Reorder preference: ${DB.settings.medicationReorderDays} days</button>
      <button class="btn small" id="addMed">+ Add medication</button>
    </div></div><div id="medWrap"></div>`;

  document.getElementById('reorderPref').onclick = ()=>{
    openForm({
      title: 'Reorder preference',
      fields: [{key:'medicationReorderDays', label:'Reorder this many days before running out', type:'number', required:true}],
      values: DB.settings,
      onSubmit: (data)=>{ DB.settings.medicationReorderDays = Number(data.medicationReorderDays)||0; saveDB(); closeModal(); route(); toast('Saved.'); }
    });
  };

  const wrap = document.getElementById('medWrap');
  if(!DB.medications.length){
    wrap.innerHTML = `<div class="empty-state"><b>No medications yet</b>Add a medication and log prescriptions to track reorder dates.</div>`;
  } else {
    wrap.innerHTML = `<div class="card-grid">` + DB.medications.map(m=>{
      const calc = computeMedStock(m);
      let statusHtml = `<span class="tag">No prescriptions logged</span>`;
      if(calc){
        if(calc.daysUntilReorder == null){
          statusHtml = `<span class="tag">Set a dose per day to calculate</span>`;
        } else if(calc.daysUntilReorder < 0){
          statusHtml = `<span class="tag red">${Math.abs(calc.daysUntilReorder)} days overdue to reorder</span>`;
        } else {
          statusHtml = `<span class="tag amber">Reorder in ${calc.daysUntilReorder} days</span>`;
        }
      }
      return `<div class="thing-card" data-id="${m.id}">
        <h3>${escHtml(m.name)}</h3>
        <div class="kv"><span>Strength</span><b>${escHtml(m.strength||'—')}</b></div>
        <div class="kv"><span>Dose / day</span><b>${m.dosePerDay!=null? m.dosePerDay : '—'}</b></div>
        ${calc? `<div class="kv"><span>Estimated stock</span><b>${Math.max(0,Math.round(calc.stock))} tablets</b></div>` : ''}
        ${calc && calc.runOutDays!=null ? `<div class="kv"><span>Runs out</span><b>${fmtDate(calc.runOutDate.toISOString().slice(0,10))}</b></div>` : ''}
        <div>${statusHtml}</div>
        <div class="actions">
          <button class="btn secondary small" data-act="rx">Log prescription</button>
          <button class="btn secondary small" data-act="edit">Edit</button>
          <button class="btn danger small" data-act="del">Delete</button>
        </div>
      </div>`;
    }).join('') + `</div>`;
    wrap.querySelectorAll('.thing-card').forEach(card=>{
      const m = DB.medications.find(x=>x.id===card.dataset.id);
      card.querySelector('[data-act=edit]').onclick = ()=> openMedForm(m);
      card.querySelector('[data-act=rx]').onclick = ()=> openPrescriptionForm(m);
      card.querySelector('[data-act=del]').onclick = ()=> confirmDialog('This will permanently delete this medication and its prescription history.', ()=>{ DB.medications = DB.medications.filter(x=>x.id!==m.id); saveDB(); route(); toast('Deleted.'); });
    });
  }
  document.getElementById('addMed').onclick = ()=> openMedForm(null);
}
function openMedForm(existing){
  openForm({
    title: existing? 'Edit medication' : 'Add medication',
    fields: [
      {key:'name', label:'Medication name', type:'text', required:true},
      {key:'strength', label:'Strength (e.g. 500mg)', type:'text'},
      {key:'dosePerDay', label:'Dose per day (tablets)', type:'number', step:'0.5', required:true},
    ],
    values: existing || {},
    onSubmit: (data)=>{
      if(existing){ Object.assign(existing, data); }
      else { DB.medications.push(Object.assign({id:uid(), prescriptions:[]}, data)); }
      saveDB(); closeModal(); route(); toast('Saved.');
    }
  });
}
function openPrescriptionForm(med){
  openForm({
    title: 'Log prescription — ' + med.name,
    fields: [
      {key:'date', label:'Date received', type:'date', required:true},
      {key:'strength', label:'Strength prescribed', type:'text'},
      {key:'quantity', label:'Number of tablets', type:'number', required:true},
    ],
    values: {date: todayISO()},
    onSubmit: (data)=>{
      med.prescriptions = med.prescriptions || [];
      med.prescriptions.push(data);
      saveDB(); closeModal(); route(); toast('Prescription logged.');
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Contacts                                                                */
/* ---------------------------------------------------------------------- */
function renderContacts(container){
  container.innerHTML = `<div class="section-head"><h2 style="visibility:hidden">.</h2><button class="btn small" id="addContact">+ Add contact</button></div><div id="contactWrap"></div>`;
  const wrap = document.getElementById('contactWrap');
  if(!DB.contacts.length){
    wrap.innerHTML = `<div class="empty-state"><b>No contacts yet</b>Add people to track birthdays, key dates and details in one place.</div>`;
  } else {
    const sorted = [...DB.contacts].sort((a,b)=> contactName(a).localeCompare(contactName(b)));
    wrap.innerHTML = `<div class="card-grid">` + sorted.map(c=>{
      const email = (c.contactInfo||[]).find(ci=>ci.type==='Email Address');
      const mobile = (c.contactInfo||[]).find(ci=>ci.type==='Mobile Number');
      return `<div class="thing-card" data-id="${c.id}">
        <h3>${contactName(c)}</h3>
        ${c.dobDay&&c.dobMonth? `<div class="kv"><span>Birthday</span><b>${c.dobDay} ${MONTHS[c.dobMonth-1]}${c.dobYear? ' '+c.dobYear:''}</b></div>` : ''}
        ${mobile? `<div class="kv"><span>Mobile</span><b>${escHtml(mobile.value)}</b></div>` : ''}
        ${email? `<div class="kv"><span>Email</span><b>${escHtml(email.value)}</b></div>` : ''}
        <div class="actions"><button class="btn secondary small" data-act="edit">Edit</button><button class="btn danger small" data-act="del">Delete</button></div>
      </div>`;
    }).join('') + `</div>`;
    wrap.querySelectorAll('.thing-card').forEach(card=>{
      const c = DB.contacts.find(x=>x.id===card.dataset.id);
      card.querySelector('[data-act=edit]').onclick = ()=> openContactForm(c);
      card.querySelector('[data-act=del]').onclick = ()=> confirmDialog('This will permanently delete this contact.', ()=>{ DB.contacts = DB.contacts.filter(x=>x.id!==c.id); saveDB(); route(); toast('Deleted.'); });
    });
  }
  document.getElementById('addContact').onclick = ()=> openContactForm(null);
}

const CONTACT_INFO_TYPES = ['Mobile Number','Home Phone Number','Work Number','Email Address'];
const LINK_TYPES = ['Spouse/Partner','Parent','Child','Sibling','Friend','Colleague','Other'];

function blankContact(){
  return {id:null, firstName:'', middleName:'', surname:'', gender:'', dobDay:'', dobMonth:'', dobYear:'',
    contactInfo:[], address:{line1:'',line2:'',city:'',postcode:'',country:''},
    bankInfo:[], sensitiveInfo:[], keyDates:[], links:[], customFields:{}};
}

function openContactForm(existingRef){
  const working = existingRef ? JSON.parse(JSON.stringify(existingRef)) : blankContact();
  working.contactInfo = working.contactInfo || [];
  working.bankInfo = working.bankInfo || [];
  working.sensitiveInfo = working.sensitiveInfo || [];
  working.keyDates = working.keyDates || [];
  working.links = working.links || [];
  working.address = working.address || {};
  working.customFields = working.customFields || {};

  function val(id){ const el=document.getElementById(id); if(!el) return undefined; return el.type==='checkbox' ? el.checked : el.value; }
  function sync(){
    working.firstName = val('c_firstName'); working.middleName = val('c_middleName'); working.surname = val('c_surname');
    working.gender = val('c_gender');
    working.dobDay = val('c_dobDay'); working.dobMonth = val('c_dobMonth'); working.dobYear = val('c_dobYear');
    working.address = {line1:val('c_addr_line1'), line2:val('c_addr_line2'), city:val('c_addr_city'), postcode:val('c_addr_postcode'), country:val('c_addr_country')};
    working.contactInfo.forEach(r=>{ r.type = val('ci_type_'+r.id); r.value = val('ci_value_'+r.id); });
    working.bankInfo.forEach(r=>{ r.sortCode=val('bi_sc_'+r.id); r.accountNumber=val('bi_an_'+r.id); r.reference=val('bi_ref_'+r.id); });
    working.sensitiveInfo.forEach(r=>{ r.nationalInsuranceNumber=val('si_ni_'+r.id); r.drivingLicenceNumber=val('si_dl_'+r.id); r.passportNumber=val('si_pp_'+r.id); r.bloodType=val('si_bt_'+r.id); });
    working.keyDates.forEach(r=>{ r.name=val('kd_name_'+r.id); r.date=val('kd_date_'+r.id); r.notes=val('kd_notes_'+r.id); });
    working.links.forEach(r=>{ r.contactId=val('lk_id_'+r.id); r.type=val('lk_type_'+r.id); });
    (DB.settings.contactCustomFields||[]).forEach(cf=>{ working.customFields[cf.id] = val('cf_'+cf.id); });
  }

  function repeatRow(html, removeId){
    return `<div class="repeat-block"><div class="repeat-block-head"><span></span><button type="button" class="btn danger small" data-remove="${removeId}">Remove</button></div>${html}</div>`;
  }

  function draw(){
    const otherContacts = DB.contacts.filter(c=> c.id !== working.id);
    const customFieldsHtml = (DB.settings.contactCustomFields||[]).map(cf=>
      `<div class="field"><label>${escHtml(cf.label)}</label><input type="text" id="cf_${cf.id}" value="${escAttr(working.customFields[cf.id]||'')}"></div>`
    ).join('');

    const html = `
      <div class="subgroup-label">Basic details</div>
      <div class="field-row">
        <div class="field"><label>First name</label><input type="text" id="c_firstName" value="${escAttr(working.firstName)}"></div>
        <div class="field"><label>Middle name</label><input type="text" id="c_middleName" value="${escAttr(working.middleName)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Surname</label><input type="text" id="c_surname" value="${escAttr(working.surname)}"></div>
        <div class="field"><label>Gender</label><select id="c_gender">
          <option value="">—</option>
          <option value="male" ${working.gender==='male'?'selected':''}>Male</option>
          <option value="female" ${working.gender==='female'?'selected':''}>Female</option>
          <option value="other" ${working.gender==='other'?'selected':''}>Other</option>
        </select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Day of birth</label><input type="number" min="1" max="31" id="c_dobDay" value="${escAttr(working.dobDay)}"></div>
        <div class="field"><label>Month of birth</label><select id="c_dobMonth"><option value="">—</option>${MONTHS.map((m,i)=>`<option value="${i+1}" ${Number(working.dobMonth)===i+1?'selected':''}>${m}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Year of birth</label><input type="number" id="c_dobYear" value="${escAttr(working.dobYear)}" style="max-width:140px;"></div>
      ${customFieldsHtml}

      <div class="subgroup-label">Contact information</div>
      ${working.contactInfo.map(r=> repeatRow(`
        <div class="field-row">
          <div class="field"><label>Type</label><select id="ci_type_${r.id}">${CONTACT_INFO_TYPES.map(t=>`<option ${r.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Value</label><input type="text" id="ci_value_${r.id}" value="${escAttr(r.value)}"></div>
        </div>`, r.id)).join('')}
      <button type="button" class="add-row-btn" data-add="contactInfo">+ Add contact information</button>

      <div class="subgroup-label">Address</div>
      <div class="field-row">
        <div class="field"><label>Address line 1</label><input type="text" id="c_addr_line1" value="${escAttr(working.address.line1||'')}"></div>
        <div class="field"><label>Address line 2</label><input type="text" id="c_addr_line2" value="${escAttr(working.address.line2||'')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>City</label><input type="text" id="c_addr_city" value="${escAttr(working.address.city||'')}"></div>
        <div class="field"><label>Postcode</label><input type="text" id="c_addr_postcode" value="${escAttr(working.address.postcode||'')}"></div>
      </div>
      <div class="field"><label>Country</label><input type="text" id="c_addr_country" value="${escAttr(working.address.country||'')}"></div>

      <div class="subgroup-label">Bank information</div>
      ${working.bankInfo.map(r=> repeatRow(`
        <div class="field-row">
          <div class="field"><label>Sort code</label><input type="text" id="bi_sc_${r.id}" value="${escAttr(r.sortCode||'')}"></div>
          <div class="field"><label>Account number</label><input type="text" id="bi_an_${r.id}" value="${escAttr(r.accountNumber||'')}"></div>
        </div>
        <div class="field"><label>Reference</label><input type="text" id="bi_ref_${r.id}" value="${escAttr(r.reference||'')}"></div>`, r.id)).join('')}
      <button type="button" class="add-row-btn" data-add="bankInfo">+ Add bank information</button>

      <div class="subgroup-label">Sensitive information</div>
      ${working.sensitiveInfo.map(r=> repeatRow(`
        <div class="field-row">
          <div class="field"><label>National Insurance number</label><input type="text" id="si_ni_${r.id}" value="${escAttr(r.nationalInsuranceNumber||'')}"></div>
          <div class="field"><label>Driving licence number</label><input type="text" id="si_dl_${r.id}" value="${escAttr(r.drivingLicenceNumber||'')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Passport number</label><input type="text" id="si_pp_${r.id}" value="${escAttr(r.passportNumber||'')}"></div>
          <div class="field"><label>Blood type</label><input type="text" id="si_bt_${r.id}" value="${escAttr(r.bloodType||'')}"></div>
        </div>`, r.id)).join('')}
      <button type="button" class="add-row-btn" data-add="sensitiveInfo">+ Add sensitive information</button>

      <div class="subgroup-label">Key dates</div>
      ${working.keyDates.map(r=> repeatRow(`
        <div class="field-row">
          <div class="field"><label>Name</label><input type="text" id="kd_name_${r.id}" value="${escAttr(r.name||'')}"></div>
          <div class="field"><label>Date</label><input type="date" id="kd_date_${r.id}" value="${escAttr(r.date||'')}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="kd_notes_${r.id}">${escHtml(r.notes||'')}</textarea></div>`, r.id)).join('')}
      <button type="button" class="add-row-btn" data-add="keyDates">+ Add key date</button>

      <div class="subgroup-label">Linked contacts</div>
      ${working.links.map(r=> repeatRow(`
        <div class="field-row">
          <div class="field"><label>Contact</label><select id="lk_id_${r.id}"><option value="">—</option>${otherContacts.map(o=>`<option value="${o.id}" ${r.contactId===o.id?'selected':''}>${contactName(o)}</option>`).join('')}</select></div>
          <div class="field"><label>Relationship</label><select id="lk_type_${r.id}">${LINK_TYPES.map(t=>`<option ${r.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
        </div>`, r.id)).join('')}
      <button type="button" class="add-row-btn" data-add="links">+ Link a contact</button>
    `;

    const extraStyle = existingRef ? `<button type="button" class="btn danger" id="deleteContactBtn" style="margin-right:auto;">Delete contact</button>` : '';

    openForm({
      title: existingRef ? 'Edit contact' : 'Add contact',
      wide: true,
      fields: [],
      extraHtml: html,
      onSubmit: ()=>{
        sync();
        if(!working.firstName && !working.surname){ toast('Add at least a first name or surname.'); return; }
        if(existingRef){
          Object.assign(existingRef, working);
        } else {
          working.id = uid();
          DB.contacts.push(working);
        }
        saveDB(); closeModal(); route(); toast('Saved.');
      }
    });

    document.querySelectorAll('[data-add]').forEach(btn=>{
      btn.onclick = ()=>{ sync(); working[btn.dataset.add].push({id:uid()}); draw(); };
    });
    document.querySelectorAll('[data-remove]').forEach(btn=>{
      btn.onclick = ()=>{
        sync();
        const rid = btn.dataset.remove;
        ['contactInfo','bankInfo','sensitiveInfo','keyDates','links'].forEach(k=>{
          working[k] = working[k].filter(r=> r.id !== rid);
        });
        draw();
      };
    });
    if(existingRef){
      const actions = document.querySelector('.form-actions');
      const del = document.createElement('button');
      del.type='button'; del.className='btn danger'; del.textContent='Delete contact'; del.style.marginRight='auto';
      del.onclick = ()=> confirmDialog('Delete this contact permanently?', ()=>{ DB.contacts = DB.contacts.filter(c=>c.id!==existingRef.id); saveDB(); closeModal(); route(); toast('Deleted.'); });
      actions.prepend(del);
    }
  }
  draw();
}

/* ---------------------------------------------------------------------- */
/* Preferences & Data                                                      */
/* ---------------------------------------------------------------------- */
let prefTab = 'categories';
function openPreferences(){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" id="prefOverlay">
      <div class="modal wide">
        <div class="modal-head"><h2>Preferences &amp; Data</h2><button class="modal-close" id="prefClose">✕</button></div>
        <div class="pref-tabs">
          <button class="pref-tab" data-tab="categories">Categories</button>
          <button class="pref-tab" data-tab="fields">Contact fields</button>
          <button class="pref-tab" data-tab="data">Data</button>
        </div>
        <div id="prefBody"></div>
      </div>
    </div>`;
  document.getElementById('prefOverlay').addEventListener('click', e=>{ if(e.target.id==='prefOverlay') closeModal(); });
  document.getElementById('prefClose').onclick = closeModal;
  root.querySelectorAll('.pref-tab').forEach(t=> t.onclick = ()=>{ prefTab = t.dataset.tab; drawPrefBody(); });
  drawPrefBody();
}
function drawPrefBody(){
  document.querySelectorAll('.pref-tab').forEach(t=> t.classList.toggle('active', t.dataset.tab===prefTab));
  const body = document.getElementById('prefBody');
  if(prefTab === 'categories'){
    const cats = DB.settings.categories;
    body.innerHTML = Object.keys(cats).map(type=>`
      <div class="field">
        <label style="text-transform:capitalize;">${type} categories</label>
        <div class="chip-list" id="chips_${type}">
          ${cats[type].map(c=>`<span class="chip">${escHtml(c)}<button data-type="${type}" data-cat="${escAttr(c)}">✕</button></span>`).join('')}
        </div>
        <div class="field-row" style="margin-top:8px;">
          <input type="text" id="newcat_${type}" placeholder="New ${type} category">
          <button class="btn secondary small" data-addcat="${type}" style="width:auto;">Add</button>
        </div>
      </div>`).join('');
    body.querySelectorAll('[data-cat]').forEach(b=> b.onclick = ()=>{
      const {type, cat} = b.dataset;
      DB.settings.categories[type] = DB.settings.categories[type].filter(c=>c!==cat);
      saveDB(); drawPrefBody();
    });
    body.querySelectorAll('[data-addcat]').forEach(b=> b.onclick = ()=>{
      const type = b.dataset.addcat;
      const input = document.getElementById('newcat_'+type);
      const v = input.value.trim();
      if(v && !DB.settings.categories[type].includes(v)){ DB.settings.categories[type].push(v); saveDB(); drawPrefBody(); }
    });
  } else if(prefTab === 'fields'){
    const fields = DB.settings.contactCustomFields;
    body.innerHTML = `
      <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">Custom fields you add here appear on every contact, new and existing.</p>
      <div class="chip-list" id="customFieldChips">
        ${fields.map(f=>`<span class="chip">${escHtml(f.label)}<button data-fid="${f.id}">✕</button></span>`).join('') || '<span style="font-size:13px;color:var(--ink-faint);">No custom fields yet.</span>'}
      </div>
      <div class="field-row" style="margin-top:10px;">
        <input type="text" id="newFieldLabel" placeholder="New field name (e.g. Employer)">
        <button class="btn secondary small" id="addFieldBtn" style="width:auto;">Add field</button>
      </div>`;
    body.querySelectorAll('[data-fid]').forEach(b=> b.onclick = ()=>{
      DB.settings.contactCustomFields = fields.filter(f=>f.id!==b.dataset.fid);
      saveDB(); drawPrefBody();
    });
    document.getElementById('addFieldBtn').onclick = ()=>{
      const input = document.getElementById('newFieldLabel');
      const v = input.value.trim();
      if(v){ DB.settings.contactCustomFields.push({id:uid(), label:v, type:'text'}); saveDB(); drawPrefBody(); }
    };
  } else if(prefTab === 'data'){
    body.innerHTML = `
      <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">All data is stored only in this browser's local storage. Export a backup regularly, or move your data to another device.</p>
      <div class="form-actions" style="justify-content:flex-start;border:none;padding-top:0;margin-top:0;">
        <button class="btn" id="exportBtn">Export JSON</button>
        <button class="btn secondary" id="importBtn">Import JSON</button>
        <input type="file" id="importFile" accept=".json" style="display:none;">
      </div>
      <div class="form-actions" style="justify-content:flex-start;border-top:1px solid var(--border);margin-top:18px;">
        <button class="btn danger" id="wipeBtn">Delete all data</button>
      </div>`;
    document.getElementById('exportBtn').onclick = exportData;
    document.getElementById('importBtn').onclick = ()=> document.getElementById('importFile').click();
    document.getElementById('importFile').onchange = (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = ()=>{
        try{
          const parsed = JSON.parse(reader.result);
          DB = Object.assign(defaultData(), parsed);
          DB.settings = Object.assign({}, defaultData().settings, parsed.settings||{});
          saveDB(); applyTheme(); closeModal(); route(); toast('Data imported.');
        }catch(err){ toast('That file could not be read as valid LifeOS JSON.'); }
      };
      reader.readAsText(file);
    };
    document.getElementById('wipeBtn').onclick = ()=> confirmDialog('This permanently deletes all LifeOS data stored in this browser. This cannot be undone.', ()=>{
      localStorage.removeItem(DB_KEY);
      DB = defaultData();
      saveDB(); applyTheme(); closeModal(); route(); toast('All data deleted.');
    });
  }
}
function exportData(){
  const blob = new Blob([JSON.stringify(DB, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'lifeos-export-' + todayISO() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Exported.');
}

/* ---------------------------------------------------------------------- */
/* Init                                                                    */
/* ---------------------------------------------------------------------- */
function init(){
  buildNav();
  applyTheme();
  document.getElementById('themeToggle').onclick = toggleTheme;
  document.getElementById('openPrefs').onclick = openPreferences;
  document.getElementById('menuBtn').onclick = openSidebar;
  document.getElementById('sidebarClose').onclick = closeSidebar;
  document.getElementById('scrim').onclick = closeSidebar;
  if(!location.hash) location.hash = '#/dashboard';
  route();
}
document.addEventListener('DOMContentLoaded', init);
