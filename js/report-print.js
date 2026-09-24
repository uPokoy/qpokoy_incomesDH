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

  function dateInputValue(date){
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }

  function parseInputDate(value){
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)return null;
    const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
    return Number.isNaN(date.getTime())?null:date;
  }

  function currentMonthPeriod(){
    const now=new Date();
    return {month:now.getMonth(),year:now.getFullYear()};
  }

  function previousMonthPeriod(){
    const now=new Date();
    const date=new Date(now.getFullYear(),now.getMonth()-1,1);
    return {month:date.getMonth(),year:date.getFullYear()};
  }

  function normalizeCategory(item){
    const value=String(item&&item.category||'').trim();
    return value||'Без категории';
  }

  function filterReport(mode,options){
    options=options||{};
    const period=options.period||readSelectedPeriod();
    const range=options.range||null;
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
    }else if(mode==='range'&&range&&range.from&&range.to){
      const from=new Date(range.from.getFullYear(),range.from.getMonth(),range.from.getDate(),0,0,0,0);
      const to=new Date(range.to.getFullYear(),range.to.getMonth(),range.to.getDate(),23,59,59,999);
      label=formatDate(from)+' — '+formatDate(to);
      filtered=records.filter(function(item){
        const date=parseDate(item.date);
        return date&&date>=from&&date<=to;
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

    return {records:filtered,label:label,period:period,range:range};
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

  function reportDateRange(report,mode,period,range){
    const dates=report.records.map(function(item){return parseDate(item.date);}).filter(Boolean);
    period=period||report.period||readSelectedPeriod();
    range=range||report.range||null;
    if(mode==='month'){
      const first=new Date(period.year,period.month,1);
      const last=new Date(period.year,period.month+1,0);
      return formatDate(first)+' — '+formatDate(last);
    }
    if(mode==='year'){
      return '01.01.'+period.year+' — 31.12.'+period.year;
    }
    if(mode==='range'&&range&&range.from&&range.to){
      return formatDate(range.from)+' — '+formatDate(range.to);
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

  function buildReportHtml(report,mode,period,range){
    const records=report.records;
    const total=records.reduce(function(sum,item){return sum+item.amount;},0);
    const incomeDays=new Set(records.map(function(item){
      const date=parseDate(item.date);
      return date?formatDate(date):String(item.date||'');
    }).filter(Boolean)).size;
    const generated=formatDate(new Date());
    const rangeText=reportDateRange(report,mode,period,range);
    const title='qPokoy — '+report.label;
    const pdfFileName=('Доходы '+report.label).replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim()+'.pdf';

    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(title)+'</title>'+
      '<style>'+
      '@page{size:A4;margin:13mm 12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:13px;line-height:1.4}'+
      'body{padding:22px;margin:0;background:#fff}.report-document{max-width:920px;margin:0 auto}.report-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:18px}.period{font-size:20px;font-weight:750;line-height:1.15;color:#111827}.report-meta{text-align:right;color:#6b7280;font-size:11px;line-height:1.5;white-space:nowrap}.summary{display:grid;grid-template-columns:1.45fr .8fr .8fr;margin:0 0 18px;background:#f5f7fa;border:1px solid #edf0f3;border-radius:9px;overflow:hidden}.metric{min-height:70px;padding:12px 15px;display:flex;flex-direction:column;justify-content:center}.metric+.metric{border-left:1px solid #dde2e8}.metric span{margin:0 0 6px;color:#6b7280;font-size:11px}.metric strong{font-size:23px;line-height:1;font-weight:750;letter-spacing:-.02em}.metric:not(:first-child) strong{font-size:20px}.income-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e3e8ee;border-radius:8px;overflow:hidden}thead{display:table-header-group}th{background:#f3f4f6;color:#4b5563;font-size:11px;font-weight:650;text-align:left}th,td{padding:8px 9px;border-right:1px solid #edf0f3;border-bottom:1px solid #e7ebf0;vertical-align:top}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}.date{width:18%;white-space:nowrap}.category{width:22%}.description{width:40%;word-break:break-word}.number{width:20%;text-align:right;white-space:nowrap;font-weight:650}.total-row td{background:#f8fafc;font-weight:750;border-top:1px solid #e1e6ec}.total-row .total-inline{text-align:right;white-space:nowrap;font-size:14px}.total-row .total-inline span{margin-right:8px}.total-row .total-inline strong{font-size:14px}.report-actions{position:fixed;right:max(20px,calc((100vw - 920px)/2));bottom:20px;z-index:20;display:flex;align-items:center;justify-content:flex-end;gap:8px}.report-document{padding-bottom:64px}.report-actions button{padding:11px 15px;border-radius:9px;font:600 13px inherit;cursor:pointer}.report-print-btn{border:1px solid #d7dde5;background:#fff;color:#374151;box-shadow:0 4px 14px rgba(15,23,42,.08)}.report-save-btn{border:0;background:#2563eb;color:#fff;box-shadow:0 5px 16px rgba(37,99,235,.18)}.report-save-btn:disabled{opacity:.6;cursor:wait}tr{break-inside:avoid;page-break-inside:avoid}@media print{body{padding:0}.report-document{max-width:none}.report-actions{display:none}.summary{break-inside:avoid;page-break-inside:avoid}.income-table{border-radius:6px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body>'+
      '<main class="report-document" id="reportDocument">'+
      '<header class="report-head"><div><div class="period">'+escapeHtml(report.label)+'</div></div><div class="report-meta">Сформировано '+escapeHtml(generated)+'<br>'+escapeHtml(rangeText)+'</div></header>'+
      '<section class="summary"><div class="metric"><span>Общий доход</span><strong>'+escapeHtml(money(total))+'</strong></div><div class="metric"><span>Доходов</span><strong>'+records.length+'</strong></div><div class="metric"><span>Дней с доходом</span><strong>'+incomeDays+'</strong></div></section>'+
      '<table class="income-table"><thead><tr><th class="date">Дата</th><th class="category">Категория</th><th class="description">Описание</th><th class="number">Сумма</th></tr></thead><tbody>'+
      incomeRows(records)+
      '<tr class="total-row"><td colspan="4" class="total-inline"><span>Итого:</span><strong>'+escapeHtml(money(total))+'</strong></td></tr>'+
      '</tbody></table>'+
      '</main>'+
      '<div class="report-actions"><button type="button" class="report-print-btn" onclick="window.print()">Печать</button><button type="button" class="report-save-btn" id="saveReportPdfBtn" onclick="saveReportPdf()">Сохранить PDF</button></div>'+
      '<script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"><\/script>'+
      '<script>'+
      'const qPokoyPdfFileName='+JSON.stringify(pdfFileName)+';'+
      'function saveReportPdf(){'+
        'const button=document.getElementById("saveReportPdfBtn");'+
        'if(!window.html2pdf){alert("Модуль сохранения PDF ещё загружается. Повторите через секунду.");return;}'+
        'button.disabled=true;button.textContent="Сохранение…";'+
        'const source=document.getElementById("reportDocument");'+
        'const options={margin:[13,12,13,12],filename:qPokoyPdfFileName,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff",logging:false},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"],avoid:["tr",".summary"]}};'+
        'html2pdf().set(options).from(source).save().then(function(){button.disabled=false;button.textContent="Сохранить PDF";}).catch(function(){button.disabled=false;button.textContent="Сохранить PDF";alert("Не удалось сохранить PDF. Используйте кнопку «Печать».");});'+
      '}'+
      '<\/script>'+
      '</body></html>';
  }

  function printReport(config){
    config=config||{};
    const mode=config.mode||document.getElementById(config.periodSelectId||'printReportPeriod')?.value||'month';
    const period=config.period||readSelectedPeriod();
    const range=config.range||null;
    const report=filterReport(mode,{period:period,range:range,categories:config.categories});
    if(!report.records.length){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Нет данных','Для выбранного периода и категорий доходов нет.','error');
      return;
    }

    const popup=window.open('','_blank');
    if(!popup){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Печать заблокирована','Разрешите всплывающие окна для qPokoy и повторите.','error');
      return;
    }

    popup.document.open();
    popup.document.write(buildReportHtml(report,mode,period,range));
    popup.document.close();
    popup.focus();
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

  function pickerPresetConfig(preset,overlay){
    const now=new Date();
    if(preset==='current-month')return {mode:'month',period:currentMonthPeriod()};
    if(preset==='previous-month')return {mode:'month',period:previousMonthPeriod()};
    if(preset==='current-year')return {mode:'year',period:{month:0,year:now.getFullYear()}};
    if(preset==='previous-year')return {mode:'year',period:{month:0,year:now.getFullYear()-1}};
    if(preset==='all')return {mode:'all',period:readSelectedPeriod()};
    if(preset==='custom'){
      const from=parseInputDate(overlay.querySelector('#incomeReportDateFrom').value);
      const to=parseInputDate(overlay.querySelector('#incomeReportDateTo').value);
      return {mode:'range',period:readSelectedPeriod(),range:{from:from,to:to}};
    }
    return {mode:'month',period:currentMonthPeriod()};
  }

  function setPickerPreset(overlay,preset){
    overlay.dataset.reportPreset=preset;
    overlay.querySelectorAll('.income-report-preset-btn').forEach(function(button){
      button.classList.toggle('active',button.dataset.reportPreset===preset);
    });
    overlay.querySelector('.income-report-custom-range').hidden=preset!=='custom';
    updatePickerSubmitState(overlay);
  }

  function ensureHistoryPicker(){
    let overlay=document.getElementById('incomeReportPicker');
    if(overlay)return overlay;

    overlay=document.createElement('div');
    overlay.id='incomeReportPicker';
    overlay.className='income-report-picker';
    overlay.hidden=true;
    overlay.innerHTML=
      '<div class="income-report-picker-card" role="dialog" aria-modal="true" aria-label="Настройки печати отчёта">'+
        '<div class="income-report-picker-head">'+
          '<button type="button" class="income-report-picker-close" aria-label="Закрыть">×</button>'+
        '</div>'+
        '<div class="income-report-preset-grid">'+
          '<button type="button" class="income-report-preset-btn" data-report-preset="current-month">Текущий месяц</button>'+
          '<button type="button" class="income-report-preset-btn" data-report-preset="previous-month">Прошлый месяц</button>'+
          '<button type="button" class="income-report-preset-btn" data-report-preset="current-year">Текущий год</button>'+
          '<button type="button" class="income-report-preset-btn" data-report-preset="previous-year">Прошлый год</button>'+
          '<button type="button" class="income-report-preset-btn" data-report-preset="all">Всё время</button>'+
          '<button type="button" class="income-report-preset-btn" data-report-preset="custom">Свой диапазон</button>'+
        '</div>'+
        '<div class="income-report-custom-range" hidden>'+
          '<label><span>С</span><input type="date" id="incomeReportDateFrom"></label>'+
          '<label><span>По</span><input type="date" id="incomeReportDateTo"></label>'+
        '</div>'+
        '<div class="income-report-picker-section-title income-report-category-title">Категории</div>'+
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

    function close(){
      overlay.hidden=true;
      document.body.classList.remove('income-report-picker-open');
    }

    overlay.querySelector('.income-report-picker-close').addEventListener('click',close);
    overlay.querySelector('.income-report-picker-cancel').addEventListener('click',close);
    overlay.addEventListener('click',function(event){
      if(event.target===overlay)close();
    });

    overlay.querySelector('.income-report-preset-grid').addEventListener('click',function(event){
      const button=event.target.closest('.income-report-preset-btn');
      if(!button)return;
      setPickerPreset(overlay,button.dataset.reportPreset);
    });

    overlay.querySelectorAll('.income-report-custom-range input').forEach(function(input){
      input.addEventListener('change',function(){updatePickerSubmitState(overlay);});
      input.addEventListener('input',function(){updatePickerSubmitState(overlay);});
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

      const preset=overlay.dataset.reportPreset||'current-month';
      const config=pickerPresetConfig(preset,overlay);
      if(config.mode==='range'){
        if(!config.range.from||!config.range.to||config.range.from>config.range.to)return;
      }

      close();
      printReport({
        mode:config.mode,
        period:config.period,
        range:config.range||null,
        categories:categories
      });
    });

    document.addEventListener('keydown',function(event){
      if(event.key==='Escape'&&!overlay.hidden)close();
    });

    return overlay;
  }

  function updatePickerSubmitState(overlay){
    const submit=overlay.querySelector('.income-report-picker-submit');
    const hasCategory=!!overlay.querySelector('.income-report-picker-category-list input[type="checkbox"]:checked');
    const preset=overlay.dataset.reportPreset||'current-month';
    let validPeriod=true;

    if(preset==='custom'){
      const from=parseInputDate(overlay.querySelector('#incomeReportDateFrom').value);
      const to=parseInputDate(overlay.querySelector('#incomeReportDateTo').value);
      validPeriod=!!from&&!!to&&from<=to;
    }

    submit.disabled=!hasCategory||!validPeriod;
  }

  function openHistoryPicker(){
    const overlay=ensureHistoryPicker();
    const selected=readSelectedPeriod();
    const first=new Date(selected.year,selected.month,1);
    const last=new Date(selected.year,selected.month+1,0);
    const categoryList=overlay.querySelector('#incomeReportCategoryList');

    overlay.querySelector('#incomeReportDateFrom').value=dateInputValue(first);
    overlay.querySelector('#incomeReportDateTo').value=dateInputValue(last);

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
    setPickerPreset(overlay,'current-month');
    updatePickerSubmitState(overlay);
    overlay.hidden=false;
    document.body.classList.add('income-report-picker-open');
    overlay.querySelector('.income-report-preset-btn.active')?.focus();
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
