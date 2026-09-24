(function qPokoyReportPrintInit(){
  'use strict';

  const monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function money(value){
    return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value)||0)+' ₽';
  }

  function parseDate(value){
    const text=String(value||'').trim();
    let match=text.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(match){
      let year=Number(match[3]);
      if(year<100)year+=2000;
      const date=new Date(year,Number(match[2])-1,Number(match[1]));
      return Number.isNaN(date.getTime())?null:date;
    }
    match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(match){
      const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
      return Number.isNaN(date.getTime())?null:date;
    }
    return null;
  }

  function readRecords(){
    try{
      if(window.IncomeStore&&typeof window.IncomeStore.load==='function'){
        const rows=window.IncomeStore.load();
        if(Array.isArray(rows))return rows.slice();
      }
    }catch(e){}
    try{
      const rows=JSON.parse(localStorage.getItem('incomes')||'[]');
      return Array.isArray(rows)?rows:[];
    }catch(e){
      return [];
    }
  }

  function readSelectedPeriod(){
    try{
      const saved=JSON.parse(localStorage.getItem('incomeSelectedPeriod')||'null');
      if(saved&&Number.isInteger(saved.month)&&saved.month>=0&&saved.month<12&&Number.isInteger(saved.year)){
        return {month:saved.month,year:saved.year};
      }
    }catch(e){}
    const now=new Date();
    return {month:now.getMonth(),year:now.getFullYear()};
  }

  function normalizeCategory(item){
    const value=String(item&&item.category||'').trim();
    return value||'Без категории';
  }

  function filterReport(mode,options){
    options=options||{};
    const period=options.period||readSelectedPeriod();
    const hasCategoryFilter=Array.isArray(options.categories);
    const selectedCategories=hasCategoryFilter?new Set(options.categories.map(String)):null;
    const records=readRecords().filter(function(item){
      return item&&Number.isFinite(Number(item.amount));
    });
    let label='Все доходы';
    let filtered=records;

    if(mode==='month'){
      label=monthNames[period.month]+' '+period.year;
      filtered=records.filter(function(item){
        const date=parseDate(item.date);
        return date&&date.getMonth()===period.month&&date.getFullYear()===period.year;
      });
    }else if(mode==='year'){
      label=String(period.year);
      filtered=records.filter(function(item){
        const date=parseDate(item.date);
        return date&&date.getFullYear()===period.year;
      });
    }

    if(selectedCategories){
      filtered=filtered.filter(function(item){
        return selectedCategories.has(normalizeCategory(item));
      });
    }

    filtered=filtered.map(function(item,index){
      return {
        index:index,
        date:String(item.date||''),
        amount:Number(item.amount)||0,
        category:normalizeCategory(item),
        description:String(item.description||'')
      };
    }).sort(function(a,b){
      const ad=parseDate(a.date);
      const bd=parseDate(b.date);
      const diff=(bd?bd.getTime():0)-(ad?ad.getTime():0);
      return diff||a.index-b.index;
    });

    return {records:filtered,label:label,period:period};
  }

  function categoryRows(records,total){
    const map=new Map();
    records.forEach(function(item){
      map.set(item.category,(map.get(item.category)||0)+item.amount);
    });
    return Array.from(map.entries()).sort(function(a,b){return b[1]-a[1];}).map(function(entry){
      const share=total>0?Math.round(entry[1]/total*100):0;
      return '<tr><td>'+escapeHtml(entry[0])+'</td><td class="number">'+escapeHtml(money(entry[1]))+'</td><td class="number">'+share+'%</td></tr>';
    }).join('');
  }

  function incomeRows(records){
    return records.map(function(item){
      return '<tr>'+
        '<td>'+escapeHtml(item.date)+'</td>'+
        '<td>'+escapeHtml(item.category)+'</td>'+
        '<td class="description">'+escapeHtml(item.description||'—')+'</td>'+
        '<td class="number">'+escapeHtml(money(item.amount))+'</td>'+
      '</tr>';
    }).join('');
  }

  function reportDateRange(report,mode,period){
    const dates=report.records.map(function(item){return parseDate(item.date);}).filter(Boolean);
    period=period||report.period||readSelectedPeriod();
    if(mode==='month'){
      const first=new Date(period.year,period.month,1);
      const last=new Date(period.year,period.month+1,0);
      return formatDate(first)+' — '+formatDate(last);
    }
    if(mode==='year'){
      return '01.01.'+period.year+' — 31.12.'+period.year;
    }
    if(!dates.length)return '';
    dates.sort(function(a,b){return a-b;});
    return formatDate(dates[0])+' — '+formatDate(dates[dates.length-1]);
  }

  function formatDate(date){
    return String(date.getDate()).padStart(2,'0')+'.'+
      String(date.getMonth()+1).padStart(2,'0')+'.'+
      date.getFullYear();
  }

  function buildReportHtml(report,mode,period){
    const records=report.records;
    const total=records.reduce(function(sum,item){return sum+item.amount;},0);
    const incomeDays=new Set(records.map(function(item){
      const date=parseDate(item.date);
      return date?formatDate(date):String(item.date||'');
    }).filter(Boolean)).size;
    const generated=formatDate(new Date());
    const range=reportDateRange(report,mode,period);
    const title='qPokoy — '+report.label;

    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(title)+'</title>'+
      '<style>'+
      '@page{size:A4;margin:13mm 12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:13px;line-height:1.4}'+
      'body{padding:22px;max-width:920px;margin:0 auto}.report-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:18px}.report-head h1{margin:0 0 4px;font-size:13px;font-weight:600;line-height:1.2;color:#374151}.period{font-size:20px;font-weight:750;line-height:1.15;color:#111827}.report-meta{text-align:right;color:#6b7280;font-size:11px;line-height:1.5;white-space:nowrap}.summary{display:grid;grid-template-columns:1.45fr .8fr .8fr;margin:0 0 18px;background:#f5f7fa;border:1px solid #edf0f3;border-radius:9px;overflow:hidden}.metric{min-height:70px;padding:12px 15px;display:flex;flex-direction:column;justify-content:center}.metric+.metric{border-left:1px solid #dde2e8}.metric span{margin:0 0 6px;color:#6b7280;font-size:11px}.metric strong{font-size:23px;line-height:1;font-weight:750;letter-spacing:-.02em}.metric:not(:first-child) strong{font-size:20px}.income-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}thead{display:table-header-group}th{background:#f3f4f6;color:#4b5563;font-size:11px;font-weight:650;text-align:left}th,td{padding:8px 9px;border-bottom:1px solid #e5e7eb;vertical-align:top}tbody tr:last-child td{border-bottom:0}.date{width:18%;white-space:nowrap}.category{width:22%}.description{width:40%;word-break:break-word}.number{width:20%;text-align:right;white-space:nowrap;font-weight:650}.total-row td{background:#f8fafc;font-weight:750;border-top:1px solid #dbe1e7}.total-row .total-inline{text-align:right;white-space:nowrap;font-size:14px}.total-row .total-inline span{margin-right:8px}.total-row .total-inline strong{font-size:14px}.report-actions{position:fixed;right:20px;bottom:20px}.report-actions button{padding:11px 15px;border:0;border-radius:9px;background:#2563eb;color:#fff;font:600 13px inherit;cursor:pointer;box-shadow:0 8px 24px rgba(37,99,235,.22)}tr{break-inside:avoid;page-break-inside:avoid}@media print{body{padding:0;max-width:none}.report-actions{display:none}.summary{break-inside:avoid;page-break-inside:avoid}.income-table{border-radius:6px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body>'+
      '<header class="report-head"><div><h1>Отчёт о доходах</h1><div class="period">'+escapeHtml(report.label)+'</div></div><div class="report-meta">Сформировано '+escapeHtml(generated)+'<br>'+escapeHtml(range)+'</div></header>'+
      '<section class="summary"><div class="metric"><span>Общий доход</span><strong>'+escapeHtml(money(total))+'</strong></div><div class="metric"><span>Доходов</span><strong>'+records.length+'</strong></div><div class="metric"><span>Дней с доходом</span><strong>'+incomeDays+'</strong></div></section>'+
      '<table class="income-table"><thead><tr><th class="date">Дата</th><th class="category">Категория</th><th class="description">Описание</th><th class="number">Сумма</th></tr></thead><tbody>'+
      incomeRows(records)+
      '<tr class="total-row"><td colspan="4" class="total-inline"><span>Итого:</span><strong>'+escapeHtml(money(total))+'</strong></td></tr>'+
      '</tbody></table>'+
      '<div class="report-actions"><button type="button" onclick="window.print()">Печать / PDF</button></div>'+
      '</body></html>';
  }

  function printReport(config){
    config=config||{};
    const mode=config.mode||document.getElementById(config.periodSelectId||'printReportPeriod')?.value||'month';
    const period=config.period||readSelectedPeriod();
    const report=filterReport(mode,{period:period,categories:config.categories});
    if(!report.records.length){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Нет данных','Для выбранного месяца и категорий доходов нет.','error');
      return;
    }

    const popup=window.open('','_blank');
    if(!popup){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Печать заблокирована','Разрешите всплывающие окна для qPokoy и повторите.','error');
      return;
    }

    popup.document.open();
    popup.document.write(buildReportHtml(report,mode,period));
    popup.document.close();
    popup.focus();
    setTimeout(function(){
      try{popup.print();}catch(e){}
    },250);
  }

  function reportYears(){
    const years=new Set();
    readRecords().forEach(function(item){
      const date=parseDate(item&&item.date);
      if(date)years.add(date.getFullYear());
    });
    years.add(readSelectedPeriod().year);
    return Array.from(years).sort(function(a,b){return b-a;});
  }

  function reportCategories(){
    return Array.from(new Set(readRecords().map(normalizeCategory))).sort(function(a,b){
      return a.localeCompare(b,'ru');
    });
  }

  function ensureHistoryPicker(){
    let overlay=document.getElementById('incomeReportPicker');
    if(overlay)return overlay;

    overlay=document.createElement('div');
    overlay.id='incomeReportPicker';
    overlay.className='income-report-picker';
    overlay.hidden=true;
    overlay.innerHTML=
      '<div class="income-report-picker-card" role="dialog" aria-modal="true" aria-labelledby="incomeReportPickerTitle">'+
        '<div class="income-report-picker-head">'+
          '<div><strong id="incomeReportPickerTitle">Печать отчёта</strong><span>Выберите период и категории</span></div>'+
          '<button type="button" class="income-report-picker-close" aria-label="Закрыть">×</button>'+
        '</div>'+
        '<div class="income-report-picker-period">'+
          '<label><span>Месяц</span><select id="incomeReportMonth"></select></label>'+
          '<label><span>Год</span><select id="incomeReportYear"></select></label>'+
        '</div>'+
        '<div class="income-report-picker-categories">'+
          '<label class="income-report-picker-all"><input type="checkbox" id="incomeReportAllCategories" checked><span>Все категории</span></label>'+
          '<div class="income-report-picker-category-list" id="incomeReportCategoryList"></div>'+
        '</div>'+
        '<div class="income-report-picker-actions">'+
          '<button type="button" class="income-report-picker-cancel">Отмена</button>'+
          '<button type="button" class="income-report-picker-submit">Печать / PDF</button>'+
        '</div>'+
      '</div>';

    document.body.appendChild(overlay);

    const monthSelect=overlay.querySelector('#incomeReportMonth');
    monthNames.forEach(function(name,index){
      const option=document.createElement('option');
      option.value=String(index);
      option.textContent=name;
      monthSelect.appendChild(option);
    });

    function close(){
      overlay.hidden=true;
      document.body.classList.remove('income-report-picker-open');
    }

    overlay.querySelector('.income-report-picker-close').addEventListener('click',close);
    overlay.querySelector('.income-report-picker-cancel').addEventListener('click',close);
    overlay.addEventListener('click',function(event){
      if(event.target===overlay)close();
    });

    overlay.querySelector('#incomeReportAllCategories').addEventListener('change',function(event){
      const checked=event.target.checked;
      overlay.querySelectorAll('.income-report-picker-category-list input[type="checkbox"]').forEach(function(input){
        input.checked=checked;
      });
      updatePickerSubmitState(overlay);
    });

    overlay.querySelector('#incomeReportCategoryList').addEventListener('change',function(event){
      if(!event.target.matches('input[type="checkbox"]'))return;
      const inputs=Array.from(overlay.querySelectorAll('.income-report-picker-category-list input[type="checkbox"]'));
      overlay.querySelector('#incomeReportAllCategories').checked=inputs.length>0&&inputs.every(function(input){return input.checked;});
      updatePickerSubmitState(overlay);
    });

    overlay.querySelector('.income-report-picker-submit').addEventListener('click',function(){
      const categories=Array.from(overlay.querySelectorAll('.income-report-picker-category-list input[type="checkbox"]:checked')).map(function(input){
        return input.value;
      });
      if(!categories.length)return;
      const period={
        month:Number(overlay.querySelector('#incomeReportMonth').value),
        year:Number(overlay.querySelector('#incomeReportYear').value)
      };
      close();
      printReport({mode:'month',period:period,categories:categories});
    });

    document.addEventListener('keydown',function(event){
      if(event.key==='Escape'&&!overlay.hidden)close();
    });

    return overlay;
  }

  function updatePickerSubmitState(overlay){
    const any=!!overlay.querySelector('.income-report-picker-category-list input[type="checkbox"]:checked');
    overlay.querySelector('.income-report-picker-submit').disabled=!any;
  }

  function openHistoryPicker(){
    const overlay=ensureHistoryPicker();
    const period=readSelectedPeriod();
    const yearSelect=overlay.querySelector('#incomeReportYear');
    const categoryList=overlay.querySelector('#incomeReportCategoryList');

    yearSelect.innerHTML='';
    reportYears().forEach(function(year){
      const option=document.createElement('option');
      option.value=String(year);
      option.textContent=String(year);
      yearSelect.appendChild(option);
    });

    if(!Array.from(yearSelect.options).some(function(option){return Number(option.value)===period.year;})){
      const option=document.createElement('option');
      option.value=String(period.year);
      option.textContent=String(period.year);
      yearSelect.prepend(option);
    }

    overlay.querySelector('#incomeReportMonth').value=String(period.month);
    yearSelect.value=String(period.year);

    categoryList.innerHTML='';
    reportCategories().forEach(function(category){
      const label=document.createElement('label');
      label.className='income-report-picker-category';
      const input=document.createElement('input');
      input.type='checkbox';
      input.value=category;
      input.checked=true;
      const text=document.createElement('span');
      text.textContent=category;
      label.appendChild(input);
      label.appendChild(text);
      categoryList.appendChild(label);
    });

    overlay.querySelector('#incomeReportAllCategories').checked=true;
    updatePickerSubmitState(overlay);
    overlay.hidden=false;
    document.body.classList.add('income-report-picker-open');
    overlay.querySelector('#incomeReportMonth').focus();
  }

  function bindReportButton(buttonId,handler){
    const button=document.getElementById(buttonId);
    if(!button||button.__qPokoyReportPrint)return;
    button.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      handler();
    });
    button.__qPokoyReportPrint=true;
  }

  function bind(){
    bindReportButton('printIncomeReportBtn',function(){
      printReport({periodSelectId:'printReportPeriod'});
    });
    bindReportButton('printIncomeHistoryReportBtn',openHistoryPicker);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
