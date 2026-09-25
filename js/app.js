
(function(){
"use strict";

// TEMP DEV TOOL — remove after mobile development
const qPokoyDevVersion='dev-2026.09.26.47';
const qPokoyDevVersionLabel=document.getElementById('qPokoyDevVersion');
const qPokoyDevRefresh=document.getElementById('qPokoyDevRefresh');
if(qPokoyDevVersionLabel)qPokoyDevVersionLabel.textContent=qPokoyDevVersion;
qPokoyDevRefresh?.addEventListener('click',async()=>{
  try{
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(key=>caches.delete(key)));
    }
  }catch(error){
    console.warn('[qPokoy dev refresh cache]',error);
  }
  const url=new URL(window.location.href);
  url.search='';
  url.hash='';
  url.searchParams.set('_dev',qPokoyDevVersion);
  url.searchParams.set('_devrefresh',Date.now().toString());
  window.location.replace(url.toString());
});

const sidebar=document.querySelector('.sidebar');
const content=document.querySelector('.content');
const toggleSidebar=document.getElementById('toggleSidebar');
toggleSidebar.addEventListener('click',()=>{
  sidebar.classList.toggle('collapsed');
  content.classList.toggle('expanded');
  localStorage.setItem('sidebarCollapsed',sidebar.classList.contains('collapsed'));
});
if(localStorage.getItem('sidebarCollapsed')==='true'){
  sidebar.classList.add('collapsed'); content.classList.add('expanded');
}

const navItems=document.querySelectorAll('.nav-item');
const pages=document.querySelectorAll('.page');
const title=document.getElementById('pageTitle');
let incomeRenderGeneration=0;
let incomeRenderFrame=0;
let incomeRenderAfterFrame=0;
function invalidateDeferredIncomeRender(){
  incomeRenderGeneration++;
  if(incomeRenderFrame){cancelAnimationFrame(incomeRenderFrame);incomeRenderFrame=0;}
  if(incomeRenderAfterFrame){cancelAnimationFrame(incomeRenderAfterFrame);incomeRenderAfterFrame=0;}
}
function deferIncomeRender(){
  const generation=incomeRenderGeneration;
  incomeRenderFrame=requestAnimationFrame(()=>{
    incomeRenderFrame=0;
    incomeRenderAfterFrame=requestAnimationFrame(()=>{
      incomeRenderAfterFrame=0;
      const incomeNav=document.querySelector('.nav-item[data-page="income"]');
      if(generation!==incomeRenderGeneration||!incomeNav?.classList.contains('active'))return;
      if(typeof window.renderIncomes==='function')window.renderIncomes();
    });
  });
}
navItems.forEach(item=>item.addEventListener('click',()=>{
  if(!item.classList.contains('active')&&!incomeForm.hidden) closeIncomeEditor();
  invalidateDeferredIncomeRender();
  navItems.forEach(x=>x.classList.remove('active'));
  pages.forEach(x=>x.classList.remove('active'));
  item.classList.add('active');
  document.getElementById(item.dataset.page).classList.add('active');
  title.textContent=item.querySelector('.nav-label')?.textContent||item.textContent.trim();

  // При каждом возврате на «Главную» показываем актуальные месяц и год.
  // Ручное переключение периода работает до ухода с вкладки.
  if(item.dataset.page==='income'){
    const now=new Date();
    const period={month:now.getMonth(),year:now.getFullYear()};
    localStorage.setItem('incomeSelectedPeriod',JSON.stringify(period));
    const names=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const caption=document.getElementById('incomeMonthCaption');
    const switcherName=document.getElementById('monthSwitcherName');
    if(caption)caption.textContent=names[period.month];
    if(switcherName)switcherName.textContent=names[period.month];
    deferIncomeRender();
  }

  // При переходе между разделами всегда начинаем с верхней части страницы.
  window.scrollTo({top:0,left:0,behavior:'auto'});
}));

window.addEventListener('load',()=>{
  if(!window.matchMedia('(min-width:761px)').matches)return;
  const incomeTop=document.querySelector('#income .income-top');
  if(!incomeTop)return;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      incomeTop.scrollIntoView({behavior:'auto',block:'center',inline:'nearest'});
    });
  });
},{once:true});

document.documentElement.setAttribute('data-theme','dark');
document.body.classList.add('dark');
localStorage.removeItem('theme');

const navLabelModeButtons=document.querySelectorAll('.nav-label-mode-btn');
function setNavLabelMode(mode){
  const allowed=['both','icons'];
  mode=allowed.includes(mode)?mode:'both';
  document.documentElement.setAttribute('data-nav-label-mode',mode);
  navLabelModeButtons.forEach(b=>b.classList.toggle('active',b.dataset.navLabelMode===mode));
  localStorage.setItem('navLabelMode',mode);
}
navLabelModeButtons.forEach(b=>b.addEventListener('click',()=>setNavLabelMode(b.dataset.navLabelMode)));
setNavLabelMode(localStorage.getItem('navLabelMode')||'both');

const incomeForm=document.getElementById('incomeForm');
const incomeDate=document.getElementById('incomeDate');
const incomeDescription=document.getElementById('incomeDescription');
const incomeCategory=document.getElementById('incomeCategory');
const incomeAmount=document.getElementById('incomeAmount');
const categorySelect=document.getElementById('categorySelect');
const categoryPopup=document.getElementById('categoryPopup');
const categoryValue=document.getElementById('categoryValue');
const categoryOptions=document.querySelectorAll('.category-option');
const incomeList=document.getElementById('incomeList');
const incomeTotal=document.getElementById('incomeTotal');
const incomeRecent=document.getElementById('incomeRecent');
const incomeRecentToggle=document.getElementById('incomeRecentToggle');
const incomeRecentHistory=document.getElementById('incomeRecentHistory');
const incomeRecentHistoryPanel=document.getElementById('incomeRecentHistoryPanel');
const historyPage=document.getElementById('history');
const historySearchWrap=document.getElementById('historySearchWrap');
const incomeTableSection=document.getElementById('incomeTableSection');

function syncIncomeRecentBody(){
  if(!incomeRecent||!incomeRecentHistoryPanel)return;
  const collapsed=incomeRecent.classList.contains('is-collapsed');
  const historyOpen=incomeRecent.classList.contains('is-history-open');

  if(historyOpen){
    incomeRecentHistoryPanel.hidden=collapsed;
    if(!collapsed){
      if(historySearchWrap&&historySearchWrap.parentElement!==incomeRecentHistoryPanel){
        incomeRecentHistoryPanel.appendChild(historySearchWrap);
      }
      if(incomeTableSection&&incomeTableSection.parentElement!==incomeRecentHistoryPanel){
        incomeRecentHistoryPanel.appendChild(incomeTableSection);
      }
    }
  }else{
    incomeRecentHistoryPanel.hidden=true;
  }
}

function setIncomeRecentCollapsed(collapsed,persist=true){
  if(!incomeRecent||!incomeRecentToggle)return;
  const next=!!collapsed;
  incomeRecent.classList.toggle('is-collapsed',next);
  if(window.matchMedia('(max-width:560px)').matches){
    const mobileGrid=incomeRecent.querySelector('.income-recent-grid');
    const mobileFooter=incomeRecent.querySelector('.income-recent-bottom-actions');
    if(mobileGrid)mobileGrid.hidden=next;
    if(mobileFooter)mobileFooter.hidden=next;
  }
  incomeRecentToggle.setAttribute('aria-expanded',next?'false':'true');
  const historyOpen=incomeRecent.classList.contains('is-history-open');
  incomeRecentToggle.setAttribute('title',next
    ?(historyOpen?'Показать историю':'Показать последние доходы')
    :(historyOpen?'Скрыть историю':'Скрыть последние доходы'));
  syncIncomeRecentBody();
  if(persist)localStorage.setItem('incomeRecentCollapsed',next?'1':'0');
}

function setIncomeRecentHistoryOpen(open){
  if(!incomeRecent||!incomeRecentHistory||!incomeRecentHistoryPanel||!historyPage)return;
  const next=!!open;
  incomeRecent.classList.toggle('is-history-open',next);
  incomeRecentHistory.textContent=next?'Последние доходы':'Вся история';
  incomeRecentHistory.setAttribute('aria-pressed',next?'true':'false');

  if(next){
    // Full History must always become visible immediately, even if the recent block was collapsed.
    setIncomeRecentCollapsed(false,true);
    if(historySearchWrap&&historySearchWrap.parentElement!==incomeRecentHistoryPanel){
      incomeRecentHistoryPanel.appendChild(historySearchWrap);
    }
    if(incomeTableSection&&incomeTableSection.parentElement!==incomeRecentHistoryPanel){
      incomeRecentHistoryPanel.appendChild(incomeTableSection);
    }
    incomeRecentHistoryPanel.hidden=false;
    if(typeof window.renderIncomes==='function')window.renderIncomes();
    if(window.matchMedia('(min-width:761px)').matches){
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          incomeRecent.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
        });
      });
    }
  }else{
    incomeRecentHistoryPanel.hidden=true;
    if(historySearchWrap&&historySearchWrap.parentElement!==historyPage)historyPage.appendChild(historySearchWrap);
    if(incomeTableSection&&incomeTableSection.parentElement!==historyPage)historyPage.appendChild(incomeTableSection);
    syncIncomeRecentBody();
    if(window.matchMedia('(min-width:761px)').matches){
      const incomeTop=document.querySelector('#income .income-top');
      if(incomeTop){
        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            incomeTop.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
          });
        });
      }
    }
  }
}

if(incomeRecent&&incomeRecentToggle){
  setIncomeRecentCollapsed(localStorage.getItem('incomeRecentCollapsed')==='1',false);
  incomeRecentToggle.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    const collapsed=incomeRecent.classList.contains('is-collapsed');

    // The chevron always returns this shell to the "Последние доходы" mode.
    // If full history is open, close it first; then apply the requested
    // collapse/expand state so the next visible content is the recent cards.
    if(incomeRecent.classList.contains('is-history-open')){
      setIncomeRecentHistoryOpen(false);
    }

    setIncomeRecentCollapsed(!collapsed,true);
  });
}
if(incomeRecentHistory){
  incomeRecentHistory.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    if(window.matchMedia('(max-width:560px)').matches){
      const historyNav=document.getElementById('historyNavItem');
      if(historyNav){
        historyNav.hidden=false;
        historyNav.removeAttribute('aria-hidden');
        historyNav.click();
      }
      return;
    }
    setIncomeRecentHistoryOpen(!incomeRecent.classList.contains('is-history-open'));
  });
}

// The old History navigation remains functional while this transition is in progress.
// Restore its DOM before leaving the main page so that the standalone page is never empty.
document.querySelectorAll('.nav-item[data-page]').forEach(item=>{
  item.addEventListener('click',()=>{
    if(item.dataset.page!=='income'&&incomeRecent?.classList.contains('is-history-open')){
      setIncomeRecentHistoryOpen(false);
    }
  },true);
});

/* Автоподгонка главной суммы под доступную ширину.
   Обычные суммы сохраняют исходный размер шрифта; уменьшаем его
   только если значение физически не помещается в одну строку. */
function qPokoyFitIncomeTotal(){
  if(!incomeTotal) return;
  const host=incomeTotal.closest('.income-month-block');
  if(!host) return;

  /* Каждый запуск начинаем с штатного CSS-размера, чтобы после
     уменьшения суммы текст снова мог стать крупным. */
  incomeTotal.style.removeProperty('font-size');

  const maxSize=parseFloat(getComputedStyle(incomeTotal).fontSize);
  const available=Math.floor(host.clientWidth);
  if(!Number.isFinite(maxSize) || maxSize<=0 || available<=0) return;

  const minSize=window.matchMedia('(max-width:560px)').matches ? 20 : 28;
  let size=maxSize;

  incomeTotal.style.setProperty('font-size',size+'px','important');

  /* Уменьшаем до тех пор, пока точная сумма с символом ₽ не
     поместится целиком. Значение и форматирование не сокращаются. */
  while(incomeTotal.scrollWidth>available && size>minSize){
    size=Math.max(minSize,size-1);
    incomeTotal.style.setProperty('font-size',size+'px','important');
  }
}

