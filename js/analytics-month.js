(function(){
  const root=document.getElementById('incomeAnalytics');
  const monthly=document.getElementById('monthlyAnalytics');
  const yearBtn=document.getElementById('analyticsModeYear');
  const monthBtn=document.getElementById('analyticsModeMonth');
  if(!root||!monthly||!yearBtn||!monthBtn)return;

  const MODE_KEY='incomeAnalyticsMode';
  const monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const monthPrep=['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];

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
    const bestAmountEl=document.getElementById('monthlyBestAmount');
    const averageEl=document.getElementById('monthlyAverageDay');
    const averageNoteEl=document.getElementById('monthlyAverageDayNote');
    const growthEl=document.getElementById('monthlyGrowthValue');
    const growthNoteEl=document.getElementById('monthlyGrowthNote');
    const growthCard=document.getElementById('monthlyGrowthCard');
    const yearGrowthEl=document.getElementById('monthlyYearGrowthValue');
    const yearGrowthNoteEl=document.getElementById('monthlyYearGrowthNote');
    const yearGrowthCard=document.getElementById('monthlyYearGrowthCard');
    const catsEl=document.getElementById('monthlyAnalyticsCategories');

    if(titleEl)titleEl.textContent=monthNames[period.month];
    if(periodEl)periodEl.textContent=String(period.year);
    if(totalEl)totalEl.textContent=money(total);

    const best=categories[0]||null;
    if(bestCategoryEl)bestCategoryEl.textContent=best?best[0]:'Нет данных';
    if(bestAmountEl)bestAmountEl.textContent=best?money(best[1]):'0 ₽';

    const daysInMonth=new Date(period.year,period.month+1,0).getDate();
    const average=daysInMonth?total/daysInMonth:0;
    if(averageEl)averageEl.textContent=money(average);
    if(averageNoteEl)averageNoteEl.textContent='Учитывается '+daysInMonth+' '+(daysInMonth===31?'день':'дней')+' в '+monthPrep[period.month]+' '+period.year;

    let prevMonth=period.month-1;
    let prevYear=period.year;
    if(prevMonth<0){prevMonth=11;prevYear--;}
    const previousTotal=monthTotal(data,prevMonth,prevYear);
    const difference=total-previousTotal;
    const growth=previousTotal>0?(difference/previousTotal*100):null;

    if(growthCard){
      growthCard.classList.remove('positive','negative','neutral');
      growthCard.classList.add(growth===null||growth===0?'neutral':growth>0?'positive':'negative');
    }
    if(growthEl){
      growthEl.textContent=growth===null?'—':(growth>=0?'+':'')+growth.toFixed(1)+'%';
    }
    if(growthNoteEl){
      if(previousTotal<=0){
        growthNoteEl.textContent='Нет данных за '+monthNames[prevMonth].toLowerCase()+' '+prevYear;
      }else if(difference>0){
        growthNoteEl.textContent='На '+money(Math.abs(difference))+' больше, чем в '+monthPrep[prevMonth]+' '+prevYear;
      }else if(difference<0){
        growthNoteEl.textContent='На '+money(Math.abs(difference))+' меньше, чем в '+monthPrep[prevMonth]+' '+prevYear;
      }else{
        growthNoteEl.textContent='Без изменений по сравнению с '+monthPrep[prevMonth]+' '+prevYear;
      }
    }

    const lastYear=period.year-1;
    const lastYearTotal=monthTotal(data,period.month,lastYear);
    const yearDifference=total-lastYearTotal;
    const yearGrowth=lastYearTotal>0?(yearDifference/lastYearTotal*100):null;

    if(yearGrowthCard){
      yearGrowthCard.classList.remove('positive','negative','neutral');
      yearGrowthCard.classList.add(yearGrowth===null||yearGrowth===0?'neutral':yearGrowth>0?'positive':'negative');
    }
    if(yearGrowthEl){
      yearGrowthEl.textContent=yearGrowth===null?'—':(yearGrowth>=0?'+':'')+yearGrowth.toFixed(1)+'%';
    }
    if(yearGrowthNoteEl){
      if(lastYearTotal<=0){
        yearGrowthNoteEl.textContent='Нет данных за '+monthPrep[period.month]+' '+lastYear;
      }else if(yearDifference>0){
        yearGrowthNoteEl.textContent='На '+money(Math.abs(yearDifference))+' больше, чем в '+monthPrep[period.month]+' '+lastYear;
      }else if(yearDifference<0){
        yearGrowthNoteEl.textContent='На '+money(Math.abs(yearDifference))+' меньше, чем в '+monthPrep[period.month]+' '+lastYear;
      }else{
        yearGrowthNoteEl.textContent='Без изменений по сравнению с '+monthPrep[period.month]+' '+lastYear;
      }
    }

    if(catsEl){
      if(!categories.length){
        catsEl.innerHTML='<div class="monthly-analytics-empty">Нет доходов за выбранный месяц</div>';
      }else{
        catsEl.innerHTML=categories.map(([name,value],index)=>{
          const pct=total?Math.round(value/total*100):0;
          const tone=categoryTone(name,index);
          return '<div class="monthly-category-card '+tone+'">'+
            '<div class="monthly-category-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5h16v11H4z"/><path d="M7 7.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.5"/><path d="M9 13h6"/></svg></div>'+
            '<span class="monthly-category-share">'+pct+'%</span>'+
            '<span class="monthly-category-name">'+escapeText(name)+'</span>'+
            '<strong class="monthly-category-value">'+escapeText(money(value))+'</strong>'+
          '</div>';
        }).join('');
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

  const saved=(()=>{try{return localStorage.getItem(MODE_KEY);}catch(e){return null;}})();
  setMode(saved==='month'?'month':'year',false);
  render();
})();