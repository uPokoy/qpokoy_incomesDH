/* Module contract: docs/frontend-module-contracts.md (categories).
 * Owns private per-user category rows, manager UI and editor category options.
 * auth calls qPokoyLoadCategories(user, bootstrapRows); omitted rows mean GET.
 * Public legacy surface: qPokoyLoadCategories, qPokoyGetCategories,
 * qPokoyCategoryVisual. The getter copies the array, not individual rows.
 * app owns editor lifecycle; selection is shared through #incomeCategory DOM.
 */
(function(){
let currentUser=null;
let categories=[];
let loadGeneration=0;
function client(){return window.qPokoyApi||null;}
function normalizeName(value){return String(value||'').trim().replace(/\s+/g,' ');}
function categoryRank(name){return normalizeName(name).toLocaleLowerCase('ru-RU')==='зарплата'?0:1;}
function sortCategories(list){
return (Array.isArray(list)?list:[]).map((item,index)=>({item,index})).sort((a,b)=>{
const diff=categoryRank(a.item?.name)-categoryRank(b.item?.name);
return diff||a.index-b.index;
}).map(x=>x.item);
}
async function fetchCategories(userId){
const c=client();
if(!c||!userId)return [];
const data=await c.listCategories();
return sortCategories((data||[]).map(x=>({id:String(x.id),name:normalizeName(x.name)})).filter(x=>x.name));
}
function renderManager(){
const card=document.querySelector('#settings > .settings-card:not([style])');
if(!card)return;
let box=card.querySelector('.qp-category-manager');
if(!box){
box=document.createElement('div');
box.className='qp-category-manager';
box.innerHTML='<div class="qp-category-add"><input id="qpCategoryInput" type="text" maxlength="80" placeholder="Название категории" autocomplete="off"><button type="button" id="qpCategoryAddBtn" aria-label="Добавить категорию" title="Добавить категорию">+</button></div>'+
'<div class="qp-category-list" id="qpCategoryList"></div>';
card.appendChild(box);
box.querySelector('#qpCategoryAddBtn').addEventListener('click',addCategory);
box.querySelector('#qpCategoryInput').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();addCategory();}});
}
const list=box.querySelector('#qpCategoryList');
if(!currentUser){list.innerHTML='<div class="qp-category-empty">Войдите в аккаунт, чтобы управлять категориями.</div>';return;}
if(!categories.length){list.innerHTML='<div class="qp-category-empty">Категорий пока нет.</div>';return;}
const orderedCategories=sortCategories(categories);
list.innerHTML=orderedCategories.map((x,i)=>{const v=window.qPokoyCategoryVisual?window.qPokoyCategoryVisual(x.name,i):{icon:'',color:'var(--primary)'};return '<div class="qp-category-item" data-id="'+x.id+'" style="--category-color:'+v.color+'"><span class="qp-category-icon">'+v.icon+'</span><span class="qp-category-name">'+escapeHtml(x.name)+'</span>'+(normalizeName(x.name).toLocaleLowerCase('ru-RU')==='зарплата'?'':'<button type="button" class="qp-category-delete" aria-label="Удалить категорию" title="Удалить категорию" data-id="'+x.id+'">×</button>')+'</div>';}).join('');
list.querySelectorAll('.qp-category-delete').forEach(btn=>btn.addEventListener('click',function(){removeCategory(btn.dataset.id);}));
}
(function(){
const icons=[
'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="14" rx="2"/><path d="M2 21h20"/><path d="M8 18h8"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v13H3z"/><path d="M7 7V5h10v2"/><path d="M8 12h8"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4z"/><path d="M2 10h20"/><path d="M6 10V7h12v3"/><path d="M8 20v-6h8v6"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l1 12H5z"/><path d="M9 8a3 3 0 0 1 6 0"/><path d="M9 12h6"/></svg>'
];
const colors=['#22c55e','#8b5cf6','#f59e0b','#3b82f6','#ec4899','#06b6d4','#f97316','#84cc16'];
window.qPokoyCategoryVisual=function(name,index){
const n=String(name||'').trim().toLowerCase();
let i=index%icons.length;
if(n==='зарплата') i=0;
else if(n==='подработка') i=1;
else if(n==='прочее') i=2;
else { let h=0; for(let k=0;k<n.length;k++)h=((h<<5)-h+n.charCodeAt(k))|0; i=Math.abs(h)%icons.length; }
return {icon:icons[i],color:colors[i]};
};
})();
function escapeHtml(value){return String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}
const mobileCategoryPopupMedia=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)');
function syncMobileCreateRowPlacement(popup){
if(!popup||!mobileCategoryPopupMedia.matches||!popup.classList.contains('open'))return;
const createRow=popup.querySelector('.category-popup-create');
if(!createRow)return;
const opensBelow=popup.style.top&&popup.style.top!=='auto';
popup.style.setProperty('padding','0 10px','important');
createRow.style.setProperty('position','sticky','important');
createRow.style.setProperty('z-index','4','important');
createRow.style.setProperty('grid-template-columns',createRow.classList.contains('is-editing')?'minmax(0,1fr) 38px':'1fr','important');
createRow.style.setProperty('gap',createRow.classList.contains('is-editing')?'4px':'0','important');
createRow.style.setProperty('background','var(--panel)','important');
if(opensBelow){
if(createRow!==popup.lastElementChild)popup.appendChild(createRow);
createRow.style.setProperty('top','auto','important');
createRow.style.setProperty('bottom','0','important');
createRow.style.setProperty('margin','0','important');
createRow.style.setProperty('padding','4px 0','important');
createRow.style.setProperty('border-top','1px solid var(--border)','important');
createRow.style.setProperty('border-bottom','0','important');
}else{
if(createRow!==popup.firstElementChild)popup.insertBefore(createRow,popup.firstChild);
createRow.style.setProperty('top','0','important');
createRow.style.setProperty('bottom','auto','important');
createRow.style.setProperty('margin','0','important');
createRow.style.setProperty('padding','4px 0','important');
createRow.style.setProperty('border-top','0','important');
createRow.style.setProperty('border-bottom','1px solid var(--border)','important');
}
}
function watchMobileCategoryPopup(){
const popup=document.getElementById('categoryPopup');
if(!popup||popup.__qPokoyCategoryCreateObserver)return;
const observer=new MutationObserver(()=>{
if(!mobileCategoryPopupMedia.matches)return;
if(!popup.classList.contains('open')){
const createRow=popup.querySelector('.category-popup-create');
if(createRow?.classList.contains('is-editing')&&typeof createRow.__qPokoyResetCreate==='function')createRow.__qPokoyResetCreate();
return;
}
requestAnimationFrame(()=>syncMobileCreateRowPlacement(popup));
});
observer.observe(popup,{attributes:true,attributeFilter:['class','style']});
popup.__qPokoyCategoryCreateObserver=observer;
}
function renderIncomeCategoryOptions(){
const popup=document.getElementById('categoryPopup');
const value=document.getElementById('categoryValue');
const hidden=document.getElementById('incomeCategory');
if(!popup||!value||!hidden)return;
popup.innerHTML='';
if(!categories.length){
const empty=document.createElement('div');empty.className='category-option category-option-empty';empty.textContent='Категорий пока нет';empty.style.cursor='default';empty.style.color='var(--text-muted)';popup.appendChild(empty);
hidden.value='';value.textContent='Добавьте категорию';
}else{
sortCategories(categories).forEach(cat=>{
const option=document.createElement('button');
option.type='button';option.className='category-option';option.dataset.value=cat.name;option.textContent=cat.name;
if(hidden.value===cat.name)option.classList.add('selected');
option.addEventListener('click',function(e){
e.stopPropagation();hidden.value=cat.name;value.textContent=cat.name;
popup.querySelectorAll('.category-option').forEach(o=>o.classList.remove('selected'));option.classList.add('selected');
popup.classList.remove('open');document.getElementById('categorySelect')?.classList.remove('open');
hidden.closest('label')?.classList.remove('field-invalid');
});
popup.appendChild(option);
});
}
const createRow=document.createElement('div');
createRow.className='category-popup-create';
const mobilePopup=mobileCategoryPopupMedia.matches;
const addIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const finishCreate=async function(rawName,e){
e?.preventDefault();
e?.stopPropagation();
const created=await createCategoryRecord(rawName);
if(!created)return;
hidden.value=created.name;
value.textContent=created.name;
hidden.closest('label')?.classList.remove('field-invalid');
renderManager();
renderIncomeCategoryOptions();
popup.classList.remove('open');
document.getElementById('categorySelect')?.classList.remove('open');
};
const showCreateEditor=function(){
createRow.classList.add('is-editing');
createRow.innerHTML='<input type="text" class="category-popup-create-input" maxlength="80" placeholder="Название категории" autocomplete="off" aria-label="Название новой категории"><button type="button" class="category-popup-create-btn" aria-label="Добавить новую категорию" title="Добавить категорию">'+addIcon+'</button>';
const input=createRow.querySelector('.category-popup-create-input');
const button=createRow.querySelector('.category-popup-create-btn');
if(mobilePopup){
createRow.style.setProperty('grid-template-columns','minmax(0,1fr) 38px','important');
createRow.style.setProperty('gap','4px','important');
createRow.style.setProperty('align-items','center','important');
input.style.setProperty('height','36px','important');
input.style.setProperty('min-height','36px','important');
input.style.setProperty('padding','0 8px','important');
input.style.setProperty('border-radius','10px','important');
input.style.setProperty('border','1px solid var(--border)','important');
input.style.setProperty('background','var(--panel-muted)','important');
input.style.setProperty('color','var(--text)','important');
input.style.setProperty('box-shadow','none','important');
input.style.setProperty('font-size','14px','important');
input.style.setProperty('margin','0','important');
input.style.setProperty('align-self','center','important');
button.style.setProperty('width','38px','important');
button.style.setProperty('min-width','38px','important');
button.style.setProperty('height','36px','important');
button.style.setProperty('min-height','36px','important');
button.style.setProperty('padding','0','important');
button.style.setProperty('border','0','important');
button.style.setProperty('border-radius','10px','important');
button.style.setProperty('display','grid','important');
button.style.setProperty('place-items','center','important');
button.style.setProperty('font-size','0','important');
button.style.setProperty('font-weight','700','important');
button.style.setProperty('line-height','0','important');
button.style.setProperty('box-shadow','none','important');
button.style.setProperty('position','static','important');
button.style.setProperty('inset','auto','important');
button.style.setProperty('margin','0','important');
button.style.setProperty('align-self','center','important');
button.style.setProperty('transform','none','important');
}
button.addEventListener('click',e=>finishCreate(input.value,e));
input.addEventListener('keydown',e=>{
e.stopPropagation();
if(e.key==='Enter')finishCreate(input.value,e);
else if(e.key==='Escape'){
e.preventDefault();
renderMobileTrigger();
}
});
if(mobilePopup){
requestAnimationFrame(()=>{
syncMobileCreateRowPlacement(popup);
input.focus({preventScroll:true});
});
}
};
const renderMobileTrigger=function(){
createRow.classList.remove('is-editing');
createRow.innerHTML='<button type="button" class="category-popup-create-trigger" aria-label="Добавить категорию"><span class="category-popup-create-trigger-plus">+</span><span>Добавить категорию</span></button>';
createRow.style.setProperty('grid-template-columns','1fr','important');
createRow.style.setProperty('gap','0','important');
createRow.style.setProperty('background','var(--panel)','important');
const trigger=createRow.querySelector('.category-popup-create-trigger');
trigger.style.setProperty('width','100%','important');
trigger.style.setProperty('height','36px','important');
trigger.style.setProperty('min-height','36px','important');
trigger.style.setProperty('display','flex','important');
trigger.style.setProperty('align-items','center','important');
trigger.style.setProperty('justify-content','flex-start','important');
trigger.style.setProperty('gap','5px','important');
trigger.style.setProperty('padding','0 4px','important');
trigger.style.setProperty('border','0','important');
trigger.style.setProperty('border-radius','9px','important');
trigger.style.setProperty('background','transparent','important');
trigger.style.setProperty('color','var(--primary)','important');
trigger.style.setProperty('font-size','14px','important');
trigger.style.setProperty('font-weight','600','important');
trigger.style.setProperty('text-align','left','important');
trigger.style.setProperty('box-shadow','none','important');
trigger.style.setProperty('-webkit-tap-highlight-color','transparent','important');
const plus=trigger.querySelector('.category-popup-create-trigger-plus');
plus.style.setProperty('width','20px','important');
plus.style.setProperty('height','20px','important');
plus.style.setProperty('display','grid','important');
plus.style.setProperty('place-items','center','important');
plus.style.setProperty('flex','0 0 20px','important');
plus.style.setProperty('border-radius','6px','important');
plus.style.setProperty('background','color-mix(in srgb,var(--primary) 15%,transparent)','important');
plus.style.setProperty('font-size','17px','important');
plus.style.setProperty('font-weight','500','important');
plus.style.setProperty('line-height','1','important');
trigger.addEventListener('click',e=>{
e.preventDefault();
e.stopPropagation();
showCreateEditor();
});
requestAnimationFrame(()=>syncMobileCreateRowPlacement(popup));
};
createRow.__qPokoyResetCreate=renderMobileTrigger;
createRow.addEventListener('click',e=>e.stopPropagation());
if(mobilePopup)renderMobileTrigger();
else{
createRow.innerHTML='<input type="text" class="category-popup-create-input" maxlength="80" placeholder="Новая категория" autocomplete="off" aria-label="Название новой категории"><button type="button" class="category-popup-create-btn" aria-label="Добавить новую категорию" title="Добавить категорию">'+addIcon+'</button>';
const input=createRow.querySelector('.category-popup-create-input');
const button=createRow.querySelector('.category-popup-create-btn');
button.style.setProperty('font-size','0','important');
button.style.setProperty('line-height','0','important');
button.addEventListener('click',e=>finishCreate(input.value,e));
input.addEventListener('keydown',e=>{
e.stopPropagation();
if(e.key==='Enter')finishCreate(input.value,e);
});
}
popup.appendChild(createRow);
}
async function loadForUser(user,bootstrapCategories){
const generation=++loadGeneration;
const nextCategories=!user?[]:(Array.isArray(bootstrapCategories)
?sortCategories(bootstrapCategories.map(x=>({id:String(x.id),name:normalizeName(x.name)})).filter(x=>x.name))
:await fetchCategories(user.id));
if(generation!==loadGeneration)return;
currentUser=user||null;
categories=nextCategories;
renderManager();
renderIncomeCategoryOptions();
}
async function createCategoryRecord(rawName){
const c=client();
const name=normalizeName(rawName);
if(!c||!currentUser)return null;
if(!name){if(window.qPokoyNotice)window.qPokoyNotice('Категория не добавлена','Введите название категории.','error');return null;}
if(categories.some(x=>x.name.toLocaleLowerCase('ru-RU')===name.toLocaleLowerCase('ru-RU'))){if(window.qPokoyNotice)window.qPokoyNotice('Категория уже существует','Введите другое название.','error');return null;}
let data;
try{data=await c.addCategory(name);}
catch(error){console.error('[qPokoy categories] add error',error);if(window.qPokoyNotice)window.qPokoyNotice('Не удалось добавить категорию',error.message||'Попробуйте ещё раз.','error');return null;}
const created={id:String(data.id),name:normalizeName(data.name)};
categories=sortCategories(categories.concat(created));
return created;
}
async function addCategory(){
const input=document.getElementById('qpCategoryInput');
const created=await createCategoryRecord(input?.value);
if(!created)return;
input.value='';
renderManager();
renderIncomeCategoryOptions();
}
async function removeCategory(id){
const cat=categories.find(x=>x.id===String(id));
if(!cat)return;
if(normalizeName(cat.name).toLocaleLowerCase('ru-RU')==='зарплата'){
if(window.qPokoyNotice)window.qPokoyNotice('Категорию нельзя удалить','Категория «Зарплата» является обязательной.','error');
return;
}
const doRemove=async function(){
const c=client();if(!c||!currentUser)return;
try{await c.deleteCategory(cat.id);}
catch(error){console.error('[qPokoy categories] delete error',error);if(window.qPokoyNotice)window.qPokoyNotice('Не удалось удалить категорию',error.message||'Попробуйте ещё раз.','error');return;}
categories=sortCategories(categories.filter(x=>x.id!==cat.id));
if(document.getElementById('incomeCategory')?.value===cat.name){document.getElementById('incomeCategory').value='';document.getElementById('categoryValue').textContent=categories.length? 'Выберите категорию':'Добавьте категорию';}
renderManager();renderIncomeCategoryOptions();
};
if(window.qPokoyConfirm)window.qPokoyConfirm('Удалить категорию?',`Удалить «${cat.name}»? Уже добавленные доходы не будут удалены.`,doRemove);
else doRemove();
}
// Public loading/reading hooks; preserve early availability before DOMContentLoaded.
window.qPokoyLoadCategories=loadForUser;
window.qPokoyGetCategories=function(){return sortCategories(categories);};
function init(){
renderManager();
watchMobileCategoryPopup();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
