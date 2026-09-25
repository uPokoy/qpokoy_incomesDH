(function(){
  const root=document.getElementById('incomeAnalytics');
  const monthly=document.getElementById('monthlyAnalytics');
  const yearBtn=document.getElementById('analyticsModeYear');
  const monthBtn=document.getElementById('analyticsModeMonth');
  if(!root||!monthly||!yearBtn||!monthBtn)return;

  const MODE_KEY='incomeAnalyticsMode';
  const monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const monthPrep=['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];
  const monthGenitive=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const monthShortGenitive=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  const monthWith=['январём','февралём','мартом','апрелем','маем','июнем','июлем','августом','сентябрём','октябрём','ноябрём','декабрём'];

  function money(value){
    if(typeof formatMoney==='function') return formatMoney(Number(value)||0);
    return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(value)||0)+' ₽';
  }

  function parseDate(value){
    if(typeof textDateToDate==='function') return textDateToDate(value);
    const match=String(value||'').match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(!match)return null;
    let year=Number(match[3]);
    if(year<100)year+=2000;
    const d=new Date(year,Number(match[2])-1,Number(match[1]));
    return Number.isNaN(d.getTime())?null:d;
  }

  function readPeriod(){
    try{
      const raw=localStorage.getItem('incomeSelectedPeriod');
      if(raw){
        const parsed=JSON.parse(raw);
        if(Number.isInteger(parsed.month)&&parsed.month>=0&&parsed.month<12&&Number.isInteger(parsed.year)){
          return {month:parsed.month,year:parsed.year};
        }
      }
    }catch(e){}
    const monthLabel=document.getElementById('monthSwitcherName')?.textContent?.trim();
    const month=Math.max(0,monthNames.indexOf(monthLabel));
    const year=Number(document.getElementById('incomeChartYear')?.textContent)||new Date().getFullYear();
    return {month,year};
  }

  function loadData(){
    try{
      if(typeof IncomeStore!=='undefined'&&IncomeStore&&typeof IncomeStore.load==='function'){
        const data=IncomeStore.load();
        return Array.isArray(data)?data:[];
      }
    }catch(e){}
    return [];
  }

  function categoryTone(name,index){
    if(name==='Зарплата')return 'salary';
    if(name==='Аванс')return 'advance';
    if(name==='Другое')return 'other';
    if(name==='НПФ')return 'pension';
    const tones=['teal','blue','violet','amber','slate','cyan'];
    return tones[index%tones.length];
  }

  function monthTotal(data,month,year){
    return data.reduce((sum,item)=>{
      const d=parseDate(item&&item.date);
      return d&&d.getFullYear()===year&&d.getMonth()===month?sum+(Number(item.amount)||0):sum;
    },0);
  }

  function monthTotalThroughDay(data,month,year,day){
    const daysInTargetMonth=new Date(year,month+1,0).getDate();
    const cappedDay=Math.max(1,Math.min(Number(day)||1,daysInTargetMonth));
    return data.reduce((sum,item)=>{
      const d=parseDate(item&&item.date);
      return d&&d.getFullYear()===year&&d.getMonth()===month&&d.getDate()<=cappedDay
        ?sum+(Number(item.amount)||0)
        :sum;
    },0);
  }

  function dayWord(day){
    const n=Math.abs(Number(day)||0)%100;
    const n1=n%10;
    if(n>10&&n<20)return 'дней';
    if(n1===1)return 'день';
    if(n1>=2&&n1<=4)return 'дня';
    return 'дней';
  }

  function smoothSpikePath(points){
    if(!points.length)return '';
    let path='M '+points[0].x.toFixed(3)+' '+points[0].y.toFixed(3);
    for(let i=1;i<points.length;i++){
      const previous=points[i-1];
      const current=points[i];
      const middle=(previous.x+current.x)/2;
      path+=' C '+middle.toFixed(3)+' '+previous.y.toFixed(3)+' '+middle.toFixed(3)+' '+current.y.toFixed(3)+' '+current.x.toFixed(3)+' '+current.y.toFixed(3);
    }
    return path;
  }

  function renderIncomeSpikes(container,dayTotals,period){
    const count=dayTotals.length;
    const dayMax=Math.max(...dayTotals,1);
    const compactGraph=window.matchMedia('(max-width:560px)').matches;
    const baseline=88;
    const top=compactGraph?38:24;
    const range=baseline-top;
    const points=dayTotals.map((value,index)=>{
      const ratio=value>0?Math.sqrt(value/dayMax):0;
      return {
        day:index+1,
        value,
        x:count>1?(index/(count-1))*100:50,
        y:baseline-ratio*range
      };
    });
    const path=smoothSpikePath(points);
    const areaPath=path&&points.length
      ?path+' L '+points[points.length-1].x.toFixed(3)+' '+baseline+' L '+points[0].x.toFixed(3)+' '+baseline+' Z'
      :'';

    const positive=points.filter(point=>point.value>0);
    const highlighted=[];
    const compactLabels=window.matchMedia('(max-width:560px)').matches;
    if(compactLabels){
      const ranked=positive.slice().sort((a,b)=>b.value-a.value);
      for(const point of ranked){
        if(highlighted.length>=2)break;
        if(highlighted.every(selected=>Math.abs(selected.x-point.x)>=18))highlighted.push(point);
      }
      if(!highlighted.length&&ranked.length)highlighted.push(ranked[0]);
    }else if(positive.length<=4){
      highlighted.push(...positive);
    }else{
      const ranked=positive.slice().sort((a,b)=>b.value-a.value);
      for(const point of ranked){
        if(highlighted.length>=3)break;
        if(highlighted.every(selected=>Math.abs(selected.x-point.x)>=10))highlighted.push(point);
      }
      for(const point of ranked){
        if(highlighted.length>=3)break;
        if(!highlighted.includes(point))highlighted.push(point);
      }
    }
    const highlightedDays=new Set(highlighted.map(point=>point.day));

    const guides=highlighted.map(point=>
      '<line class="monthly-spikes-guide" x1="'+point.x.toFixed(3)+'" y1="'+point.y.toFixed(3)+'" x2="'+point.x.toFixed(3)+'" y2="'+baseline+'"></line>'
    ).join('');

    const markers=positive.map(point=>{
      const highlightedPoint=highlightedDays.has(point.day);
      const edge=point.x<10?' edge-left':point.x>90?' edge-right':'';
      const label=highlightedPoint
        ?'<span class="monthly-spike-label"><b>'+escapeText(money(point.value))+'</b><small>'+point.day+' '+monthShortGenitive[period.month]+'</small></span>'
        :'';
      const title=point.day+' '+monthGenitive[period.month]+': '+money(point.value);
      return '<span class="monthly-spike-marker'+(highlightedPoint?' is-highlight':'')+edge+'" style="--spike-x:'+point.x.toFixed(3)+'%;--spike-y:'+point.y.toFixed(3)+'%;" title="'+escapeText(title)+'" aria-label="'+escapeText(title)+'">'+label+'</span>';
    }).join('');

    container.classList.add('monthly-income-spikes');
    container.setAttribute('aria-label','Доходные всплески по дням месяца');
    container.innerHTML=
      '<svg class="monthly-spikes-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+
        '<path class="monthly-spikes-area" d="'+areaPath+'"></path>'+
        guides+
        '<path class="monthly-spikes-line" d="'+path+'"></path>'+
      '</svg>'+
      markers;
  }

  function render(){
    const period=readPeriod();
    const data=loadData();
    const monthData=data.filter(item=>{
      const d=parseDate(item&&item.date);
      return d&&d.getFullYear()===period.year&&d.getMonth()===period.month;
    });

    const total=monthData.reduce((sum,item)=>sum+(Number(item.amount)||0),0);
    const categoriesMap={};
    monthData.forEach(item=>{
      const name=String(item.category||'Без категории');
      categoriesMap[name]=(categoriesMap[name]||0)+(Number(item.amount)||0);
    });
    const categories=Object.entries(categoriesMap).sort((a,b)=>b[1]-a[1]);

    const titleEl=document.getElementById('monthlyAnalyticsTitle');
    const periodEl=document.getElementById('monthlyAnalyticsPeriod');
    const totalEl=document.getElementById('monthlyAnalyticsTotal');
    const bestCategoryEl=document.getElementById('monthlyBestCategory');
    const bestShareEl=document.getElementById('monthlyBestShare');
    const bestAmountEl=document.getElementById('monthlyBestAmount');
    const averageEl=document.getElementById('monthlyAverageDay');
    const averageNoteEl=document.getElementById('monthlyAverageDayNote');
    const growthLabelEl=document.getElementById('monthlyGrowthLabel');
    const growthEl=document.getElementById('monthlyGrowthValue');
    const growthNoteEl=document.getElementById('monthlyGrowthNote');
    const growthTooltipEl=document.getElementById('monthlyGrowthTooltip');
    const growthCard=document.getElementById('monthlyGrowthCard');
    const yearGrowthLabelEl=document.getElementById('monthlyYearGrowthLabel');
    const yearGrowthEl=document.getElementById('monthlyYearGrowthValue');
    const yearGrowthNoteEl=document.getElementById('monthlyYearGrowthNote');
    const yearGrowthTooltipEl=document.getElementById('monthlyYearGrowthTooltip');
    const yearGrowthCard=document.getElementById('monthlyYearGrowthCard');
    const yearGrowthInfoEl=yearGrowthCard?yearGrowthCard.querySelector('.monthly-summary-info'):null;
    const catsEl=document.getElementById('monthlyAnalyticsCategories');
    const monthlyCategoriesToggleEl=document.getElementById('monthlyCategoriesToggle');
    const heroTotalEl=document.getElementById('monthlyHeroTotal');
    const heroGrowthEl=document.getElementById('monthlyHeroGrowth');
    const heroBarsEl=document.getElementById('monthlyHeroBars');
    const heroDaysLabelsEl=document.getElementById('monthlyHeroDaysLabels');
    const heroIncomeDaysEl=document.getElementById('monthlyHeroIncomeDays');
    const heroCategoriesEl=document.getElementById('monthlyHeroCategories');

    if(titleEl)titleEl.textContent=monthNames[period.month];
    if(periodEl)periodEl.textContent=String(period.year);
    if(totalEl)totalEl.textContent=money(total);
    if(heroTotalEl)heroTotalEl.textContent=money(total);
    if(heroCategoriesEl)heroCategoriesEl.textContent=String(categories.length);

    const best=categories[0]||null;
    const bestPct=best&&total?Math.round(best[1]/total*100):0;
    if(bestCategoryEl){
      bestCategoryEl.textContent=best?best[0]:'';
      const bestRow=bestCategoryEl.closest('.monthly-best-category-row');
      if(bestRow)bestRow.hidden=!best;
    }
    if(bestShareEl){
      bestShareEl.textContent=best?bestPct+'%':'0%';
      bestShareEl.hidden=!best;
    }
    if(bestAmountEl)bestAmountEl.textContent=best?money(best[1]):'0 ₽';

    const now=new Date();
    const isCurrentMonth=period.year===now.getFullYear()&&period.month===now.getMonth();
    if(yearGrowthInfoEl){
      yearGrowthInfoEl.style.display=isCurrentMonth?'':'none';
      if(!isCurrentMonth)yearGrowthInfoEl.setAttribute('aria-expanded','false');
    }
    if(yearGrowthTooltipEl&&!isCurrentMonth)yearGrowthTooltipEl.textContent='';
    const daysInMonth=new Date(period.year,period.month+1,0).getDate();
    if(heroBarsEl&&heroDaysLabelsEl){
      const dayTotals=Array(daysInMonth).fill(0);
      monthData.forEach(item=>{
        const d=parseDate(item&&item.date);
        if(!d)return;
        const day=d.getDate();
        if(day>=1&&day<=daysInMonth)dayTotals[day-1]+=Number(item.amount)||0;
      });
      heroDaysLabelsEl.style.setProperty('--monthly-days',String(daysInMonth));
      renderIncomeSpikes(heroBarsEl,dayTotals,period);
      heroDaysLabelsEl.innerHTML=dayTotals.map((value,index)=>{
        const day=index+1;
        const show=day===1||day===5||day===10||day===15||day===20||day===25||day===daysInMonth;
        return '<span>'+ (show?day:'') +'</span>';
      }).join('');
      if(heroIncomeDaysEl)heroIncomeDaysEl.textContent=String(dayTotals.filter(value=>value>0).length);
    }
    const elapsedDays=isCurrentMonth?now.getDate():daysInMonth;
    const comparableTotal=isCurrentMonth
      ?monthTotalThroughDay(data,period.month,period.year,elapsedDays)
      :total;
    const average=elapsedDays?comparableTotal/elapsedDays:0;
    if(averageEl)averageEl.textContent=money(average);
    if(averageNoteEl)averageNoteEl.textContent='Учитывается '+elapsedDays+' '+dayWord(elapsedDays)+' в '+monthPrep[period.month];

    let prevMonth=period.month-1;
    let prevYear=period.year;
    if(prevMonth<0){prevMonth=11;prevYear--;}
    if(growthLabelEl)growthLabelEl.textContent='Сравнение с '+monthWith[prevMonth];
    const previousComparisonDay=isCurrentMonth
      ?Math.min(elapsedDays,new Date(prevYear,prevMonth+1,0).getDate())
      :null;
    const previousTotal=isCurrentMonth
      ?monthTotalThroughDay(data,prevMonth,prevYear,previousComparisonDay)
      :monthTotal(data,prevMonth,prevYear);
    const difference=comparableTotal-previousTotal;
    const growth=previousTotal>0?(difference/previousTotal*100):null;

    if(growthCard){
      growthCard.classList.remove('positive','negative','neutral');
      growthCard.classList.add(growth===null||growth===0?'neutral':growth>0?'positive':'negative');
    }
    if(growthEl){
      growthEl.classList.toggle('is-empty',growth===null);
      growthEl.textContent=growth===null?'—':(growth>=0?'+':'')+Math.trunc(growth)+'%';
    }
    if(growthNoteEl){
      const previousPeriodLabel=isCurrentMonth
        ?'за 1–'+previousComparisonDay+' '+monthGenitive[prevMonth]+' '+prevYear
        :'за '+monthNames[prevMonth].toLowerCase()+' '+prevYear;
      if(growthTooltipEl)growthTooltipEl.textContent='Сравнение '+previousPeriodLabel;
      if(previousTotal<=0){
        growthNoteEl.textContent='';
      }else if(difference>0){
        growthNoteEl.textContent=money(Math.abs(difference));
      }else if(difference<0){
        growthNoteEl.textContent=money(Math.abs(difference));
      }else{
        growthNoteEl.textContent='— 0 ₽';
      }
    }

    const lastYear=period.year-1;
    if(yearGrowthLabelEl)yearGrowthLabelEl.textContent='Сравнение с '+monthWith[period.month]+' '+lastYear;
    const lastYearComparisonDay=isCurrentMonth
      ?Math.min(elapsedDays,new Date(lastYear,period.month+1,0).getDate())
      :null;
    const lastYearTotal=isCurrentMonth
      ?monthTotalThroughDay(data,period.month,lastYear,lastYearComparisonDay)
      :monthTotal(data,period.month,lastYear);
    const yearDifference=comparableTotal-lastYearTotal;
    const yearGrowth=lastYearTotal>0?(yearDifference/lastYearTotal*100):null;

    if(yearGrowthCard){
      yearGrowthCard.classList.remove('positive','negative','neutral');
      yearGrowthCard.classList.add(yearGrowth===null||yearGrowth===0?'neutral':yearGrowth>0?'positive':'negative');
    }
    if(yearGrowthEl){
      yearGrowthEl.classList.toggle('is-empty',yearGrowth===null);
      yearGrowthEl.textContent=yearGrowth===null?'—':(yearGrowth>=0?'+':'')+Math.trunc(yearGrowth)+'%';
    }
    if(heroGrowthEl){
      const heroGrowthBox=heroGrowthEl.closest('.monthly-total-growth');
      if(heroGrowthBox)heroGrowthBox.hidden=yearGrowth===null;
      heroGrowthEl.textContent=yearGrowth===null?'—':(yearGrowth>=0?'↑ ':'↓ ')+Math.abs(yearGrowth).toFixed(1)+'%';
      heroGrowthEl.classList.toggle('positive',yearGrowth!==null&&yearGrowth>0);
      heroGrowthEl.classList.toggle('negative',yearGrowth!==null&&yearGrowth<0);
      heroGrowthEl.classList.toggle('neutral',yearGrowth===null||yearGrowth===0);
    }
    if(yearGrowthNoteEl){
      const comparisonPeriod=isCurrentMonth
        ?'за 1–'+lastYearComparisonDay+' '+monthGenitive[period.month]+' '+lastYear
        :'за '+monthNames[period.month].toLowerCase()+' '+lastYear;
      if(yearGrowthTooltipEl)yearGrowthTooltipEl.textContent='Сравнение '+comparisonPeriod;
      if(lastYearTotal<=0){
        yearGrowthNoteEl.textContent='';
      }else if(yearDifference>0){
        yearGrowthNoteEl.textContent=money(Math.abs(yearDifference));
      }else if(yearDifference<0){
        yearGrowthNoteEl.textContent=money(Math.abs(yearDifference));
      }else{
        yearGrowthNoteEl.textContent='— 0 ₽';
      }
    }

    if(catsEl){
      const desktopCategories=window.matchMedia('(min-width:901px)').matches;
      const periodKey=period.year+'-'+period.month;
      if(catsEl.dataset.categoryPeriod!==periodKey){
        catsEl.dataset.categoryPeriod=periodKey;
        catsEl.dataset.categoriesExpanded='false';
      }
      const expanded=desktopCategories&&catsEl.dataset.categoriesExpanded==='true';

      if(!categories.length){
        catsEl.classList.remove('is-collapsed','is-expanded');
        catsEl.innerHTML='<div class="monthly-analytics-empty">Нет доходов за выбранный месяц</div>';
        if(monthlyCategoriesToggleEl)monthlyCategoriesToggleEl.hidden=true;
      }else if(desktopCategories){
        let visibleCategories=categories.map(([name,value])=>({name,value,grouped:false,count:1}));
        if(!expanded&&categories.length>4){
          const rest=categories.slice(3);
          const restTotal=rest.reduce((sum,item)=>sum+item[1],0);
          visibleCategories=[
            ...categories.slice(0,3).map(([name,value])=>({name,value,grouped:false,count:1})),
            {name:'Другие',value:restTotal,grouped:true,count:rest.length}
          ];
        }

        catsEl.classList.toggle('is-collapsed',!expanded&&categories.length>4);
        catsEl.classList.toggle('is-expanded',expanded&&categories.length>4);
        catsEl.innerHTML=visibleCategories.map((item,index)=>{
          const pct=total?Math.round(item.value/total*100):0;
          const tone=item.grouped?'category-grouped':categoryTone(item.name,index);
          const displayName=item.grouped?'Другие ('+item.count+')':item.name;
          const categoryVisual=!item.grouped&&typeof window.qPokoyCategoryVisual==='function'
            ?window.qPokoyCategoryVisual(item.name,index)
            :null;
          const categoryIcon=item.grouped
            ?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>'
            :(categoryVisual&&categoryVisual.icon
              ?categoryVisual.icon
              :'<svg viewBox="0 0 24 24"><path d="M4 7.5h16v11H4z"/><path d="M7 7.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.5"/><path d="M9 13h6"/></svg>');
          return '<div class="monthly-category-card '+tone+'">'+
            '<div class="monthly-category-icon" aria-hidden="true">'+categoryIcon+'</div>'+
            '<span class="monthly-category-share">'+pct+'%</span>'+
            '<span class="monthly-category-name">'+escapeText(displayName)+'</span>'+
            '<strong class="monthly-category-value">'+escapeText(money(item.value))+'</strong>'+
          '</div>';
        }).join('');

        if(monthlyCategoriesToggleEl){
          const canToggle=categories.length>4;
          monthlyCategoriesToggleEl.hidden=!canToggle;
          const toggleLabel=expanded?'Свернуть категории':'Показать все категории';
          monthlyCategoriesToggleEl.setAttribute('aria-label',toggleLabel);
          monthlyCategoriesToggleEl.title=toggleLabel;
          monthlyCategoriesToggleEl.setAttribute('aria-expanded',expanded?'true':'false');
          monthlyCategoriesToggleEl.onclick=canToggle?()=>{
            catsEl.dataset.categoriesExpanded=expanded?'false':'true';
            render();
          }:null;
        }
      }else{
        const remainingCategories=categories.slice(1);
        const mobileExpanded=catsEl.dataset.categoriesExpanded==='true';
        const canToggle=remainingCategories.length>4;
        const visibleCategories=mobileExpanded?remainingCategories:remainingCategories.slice(0,4);

        catsEl.classList.toggle('is-collapsed',canToggle&&!mobileExpanded);
        catsEl.classList.toggle('is-expanded',canToggle&&mobileExpanded);
        catsEl.innerHTML=visibleCategories.map(([name,value],index)=>{
          const pct=total?Math.round(value/total*100):0;
          const tone=categoryTone(name,index+1);
          return '<div class="monthly-category-card '+tone+'">'+
            '<div class="monthly-category-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5h16v11H4z"/><path d="M7 7.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.5"/><path d="M9 13h6"/></svg></div>'+
            '<span class="monthly-category-share">'+pct+'%</span>'+
            '<span class="monthly-category-name" title="'+escapeText(name)+'">'+escapeText(name)+'</span>'+
            '<strong class="monthly-category-value">'+escapeText(money(value))+'</strong>'+
          '</div>';
        }).join('');

        if(monthlyCategoriesToggleEl){
          monthlyCategoriesToggleEl.hidden=!canToggle;
          const toggleLabel=mobileExpanded?'Свернуть категории':'Показать остальные категории';
          monthlyCategoriesToggleEl.setAttribute('aria-label',toggleLabel);
          monthlyCategoriesToggleEl.title=toggleLabel;
          monthlyCategoriesToggleEl.setAttribute('aria-expanded',mobileExpanded?'true':'false');
          monthlyCategoriesToggleEl.onclick=canToggle?()=>{
            catsEl.dataset.categoriesExpanded=mobileExpanded?'false':'true';
            render();
          }:null;
        }
      }
    }
  }

  function escapeText(value){
    return String(value==null?'':value).replace(/[&<>"']/g,ch=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[ch]);
  }

  function setMode(mode,save){
    const monthlyMode=mode==='month';
    root.classList.toggle('is-monthly',monthlyMode);
    monthly.hidden=!monthlyMode;
    yearBtn.classList.toggle('active',!monthlyMode);
    monthBtn.classList.toggle('active',monthlyMode);
    yearBtn.setAttribute('aria-selected',monthlyMode?'false':'true');
    monthBtn.setAttribute('aria-selected',monthlyMode?'true':'false');
    if(save!==false){
      try{localStorage.setItem(MODE_KEY,monthlyMode?'month':'year');}catch(e){}
    }
    if(monthlyMode)render();
  }

  root.addEventListener('click',event=>{
    const button=event.target.closest('.monthly-summary-info');
    if(!button)return;
    const expanded=button.getAttribute('aria-expanded')==='true';
    root.querySelectorAll('.monthly-summary-info').forEach(item=>{
      if(item!==button)item.setAttribute('aria-expanded','false');
    });
    button.setAttribute('aria-expanded',expanded?'false':'true');
  });

  yearBtn.addEventListener('click',()=>setMode('year',true));
  monthBtn.addEventListener('click',()=>setMode('month',true));

  let scheduled=false;
  function scheduleRender(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      render();
    });
  }

  ['monthSwitcherName','incomeChartYear','incomeTotal'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&window.MutationObserver){
      new MutationObserver(scheduleRender).observe(el,{childList:true,characterData:true,subtree:true});
    }
  });
  const list=document.getElementById('incomeList');
  if(list&&window.MutationObserver){
    new MutationObserver(scheduleRender).observe(list,{childList:true,subtree:true});
  }

  setMode('month',false);
  render();
})();