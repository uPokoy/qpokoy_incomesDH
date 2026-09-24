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

  function filterReport(mode){
    const period=readSelectedPeriod();
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

    filtered=filtered.map(function(item,index){
      return {
        index:index,
        date:String(item.date||''),
        amount:Number(item.amount)||0,
        category:String(item.category||'Без категории'),
        description:String(item.description||'')
      };
    }).sort(function(a,b){
      const ad=parseDate(a.date);
      const bd=parseDate(b.date);
      const diff=(bd?bd.getTime():0)-(ad?ad.getTime():0);
      return diff||a.index-b.index;
    });

    return {records:filtered,label:label};
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

  function reportDateRange(report,mode){
    const dates=report.records.map(function(item){return parseDate(item.date);}).filter(Boolean);
    if(mode==='month'){
      const period=readSelectedPeriod();
      const first=new Date(period.year,period.month,1);
      const last=new Date(period.year,period.month+1,0);
      return formatDate(first)+' — '+formatDate(last);
    }
    if(mode==='year'){
      const period=readSelectedPeriod();
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

  function buildReportHtml(report,mode){
    const records=report.records;
    const total=records.reduce(function(sum,item){return sum+item.amount;},0);
    const incomeDays=new Set(records.map(function(item){
      const date=parseDate(item.date);
      return date?formatDate(date):String(item.date||'');
    }).filter(Boolean)).size;
    const generated=formatDate(new Date());
    const range=reportDateRange(report,mode);
    const title='qPokoy — '+report.label;

    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(title)+'</title>'+
      '<style>'+
      '@page{size:A4;margin:13mm 12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:11px;line-height:1.35}'+
      'body{padding:22px;max-width:920px;margin:0 auto}.report-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:16px}.brand{font-size:18px;font-weight:800;letter-spacing:-.03em}.report-head h1{margin:2px 0 1px;font-size:17px;line-height:1.15}.period{font-size:11px;color:#374151}.report-meta{text-align:right;color:#6b7280;font-size:9px;line-height:1.55;white-space:nowrap}.summary{display:grid;grid-template-columns:1.45fr .8fr .8fr;margin:0 0 16px;background:#f5f7fa;border:1px solid #edf0f3;border-radius:9px;overflow:hidden}.metric{min-height:64px;padding:11px 14px;display:flex;flex-direction:column;justify-content:center}.metric+.metric{border-left:1px solid #dde2e8}.metric strong{font-size:19px;line-height:1;font-weight:750;letter-spacing:-.02em}.metric:not(:first-child) strong{font-size:17px}.metric span{margin-top:4px;color:#6b7280;font-size:9px}.income-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}thead{display:table-header-group}th{background:#f3f4f6;color:#4b5563;font-size:9px;font-weight:650;text-align:left}th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top}tbody tr:last-child td{border-bottom:0}.date{width:18%;white-space:nowrap}.category{width:22%}.description{width:40%;word-break:break-word}.number{width:20%;text-align:right;white-space:nowrap;font-weight:650}.total-row td{background:#f8fafc;font-weight:750;border-top:1px solid #dbe1e7}.total-row .number{font-size:12px}.report-actions{position:fixed;right:20px;bottom:20px}.report-actions button{padding:10px 14px;border:0;border-radius:9px;background:#2563eb;color:#fff;font:600 12px inherit;cursor:pointer;box-shadow:0 8px 24px rgba(37,99,235,.22)}tr{break-inside:avoid;page-break-inside:avoid}@media print{body{padding:0;max-width:none}.report-actions{display:none}.summary{break-inside:avoid;page-break-inside:avoid}.income-table{border-radius:6px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body>'+
      '<header class="report-head"><div><div class="brand">qPokoy</div><h1>Отчёт о доходах</h1><div class="period">'+escapeHtml(report.label)+'</div></div><div class="report-meta">'+escapeHtml(range)+'<br>Сформировано '+escapeHtml(generated)+'</div></header>'+
      '<section class="summary"><div class="metric"><strong>'+escapeHtml(money(total))+'</strong><span>Общий доход</span></div><div class="metric"><strong>'+records.length+'</strong><span>доходов</span></div><div class="metric"><strong>'+incomeDays+'</strong><span>дней с доходом</span></div></section>'+
      '<table class="income-table"><thead><tr><th class="date">Дата</th><th class="category">Категория</th><th class="description">Описание</th><th class="number">Сумма</th></tr></thead><tbody>'+
      incomeRows(records)+
      '<tr class="total-row"><td colspan="3" class="number">Итого</td><td class="number">'+escapeHtml(money(total))+'</td></tr>'+
      '</tbody></table>'+
      '<div class="report-actions"><button type="button" onclick="window.print()">Печать / PDF</button></div>'+
      '</body></html>';
  }

  function printReport(){
    const mode=document.getElementById('printReportPeriod')?.value||'month';
    const report=filterReport(mode);
    if(!report.records.length){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Нет данных','За выбранный период доходов нет.','error');
      return;
    }

    const popup=window.open('','_blank');
    if(!popup){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Печать заблокирована','Разрешите всплывающие окна для qPokoy и повторите.','error');
      return;
    }

    popup.document.open();
    popup.document.write(buildReportHtml(report,mode));
    popup.document.close();
    popup.focus();
    setTimeout(function(){
      try{popup.print();}catch(e){}
    },250);
  }

  function bind(){
    const button=document.getElementById('printIncomeReportBtn');
    if(!button||button.__qPokoyReportPrint)return;
    button.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      printReport();
    });
    button.__qPokoyReportPrint=true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