let qPokoyIncomeTotalFitFrame=0;
function qPokoyScheduleIncomeTotalFit(){
  cancelAnimationFrame(qPokoyIncomeTotalFitFrame);
  qPokoyIncomeTotalFitFrame=requestAnimationFrame(qPokoyFitIncomeTotal);
}

window.addEventListener('resize',qPokoyScheduleIncomeTotalFit,{passive:true});

/* Автоподгонка годовой суммы справа от «Доход за YYYY».
   Нужна прежде всего на телефоне, где длинная сумма раньше переносила ₽ на вторую строку. */
function qPokoyFitAnalyticsTotal(){
  const total=document.getElementById('analyticsTotal');
  const head=document.querySelector('#incomeAnalytics .analytics-head');
  const title=document.querySelector('#incomeAnalytics .analytics-title-block');
  if(!total||!head||!title) return;

  /* На десктопе размер годовой суммы фиксированный и не зависит
     от ширины окна браузера. */
  if(!window.matchMedia('(max-width:620px)').matches){
    total.style.setProperty('font-size','36px','important');
    return;
  }

  /* На телефоне сохраняем автоподгонку для очень длинных сумм,
     чтобы символ ₽ не переносился на вторую строку. */
  total.style.removeProperty('font-size');

  const maxSize=parseFloat(getComputedStyle(total).fontSize);
  const headStyle=getComputedStyle(head);
  const gap=parseFloat(headStyle.columnGap||headStyle.gap)||0;
  const available=Math.floor(head.clientWidth-title.offsetWidth-gap);

  if(!Number.isFinite(maxSize)||maxSize<=0||available<=0) return;

  const minSize=14;
  let size=maxSize;

  total.style.setProperty('font-size',size+'px','important');

  while(total.scrollWidth>available && size>minSize){
    size=Math.max(minSize,size-1);
    total.style.setProperty('font-size',size+'px','important');
  }
}

let qPokoyAnalyticsTotalFitFrame=0;
function qPokoyScheduleAnalyticsTotalFit(){
  cancelAnimationFrame(qPokoyAnalyticsTotalFitFrame);
  qPokoyAnalyticsTotalFitFrame=requestAnimationFrame(qPokoyFitAnalyticsTotal);
}

window.addEventListener('resize',qPokoyScheduleAnalyticsTotalFit,{passive:true});
if('ResizeObserver' in window){
  const qPokoyAnalyticsHead=document.querySelector('#incomeAnalytics .analytics-head');
  if(qPokoyAnalyticsHead){
    const qPokoyAnalyticsTotalResizeObserver=new ResizeObserver(qPokoyScheduleAnalyticsTotalFit);
    qPokoyAnalyticsTotalResizeObserver.observe(qPokoyAnalyticsHead);
  }
}
if('ResizeObserver' in window){
  const qPokoyIncomeTotalHost=incomeTotal?.closest('.income-month-block');
  if(qPokoyIncomeTotalHost){
    const qPokoyIncomeTotalResizeObserver=new ResizeObserver(qPokoyScheduleIncomeTotalFit);
    qPokoyIncomeTotalResizeObserver.observe(qPokoyIncomeTotalHost);
  }
}
const formTitle=document.querySelector('.form-title');
const saveBtn=document.getElementById('saveIncome');
const cancelBtn=document.getElementById('cancelIncome');
const openIncomeForm=document.getElementById('openIncomeForm');

function closeCategoryPopup(){
  categoryPopup.classList.remove('open');
  categorySelect.classList.remove('open');
  ['position','left','width','max-height','overflow-y','top','bottom'].forEach(property=>{
    categoryPopup.style.removeProperty(property);
  });
}

function positionCategoryPopup(){
  if(!categoryPopup.classList.contains('open')) return;
  const mobile=window.matchMedia('(max-width:560px)').matches;
  const maxPopupHeight=mobile?360:252; // desktop: about 6 category rows + inline create row
  const edge=8;
  const gap=6;
  const rect=categorySelect.getBoundingClientRect();
  const sidebarRect=sidebar?.getBoundingClientRect();
  const sidebarBelow=sidebarRect&&sidebarRect.width>0&&sidebarRect.height>0&&sidebarRect.top>rect.bottom&&sidebarRect.top<window.innerHeight;
  const bottomLimit=sidebarBelow?sidebarRect.top-edge:window.innerHeight-edge;
  const below=Math.max(0,bottomLimit-rect.bottom-gap);
  const above=Math.max(0,rect.top-edge-gap);
  const openBelow=below>=maxPopupHeight||below>=above;
  const available=openBelow?below:above;
  const maxHeight=Math.min(maxPopupHeight,available);
  const width=Math.min(rect.width,window.innerWidth-edge*2);
  const left=Math.min(Math.max(edge,rect.left),window.innerWidth-edge-width);
  categoryPopup.style.position='fixed';
  categoryPopup.style.left=left+'px';
  categoryPopup.style.width=width+'px';
  categoryPopup.style.maxHeight=maxHeight+'px';
  categoryPopup.style.overflowY='auto';
  if(openBelow){
    categoryPopup.style.top=(rect.bottom+gap)+'px';
    categoryPopup.style.bottom='auto';
  }else{
    categoryPopup.style.top='auto';
    categoryPopup.style.bottom=(window.innerHeight-rect.top+gap)+'px';
  }
}
categorySelect.addEventListener('click',e=>{
  e.stopPropagation();
  const open=categoryPopup.classList.toggle('open');
  categorySelect.classList.toggle('open',open);
  if(open){
    requestAnimationFrame(()=>{
      positionCategoryPopup();
      categoryPopup.querySelector('.category-option.selected')?.scrollIntoView({block:'nearest'});
    });
  }else closeCategoryPopup();
});

window.addEventListener('resize',positionCategoryPopup,{passive:true});
window.addEventListener('scroll',()=>{
  if(categoryPopup.classList.contains('open')) closeCategoryPopup();
},{passive:true});
categoryOptions.forEach(option=>option.addEventListener('click',e=>{
  e.stopPropagation();
  incomeCategory.value=option.dataset.value;
  categoryValue.textContent=option.dataset.value;
  incomeCategory.closest('label')?.classList.remove('field-invalid');
  categoryOptions.forEach(o=>o.classList.remove('selected'));
  option.classList.add('selected');
  closeCategoryPopup();
}));

let incomes=[];
try{
  const savedIncomes=JSON.parse(localStorage.getItem('incomes')||'[]');
  incomes=Array.isArray(savedIncomes)?savedIncomes.filter(item=>item&&typeof item==='object'):[];
}catch(e){ incomes=[]; }

function formatMoney(value){
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value)+' ₽';
}
function textDateToDate(value){
  const m=String(value||'').match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if(!m)return null;
  const year=m[3].length===2?2000+Number(m[3]):Number(m[3]);
  const d=new Date(year,Number(m[2])-1,Number(m[1]));
  return d.getFullYear()===year&&d.getMonth()===Number(m[2])-1&&d.getDate()===Number(m[1])?d:null;
}
function formatDateShort(value){
    const v=String(value||'').trim();
    let m=v.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(m){
      let y=+m[3]; if(y<100)y+=2000;
      return m[1]+'.'+m[2]+'.'+String(y).slice(-2);
    }
    m=v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m){
      return m[3]+'.'+m[2]+'.'+m[1].slice(-2);
    }
    return v;
  }
function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
incomes=incomes.map(item=>({...item,date:formatDateShort(item.date)}));
localStorage.setItem('incomes',JSON.stringify(incomes));

/* === Central application state / data store === */
const AppState={
  period:null,
  filters:{
    year:'all',
    month:'all',
    category:'all',
    description:'all',
    sort:'date-desc',
    search:''
  }
};

window.IncomeStore={
  key:'incomes',
  load(){
    try{
      const raw=localStorage.getItem(this.key);
      const data=raw?JSON.parse(raw):[];
      return Array.isArray(data)?data:[];
    }catch(e){ console.error(e); return []; }
  },
  save(data){
    const normalized=Array.isArray(data)?data:[];
    localStorage.setItem(this.key,JSON.stringify(normalized));
    incomes.splice(0,incomes.length,...normalized);
    return incomes;
  },
  add(record){
    const result=this.save([record,...incomes]);
    if(typeof window.qPokoyCloudAdd==='function') window.qPokoyCloudAdd(record);
    return result;
  },
  update(id,record){
    const result=this.save(incomes.map(x=>String(x.id)===String(id)?record:x));
    if(typeof window.qPokoyCloudUpdate==='function') window.qPokoyCloudUpdate(id,record);
    return result;
  },
  async remove(id){
    if(typeof window.qPokoyCloudRemove!=='function') throw new Error('Облачное хранилище недоступно. Повторите удаление позже.');
    if(!await window.qPokoyCloudRemove(id)) return null;
    return this.save(this.load().filter(x=>String(x.id)!==String(id)));
  },
  addMany(records){
    const list=Array.isArray(records)?records:[];
    const result=this.save([...incomes,...list]);
    if(typeof window.qPokoyCloudAddMany==='function') window.qPokoyCloudAddMany(list);
    return result;
  }
};

window.qPokoyReplaceIncomes=function(records,cloudSync=true){
  const clean=Array.isArray(records)?records:[];
  IncomeStore.save(clean);
  if(cloudSync && typeof window.qPokoyCloudReplace==='function') window.qPokoyCloudReplace(clean);
  if(typeof window.applyIncomeHeaderFilters==='function') window.applyIncomeHeaderFilters();
  else if(typeof window.renderIncomes==='function') window.renderIncomes();
  if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
  return clean;
};

let editingIncomeId=null;

function resetForm(){
  editingIncomeId=null;
  incomeDate.value='';
  incomeAmount.value='';
  incomeDescription.value='';
  incomeCategory.value='';
  categoryValue.textContent='Выберите категорию';
  categoryOptions.forEach(o=>o.classList.remove('selected'));
  formTitle.textContent='Новый доход';
  saveBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  cancelBtn.style.display='inline-flex';
}

const historyEditHost=document.getElementById('history');
const incomeFormHome=incomeForm.parentElement;
const incomeFormHomeNext=incomeForm.nextSibling;

function restoreIncomeFormHome(){
  if(incomeFormHome && incomeForm.parentElement!==incomeFormHome){
    incomeFormHome.insertBefore(incomeForm,incomeFormHomeNext);
  }
}

function closeIncomeEditor(){
  resetForm();
  incomeForm.hidden=true;
  closeCategoryPopup();
  restoreIncomeFormHome();
}

function openHistoryEdit(id){
  const income=incomes.find(item=>String(item.id)===String(id));
  if(!income)return;

  editingIncomeId=income.id;
  incomeDate.value=formatDateShort(income.date||'');
  incomeAmount.value=income.amount??'';
  incomeDescription.value=income.description||'';
  incomeCategory.value=income.category||'';
  categoryValue.textContent=income.category||'Выберите категорию';
  categoryOptions.forEach(o=>o.classList.toggle('selected',o.dataset.value===income.category));
  formTitle.textContent='Редактировать доход';
  saveBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  cancelBtn.style.display='inline-flex';

  // Перемещаем существующую форму добавления в Историю.
  // Благодаря этому внешний вид, календарь, категории и кнопки полностью
  // совпадают с уже работающей формой на Главной.
  const editHost=incomeTableSection?.parentElement;
  if(!editHost)return;
  editHost.insertBefore(incomeForm,incomeTableSection);
  incomeForm.hidden=false;
  incomeForm.scrollIntoView({behavior:'smooth',block:'center'});
}

function openRecentIncomeEdit(id){
  const desktopRecentEdit=window.matchMedia('(min-width:761px)').matches;
  const mobileRecentEdit=window.matchMedia('(max-width:560px)').matches;
  if(!desktopRecentEdit&&!mobileRecentEdit)return;
  const income=incomes.find(item=>String(item.id)===String(id));
  if(!income)return;

  restoreIncomeFormHome();
  editingIncomeId=income.id;
  incomeDate.value=formatDateShort(income.date||'');
  incomeAmount.value=income.amount??'';
  incomeDescription.value=income.description||'';
  incomeCategory.value=income.category||'';
  categoryValue.textContent=income.category||'Выберите категорию';
  categoryOptions.forEach(o=>o.classList.toggle('selected',o.dataset.value===income.category));
  formTitle.textContent='Редактировать доход';
  saveBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  cancelBtn.style.display='inline-flex';
  incomeForm.hidden=false;
  requestAnimationFrame(()=>{
    setTimeout(()=>incomeForm.scrollIntoView({behavior:'smooth',block:'center'}),50);
  });
}

