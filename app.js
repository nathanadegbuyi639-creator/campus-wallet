/* =========================================================
   Allowance — shared data layer & helpers
   No styling here on purpose — this file only handles state,
   persistence (localStorage) and small DOM utilities.
   ========================================================= */

const STORAGE_KEY = 'allowanceAppState';

/* ---------- default / initial state ---------- */
function getDefaultState(){
  const today = new Date().toISOString().slice(0,10);
  return {
    profile: {
      name: 'Nathan',
      email: 'nathan@example.com',
      currency: '₦',
      period: 'Weekly',           // Weekly | Bi-weekly | Monthly
      notifications: {
        dailyCheckin: true,
        weeklySummary: true,
        goalMilestones: true
      }
    },
    allowance: {
      amount: 0,
      periodStart: today          // date the current allowance cycle began
    },
    transactions: [],             // { id, type, category, description, amount, date }
    savings: {
      general:  { balance: 0, lockDate: null, history: [] }, // fixed savings, locked until lockDate
      emergency:{ balance: 0, history: [] }                  // flexible savings, withdraw anytime
    },
    goals: []                     // { id, name, target, saved, dueDate }
  };
}

/* ---------- persistence ---------- */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    const def = getDefaultState();
    return {
      profile: Object.assign({}, def.profile, parsed.profile, {
        notifications: Object.assign({}, def.profile.notifications, parsed.profile && parsed.profile.notifications)
      }),
      allowance: Object.assign({}, def.allowance, parsed.allowance),
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      savings: {
        general: Object.assign({}, def.savings.general, parsed.savings && parsed.savings.general),
        emergency: Object.assign({}, def.savings.emergency, parsed.savings && parsed.savings.emergency)
      },
      goals: Array.isArray(parsed.goals) ? parsed.goals : []
    };
  }catch(err){
    console.error('Could not read saved data, starting fresh.', err);
    return getDefaultState();
  }
}

function saveState(state){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(err){
    console.error('Could not save data.', err);
  }
  return state;
}

function resetState(){
  localStorage.removeItem(STORAGE_KEY);
  return loadState();
}

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayISO(){
  return new Date().toISOString().slice(0,10);
}

/* ---------- allowance ---------- */
function setAllowance(amount, period){
  const state = loadState();
  state.allowance.amount = Number(amount) || 0;
  state.allowance.periodStart = todayISO();
  if(period) state.profile.period = period;
  return saveState(state);
}

/* ---------- transactions ---------- */
// Internal: push a transaction onto an already-loaded state object (no save)
function pushTransaction(state, tx){
  state.transactions.unshift(Object.assign({
    id: uid(),
    date: todayISO()
  }, tx));
}

function addTransaction(tx){
  const state = loadState();
  pushTransaction(state, tx);
  return saveState(state);
}

function deleteTransaction(id){
  const state = loadState();
  state.transactions = state.transactions.filter(t => t.id !== id);
  return saveState(state);
}

/* ---------- savings ---------- */
// kind: 'general' | 'emergency'
function depositSavings(kind, amount, opts){
  const state = loadState();
  const bucket = state.savings[kind];
  if(!bucket) return { ok:false, state, reason:'Unknown savings type.' };
  const amt = Number(amount);
  if(!amt || amt <= 0) return { ok:false, state, reason:'Enter an amount greater than zero.' };

  bucket.balance += amt;
  bucket.history.unshift({ id: uid(), type:'deposit', amount: amt, date: todayISO() });
  if(kind === 'general' && opts && opts.lockDate){
    bucket.lockDate = opts.lockDate;
  }
  pushTransaction(state, {
    type: 'savings',
    category: kind === 'general' ? 'General Savings' : 'Emergency Savings',
    description: 'Deposit to ' + (kind === 'general' ? 'General Savings' : 'Emergency Savings'),
    amount: amt
  });
  saveState(state);
  return { ok:true, state };
}

