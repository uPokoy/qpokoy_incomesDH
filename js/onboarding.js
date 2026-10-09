/* Shared onboarding presentation. Demo values never enter IncomeStore/API/storage.
 * Completion belongs to the authenticated account, not this browser. */
(function(){
  const desktop=window.matchMedia('(hover:hover) and (pointer:fine), (pointer:coarse) and (min-width:901px) and (max-width:1200px)');
  const mobile=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)');
  // Temporary manual-test switch: completed mobile accounts repeat on each new launch/login.
  const MOBILE_ONBOARDING_TEST_MODE=false;
  if(!desktop.matches&&!mobile.matches)return;
  const byId=id=>document.getElementById(id);
  const texts=[
    'Здесь самое важное: доход за текущий месяц, а также годовой график.',
    'А здесь — статистика и анализ ваших доходов.',
    'Теперь добавьте свой первый доход.',
    'Не нашли нужную категорию? Добавьте её здесь или позже в Настройках.'
  ];
  let started=false,finished=false,step=0,demo=false,frame=0,startFrame=0;
  let tourUser=null;
  let target=null,tip=null,focus=null,shades=[],previousFocus=null;
  let mobileResizeObserver=null;
  const snapshots=new Map(),attributes=[];
  let mobileState=null;
  function prepareMobile(){
    if(!mobile.matches)return;
    const recent=byId('incomeRecent'),settings=byId('analyticsSettingsToggle');
    mobileState={collapsed:recent.classList.contains('is-collapsed'),history:recent.classList.contains('is-history-open'),
      settings:settings.getAttribute('aria-expanded')==='true',tab:document.querySelector('.qp-settings-tab.active')?.dataset.settingsTabTarget,
      persisted:localStorage.getItem('incomeRecentCollapsed')};
    if(mobileState.settings)settings.click();
    if(recent.classList.contains('is-history-open'))byId('incomeRecentHistory').click();
    if(!recent.classList.contains('is-collapsed'))byId('incomeRecentToggle').click();
  }
  function restoreMobile(){
    if(!mobileState)return;
    const state=mobileState;mobileState=null;
    const recent=byId('incomeRecent');
    if(recent.classList.contains('is-collapsed')!==state.collapsed)byId('incomeRecentToggle').click();
    if(state.history&&!recent.classList.contains('is-history-open'))byId('incomeRecentHistory').click();
    if(state.settings){
      byId('analyticsSettingsToggle').click();
      window.qPokoySetSettingsTab?.(state.tab);
    }
    if(state.persisted===null)localStorage.removeItem('incomeRecentCollapsed');
    else localStorage.setItem('incomeRecentCollapsed',state.persisted);
  }
  const money=value=>value.toLocaleString('ru-RU')+' ₽';
  function swap(id,content){
    const node=byId(id);if(!node)return;
    if(!snapshots.has(node))snapshots.set(node,[...node.childNodes]);
    if(typeof content==='string')node.textContent=content;
    else node.replaceChildren(...content);
  }
  function html(id,markup){
    if(byId(id)?.namespaceURI==='http://www.w3.org/2000/svg'){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.innerHTML=markup;
      swap(id,[...svg.childNodes]);
    }else{
      const template=document.createElement('template');template.innerHTML=markup;
      swap(id,[...template.content.childNodes]);
    }
  }
  function attribute(node,name,value){
    if(!node)return;
    attributes.push([node,name,node.getAttribute(name)]);
    node.setAttribute(name,value);
  }
  function showDemo(){
    demo=true;
    const root=byId('incomeAnalytics');
    attribute(root,'class',root.className+' is-monthly');
    attribute(byId('monthlyAnalytics'),'hidden','');
    byId('monthlyAnalytics').removeAttribute('hidden');
    attribute(byId('monthlyBestShare'),'hidden','');
    byId('monthlyBestShare').removeAttribute('hidden');
    attribute(byId('analyticsModeMonth'),'class',byId('analyticsModeMonth').className+' active');
    attribute(byId('analyticsModeYear'),'class',byId('analyticsModeYear').className.replace(/\bactive\b/g,''));
    attribute(byId('analyticsModeMonth'),'aria-selected','true');
    attribute(byId('analyticsModeYear'),'aria-selected','false');
    ['monthlyGrowthCard','monthlyYearGrowthCard'].forEach(id=>{
      const node=byId(id);attribute(node,'class',node.className.replace(/\b(positive|negative|neutral)\b/g,'')+' positive');
    });
    ['monthlyGrowthValue','monthlyYearGrowthValue'].forEach(id=>{
      const node=byId(id);attribute(node,'class',node.className.replace(/\bis-empty\b/g,''));
    });
    const values={incomeTotal:'57 600 ₽',monthlyAnalyticsTotal:'57 600 ₽',monthlyHeroTotal:'57 600 ₽',
      monthlyBestCategory:'Зарплата',monthlyBestAmount:'40 000 ₽',monthlyBestShare:'69%',
      monthlyAverageDay:'7 200 ₽',monthlyGrowthValue:'+8%',monthlyYearGrowthValue:'+12%',
      monthlyHeroIncomeDays:'8',monthlyHeroCategories:'4',monthlyAverageNote:'',monthlyGrowthNote:'',monthlyYearGrowthNote:''};
    Object.entries(values).forEach(([id,value])=>swap(id,value));
    const annual=[48000,51000,49500,54000,56000,52000,58500,55000,53300,57600];
    const names=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт'];
    html('incomeChartSvg',annual.map((value,i)=>{
      const height=value/58500*128;
      return '<g><title>'+names[i]+': '+money(value)+' — пример данных</title><rect class="income-chart-bar" x="'+(18+i*41.67)+'" y="'+(140-height)+'" width="26" height="'+height+'" rx="4"/></g>';
    }).join(''));
    const dayTotals=Array(31).fill(0);
    [[1,5000],[4,6500],[7,4100],[10,12000],[14,7200],[18,8400],[23,6400],[28,8000]].forEach(([day,value])=>{dayTotals[day-1]=value;});
    const chart=document.createElement('div');
    window.qPokoyRenderIncomeSpikes(chart,dayTotals,{month:9,year:2026});
    swap('monthlyHeroBars',[...chart.childNodes]);
    attribute(byId('monthlyHeroDaysLabels'),'style',byId('monthlyHeroDaysLabels').getAttribute('style')||'');
    byId('monthlyHeroDaysLabels').style.setProperty('--monthly-days','31');
    html('monthlyHeroDaysLabels',dayTotals.map((value,index)=>'<span>'+([1,5,10,15,20,25,31].includes(index+1)?index+1:'')+'</span>').join(''));
    const categories=[['Зарплата',40000,69],['Подработка',12500,22],['Продажи',4100,7],['Прочее',1000,2]];
    html('monthlyAnalyticsCategories',categories.map(([name,value,share],i)=>{
      const visual=window.qPokoyCategoryVisual(name,i);
      return '<div class="monthly-category-card '+['teal','blue','amber','slate'][i]+'"><span class="monthly-category-icon" aria-hidden="true">'+visual.icon+'</span><span class="monthly-category-share">'+share+'%</span><span class="monthly-category-name">'+name+'</span><strong class="monthly-category-value">'+money(value)+'</strong></div>';
    }).join(''));
    [document.querySelector('#income .income-top'),root].forEach(host=>{
      const badge=document.createElement('span');badge.className='qp-tour-demo-badge';badge.textContent='Пример данных';host.appendChild(badge);
    });
  }
  function restoreDemo(){
    if(!demo)return;
    demo=false;
    snapshots.forEach((children,node)=>node.replaceChildren(...children));snapshots.clear();
    attributes.splice(0).reverse().forEach(([node,name,value])=>{
      if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);
    });
    document.querySelectorAll('.qp-tour-demo-badge').forEach(node=>node.remove());
    // Render only confirmed real state, also covering a refresh during the tour.
    if(typeof window.renderIncomes==='function')window.renderIncomes();
  }
  function removeOverlay(){
    cancelAnimationFrame(frame);frame=0;
    mobileResizeObserver?.disconnect();mobileResizeObserver=null;
    [tip,focus,...shades].forEach(node=>node?.remove());
    tip=null;focus=null;shades=[];target=null;
  }
  function finish(completed=false){
    if(finished)return;
    finished=true;step=0;
    if(completed)window.qPokoyAuth.completeOnboarding().catch(()=>{});
    cancelAnimationFrame(startFrame);startFrame=0;
    removeOverlay();restoreDemo();restoreMobile();
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  }
  function position(){
    if(!tip||!target?.isConnected)return;
    if(mobile.matches){positionMobile();return;}
    const rect=target.getBoundingClientRect();
    const w=window.innerWidth,h=window.innerHeight,pad=6;
    let top=Math.max(0,rect.top-pad),bottom=Math.min(h,rect.bottom+pad);
    if(step===1){
      const month=document.querySelector('#income .income-month-block').getBoundingClientRect();
      const chart=byId('incomeMonthChart').getBoundingClientRect();
      top=Math.max(0,Math.min(month.top,chart.top)-12);
      bottom=Math.min(h,Math.max(month.bottom,chart.bottom)+12);
    }
    let left=Math.max(0,rect.left-pad),right=Math.min(w,rect.right+pad);
    const focusBox={left:left+'px',top:top+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'};
    if(step===4){
      // Keep the entire real list undimmed and interactive; outline only creation.
      const popup=byId('categoryPopup').getBoundingClientRect();
      left=Math.max(0,popup.left-pad);right=Math.min(w,popup.right+pad);
      top=Math.max(0,popup.top-pad);bottom=Math.min(h,popup.bottom+pad);
    }
    const boxes=[[0,0,w,top],[0,bottom,w,h-bottom],[0,top,left,bottom-top],[right,top,w-right,bottom-top]];
    shades.forEach((node,i)=>{
      const [x,y,width,height]=boxes[i];Object.assign(node.style,{left:x+'px',top:y+'px',width:Math.max(0,width)+'px',height:Math.max(0,height)+'px'});
    });
    Object.assign(focus.style,focusBox);
    const box=tip.getBoundingClientRect();
    let x=Math.min(w-box.width-16,Math.max(16,left));
    let y=top>box.height+28?top-box.height-18:bottom+18;
    if(step===4&&w-right>box.width+28){x=right+18;y=top-box.height+44;}
    else if(step===4&&left>box.width+28){x=left-box.width-18;y=top-box.height+44;}
    if(y+box.height>h-16){
      if(left>box.width+28){x=left-box.width-18;y=top;}
      else if(w-right>box.width+28){x=right+18;y=top;}
      else y=Math.max(16,h-box.height-16);
    }
    Object.assign(tip.style,{left:Math.max(16,x)+'px',top:Math.min(h-box.height-16,Math.max(16,y))+'px'});
  }
  function mobileBounds(){
    const view=window.visualViewport,style=getComputedStyle(tip);
    const left=view?.offsetLeft||0,top=view?.offsetTop||0;
    return {left:left+12,right:left+(view?.width||innerWidth)-12,
      top:top+(parseFloat(style.scrollMarginTop)||12),
      bottom:top+(view?.height||innerHeight)-(parseFloat(style.scrollMarginBottom)||12)};
  }
  function mobileStatistics(){
    return ['#monthlyAnalytics .monthly-summary-best','#monthlyGrowthCard',
      '#monthlyAnalytics .monthly-summary-average','#monthlyTotalCard'].map(selector=>document.querySelector(selector));
  }
  function mobileTargetRect(){
    if(step!==2)return target.getBoundingClientRect();
    const rects=mobileStatistics().map(node=>node.getBoundingClientRect());
    const left=Math.min(...rects.map(rect=>rect.left)),right=Math.max(...rects.map(rect=>rect.right));
    const top=Math.min(...rects.map(rect=>rect.top)),bottom=Math.max(...rects.map(rect=>rect.bottom));
    return {left,right,top,bottom,width:right-left,height:bottom-top};
  }
  function positionMobile(){
    const bounds=mobileBounds(),pad=6;
    let rect=mobileTargetRect();
    if(step===2&&(rect.bottom+pad+18+tip.getBoundingClientRect().height>bounds.bottom+1||rect.bottom+pad+18<bounds.top)){
      scrollMobileTarget();rect=mobileTargetRect();
    }
    const left=Math.max(bounds.left-pad,rect.left-pad),right=Math.min(bounds.right+pad,rect.right+pad);
    const top=Math.max(bounds.top-pad,rect.top-pad),bottom=Math.min(bounds.bottom+pad,rect.bottom+pad);
    Object.assign(focus.style,{left:left+'px',top:top+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'});
    // As on desktop, category choices remain usable; only creation gets an outline.
    const undimmed=step===4?byId('categoryPopup').getBoundingClientRect():rect;
    const l=Math.max(0,undimmed.left-pad),r=Math.min(innerWidth,undimmed.right+pad);
    const t=Math.max(0,undimmed.top-pad),b=Math.min(innerHeight,undimmed.bottom+pad);
    const boxes=[[0,0,innerWidth,t],[0,b,innerWidth,innerHeight-b],[0,t,l,b-t],[r,t,innerWidth-r,b-t]];
    shades.forEach((node,i)=>{const [x,y,w,h]=boxes[i];Object.assign(node.style,{left:x+'px',top:y+'px',width:Math.max(0,w)+'px',height:Math.max(0,h)+'px'});});
    tip.style.maxHeight=Math.max(0,bounds.bottom-bounds.top)+'px';
    const box=tip.getBoundingClientRect();
    const x=Math.max(bounds.left,Math.min(bounds.right-box.width,(rect.left+rect.right-box.width)/2));
    const below=bottom+18,above=top-box.height-18;
    let y=step===2?below:below+box.height<=bounds.bottom?below:above>=bounds.top?above:Math.max(bounds.top,Math.min(bounds.bottom-box.height,above));
    Object.assign(tip.style,{left:x+'px',top:y+'px'});
    tip.dataset.placement=y>=bottom?'below':'above';
    tip.style.setProperty('--qp-tour-arrow-x',Math.max(20,Math.min(box.width-20,(rect.left+rect.right)/2-x))+'px');
  }
  function scrollMobileTarget(){
    const bounds=mobileBounds(),box=tip.getBoundingClientRect();
    if(step===1){
      target=document.querySelector('#income .income-top');
      if(target.getBoundingClientRect().height+box.height+36>bounds.bottom-bounds.top){
        target=document.querySelector('#income .income-chart-wrap');
      }
    }
    if(step===2){
      target=byId('monthlyAnalytics');
    }
    tip.dataset.target=step===2?'monthly-statistics':target.id||target.classList[0];
    if(step===3||step===4)return;
    const rect=mobileTargetRect();
    // Keep the full four-card group even on short screens: align its bottom
    // above the tooltip instead of substituting a smaller target.
    const desiredTop=step===2?Math.min(bounds.top+6,bounds.bottom-box.height-24-rect.height):bounds.top+6;
    window.scrollTo({top:Math.max(0,scrollY+rect.top-desiredTop),behavior:'instant'});
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(position);}
  function resized(){if(mobile.matches&&tip)scrollMobileTarget();schedule();}
  function show(next){
    removeOverlay();step=next;
    if(step===3)restoreDemo();
    target=step===1?document.querySelector('#income .income-top'):step===2?byId('incomeAnalytics'):step===3?byId('openIncomeForm'):byId('categoryPopup')?.querySelector('.category-popup-create');
    if(!target){finish();return;}
    if(step<4&&!mobile.matches){target.scrollIntoView({block:'center',behavior:'instant'});}
    shades=Array.from({length:4},()=>{const node=document.createElement('div');node.className='qp-tour-shade';node.setAttribute('aria-hidden','true');document.body.appendChild(node);return node;});
    focus=document.createElement('div');focus.className='qp-tour-focus';focus.setAttribute('aria-hidden','true');document.body.appendChild(focus);
    tip=document.createElement('section');tip.className='qp-tour-tip';tip.id='qpOnboarding';tip.setAttribute('role','dialog');tip.setAttribute('aria-modal',step<3?'true':'false');tip.setAttribute('aria-labelledby','qpTourText');
    tip.innerHTML='<div class="qp-tour-heading"><span class="qp-tour-number" aria-hidden="true">'+step+'</span><p id="qpTourText"></p></div><div class="qp-tour-footer"><span class="qp-tour-progress">'+step+' из '+(mobile.matches?3:4)+'</span><button type="button" data-tour-skip>Пропустить</button>'+(step>=3?'':'<button type="button" class="qp-tour-next" data-tour-next>Далее →</button>')+'</div>';
    tip.querySelector('p').textContent=texts[step-1];
    tip.querySelector('[data-tour-skip]').addEventListener('click',()=>finish(true));
    tip.querySelector('[data-tour-next]')?.addEventListener('click',()=>show(step+1));
    document.body.appendChild(tip);
    if(mobile.matches){
      tip.classList.add('qp-tour-mobile');scrollMobileTarget();
      if(typeof ResizeObserver==='function'){
        mobileResizeObserver=new ResizeObserver(schedule);
        (step===2?mobileStatistics():[target]).forEach(node=>mobileResizeObserver.observe(node));mobileResizeObserver.observe(tip);
      }
    }
    if(step===2&&!mobile.matches){
      // Reserve space above tall statistics at narrow desktop sizes rather
      // than placing the tooltip over category cards. Do not resize the UI.
      window.scrollTo({top:Math.max(0,window.scrollY+target.getBoundingClientRect().top-tip.getBoundingClientRect().height-40),behavior:'instant'});
    }
    position();schedule();
    tip.querySelector('[data-tour-next],[data-tour-skip]').focus({preventScroll:true});
  }
  function ready(){return !document.body.classList.contains('qp-auth-checking')&&!document.body.classList.contains('qp-auth-locked')&&!document.documentElement.classList.contains('qp-appearance-pending')&&document.querySelector('.app')?.getAttribute('aria-hidden')==='false';}
  function check(){
    if(started&&!ready()){finish();started=false;tourUser=null;return;}
    const user=window.qPokoyAuth?.getUser();
    if(ready()&&user?.id!==tourUser){tourUser=user?.id;started=false;finished=false;}
    if(finished)return;
    const eligible=()=>window.qPokoyAuth?.getUser()&&(mobile.matches&&MOBILE_ONBOARDING_TEST_MODE||window.qPokoyAuth.getUser().onboarding_completed===false);
    if(!started&&ready()&&(desktop.matches||mobile.matches)){
      if(!eligible())return;
      // Let the analytics renderer queued by bootstrap finish its first frame.
      if(!startFrame)startFrame=requestAnimationFrame(()=>{
        startFrame=0;
        if(finished||!ready()||(!desktop.matches&&!mobile.matches)||!eligible())return;
        previousFocus=document.activeElement;prepareMobile();started=true;showDemo();show(1);
      });
      return;
    }
    if(!mobile.matches&&step===-1&&byId('categoryPopup')?.classList.contains('open'))show(4);
    if(step===4&&!byId('categoryPopup')?.classList.contains('open'))finish();
  }
  const observer=new MutationObserver(check);
  [document.body,document.documentElement,byId('categoryPopup')].filter(Boolean).forEach(node=>observer.observe(node,{attributes:true,attributeFilter:['class','hidden','aria-hidden']}));
  document.addEventListener('click',event=>{
    if(!started||finished)return;
    if(step===-1){
      if(event.target.closest('#cancelIncome,#saveIncome'))finish();
      return;
    }
    if(event.target.closest('#qpOnboarding'))return;
    if(step===3&&event.target.closest('#openIncomeForm')){
      if(mobile.matches)finish(true);
      else {removeOverlay();step=-1;}
      return;
    }
    if(step===4&&event.target.closest('#categoryPopup')){
      if(event.target.closest('button.category-option,.category-popup-create'))finish(true);
      return;
    }
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  document.addEventListener('keydown',event=>{
    if(!tip)return;
    if(step===4&&event.key==='Enter'&&event.target.closest('.category-popup-create-input')){finish(true);return;}
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(true);return;}
    if(event.key==='Tab'){
      const controls=[...tip.querySelectorAll('button')];
      if(step===3)controls.push(byId('openIncomeForm'));
      if(step===4)controls.push(...byId('categoryPopup').querySelectorAll('input,button'));
      const index=controls.indexOf(document.activeElement),delta=event.shiftKey?-1:1;
      event.preventDefault();controls[(index+delta+controls.length)%controls.length].focus({preventScroll:true});
    }else if(!event.target.closest('#qpOnboarding')&&!(step===3&&event.target.closest('#openIncomeForm'))&&!(step===4&&event.target.closest('#categoryPopup'))){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  window.addEventListener('qpokoy:income-data-rendered',()=>{if(demo)finish();});
  window.addEventListener('scroll',schedule,{capture:true,passive:true});
  window.addEventListener('resize',resized,{passive:true});
  const mediaChanged=()=>{if(!desktop.matches&&!mobile.matches)finish();else schedule();};
  if(typeof desktop.addEventListener==='function')desktop.addEventListener('change',mediaChanged);
  else desktop.addListener(mediaChanged);
  if(typeof mobile.addEventListener==='function')mobile.addEventListener('change',mediaChanged);
  else mobile.addListener(mediaChanged);
  window.visualViewport?.addEventListener('resize',resized,{passive:true});
  window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
  check();
})();