function syncAppPeriod(){
  AppState.period=getSelectedIncomePeriod();
  return AppState.period;
}


function getVisibleIncomes(source=incomes){
  const state=AppState.filters;
  const result=source.filter(x=>{
    const d=typeof textDateToDate==='function'?textDateToDate(x.date):null;
    if(!d)return false;
    if(state.year!=='all'&&d.getFullYear()!==Number(state.year))return false;
    if(state.month!=='all'&&d.getMonth()!==Number(state.month))return false;
    if(state.category!=='all'&&x.category!==state.category)return false;
    if(state.description!=='all'&&x.description!==state.description)return false;
    const q=String(state.search||'').trim().toLowerCase();
    if(q && ![x.date,x.amount,x.category,x.description].join(' ').toLowerCase().includes(q))return false;
    return true;
  });
  if(state.sort==='date-desc')result.sort((a,b)=>{
      const da=textDateToDate(b&&b.date), db=textDateToDate(a&&a.date);
      return (da?da.getTime():0)-(db?db.getTime():0);
    });
  if(state.sort==='date-asc')result.sort((a,b)=>{
      const da=textDateToDate(a&&a.date), db=textDateToDate(b&&b.date);
      return (da?da.getTime():0)-(db?db.getTime():0);
    });
  if(state.sort==='amount-desc')result.sort((a,b)=>Number(b.amount)-Number(a.amount));
  if(state.sort==='amount-asc')result.sort((a,b)=>Number(a.amount)-Number(b.amount));
  return result;
}

const RECENT_INCOME_PAGE_SIZE=4;
function getRecentIncomePageSize(){
  return window.matchMedia('(max-width:560px)').matches?2:RECENT_INCOME_PAGE_SIZE;
}
let recentIncomePage=0;
let recentIncomePeriodKey='';

function ensureRecentIncomePager(){
  const controls=document.querySelector('#income .income-recent-controls');
  if(!controls)return null;

  let pager=document.getElementById('incomeRecentPager');
  if(!pager){
    pager=document.createElement('div');
    pager.className='income-recent-pager';
    pager.id='incomeRecentPager';
    pager.setAttribute('aria-label','Перелистывание последних доходов');
    pager.innerHTML=`
      <button type="button" class="income-recent-page-btn" id="incomeRecentPrev" aria-label="Предыдущие 4 дохода" title="Предыдущие 4 дохода">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
      </button>
      <span class="income-recent-page-indicator" id="incomeRecentPageIndicator" aria-live="polite">1 / 1</span>
      <button type="button" class="income-recent-page-btn" id="incomeRecentNext" aria-label="Следующие 4 дохода" title="Следующие 4 дохода">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      </button>`;
    controls.appendChild(pager);
  }

  pager.hidden=false;
  pager.removeAttribute('hidden');

  if(!pager.dataset.bound){
    pager.addEventListener('click',event=>{
      const prev=event.target.closest('#incomeRecentPrev');
      const next=event.target.closest('#incomeRecentNext');
      if(prev){
        if(recentIncomePage<=0)return;
        recentIncomePage--;
        renderRecentIncomes(getSelectedIncomePeriod());
      }else if(next){
        recentIncomePage++;
        renderRecentIncomes(getSelectedIncomePeriod());
      }
    });
    pager.dataset.bound='1';
  }
  return pager;
}

function renderRecentIncomes(period=getSelectedIncomePeriod()){
  const host=document.getElementById('incomeRecentGrid');
  if(!host)return;

  const pager=ensureRecentIncomePager();
  const prevBtn=document.getElementById('incomeRecentPrev');
  const nextBtn=document.getElementById('incomeRecentNext');
  const indicator=document.getElementById('incomeRecentPageIndicator');
  const selectedMonth=Number(period?.month);
  const selectedYear=Number(period?.year);
  const periodKey=`${selectedYear}-${selectedMonth}`;

  if(recentIncomePeriodKey!==periodKey){
    recentIncomePeriodKey=periodKey;
    recentIncomePage=0;
  }

  const ordered=incomes
    .filter(item=>{
      const d=textDateToDate(item.date);
      return d&&d.getMonth()===selectedMonth&&d.getFullYear()===selectedYear;
    })
    .slice();

  const recentPageSize=getRecentIncomePageSize();
  const pageCount=Math.max(1,Math.ceil(ordered.length/recentPageSize));
  recentIncomePage=Math.max(0,Math.min(recentIncomePage,pageCount-1));
  const pageStart=recentIncomePage*recentPageSize;
  const visible=ordered.slice(pageStart,pageStart+recentPageSize);

  if(pager){
    pager.hidden=false;
    pager.removeAttribute('hidden');
  }
  if(prevBtn){
    prevBtn.disabled=recentIncomePage===0;
    prevBtn.setAttribute('aria-label','Предыдущая страница доходов');
    prevBtn.title='Предыдущая страница доходов';
  }
  if(nextBtn){
    nextBtn.disabled=recentIncomePage>=pageCount-1;
    nextBtn.setAttribute('aria-label','Следующая страница доходов');
    nextBtn.title='Следующая страница доходов';
  }
  if(indicator) indicator.textContent=`${recentIncomePage+1} / ${pageCount}`;

  if(!visible.length){
    host.innerHTML='<div class="income-recent-empty">Нет записей</div>';
    return;
  }

  host.innerHTML=visible.map(item=>`
    <article class="income-recent-card" data-id="${escapeHtml(item.id)}" tabindex="-1">
      <div class="income-recent-amount">${formatMoney(Number(item.amount||0))}</div>
      <div class="income-recent-category">${escapeHtml(item.category||'—')}</div>
      <div class="income-recent-date">${escapeHtml(formatDateShort(item.date))}</div>
      <button class="income-recent-edit" data-id="${escapeHtml(item.id)}" type="button" title="Редактировать" aria-label="Редактировать">
        <span class="history-action-pencil" aria-hidden="true">✎</span>
      </button>
      <div class="income-recent-mobile-actions">
        <button class="income-recent-mobile-edit" data-id="${escapeHtml(item.id)}" type="button" aria-label="Редактировать доход" title="Редактировать">
          <svg class="history-action-pencil" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg><span class="history-action-label" style="display:none">Изменить</span>
        </button>
        <button class="income-recent-mobile-delete" data-id="${escapeHtml(item.id)}" type="button" aria-label="Удалить доход" title="Удалить">
          <svg class="history-delete-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10"/><path d="M17 7L7 17"/></svg>
          <svg class="history-delete-trash" style="display:none" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>
          <span class="history-action-label" style="display:none">Удалить</span>
        </button>
      </div>
    </article>
  `).join('');
}

const incomeRecentGrid=document.getElementById('incomeRecentGrid');
ensureRecentIncomePager();

/* qp-mobile-recent-actions-v17 */
function clearRecentMobileActions(except=null){
  incomeRecentGrid?.querySelectorAll('.income-recent-card.is-longpress-selected').forEach(card=>{
    if(card!==except)card.classList.remove('is-longpress-selected');
  });
}

incomeRecentGrid?.addEventListener('click',e=>{
  const mobile=window.matchMedia('(max-width:560px)').matches;
  if(mobile){
    const editButton=e.target.closest('.income-recent-mobile-edit');
    if(editButton){
      e.preventDefault();
      e.stopPropagation();
      clearRecentMobileActions();
      openRecentIncomeEdit(editButton.dataset.id);
      return;
    }
    const deleteButton=e.target.closest('.income-recent-mobile-delete');
    if(deleteButton){
      e.preventDefault();
      e.stopPropagation();
      clearRecentMobileActions();
      if(typeof window.qPokoyDeleteIncome==='function')window.qPokoyDeleteIncome(deleteButton.dataset.id);
      return;
    }
    const card=e.target.closest('.income-recent-card');
    if(!card){
      clearRecentMobileActions();
      return;
    }
    if(!card.classList.contains('is-longpress-selected'))clearRecentMobileActions();
    return;
  }

  if(!window.matchMedia('(min-width:761px)').matches)return;
  const editButton=e.target.closest('.income-recent-edit');
  if(editButton){
    e.stopPropagation();
    openRecentIncomeEdit(editButton.dataset.id);
    return;
  }
  const card=e.target.closest('.income-recent-card');
  if(!card)return;
  incomeRecentGrid.querySelectorAll('.income-recent-card.is-selected').forEach(item=>{
    if(item!==card)item.classList.remove('is-selected');
  });
  card.classList.add('is-selected');
});

if(incomeRecentGrid&&!incomeRecentGrid.dataset.qpLongPressBound){
  incomeRecentGrid.dataset.qpLongPressBound='1';
  let timer=0;
  let startX=0;
  let startY=0;
  let activeCard=null;
  const cancel=()=>{
    clearTimeout(timer);
    timer=0;
    activeCard=null;
  };
  incomeRecentGrid.addEventListener('touchstart',e=>{
    if(!window.matchMedia('(max-width:560px)').matches||e.touches.length!==1)return;
    if(e.target.closest('.income-recent-mobile-actions'))return;
    const card=e.target.closest('.income-recent-card');
    if(!card)return;
    startX=e.touches[0].clientX;
    startY=e.touches[0].clientY;
    activeCard=card;
    clearTimeout(timer);
    timer=setTimeout(()=>{
      if(!activeCard)return;
      clearRecentMobileActions(activeCard);
      activeCard.classList.add('is-longpress-selected');
      if(navigator.vibrate)navigator.vibrate(20);
      timer=0;
    },520);
  },{passive:true});
  incomeRecentGrid.addEventListener('touchmove',e=>{
    if(!timer||!e.touches.length)return;
    const dx=e.touches[0].clientX-startX;
    const dy=e.touches[0].clientY-startY;
    if(Math.hypot(dx,dy)>12)cancel();
  },{passive:true});
  incomeRecentGrid.addEventListener('touchend',cancel,{passive:true});
  incomeRecentGrid.addEventListener('touchcancel',cancel,{passive:true});
}

document.addEventListener('touchstart',e=>{
  if(!window.matchMedia('(max-width:560px)').matches)return;
  if(e.target.closest('#incomeRecentGrid .income-recent-card'))return;
  clearRecentMobileActions();
},{passive:true});

// Mobile recent cards own the long-press gesture: never let the browser
// turn the date/card text into a selection or copy callout.
incomeRecentGrid?.addEventListener('selectstart',e=>{
  if(window.matchMedia('(max-width:560px)').matches&&e.target.closest('.income-recent-card'))e.preventDefault();
});
incomeRecentGrid?.addEventListener('contextmenu',e=>{
  if(window.matchMedia('(max-width:560px)').matches&&e.target.closest('.income-recent-card'))e.preventDefault();
});