function withdrawSavings(kind, amount){
  const state = loadState();
  const bucket = state.savings[kind];
  if(!bucket) return { ok:false, state, reason:'Unknown savings type.' };
  const amt = Number(amount);
  if(!amt || amt <= 0) return { ok:false, state, reason:'Enter an amount greater than zero.' };
  if(amt > bucket.balance) return { ok:false, state, reason:'That is more than the current balance.' };

  if(kind === 'general' && bucket.lockDate && todayISO() < bucket.lockDate){
    return { ok:false, state, reason:'General Savings is locked until ' + bucket.lockDate + '.' };
  }

  bucket.balance -= amt;
  bucket.history.unshift({ id: uid(), type:'withdraw', amount: amt, date: todayISO() });
  pushTransaction(state, {
    type: 'savings',
    category: kind === 'general' ? 'General Savings' : 'Emergency Savings',
    description: 'Withdrawal from ' + (kind === 'general' ? 'General Savings' : 'Emergency Savings'),
    amount: -amt
  });
  saveState(state);
  return { ok:true, state };
}

function setGeneralLockDate(lockDate){
  const state = loadState();
  state.savings.general.lockDate = lockDate || null;
  return saveState(state);
}

/* ---------- goals ---------- */
function addGoal(goal){
  const state = loadState();
  state.goals.push(Object.assign({ id: uid(), saved: 0 }, goal));
  return saveState(state);
}

function contributeToGoal(id, amount){
  const state = loadState();
  const goal = state.goals.find(g => g.id === id);
  if(!goal) return { ok:false, state, reason:'Goal not found.' };
  const amt = Number(amount);
  if(!amt || amt <= 0) return { ok:false, state, reason:'Enter an amount greater than zero.' };

  goal.saved += amt;
  pushTransaction(state, {
    type: 'savings',
    category: 'Goal: ' + goal.name,
    description: 'Contribution to ' + goal.name,
    amount: amt
  });
  saveState(state);
  return { ok:true, state };
}

function deleteGoal(id){
  const state = loadState();
  state.goals = state.goals.filter(g => g.id !== id);
  return saveState(state);
}

/* ---------- profile / settings ---------- */
function updateProfile(patch){
  const state = loadState();
  state.profile = Object.assign({}, state.profile, patch);
  return saveState(state);
}

function updateNotification(key, value){
  const state = loadState();
  state.profile.notifications[key] = value;
  return saveState(state);
}

/* ---------- derived stats ---------- */
function computeStats(state){
  const txs = state.transactions;
  const spent   = txs.filter(t => t.type === 'expense').reduce((a,t)=>a+Number(t.amount),0);
  const saved   = txs.filter(t => t.type === 'savings').reduce((a,t)=>a+Number(t.amount),0);
  const other   = txs.filter(t => t.type === 'other').reduce((a,t)=>a+Number(t.amount),0);
  const allowance = Number(state.allowance.amount) || 0;
  const remaining = allowance - spent - saved - other;

  const categoryTotals = {};
  txs.filter(t => t.type === 'expense').forEach(t=>{
    const key = t.category || 'Other';
    categoryTotals[key] = (categoryTotals[key] || 0) + Number(t.amount);
  });
  const categoryList = Object.keys(categoryTotals).map(name => ({
    name,
    amount: categoryTotals[name],
    pct: spent ? Math.round(categoryTotals[name] / spent * 100) : 0
  })).sort((a,b)=>b.amount - a.amount);

  return { allowance, spent, saved, other, remaining, categoryList };
}

function fmt(amount, currency){
  const c = currency || (loadState().profile.currency) || '₦';
  const n = Number(amount) || 0;
  return c + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatDate(iso){
  if(!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' });
}

/* ---------- small DOM utilities (no styling involved) ---------- */
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

// Marks the current page's nav link so a stylesheet can target it later.
function markActiveNav(){
  const page = document.body.getAttribute('data-page');
  if(!page) return;
  qsa('[data-nav]').forEach(link=>{
    if(link.getAttribute('data-nav') === page){
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
  });
}

// Generic tab/filter switcher: buttons with [data-tab] inside [data-tab-group]
// toggle sibling elements with matching [data-panel] using the `hidden` attribute.
function initTabs(root){
  (root || document).querySelectorAll('[data-tab-group]').forEach(group=>{
    const panelRoot = document.querySelector(group.getAttribute('data-controls'));
    if(!panelRoot) return;
    group.querySelectorAll('[data-tab]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        group.querySelectorAll('[data-tab]').forEach(b=>{
          b.classList.remove('active');
          b.removeAttribute('aria-current');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'true');
        const target = btn.getAttribute('data-tab');
        panelRoot.querySelectorAll('[data-panel]').forEach(p=>{
          p.hidden = p.getAttribute('data-panel') !== target;
        });
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', markActiveNav);
