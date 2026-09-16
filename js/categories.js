
(function(){
  const TABLE='qpokoy_categories';
  const DEFAULTS=['Зарплата','Подработка','Прочее'];
  let currentUser=null;
  let categories=[];

  function client(){return window.qPokoySupabase||null;}
  function normalizeName(value){return String(value||'').trim().replace(/\s+/g,' ');}
  function categoryRank(name){return normalizeName(name).toLocaleLowerCase('ru-RU')==='зарплата'?0:1;}
  function sortCategories(list){
    return (Array.isArray(list)?list:[]).map((item,index)=>({item,index})).sort((a,b)=>{
      const diff=categoryRank(a.item?.name)-categoryRank(b.item?.name);
      return diff||a.index-b.index;
    }).map(x=>x.item);
  }

  async function ensureSalaryCategory(userId, existing){
    const c=client();
    if(!c||!userId)return existing||[];
    const list=Array.isArray(existing)?existing.slice():await fetchCategories(userId);
    if(list.some(x=>normalizeName(x.name).toLocaleLowerCase('ru-RU')==='зарплата'))return list;
    const {data,error}=await c.from(TABLE).insert({user_id:userId,name:'Зарплата'}).select('id,user_id,name,created_at').single();
    if(error){console.error('[qPokoy categories] salary ensure error',error);return list;}
    if(data)list.push({id:String(data.id),name:normalizeName(data.name)});
    return sortCategories(list);
  }

  async function fetchCategories(userId){
    const c=client();
    if(!c||!userId)return [];
    const {data,error}=await c.from(TABLE).select('id,user_id,name,created_at').eq('user_id',userId).order('created_at',{ascending:true});
    if(error){console.error('[qPokoy categories] load error',error);return [];}
    return sortCategories((data||[]).map(x=>({id:String(x.id),name:normalizeName(x.name)})).filter(x=>x.name));
  }

  function renderManager(){
    const card=document.querySelector('#settings > .settings-card:not([style])');
    if(!card)return;
    let box=card.querySelector('.qp-category-manager');
    if(!box){
      box=document.createElement('div');
      box.className='qp-category-manager';
      box.innerHTML='<div class="qp-category-manager-title">Категории</div>'+
        '<div class="qp-category-manager-subtitle"></div>'+
        '<div class="qp-category-add"><input id="qpCategoryInput" type="text" maxlength="80" placeholder="Название категории" autocomplete="off"><button type="button" id="qpCategoryAddBtn" aria-label="Добавить категорию" title="Добавить категорию">+</button></div>'+
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

  function renderIncomeCategoryOptions(){
    const popup=document.getElementById('categoryPopup');
    const value=document.getElementById('categoryValue');
    const hidden=document.getElementById('incomeCategory');
    if(!popup||!value||!hidden)return;
    popup.innerHTML='';
    if(!categories.length){
      const empty=document.createElement('div');empty.className='category-option';empty.textContent='Категорий пока нет';empty.style.cursor='default';empty.style.color='var(--text-muted)';popup.appendChild(empty);
      hidden.value='';value.textContent='Добавьте категорию';
      return;
    }
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

  async function loadForUser(user){
    currentUser=user||null;
    categories=user?await fetchCategories(user.id):[];
    if(user)categories=await ensureSalaryCategory(user.id,categories);
    renderManager();
    renderIncomeCategoryOptions();
  }

  window.qPokoySeedDefaultCategories=async function(userId){
    const c=client();
    if(!c||!userId)return;
    const existing=await fetchCategories(userId);
    if(existing.length){
      categories=await ensureSalaryCategory(userId,existing);
      currentUser={id:userId};
      renderManager();
      renderIncomeCategoryOptions();
      return;
    }
    const rows=DEFAULTS.map(name=>({user_id:userId,name}));
    const {data,error}=await c.from(TABLE).insert(rows).select('id,user_id,name,created_at');
    if(error){console.error('[qPokoy categories] seed error',error);return;}
    currentUser={id:userId};
    categories=(data||[]).map(x=>({id:String(x.id),name:normalizeName(x.name)}));
    categories=await ensureSalaryCategory(userId,categories);
    renderManager();renderIncomeCategoryOptions();
  };

  async function addCategory(){
    const c=client();
    const input=document.getElementById('qpCategoryInput');
    const name=normalizeName(input?.value);
    if(!c||!currentUser)return;
    if(!name){if(window.qPokoyNotice)window.qPokoyNotice('Категория не добавлена','Введите название категории.','error');return;}
    if(categories.some(x=>x.name.toLocaleLowerCase('ru-RU')===name.toLocaleLowerCase('ru-RU'))){if(window.qPokoyNotice)window.qPokoyNotice('Категория уже существует','Введите другое название.','error');return;}
    const {data,error}=await c.from(TABLE).insert({user_id:currentUser.id,name}).select('id,user_id,name,created_at').single();
    if(error){console.error('[qPokoy categories] add error',error);if(window.qPokoyNotice)window.qPokoyNotice('Не удалось добавить категорию',error.message||'Попробуйте ещё раз.','error');return;}
    categories=sortCategories(categories.concat({id:String(data.id),name:normalizeName(data.name)}));
    input.value='';renderManager();renderIncomeCategoryOptions();
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
      const {error}=await c.from(TABLE).delete().eq('id',cat.id).eq('user_id',currentUser.id);
      if(error){console.error('[qPokoy categories] delete error',error);if(window.qPokoyNotice)window.qPokoyNotice('Не удалось удалить категорию',error.message||'Попробуйте ещё раз.','error');return;}
      categories=sortCategories(categories.filter(x=>x.id!==cat.id));
      if(document.getElementById('incomeCategory')?.value===cat.name){document.getElementById('incomeCategory').value='';document.getElementById('categoryValue').textContent=categories.length? 'Выберите категорию':'Добавьте категорию';}
      renderManager();renderIncomeCategoryOptions();
    };
    if(window.qPokoyConfirm)window.qPokoyConfirm('Удалить категорию?',`Удалить «${cat.name}»? Уже добавленные доходы не будут удалены.`,doRemove);
    else doRemove();
  }

  window.qPokoyLoadCategories=loadForUser;
  window.qPokoyGetCategories=function(){return sortCategories(categories);};

  function bindAuth(){
    const c=client();if(!c)return false;
    c.auth.onAuthStateChange(function(_event,session){loadForUser(session?.user||null);});
    c.auth.getSession().then(r=>loadForUser(r.data?.session?.user||null));
    return true;
  }
  function init(){
    renderManager();
    if(!bindAuth())setTimeout(init,100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