window.renderIncomes=function renderIncomes(filteredData=null){
  clearHistoryNativeSwipeState();
  const latest=IncomeStore.load();
  if(Array.isArray(latest)) incomes.splice(0,incomes.length,...latest);
  const period=syncAppPeriod();
  renderRecentIncomes(period);
  const selectedYear=period.year;
  const selectedMonth=period.month;
  const total=incomes.reduce((sum,item)=>{
    const d=textDateToDate(item.date);
    return d&&d.getMonth()===selectedMonth&&d.getFullYear()===selectedYear
      ?sum+Number(item.amount||0):sum;
  },0);
  incomeTotal.textContent=formatMoney(total);
  qPokoyFitIncomeTotal();

  // Если фильтры не переданы явно, строим список через единый фильтр.
  // Важно: не пересортировываем результат здесь — иначе выбор «Дата»
  // теряется и список снова принудительно становится «сначала новые».
  const source=Array.isArray(filteredData)?filteredData:getVisibleIncomes(incomes);
  const header=`
    <div class="income-row income-header">
      <div><button type="button" class="header-filter-btn" data-filter="date">Дата</button><span class="column-resizer" data-column="date" title="Изменить ширину"></span></div>
      <div class="income-amount"><button type="button" class="header-filter-btn" data-filter="amount">Сумма</button><span class="column-resizer" data-column="amount" title="Изменить ширину"></span></div>
      <div><button type="button" class="header-filter-btn" data-filter="category">Категория</button><span class="column-resizer" data-column="category" title="Изменить ширину"></span></div>
      <div><span>Описание</span><span class="column-resizer" data-column="description" title="Изменить ширину"></span></div>
      <div></div>
    </div>`;

  if(!source.length){
    incomeList.innerHTML=header+'<div class="income-empty">Пока нет доходов</div>';
    if(typeof window.renderIncomeMonthChart==='function') window.renderIncomeMonthChart();
    if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
    return;
  }

  const rows = source.slice();
  const mobileHistoryRows=historyNativeSwipeMedia.matches;
  const historyEditIcon=mobileHistoryRows
    ? '<svg class="history-action-pencil" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>'
    : '<span class="history-action-pencil" aria-hidden="true">✎</span>';
  incomeList.innerHTML=header+
    rows.map(item=>{
      const cells=`
        <div>${escapeHtml(formatDateShort(item.date))}</div>
        <div class="income-amount">${formatMoney(Number(item.amount||0))}</div>
        <div>${escapeHtml(item.category||'—')}</div>
        <div>${escapeHtml(item.description||'')}</div>`;
      const actions=`
        <button class="edit-income" data-id="${escapeHtml(item.id)}" type="button" title="Редактировать" aria-label="Редактировать">${historyEditIcon}<span class="history-action-label" style="display:none">Изменить</span></button>
        <button class="delete-income" data-id="${escapeHtml(item.id)}" type="button" aria-label="Удалить доход" title="Удалить доход" onclick="return window.qPokoyDeleteIncome(this.getAttribute('data-id')); ">
          <svg class="history-delete-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10"/><path d="M17 7L7 17"/></svg>
          <svg class="history-delete-trash" style="display:none" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>
          <span class="history-action-label" style="display:none">Удалить</span>
        </button>`;
      return mobileHistoryRows
        ? `<div class="income-row history-swipe-row"><div class="history-card-surface">${cells}</div><div class="history-swipe-actions">${actions}</div></div>`
        : `<div class="income-row">${cells}${actions}</div>`;
    }).join('');
  if(typeof window.renderIncomeMonthChart==='function') window.renderIncomeMonthChart();
  if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
}

function calculateIncomeAnalytics(year){
  const data=IncomeStore.load();
  const monthTotals=Array(12).fill(0);
  const categoryTotals={};
  data.forEach(item=>{
    const d=textDateToDate(item.date);
    if(!d||d.getFullYear()!==Number(year))return;
    const amount=Number(item.amount)||0;
    monthTotals[d.getMonth()]+=amount;
    const category=String(item.category||'Без категории');
    categoryTotals[category]=(categoryTotals[category]||0)+amount;
  });
  const numericYear=Number(year);
  const now=new Date();
  const currentYear=now.getFullYear();
  const currentMonth=now.getMonth();
  // Текущий месяц ещё не завершён, поэтому не участвует в лучшем/худшем.
  const lastCompletedMonth=numericYear<currentYear?11:(numericYear===currentYear?currentMonth-1:-1);
  const eligibleMonths=monthTotals
    .map((value,index)=>({value,index}))
    .filter(x=>x.index<=lastCompletedMonth && x.value>0);
  const total=monthTotals.reduce((a,b)=>a+b,0);
  const nonZero=monthTotals.filter(v=>v>0);
  const average=total/12;
  const averageActive=nonZero.length?total/nonZero.length:0;
  const bestEntry=eligibleMonths.length?eligibleMonths.reduce((a,b)=>b.value>a.value?b:a):null;
  const worstEntry=eligibleMonths.length?eligibleMonths.reduce((a,b)=>b.value<a.value?b:a):null;
  return {
    year:numericYear,
    monthTotals,
    categoryTotals,
    total,
    average,
    averageActive,
    best:bestEntry?bestEntry.index:-1,
    worst:worstEntry?worstEntry.index:-1
  };
}

window.renderIncomeAnalytics=function(){
  const selectedPeriod=getSelectedIncomePeriod();
  const year=selectedPeriod.year;
  const a=calculateIncomeAnalytics(year);
  const fullNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const yearEl=document.getElementById('analyticsYear');
  const totalEl=document.getElementById('analyticsTotal');
  const avgActiveEl=document.getElementById('analyticsAverageActive');
  const growthEl=document.getElementById('analyticsGrowth');
  const growthCaptionEl=document.getElementById('analyticsGrowthCaption');
  const growthTooltipEl=document.getElementById('analyticsGrowthTooltip');
  const bestEl=document.getElementById('analyticsBest');
  const bestAmountEl=document.getElementById('analyticsBestAmount');
  const bestShareEl=document.getElementById('analyticsBestShare');
  const worstEl=document.getElementById('analyticsWorst');
  const worstAmountEl=document.getElementById('analyticsWorstAmount');
  const worstShareEl=document.getElementById('analyticsWorstShare');
  const catsEl=document.getElementById('analyticsCategories');
  const annualCategoriesToggleEl=document.getElementById('annualCategoriesToggle');
  const annualHeroTotalEl=document.getElementById('annualHeroTotal');
  const annualHeroTotalMobileEl=document.getElementById('annualHeroTotalMobile');
  const annualHeroYearMobileEl=document.getElementById('annualHeroYearMobile');
  const annualHeroMonthsEl=document.getElementById('annualHeroMonths');
  const annualHeroCategoriesEl=document.getElementById('annualHeroCategories');
  const annualHeroGrowthEl=document.getElementById('annualHeroGrowth');
  const annualHeroBarsEl=document.getElementById('annualHeroBars');
  const annualTotalCardEl=document.getElementById('annualTotalCard');
  if(!yearEl||!totalEl||!avgActiveEl||!bestEl||!worstEl||!growthEl)return;

  yearEl.textContent=a.year;
  totalEl.textContent=formatMoney(a.total);
  if(annualHeroTotalEl) annualHeroTotalEl.textContent=formatMoney(a.total);
  if(annualHeroTotalMobileEl) annualHeroTotalMobileEl.textContent=formatMoney(a.total);
  if(annualHeroYearMobileEl) annualHeroYearMobileEl.textContent='за '+a.year+' год';
  if(annualHeroMonthsEl) annualHeroMonthsEl.textContent=String(a.monthTotals.filter(value=>value>0).length);
  qPokoyFitAnalyticsTotal();
  if(avgActiveEl) avgActiveEl.textContent=formatMoney(a.averageActive);
  const previous=calculateIncomeAnalytics(year-1);
  const hasPrevious=previous.total>0;
  const growth=hasPrevious?((a.total-previous.total)/previous.total*100):null;
  growthEl.textContent=growth===null?'—':`${growth>=0?'+':''}${growth.toFixed(1)}%`;
  growthEl.classList.toggle('positive',growth!==null&&growth>0);
  growthEl.classList.toggle('negative',growth!==null&&growth<0);
  growthEl.classList.toggle('neutral',growth===0||growth===null);
  const growthCaption=hasPrevious?`по сравнению с ${year-1} годом`:'нет данных за предыдущий год';
  if(growthCaptionEl) growthCaptionEl.textContent=growthCaption;
  if(growthTooltipEl) growthTooltipEl.textContent=growthCaption;

  if(annualHeroGrowthEl){
    const annualGrowthBox=annualHeroGrowthEl.closest('.annual-total-growth');
    if(annualGrowthBox)annualGrowthBox.hidden=growth===null;
    annualHeroGrowthEl.textContent=growth===null?'—':`${growth>=0?'↑ ':'↓ '}${Math.abs(growth).toFixed(1)}%`;
    annualHeroGrowthEl.classList.toggle('positive',growth!==null&&growth>0);
    annualHeroGrowthEl.classList.toggle('negative',growth!==null&&growth<0);
    annualHeroGrowthEl.classList.toggle('neutral',growth===0||growth===null);
  }
  if(annualHeroBarsEl){
    const annualMax=Math.max(...a.monthTotals,1);
    annualHeroBarsEl.innerHTML=a.monthTotals.map((value,index)=>{
      const height=value>0?Math.max(8,(value/annualMax)*100):4;
      const hue=174+index*9;
      return `<span class="annual-total-bar${value>0?'':' is-zero'}${index===selectedPeriod.month?' selected':''}" data-month="${index}" role="button" tabindex="0" style="--bar-height:${height.toFixed(1)}%;--bar-hue:${hue}" title="${fullNames[index]}: ${formatMoney(value)}" aria-label="Показать ${fullNames[index]} ${a.year}: ${formatMoney(value)}"></span>`;
    }).join('');
  }
  if(annualTotalCardEl){
    annualTotalCardEl.dataset.year=String(a.year);
    annualTotalCardEl.querySelectorAll('.annual-total-months span').forEach((label,index)=>{
      label.dataset.month=String(index);
      label.setAttribute('role','button');
      label.tabIndex=0;
      label.setAttribute('aria-label','Показать '+fullNames[index]+' '+a.year);
    });
    if(!annualTotalCardEl.__monthSelectBound){
      const selectAnnualMonth=(target)=>{
        const item=target.closest('.annual-total-bar[data-month],.annual-total-months span[data-month]');
        if(!item)return;
        const month=Number(item.dataset.month);
        const selectedYear=Number(annualTotalCardEl.dataset.year);
        if(!Number.isInteger(month)||month<0||month>11||!Number.isInteger(selectedYear))return;
        setSelectedIncomePeriod(month,selectedYear);
        if(typeof window.renderIncomes==='function')window.renderIncomes();
      };
      annualTotalCardEl.addEventListener('click',event=>selectAnnualMonth(event.target));
      annualTotalCardEl.addEventListener('keydown',event=>{
        if(event.key!=='Enter'&&event.key!==' ')return;
        const item=event.target.closest('.annual-total-bar[data-month],.annual-total-months span[data-month]');
        if(!item)return;
        event.preventDefault();
        selectAnnualMonth(item);
      });
      annualTotalCardEl.__monthSelectBound=true;
    }
  }
  if(a.best>=0){
    bestEl.textContent=fullNames[a.best];
    if(bestAmountEl) bestAmountEl.textContent=formatMoney(a.monthTotals[a.best]);
    else bestEl.textContent+=' '+formatMoney(a.monthTotals[a.best]);
    if(bestShareEl){
      bestShareEl.textContent=(a.total>0?Math.round(a.monthTotals[a.best]/a.total*100):0)+'%';
      bestShareEl.hidden=false;
    }
  }else{
    bestEl.textContent='—';
    if(bestAmountEl) bestAmountEl.textContent='0 ₽';
    if(bestShareEl) bestShareEl.hidden=true;
  }
  if(a.worst>=0){
    worstEl.textContent=fullNames[a.worst];
    if(worstAmountEl) worstAmountEl.textContent=formatMoney(a.monthTotals[a.worst]);
    else worstEl.textContent+=' '+formatMoney(a.monthTotals[a.worst]);
    if(worstShareEl){
      worstShareEl.textContent=(a.total>0?Math.round(a.monthTotals[a.worst]/a.total*100):0)+'%';
      worstShareEl.hidden=false;
    }
  }else{
    worstEl.textContent='—';
    if(worstAmountEl) worstAmountEl.textContent='0 ₽';
    if(worstShareEl) worstShareEl.hidden=true;
  }

  const categories=Object.entries(a.categoryTotals).sort((x,y)=>y[1]-x[1]);
  if(annualHeroCategoriesEl) annualHeroCategoriesEl.textContent=String(categories.length);

  if(catsEl){
    const desktopCategories=window.matchMedia('(min-width:901px)').matches;
    const periodKey=String(a.year);
    if(catsEl.dataset.categoryPeriod!==periodKey){
      catsEl.dataset.categoryPeriod=periodKey;
      catsEl.dataset.categoriesExpanded='false';
    }
    const expanded=desktopCategories&&catsEl.dataset.categoriesExpanded==='true';
    let visibleCategories=categories.map(([name,value])=>({name,value,grouped:false,count:1}));
    if(desktopCategories&&!expanded&&categories.length>4){
      const rest=categories.slice(3);
      const restTotal=rest.reduce((sum,item)=>sum+item[1],0);
      visibleCategories=[
        ...categories.slice(0,3).map(([name,value])=>({name,value,grouped:false,count:1})),
        {name:'Другие',value:restTotal,grouped:true,count:rest.length}
      ];
    }

    catsEl.classList.toggle('is-collapsed',desktopCategories&&!expanded&&categories.length>4);
    catsEl.classList.toggle('is-expanded',desktopCategories&&expanded&&categories.length>4);

    catsEl.innerHTML=categories.length?visibleCategories.map((item)=>{
      const name=item.name;
      const value=item.value;
      const pct=a.total?value/a.total*100:0;
      const categoryClass=item.grouped
        ?'category-grouped'
        :(name==='Зарплата'?'salary':(name==='Аванс'?'advance':(name==='Другое'?'other':'pension')));
      const displayName=item.grouped?'Другие ('+item.count+')':name;
      const categoryVisual=desktopCategories&&!item.grouped&&typeof window.qPokoyCategoryVisual==='function'
        ?window.qPokoyCategoryVisual(name,0)
        :null;
      const categoryIcon=item.grouped
        ?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>'
        :(categoryVisual&&categoryVisual.icon
          ?categoryVisual.icon
          :'<svg viewBox="0 0 24 24"><path d="M4 7.5h16v11H4z"/><path d="M7 7.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.5"/><path d="M9 13h6"/></svg>');
      const tag=desktopCategories?(item.grouped?'div':'button'):'div';
      const attrs=item.grouped?'':(desktopCategories
        ?` type="button" data-category="${escapeHtml(name)}"`
        :` data-category="${escapeHtml(name)}"`);
      return `<${tag}${attrs} class="analytics-category-panel ${categoryClass}">
        <span class="analytics-category-panel-icon" aria-hidden="true">${categoryIcon}</span>
        <span class="analytics-category-panel-body">
          <span class="analytics-category-panel-name">${escapeHtml(displayName)}</span>
          <strong class="analytics-category-panel-value">${formatMoney(value)}</strong>
        </span>
        <span class="analytics-category-panel-share">${pct.toFixed(0)}%</span>
      </${tag}>`;
    }).join(''):'<div class="monthly-analytics-empty annual-analytics-empty">Нет данных за этот год</div>';

    if(annualCategoriesToggleEl){
      const canToggle=desktopCategories&&categories.length>4;
      annualCategoriesToggleEl.hidden=!canToggle;
      const toggleLabel=expanded?'Свернуть категории':'Показать все категории';
      annualCategoriesToggleEl.setAttribute('aria-label',toggleLabel);
      annualCategoriesToggleEl.title=toggleLabel;
      annualCategoriesToggleEl.setAttribute('aria-expanded',expanded?'true':'false');
      annualCategoriesToggleEl.onclick=canToggle?()=>{
        catsEl.dataset.categoriesExpanded=expanded?'false':'true';
        window.renderIncomeAnalytics();
      }:null;
    }
  }

};


const INCOME_PERIOD_KEY='incomeSelectedPeriod';
let incomePeriodInitialized=false;
function getSelectedIncomePeriod(){
  // При каждом новом открытии/обновлении страницы начинаем с текущих
  // месяца и года. После этого ручное переключение сохраняется до
  // следующей перезагрузки страницы.
  if(!incomePeriodInitialized){
    incomePeriodInitialized=true;
    const now=new Date();
    const period={month:now.getMonth(),year:now.getFullYear()};
    localStorage.setItem(INCOME_PERIOD_KEY,JSON.stringify(period));
    return period;
  }
  try{
    const raw=localStorage.getItem(INCOME_PERIOD_KEY);
    if(raw){
      const parsed=JSON.parse(raw);
      if(Number.isInteger(parsed.month)&&parsed.month>=0&&parsed.month<12 &&
         Number.isInteger(parsed.year)&&parsed.year>=1970&&parsed.year<=9999) return parsed;
    }
  }catch(e){}
  const now=new Date();
  const period={month:now.getMonth(),year:now.getFullYear()};
  localStorage.setItem(INCOME_PERIOD_KEY,JSON.stringify(period));
  return period;
}
function getSelectedIncomeYear(){ return getSelectedIncomePeriod().year; }
function setSelectedIncomePeriod(month,year){
  const current=getSelectedIncomePeriod();
  let m=Number(month), y=Number(year);
  if(!Number.isInteger(m)||m<0||m>11) m=current.month;
  if(!Number.isInteger(y)||y<1970||y>9999) y=current.year;
  const period={month:m,year:y};
  localStorage.setItem(INCOME_PERIOD_KEY,JSON.stringify(period));
  const names=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const caption=document.getElementById('incomeMonthCaption');
  const switcherName=document.getElementById('monthSwitcherName');
  if(caption) caption.textContent=names[m];
  if(switcherName) switcherName.textContent=names[m];
  return period;
}
function changeSelectedIncomeMonth(delta){
  const current=getSelectedIncomePeriod();
  let month=current.month, year=current.year;
  const next=month+Number(delta||0);
  if(next<0){month=11;year--;}
  else if(next>11){month=0;year++;}
  else month=next;
  setSelectedIncomePeriod(month,year);
  if(typeof window.renderIncomes==='function') window.renderIncomes();
}
window.qPokoyChangeSelectedIncomeMonth=changeSelectedIncomeMonth;


(function(){
  const bestCard=document.querySelector('#incomeAnalytics .analytics-card-best');
  const worstCard=document.querySelector('#incomeAnalytics .analytics-card-worst');

  function openAnalyticsMonth(type){
    const yearEl=document.getElementById('analyticsYear');
    const year=Number(yearEl?.textContent);
    if(!Number.isInteger(year))return;

    const totals=Array(12).fill(0);
    IncomeStore.load().forEach(item=>{
      const d=textDateToDate(item.date);
      if(d && d.getFullYear()===year) totals[d.getMonth()]+=Number(item.amount)||0;
    });

    const now=new Date();
    const currentYear=now.getFullYear();
    const currentMonth=now.getMonth();
    const lastCompletedMonth=year<currentYear ? 11 : (year===currentYear ? currentMonth-1 : -1);
    const eligible=totals
      .map((value,index)=>({value,index}))
      .filter(x=>x.index<=lastCompletedMonth && x.value>0);
    if(!eligible.length)return;
    const selected=type==='best'
      ? eligible.reduce((a,b)=>b.value>a.value?b:a)
      : eligible.reduce((a,b)=>b.value<a.value?b:a);
    const month=selected.index;

    setSelectedIncomePeriod(month,year);
    if(typeof window.renderIncomes==='function') window.renderIncomes();
    document.getElementById('incomeMonthChart')?.scrollIntoView({
      behavior:'smooth',block:'nearest'
    });
  }

  bestCard?.addEventListener('click',()=>openAnalyticsMonth('best'));
  worstCard?.addEventListener('click',()=>openAnalyticsMonth('worst'));
})();

openIncomeForm.addEventListener('click',()=>{
  resetForm();
  incomeForm.hidden=false;
  const today=new Date();
  incomeDate.value=`${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getFullYear()).slice(-2)}`;
  requestAnimationFrame(()=>{
    setTimeout(()=>incomeForm.scrollIntoView({behavior:'smooth',block:'center'}),50);
  });
});

cancelBtn.addEventListener('click',closeIncomeEditor);

saveBtn.addEventListener('click',(e)=>{
  incomeForm.querySelectorAll('.field-invalid').forEach(el=>el.classList.remove('field-invalid'));
  const required = [
    {el: incomeDate, wrap: incomeDate?.closest('label') || incomeDate?.parentElement},
    {el: incomeAmount, wrap: incomeAmount?.closest('label') || incomeAmount?.parentElement},
    {el: incomeCategory, wrap: incomeCategory?.closest('label') || incomeCategory?.parentElement}
  ];
  let invalid=false;
  required.forEach(({el,wrap})=>{
    const value=String(el?.value||'').trim();
    if(!value || (el===incomeAmount && Number(value)<=0)) {
      wrap?.classList.add('field-invalid');
      invalid=true;
    }
  });
  if(invalid){ e.preventDefault(); return; }

  const amount=Number(incomeAmount.value);
  const parsed=textDateToDate(incomeDate.value.trim());
  if(!parsed||!incomeCategory.value||!amount||amount<0) return;

  const wasEditing=editingIncomeId!==null;
  const record={
    id:editingIncomeId??(crypto.randomUUID?.()||('income-'+Date.now()+'-'+Math.random().toString(36).slice(2,8))),
    date:`${String(parsed.getDate()).padStart(2,'0')}.${String(parsed.getMonth()+1).padStart(2,'0')}.${String(parsed.getFullYear()).slice(-2)}`,
    description:incomeDescription.value.trim(),
    category:incomeCategory.value.trim(),
    amount
  };

  if(editingIncomeId!==null){
    IncomeStore.update(editingIncomeId,record);
  }else{
    IncomeStore.add(record);
  }

  renderIncomes();
  closeIncomeEditor();
  if(!wasEditing){
    window.scrollTo({top:0,left:0,behavior:'smooth'});
  }
});

incomeList.addEventListener('click',e=>{
  const editButton=e.target.closest('.edit-income');
  if(editButton){
    openHistoryEdit(editButton.dataset.id);
    return;
  }
});

const historyNativeSwipeMedia=window.matchMedia('(max-width:560px)');
let historyNativeOpenRow=null;
const historyNativeClosingRows=new WeakSet();

function closeHistoryNativeRow(row,smooth=true){
  if(!row)return;
  if(historyNativeOpenRow===row)historyNativeOpenRow=null;
  if(smooth && typeof row.scrollTo==='function'){
    historyNativeClosingRows.add(row);
    row.scrollTo({left:0,behavior:'smooth'});
  }else{
    historyNativeClosingRows.delete(row);
    row.scrollLeft=0;
  }
}
function clearHistoryNativeSwipeState(){
  closeHistoryNativeRow(historyNativeOpenRow,false);
  historyNativeOpenRow=null;
}

incomeList.addEventListener('pointerdown',e=>{
  if(!historyNativeSwipeMedia.matches)return;
  const row=e.target.closest('#history #incomeList > .history-swipe-row');
  if(row)historyNativeClosingRows.delete(row);
  if(row && historyNativeOpenRow && historyNativeOpenRow!==row)closeHistoryNativeRow(historyNativeOpenRow,true);
});
incomeList.addEventListener('scroll',e=>{
  if(!historyNativeSwipeMedia.matches)return;
  const row=e.target;
  if(!row.matches?.('#history #incomeList > .history-swipe-row'))return;
  if(historyNativeClosingRows.has(row)){
    if(row.scrollLeft<=2)historyNativeClosingRows.delete(row);
    return;
  }
  if(row.scrollLeft>2){
    if(historyNativeOpenRow && historyNativeOpenRow!==row)closeHistoryNativeRow(historyNativeOpenRow,true);
    historyNativeOpenRow=row;
  }else if(historyNativeOpenRow===row){
    historyNativeOpenRow=null;
  }
},true);
document.addEventListener('pointerdown',e=>{
  if(!historyNativeSwipeMedia.matches || !historyNativeOpenRow)return;
  if(!historyNativeOpenRow.contains(e.target))closeHistoryNativeRow(historyNativeOpenRow);
});
function rerenderHistoryForNativeSwipe(){
  if(typeof window.applyIncomeHeaderFilters==='function')window.applyIncomeHeaderFilters();
  else window.renderIncomes();
}
if(historyNativeSwipeMedia.addEventListener)historyNativeSwipeMedia.addEventListener('change',rerenderHistoryForNativeSwipe);
else historyNativeSwipeMedia.addListener(rerenderHistoryForNativeSwipe);

incomeDate.addEventListener('focus',()=>incomeDate.select());
incomeDate.addEventListener('click',()=>incomeDate.select());
incomeDate.addEventListener('input',()=>{
  incomeDate.value=incomeDate.value.replace(/[^0-9.]/g,'');
});

const openCalendar=document.getElementById('openCalendar');
const calendarPopup=document.getElementById('calendarPopup');
const calendarDays=document.getElementById('calendarDays');
const calendarMonth=document.getElementById('calendarMonth');
const calendarPrev=document.getElementById('calendarPrev');
const calendarNext=document.getElementById('calendarNext');
let calendarView=new Date();

function pad(n){return String(n).padStart(2,'0')}
function renderCalendar(){
  const y=calendarView.getFullYear(),m=calendarView.getMonth();
  calendarMonth.textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(calendarView);

  // Первый день месяца: понедельник = 0 ... воскресенье = 6
  const first=new Date(y,m,1);
  const offset=(first.getDay()+6)%7;
  const daysInMonth=new Date(y,m+1,0).getDate();
  const selected=textDateToDate(incomeDate.value.trim());
  const today=new Date();
  let cells='';

  // Показываем ровно нужное количество недель (5 или 6),
  // а даты соседних месяцев рассчитываем через Date, чтобы корректно
  // обрабатывались январь/декабрь и переход между годами.
  const totalCells=Math.ceil((offset+daysInMonth)/7)*7;
  for(let i=0;i<totalCells;i++){
    const d=new Date(y,m,1-offset+i);
    let cls='calendar-day';
    if(d.getMonth()!==m) cls+=' other';
    if(d.toDateString()===today.toDateString()) cls+=' today';
    if(selected&&d.toDateString()===selected.toDateString()) cls+=' selected';
    const day=d.getDate();
    const iso=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(day)}`;
    cells+=`<button type="button" class="${cls}" data-date="${iso}">${day}</button>`;
  }
  calendarDays.innerHTML=cells;
}
function positionCalendarPopup(){
  if(!calendarPopup.classList.contains('open'))return;
  const field=document.querySelector('.date-field');
  if(!field)return;

  const rect=field.getBoundingClientRect();
  const gap=8;
  const viewportWidth=document.documentElement.clientWidth||window.innerWidth;
  const viewportHeight=window.innerHeight;
  const width=calendarPopup.offsetWidth;
  const height=calendarPopup.offsetHeight;

  // Горизонталь: не выпускаем календарь за границы окна.
  const desiredLeft=Math.max(gap,Math.min(rect.left,viewportWidth-width-gap));
  const relativeLeft=desiredLeft-rect.left;
  calendarPopup.style.left=Math.round(relativeLeft)+'px';

  const spaceBelow=viewportHeight-rect.bottom-gap;
  const spaceAbove=rect.top-gap;
  const openUp=spaceBelow<height && spaceAbove>spaceBelow;

  calendarPopup.classList.toggle('calendar-open-up',openUp);
  calendarPopup.classList.toggle('calendar-open-down',!openUp);

  // Если календарь физически не помещается ни сверху, ни снизу,
  // ограничиваем его высоту, чтобы он всё равно оставался в окне.
  const available=Math.max(120,Math.max(spaceAbove,spaceBelow));
  calendarPopup.style.maxHeight=Math.min(height,available)+'px';
  calendarPopup.style.overflowY=height>available?'auto':'visible';
}

function openCalendarPopup(){
  const selected=textDateToDate(incomeDate.value.trim());
  calendarView=selected?new Date(selected.getFullYear(),selected.getMonth(),1):new Date();
  renderCalendar();
  calendarPopup.classList.add('open');
  requestAnimationFrame(positionCalendarPopup);
}
openCalendar.addEventListener('click',e=>{
  e.stopPropagation();
  if(calendarPopup.classList.contains('open')){
    calendarPopup.classList.remove('open','calendar-open-up','calendar-open-down');
    calendarPopup.style.maxHeight='';
    calendarPopup.style.overflowY='';
    return;
  }
  openCalendarPopup();
});
calendarPrev.addEventListener('click',e=>{
  e.stopPropagation();
  calendarView.setMonth(calendarView.getMonth()-1);
  renderCalendar();
  requestAnimationFrame(positionCalendarPopup);
});
calendarNext.addEventListener('click',e=>{
  e.stopPropagation();
  calendarView.setMonth(calendarView.getMonth()+1);
  renderCalendar();
  requestAnimationFrame(positionCalendarPopup);
});

// При прокрутке страницы открытый календарь закрывается.
function closeCalendarOnScroll(){
  if(calendarPopup.classList.contains('open')){
    calendarPopup.classList.remove('open','calendar-open-up','calendar-open-down');
    calendarPopup.style.maxHeight='';
    calendarPopup.style.overflowY='';
  }
}
window.addEventListener('scroll',closeCalendarOnScroll,{passive:true});
document.addEventListener('scroll',closeCalendarOnScroll,{passive:true,capture:true});
window.addEventListener('resize',()=>{
  if(calendarPopup.classList.contains('open'))positionCalendarPopup();
},{passive:true});
calendarDays.addEventListener('click',e=>{
  const btn=e.target.closest('.calendar-day');
  if(!btn)return;
  const [y,m,d]=btn.dataset.date.split('-');
  incomeDate.value=`${d}.${m}.${String(y).slice(-2)}`;
  calendarPopup.classList.remove('open');
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.date-field'))calendarPopup.classList.remove('open');
  if(!e.target.closest('.category-field')) closeCategoryPopup();
});

const incomeListEl=document.getElementById('incomeList');
const defaultWidths={date:82,amount:120,category:190,description:240};
let columnWidths={};
try{columnWidths=JSON.parse(localStorage.getItem('incomeColumnWidths')||'{}')||{};}catch(e){columnWidths={};}
Object.entries(defaultWidths).forEach(([key,def])=>{
  const value=Number(columnWidths[key])||def;
  incomeListEl.style.setProperty('--col-'+key,Math.max(key==='description'?120:70,value)+'px');
});
let resizeState=null;
incomeListEl.addEventListener('mousedown',e=>{
  const handle=e.target.closest('.column-resizer');
  if(!handle)return;
  e.preventDefault(); e.stopPropagation();
  const key=handle.dataset.column;
  const current=parseFloat(getComputedStyle(incomeListEl).getPropertyValue('--col-'+key))||defaultWidths[key];
  resizeState={key,startX:e.clientX,startWidth:current,handle};
  handle.classList.add('dragging');
  document.body.classList.add('resizing');
});
document.addEventListener('mousemove',e=>{
  if(!resizeState)return;
  const min=resizeState.key==='description'?120:70;
  const max=resizeState.key==='description'?900:450;
  const next=Math.min(max,Math.max(min,resizeState.startWidth+(e.clientX-resizeState.startX)));
  incomeListEl.style.setProperty('--col-'+resizeState.key,Math.round(next)+'px');
});
document.addEventListener('mouseup',()=>{
  if(!resizeState)return;
  const key=resizeState.key;
  const value=parseFloat(getComputedStyle(incomeListEl).getPropertyValue('--col-'+key));
  if(value){columnWidths[key]=Math.round(value);localStorage.setItem('incomeColumnWidths',JSON.stringify(columnWidths));}
  resizeState.handle.classList.remove('dragging');
  document.body.classList.remove('resizing');
  resizeState=null;
});



(function(){
  const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const state=AppState.filters;
  const read=()=>{try{return JSON.parse(localStorage.getItem('incomes')||'[]')}catch(e){return []}};
  function parts(v){const m=String(v||'').match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);if(!m)return null;let y=+m[3];if(y<100)y+=2000;return {day:+m[1],month:+m[2],year:y};}
  function apply(){
    const loaded=read();
    incomes.splice(0,incomes.length,...loaded);
    window.renderIncomes(getVisibleIncomes());
  }
  function values(type){
    const all=read();
    if(type==='date'){
      const ys=[...new Set(all.map(x=>parts(x.date)?.year).filter(Boolean))].sort((a,b)=>b-a);
      return [['date-desc','Сначала новые'],['date-asc','Сначала старые']];
    }
    if(type==='month')return [['all','Все месяцы'],...months.map((m,i)=>[String(i+1),m])];
    if(type==='category'){
      const cs=[...new Set(all.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
      return [['all','Все категории'],...cs.map(c=>[c,c])];
    }
    if(type==='description'){
      const ds=[...new Set(all.map(x=>String(x.description||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
      return [['all','Все описания'],...ds.map(d=>[d,d])];
    }
    if(type==='amount')return [['amount-desc','По убыванию'],['amount-asc','По возрастанию']];
    return [['date-desc','Сначала новые'],['date-asc','Сначала старые']];
  }
  function close(){document.querySelectorAll('.filter-popover').forEach(x=>x.remove());document.querySelectorAll('.header-filter-btn').forEach(x=>x.classList.remove('active'));}
  function open(btn){
    close();
    const type=btn.dataset.filter;
    const key=type==='date'?'date':type==='amount'?'sort':type;
    const pop=document.createElement('div');pop.className='filter-popover';
    const title=document.createElement('div');title.className='filter-popover-title';title.textContent='';
    const sel=document.createElement('select');
    if(type==='date'||type==='amount'||type==='category'||type==='description'){
      const opts=values(type);
      opts.forEach(([v,t])=>{
        if(v==='divider'){
          const d=document.createElement('div');d.className='filter-divider';pop.appendChild(d);return;
        }
        const b=document.createElement('button');b.type='button';b.className='filter-choice';
        const active=(type==='date'||type==='amount') ? state.sort===v : state[type]===v;
        b.classList.toggle('selected',active);
        b.innerHTML='<span>'+escapeHtml(t)+'</span>'+(active?'<span>✓</span>':'');
        b.onclick=()=>{
          if(type==='date'||type==='amount') state.sort=v; else state[type]=v;
          close();apply();
        };
        pop.appendChild(b);
      });
    }else{
      values(type).forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;sel.appendChild(o)});
      sel.value=state[key]||'all';
    }
    const actions=document.createElement('div');actions.className='filter-popover-actions';
    const reset=document.createElement('button');reset.textContent='Сбросить';
    const applyBtn=document.createElement('button');applyBtn.className='apply';applyBtn.textContent='Применить';
    if(type==='date'||type==='amount'||type==='category'||type==='description'){
      // compact choice menu, одинаковый для всех фильтров
    }else if(type==='month'){
      actions.append(reset,applyBtn);pop.append(sel,actions);
    }else{
      actions.append(reset,applyBtn);pop.append(title,sel,actions);
    }
    document.body.appendChild(pop);btn.classList.add('active');
    const r=btn.getBoundingClientRect();
    let left=r.left,top=r.bottom+7;
    if(left+pop.offsetWidth>innerWidth-8)left=innerWidth-pop.offsetWidth-8;
    pop.style.left=Math.max(8,left)+'px';pop.style.top=Math.max(8,top)+'px';
    if(type!=='date'&&type!=='amount'&&type!=='category'&&type!=='description'){
      applyBtn.onclick=()=>{state[key]=sel.value;close();apply()};
      reset.onclick=()=>{state[key]=key==='sort'?'date-desc':'all';close();apply()};
      sel.onkeydown=e=>{if(e.key==='Enter')applyBtn.click();if(e.key==='Escape')close()};
      sel.focus();
    }
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('.header-filter-btn');
    if(b){e.preventDefault();e.stopPropagation();open(b);return;}
    if(!e.target.closest('.filter-popover'))close();
  });
  // Закрывать фильтр только когда курсор действительно ушёл из самого фильтра.
  window.applyIncomeHeaderFilters=apply;

  const historySearch=document.getElementById('historySearch');
  if(historySearch){
    historySearch.addEventListener('input',()=>{
      state.search=historySearch.value||'';
      apply();
    });
    state.search=historySearch.value||'';
  }

  // Фильтр закрывается только при клике вне него.
  // Скролл и движение курсора больше не закрывают открытое меню.
})();

(function(){
  const section=document.getElementById('incomeTableSection');
  const head=document.querySelector('.income-table-section-head');
  const btn=document.getElementById('incomeTableCollapse');
  if(!section||!head||!btn) return;
  const key='incomeTableCollapsed';

  function update(){
    const collapsed=section.classList.contains('is-collapsed');
    btn.setAttribute('aria-label',collapsed?'Развернуть таблицу':'Свернуть таблицу');
    btn.title=collapsed?'Развернуть таблицу':'Свернуть таблицу';
  }
  function setCollapsed(collapsed){
    section.classList.toggle('is-collapsed',!!collapsed);
    localStorage.setItem(key,collapsed?'1':'0');
    update();
  }
  function toggle(){setCollapsed(!section.classList.contains('is-collapsed'));}

  if(localStorage.getItem(key)==='1') section.classList.add('is-collapsed');
  btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggle();});
  head.style.cursor='pointer';
  head.addEventListener('click',e=>{
    if(e.target.closest('button')) return;
    toggle();
  });
  update();
})();


(function(){
 const sw=document.getElementById('incomeMonthSwitcher');
 const name=document.getElementById('monthSwitcherName'); const prev=document.getElementById('monthPrev'); const next=document.getElementById('monthNext');
 if(!sw||!name||!prev||!next)return;
 function refresh(){
   const m=getSelectedIncomePeriod().month;
   const month=Number.isInteger(m)&&m>=0&&m<12?m:new Date().getMonth();
   setSelectedIncomePeriod(month,getSelectedIncomeYear());
 }
 prev.addEventListener('click',()=>changeSelectedIncomeMonth(-1));
 next.addEventListener('click',()=>changeSelectedIncomeMonth(1));
 refresh();
})();

[incomeDate,incomeAmount,incomeCategory].forEach(el=>el?.addEventListener('input',()=>el.closest('label')?.classList.remove('field-invalid')));
[incomeDate,incomeAmount,incomeCategory].forEach(el=>el?.addEventListener('change',()=>el.closest('label')?.classList.remove('field-invalid')));

(function(){
  const svg=document.getElementById('incomeChartSvg');
  const monthsEl=document.getElementById('incomeChartMonths');
  const yearEl=document.getElementById('incomeChartYear');
  if(!svg||!monthsEl)return;
  const names=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

  function syncMobileSelectedChartColor(){
    if(!window.matchMedia('(max-width:560px)').matches){
      svg.style.removeProperty('--income-chart-selected');
      return;
    }
    const probe=document.createElement('span');
    probe.style.cssText='position:fixed;left:-9999px;top:-9999px;color:var(--primary);pointer-events:none';
    document.body.appendChild(probe);
    const values=(getComputedStyle(probe).color.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    probe.remove();
    if(values.length!==3||values.some(value=>!Number.isFinite(value)))return;
    const factor=.64;
    const darker=values.map(value=>Math.max(0,Math.min(255,Math.round(value*factor))));
    svg.style.setProperty('--income-chart-selected',`rgb(${darker[0]}, ${darker[1]}, ${darker[2]})`);
  }

  function draw(){
    syncMobileSelectedChartColor();
    const chartData=typeof IncomeStore!=='undefined'?IncomeStore.load():incomes;
    if(!Array.isArray(chartData))return;
    const period=getSelectedIncomePeriod();
    const year=period.year;
    const selected=period.month;
    const totals=Array(12).fill(0);
    chartData.forEach(item=>{
      const d=typeof textDateToDate==='function'?textDateToDate(item.date):null;
      if(d&&d.getFullYear()===year)totals[d.getMonth()]+=Number(item.amount||0);
    });
    const max=Math.max(...totals,1);
    const W=520,H=150,left=10,right=10,top=12,bottom=10;
    const innerW=W-left-right, innerH=H-top-bottom;
    const step=innerW/12;
    const barW=Math.min(26,step*0.62);
    const baseline=top+innerH;
    const grid=[0.25,0.5,0.75].map(q=>{const y=top+innerH*q;return `<line class="income-chart-grid" x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"/>`;}).join('');
    const bars=totals.map((v,i)=>{
      const h=(v/max)*innerH;
      const x=left+i*step+(step-barW)/2;
      const y=baseline-h;
      return `<g class="income-chart-point" data-month="${i}">
        <title>${names[i]} ${year}: ${formatMoney(v)}</title>
        <rect class="income-chart-bar ${i===selected?'selected':''}" data-month="${i}" role="button" tabindex="0" aria-label="Доход за ${names[i]} ${year}: ${formatMoney(v)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="4"/>
      </g>`;
    }).join('');
    svg.innerHTML=grid+bars;
    monthsEl.innerHTML='';
    if(yearEl)yearEl.textContent=year;
  }
  if(!svg.__incomeChartInteractive){
    const selectMonth=(month)=>{
      const m=Number(month);
      if(!Number.isInteger(m)||m<0||m>11)return;
      setSelectedIncomePeriod(m,getSelectedIncomeYear());
      if(typeof window.renderIncomes==='function')window.renderIncomes();
      else draw();
    };
    svg.addEventListener('click',(e)=>{
      const bar=e.target.closest('.income-chart-bar');
      if(bar)selectMonth(bar.dataset.month);
    });
    svg.addEventListener('keydown',(e)=>{
      const bar=e.target.closest('.income-chart-bar');
      if(bar&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectMonth(bar.dataset.month);}
    });
    svg.__incomeChartInteractive=true;
  }
  const yearPrev=document.getElementById('chartYearPrev');
  const yearNext=document.getElementById('chartYearNext');
  const getYear=()=>getSelectedIncomePeriod().year;
  const setYear=(y)=>{
    y=Math.max(1970,Math.min(9999,Number(y)));
    const period=getSelectedIncomePeriod();
    setSelectedIncomePeriod(period.month,y);
    draw();
    if(typeof window.renderIncomes==='function') window.renderIncomes();
  };
  if(yearPrev&&!yearPrev.__bound){yearPrev.addEventListener('click',()=>setYear(getYear()-1));yearPrev.__bound=true;}
  if(yearNext&&!yearNext.__bound){yearNext.addEventListener('click',()=>setYear(getYear()+1));yearNext.__bound=true;}
  window.renderIncomeMonthChart=draw;
  draw();
  window.addEventListener('storage',draw);
  
  
})();


/* qp-mobile-home-header-v15 */
(function(){
  const mq=window.matchMedia('(max-width:560px)');
  const monthBlock=document.querySelector('#income .income-month-block');
  const monthSwitcher=document.getElementById('incomeMonthSwitcher');
  const yearSwitcher=document.querySelector('#income .income-chart-year-switcher');
  const yearHome=document.querySelector('#income .income-chart-year-bottom');
  const recent=document.getElementById('incomeRecent');
  const recentControls=recent?.querySelector('.income-recent-controls');
  const recentGrid=document.getElementById('incomeRecentGrid');
  const recentFooter=recent?.querySelector('.income-recent-bottom-actions');
  const addButton=document.getElementById('openIncomeForm');
  const historyPanel=document.getElementById('incomeRecentHistoryPanel');

  if(!monthBlock||!monthSwitcher||!yearSwitcher||!yearHome||!recent||!recentControls||!recentGrid||!recentFooter)return;

  function showArrows(switcher,autoHide){
    switcher.classList.add('is-arrows-visible');
    clearTimeout(switcher.__qpArrowTimer);
    if(autoHide){
      switcher.__qpArrowTimer=setTimeout(()=>{
        switcher.classList.remove('is-arrows-visible');
      },1000);
    }
  }

  [monthSwitcher,yearSwitcher].forEach(switcher=>{
    if(switcher.dataset.qpMobileArrowBound==='1')return;
    switcher.dataset.qpMobileArrowBound='1';
    switcher.addEventListener('click',event=>{
      if(!mq.matches)return;
      showArrows(switcher,!!event.target.closest('button'));
    });

    let swipeStartX=0;
    let swipeStartY=0;
    switcher.addEventListener('touchstart',event=>{
      if(!mq.matches||event.touches.length!==1)return;
      swipeStartX=event.touches[0].clientX;
      swipeStartY=event.touches[0].clientY;
    },{passive:true});
    switcher.addEventListener('touchend',event=>{
      if(!mq.matches||!event.changedTouches.length)return;
      const dx=event.changedTouches[0].clientX-swipeStartX;
      const dy=event.changedTouches[0].clientY-swipeStartY;
      if(Math.abs(dx)<42||Math.abs(dx)<=Math.abs(dy)*1.15)return;
      const prevButton=switcher.querySelector('button:first-of-type');
      const nextButton=switcher.querySelector('button:last-of-type');
      const target=dx<0?nextButton:prevButton;
      if(!target||target.disabled)return;
      event.preventDefault();
      target.click();
      showArrows(switcher,true);
    },{passive:false});
  });

  document.documentElement.classList.add('qp-mobile-home-header-v16');

  function applyMobileStructure(){
    if(mq.matches){
      monthBlock.classList.add('qp-mobile-period-row');
      if(yearSwitcher.parentElement!==monthBlock){
        const total=monthBlock.querySelector('.income-total-cloud-inner');
        monthBlock.insertBefore(yearSwitcher,total||null);
      }
      recent.classList.add('qp-mobile-recent-stack');
      if(recentFooter.parentElement!==recent){
        if(historyPanel&&historyPanel.parentElement===recent)recent.insertBefore(recentFooter,historyPanel);
        else recent.appendChild(recentFooter);
      }
    }else{
      monthBlock.classList.remove('qp-mobile-period-row');
      monthSwitcher.classList.remove('is-arrows-visible');
      yearSwitcher.classList.remove('is-arrows-visible');
      if(yearSwitcher.parentElement!==yearHome)yearHome.appendChild(yearSwitcher);
      recent.classList.remove('qp-mobile-recent-stack');
      if(recentFooter.parentElement!==recentControls){
        recentControls.insertBefore(recentFooter,addButton||null);
      }
    }
  }

  if(recentGrid.dataset.qpSwipeBound!=='1'){
    recentGrid.dataset.qpSwipeBound='1';
    let startX=0;
    let startY=0;
    recentGrid.addEventListener('touchstart',event=>{
      if(!mq.matches||event.touches.length!==1)return;
      startX=event.touches[0].clientX;
      startY=event.touches[0].clientY;
    },{passive:true});
    recentGrid.addEventListener('touchend',event=>{
      if(!mq.matches||!event.changedTouches.length)return;
      const dx=event.changedTouches[0].clientX-startX;
      const dy=event.changedTouches[0].clientY-startY;
      if(Math.abs(dx)<48||Math.abs(dx)<=Math.abs(dy)*1.15)return;
      const target=dx<0?document.getElementById('incomeRecentNext'):document.getElementById('incomeRecentPrev');
      if(!target||target.disabled)return;
      event.preventDefault();
      target.click();
    },{passive:false});
  }

  if(typeof mq.addEventListener==='function')mq.addEventListener('change',applyMobileStructure);
  else if(typeof mq.addListener==='function')mq.addListener(applyMobileStructure);
  applyMobileStructure();
})();


(function(){
  const analytics=document.getElementById('incomeAnalytics');
  const toggle=document.getElementById('analyticsSettingsToggle');
  const host=document.getElementById('analyticsSettingsHost');
  const settings=document.getElementById('settings');
  if(!analytics||!toggle||!host||!settings)return;

  const homeParent=settings.parentNode;
  const homeAnchor=document.createComment('qPokoy-settings-home');
  homeParent.insertBefore(homeAnchor,settings);
  const desktop=()=>window.matchMedia('(min-width:901px)').matches;
  const inlineSettings=()=>desktop()||window.matchMedia('(max-width:560px)').matches;

  function restoreSettingsHome(){
    if(homeAnchor.parentNode&&settings.parentNode!==homeAnchor.parentNode){
      homeAnchor.parentNode.insertBefore(settings,homeAnchor.nextSibling);
    }
    settings.classList.remove('analytics-inline-settings');
  }

  function setOpen(open){
    const next=!!open&&inlineSettings();
    const mobileInline=window.matchMedia('(max-width:560px)').matches;
    const modeRow=analytics.querySelector('.analytics-mode-row');

    // Settings must always open over the compact analytics shell.
    // Collapse expanded category panels first so their temporary height
    // never becomes the height of the settings overlay.
    if(next){
      const annualCategoriesToggle=document.getElementById('annualCategoriesToggle');
      const monthlyCategoriesToggle=document.getElementById('monthlyCategoriesToggle');
      if(annualCategoriesToggle?.getAttribute('aria-expanded')==='true'){
        annualCategoriesToggle.click();
      }
      if(monthlyCategoriesToggle?.getAttribute('aria-expanded')==='true'){
        monthlyCategoriesToggle.click();
      }
    }

    analytics.classList.toggle('is-settings-open',next);
    toggle.classList.toggle('is-active',next);
    toggle.setAttribute('aria-expanded',next?'true':'false');
    toggle.setAttribute('aria-label',next?'Закрыть настройки':'Настройки');
    toggle.title=next?'Закрыть настройки':'Настройки';

    if(next){
      if(mobileInline&&modeRow){
        modeRow.insertAdjacentElement('afterend',host);
        Array.from(analytics.children).forEach(child=>{
          if(child===modeRow||child===host)return;
          child.dataset.qpMobileSettingsHidden=child.hidden?'1':'0';
          child.hidden=true;
        });
      }
      host.hidden=false;
      host.appendChild(settings);
      settings.classList.add('analytics-inline-settings');
      settings.style.removeProperty('display');
      if(typeof window.qPokoySetSettingsTab==='function')window.qPokoySetSettingsTab('categories');
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          analytics.scrollIntoView({behavior:'smooth',block:mobileInline?'start':'center',inline:'nearest'});
        });
      });
    }else{
      if(mobileInline){
        Array.from(analytics.children).forEach(child=>{
          if(!Object.prototype.hasOwnProperty.call(child.dataset,'qpMobileSettingsHidden'))return;
          const wasHidden=child.dataset.qpMobileSettingsHidden==='1';
          child.hidden=wasHidden;
          delete child.dataset.qpMobileSettingsHidden;
        });
        analytics.appendChild(host);
      }
      host.hidden=true;
      restoreSettingsHome();
      const active=document.querySelector('.page.active');
      if(active&&active.id!=='settings'){
        settings.style.setProperty('display','none','important');
      }
      if(desktop()){
        const incomeTop=document.querySelector('#income .income-top');
        if(incomeTop){
          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
              incomeTop.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
            });
          });
        }
      }
    }
  }

  toggle.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    setOpen(!analytics.classList.contains('is-settings-open'));
  });

  window.addEventListener('resize',()=>{
    if(!inlineSettings()&&analytics.classList.contains('is-settings-open'))setOpen(false);
  },{passive:true});

  window.qPokoySetAnalyticsSettingsOpen=setOpen;

  // Close settings before actions that change the dashboard context.
  // Capture phase lets the original click continue normally afterwards.
  document.addEventListener('click',event=>{
    if(!analytics.classList.contains('is-settings-open'))return;
    const target=event.target.closest(
      '#monthPrev, #monthNext, #chartYearPrev, #chartYearNext, '+
      '#analyticsYearPrev, #analyticsYearNext, '+
      '#analyticsModeMonth, #analyticsModeYear, '+
      '.income-chart-bar, .annual-total-bar, '+
      '#openIncomeForm, #incomeRecentToggle'
    );
    if(!target)return;
    setOpen(false);
  },true);
})();

(function(){
  const settings=document.getElementById('settings');
  if(!settings)return;

  const allowed=['categories','appearance','data'];
  const buttons=[...settings.querySelectorAll('.qp-settings-tab[data-settings-tab-target]')];

  function setTab(tab){
    const next=allowed.includes(tab)?tab:'categories';
    settings.dataset.settingsTab=next;
    buttons.forEach(btn=>{
      const active=btn.dataset.settingsTabTarget===next;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-selected',active?'true':'false');
    });
  }

  buttons.forEach(btn=>btn.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    setTab(btn.dataset.settingsTabTarget);
  }));

  setTab('categories');
  window.qPokoySetSettingsTab=setTab;
})();

document.querySelectorAll('.page:not(#settings) .settings-card').forEach(el=>el.remove());

(function(){
  function enforceSettingsOnly(){
    const settings=document.getElementById('settings');
    if(!settings) return;
    document.querySelectorAll('.settings-card').forEach(function(el){
      if(!settings.contains(el)){
        el.remove();
      }
    });
    const active=document.querySelector('.page.active');
    const inlineOpen=!!settings.closest('#analyticsSettingsHost')&&
      document.getElementById('incomeAnalytics')?.classList.contains('is-settings-open');
    if(inlineOpen){
      settings.style.removeProperty('display');
      settings.querySelectorAll('.settings-card').forEach(function(el){
        el.style.removeProperty('display');
      });
    } else if(active && active.id!=='settings'){
      settings.style.setProperty('display','none','important');
      settings.querySelectorAll('.settings-card').forEach(function(el){
        el.style.removeProperty('display');
      });
    } else if(active && active.id==='settings'){
      settings.style.removeProperty('display');
    }
  }
  enforceSettingsOnly();
  document.querySelectorAll('.nav-item[data-page]').forEach(function(item){
    item.addEventListener('click',enforceSettingsOnly);
  });
})();


// Initialize the single source of truth for period, then render.
const initialPeriod=getSelectedIncomePeriod();
setSelectedIncomePeriod(initialPeriod.month,initialPeriod.year);

// Imports above may have changed localStorage through IncomeStore.
// Re-sync the in-memory array before any statistics/chart calculation.
const finalLoadedIncomes=IncomeStore.load();
incomes.splice(0,incomes.length,...finalLoadedIncomes);

renderIncomes();
if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();

})();



/* V6 DATA SAFETY / ANALYTICS UX */
(function(){
  const BACKUP_KEY='incomeBackupLastAt';

  function normalizeIncomeRecord(item){
    if(!item || typeof item!=='object') return null;
    const amount=Number(item.amount);
    if(!Number.isFinite(amount) || amount<0) return null;
    const date=String(item.date||'').trim();
    const category=String(item.category||'Другое').trim() || 'Другое';
    return {
      id:String(item.id||crypto.randomUUID?.()||('income-'+Date.now()+'-'+Math.random().toString(36).slice(2))),
      date,
      amount,
      category,
      description:String(item.description||'').trim()
    };
  }

  
window.qPokoyDeleteIncome=function(id){
  let records=[];
  try{ records=JSON.parse(localStorage.getItem('incomes')||'[]'); }catch(e){ records=[]; }
  const record=Array.isArray(records)?records.find(x=>String(x.id)===String(id)):null;
  const message=record
    ? `Удалить доход ${Number(record.amount||0).toLocaleString('ru-RU')} ₽ от ${record.date||''}?`
    : 'Удалить выбранный доход?';
  if(typeof window.qPokoyConfirm==='function'){
    window.qPokoyConfirm('Удалить доход?',message,async function(){
      try{
        const next=await IncomeStore.remove(id);
        if(!next) return;
        if(typeof window.qPokoyReplaceIncomes==='function') window.qPokoyReplaceIncomes(next,false);
        else if(typeof window.renderIncomes==='function') window.renderIncomes();
      }catch(error){
        console.error('[qPokoy delete]',error);
        if(window.qPokoyNotice) window.qPokoyNotice('Ошибка удаления','Не удалось завершить удаление. Обновите страницу перед повторной попыткой. '+(error.message||''),'error');
      }
    });
  }
  return false;
};

function getAllIncomeRecords(){
    try{
      return (IncomeStore.load()||[]).map(normalizeIncomeRecord).filter(Boolean);
    }catch(e){
      return Array.isArray(window.incomes)?window.incomes.map(normalizeIncomeRecord).filter(Boolean):[];
    }
  }

  async function persistRecords(records){
    const clean=records.map(normalizeIncomeRecord).filter(Boolean);
    if(typeof window.qPokoyCloudRestoreBackup!=='function'){
      throw new Error('Облачное восстановление недоступно. Обновите страницу и повторите импорт.');
    }
    const restored=await window.qPokoyCloudRestoreBackup(clean);
    if(!restored){
      throw new Error('Резервная копия не была полностью восстановлена. Данные синхронизированы с фактическим состоянием облака.');
    }
    return IncomeStore.load();
  }

  function setBackupStatus(text){
    const el=document.getElementById('incomeBackupStatus');
    if(el) el.textContent=text||'';
  }

  function exportData(){
    const records=getAllIncomeRecords();
    const payload={
      format:'qPokoy-income-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      incomes:records
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url;
    a.download=`income-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(typeof window.qPokoyNotice==='function') window.qPokoyNotice('Экспорт завершён',`Файл с данными подготовлен. Записей: ${records.length}.`,'success');
    localStorage.setItem(BACKUP_KEY,new Date().toISOString());
    setBackupStatus(`Экспортировано записей: ${records.length}.`);
  }

  function canonicalDate(value){
    const s=String(value||'').trim();
    let m=s.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(m) return m[1]+'.'+m[2]+'.'+m[3].slice(-2);
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m) return m[3]+'.'+m[2]+'.'+m[1].slice(-2);
    return s;
  }

  async function importData(file){
    if(!file) return;
    const text=(await file.text()).replace(/^\uFEFF/,'').trim();
    let payload;
    try{ payload=JSON.parse(text); }catch(e){ throw new Error('Файл не является корректным JSON.'); }

    const incoming=Array.isArray(payload) ? payload : (payload && Array.isArray(payload.incomes) ? payload.incomes : null);
    if(!Array.isArray(incoming)) throw new Error('В файле не найден массив доходов.');

    const clean=incoming.map(item=>{
      if(!item || typeof item!=='object') return null;
      const copy={...item};
      if(copy.amount==null && copy.sum!=null) copy.amount=copy.sum;
      if(copy.amount==null && copy.value!=null) copy.amount=copy.value;
      copy.date=canonicalDate(copy.date);
      return normalizeIncomeRecord(copy);
    }).filter(Boolean);

    if(!clean.length) throw new Error('В файле нет корректных записей.');

    // Импорт резервной копии восстанавливает именно содержимое файла,
    // а не смешивает его со случайными локальными данными.
    await persistRecords(clean);
    localStorage.removeItem('historical2026Imported');
    localStorage.removeItem('income2023ImportedV1');

    // После импорта показываем все загруженные записи, независимо от
    // фильтров, которые были выбраны до загрузки файла.
    if(typeof state==='object' && state){
      state.year='all';
      state.month='all';
      state.category='all';
      state.description='all';
      state.search='';
      state.sort='date-desc';
    }
    const search=document.getElementById('historySearch');
    if(search) search.value='';

    setBackupStatus(`Импортировано: ${clean.length}. Всего записей: ${clean.length}.`);
    if(typeof window.applyIncomeHeaderFilters==='function') window.applyIncomeHeaderFilters();
    if(typeof window.renderDashboard==='function') window.renderDashboard();
    if(typeof window.renderAnalytics==='function') window.renderAnalytics();
    if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
  }

  window.IncomeBackup={exportData,importData,getAllIncomeRecords,persistRecords};

  document.addEventListener('click',function(e){
    const exportBtn=e.target.closest('#exportIncomeData');
    if(exportBtn){ e.preventDefault(); exportData(); return; }

  });

  const last=localStorage.getItem(BACKUP_KEY);
  if(last) setBackupStatus(`Последний экспорт: ${new Date(last).toLocaleString('ru-RU')}`);
})();


/* qp-mobile-month-total-swipe-v34 */
(function(){
  const mq=window.matchMedia('(max-width:560px)');
  const total=document.getElementById('incomeTotal');
  if(!total||total.dataset.qpMonthSwipeBound==='1')return;

  total.dataset.qpMonthSwipeBound='1';
  let startX=0;
  let startY=0;

  total.addEventListener('touchstart',event=>{
    if(!mq.matches||event.touches.length!==1)return;
    startX=event.touches[0].clientX;
    startY=event.touches[0].clientY;
  },{passive:true});

  total.addEventListener('touchend',event=>{
    if(!mq.matches||!event.changedTouches.length)return;
    const dx=event.changedTouches[0].clientX-startX;
    const dy=event.changedTouches[0].clientY-startY;
    if(Math.abs(dx)<44||Math.abs(dx)<=Math.abs(dy)*1.15)return;
    if(typeof window.qPokoyChangeSelectedIncomeMonth!=='function')return;

    event.preventDefault();
    window.qPokoyChangeSelectedIncomeMonth(dx<0?1:-1);
  },{passive:false});
})();
