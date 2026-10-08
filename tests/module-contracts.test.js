'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApiClient,ApiError}=require('../js/api-client');
const {createHarness}=require('./helpers/frontend-harness');

function methods(object,names){
  for(const name of names)assert.equal(typeof object[name],'function',name);
}

test('public API client retains transport, auth, CRUD, billing and admin methods',()=>{
  const api=createApiClient({storage:{getItem:()=>null}});
  methods(api,[
    'getToken','clearToken','request','setUnauthorizedHandler',
    'register','login','restoreSession','bootstrap','logout','deleteAccount',
    'startOAuth','exchangeOAuthTicket','resendEmailVerification','confirmEmailVerification',
    'requestPasswordReset','confirmPasswordReset',
    'listIncomes','addIncome','updateIncome','deleteIncome','replaceIncomes','deleteAllIncomes',
    'listCategories','addCategory','deleteCategory','listSettings','putSetting',
    'billingStatus','createPayment','paymentStatus','setBillingAutoRenew',
    'adminSession','adminFindUser','adminSetAccess'
  ]);
  assert.equal(api.getToken(),null);
  const error=new ApiError(401,'unauthorized','fixture');
  assert.equal(error.status,401);assert.equal(error.code,'unauthorized');
});

test('existing window interfaces remain callable after normal startup',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  methods(h.w.IncomeStore,['load','save','add','update','remove','addMany']);
  methods(h.w.IncomeBackup,['exportData','importData','getAllIncomeRecords','persistRecords']);
  methods(h.w.qPokoyAuth,['showGate','setMode','getSettings']);
  assert.equal(h.w.qPokoyAuth.client,h.w.qPokoyApi);
  methods(h.w,[
    'renderIncomes','renderIncomeAnalytics','renderIncomeMonthChart','applyIncomeHeaderFilters',
    'qPokoyReplaceIncomes','qPokoyDeleteIncome',
    'qPokoyGetSelectedIncomePeriod','qPokoyChangeSelectedIncomeMonth','qPokoyChangeSelectedIncomeYear',
    'qPokoySetAnalyticsSettingsOpen','qPokoySetSettingsRoute','qPokoySetSettingsTab',
    'qPokoyLoadCategories','qPokoyGetCategories','qPokoyCategoryVisual',
    'qPokoyCloudAdd','qPokoyCloudUpdate','qPokoyCloudRemove','qPokoyCloudAddMany',
    'qPokoyCloudReplace','qPokoyCloudRestoreBackup','qPokoyCloudDeleteAll'
  ]);
  const selected=h.w.qPokoyGetSelectedIncomePeriod();
  const originalMonth=selected.month;selected.month=99;
  assert.equal(h.w.qPokoyGetSelectedIncomePeriod().month,originalMonth);
  const settings=h.w.qPokoyAuth.getSettings();settings.push({setting_key:'fixture'});
  assert.equal(h.w.qPokoyAuth.getSettings().length,0);
  const categories=h.w.qPokoyGetCategories();categories.length=0;
  assert.equal(h.w.qPokoyGetCategories().length,1);
  assert.equal(typeof h.w.qPokoyCategoryVisual('Зарплата',0).icon,'string');

  // Exercise the names supporting scripts already call, not internal helpers.
  h.w.renderIncomes();h.w.renderIncomeAnalytics();h.w.applyIncomeHeaderFilters();
  h.w.qPokoySetSettingsTab('categories');
  const before=h.w.qPokoyGetSelectedIncomePeriod();
  const previous=new Date(before.year,before.month-2,1);
  const periodEvents=[];
  h.w.addEventListener('qpokoy:income-period-change',event=>periodEvents.push(event.detail.period));
  h.w.qPokoyChangeSelectedIncomeMonth(-1);
  assert.equal(h.w.qPokoyGetSelectedIncomePeriod().month,previous.getMonth()+1);
  assert.equal(periodEvents.length,1);assert.equal(periodEvents[0].month,previous.getMonth()+1);
  h.w.qPokoyChangeSelectedIncomeMonth(1);
  assert.equal(h.w.qPokoyGetSelectedIncomePeriod().month,before.month);
  assert.equal(h.w.qPokoyGetSelectedIncomePeriod().year,before.year);
  await h.settle();assert.deepEqual(h.errors,[]);
});

test('category loader legacy hook hydrates supplied rows without a category request',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  let categoryRequests=0;
  h.api.listCategories=async()=>{categoryRequests++;return [];};
  const user={id:'fixture-user'};
  await h.w.qPokoyLoadCategories(user,[{id:'fixture-cat',name:'Контракт'}]);
  assert.equal(h.w.qPokoyGetCategories()[0].name,'Контракт');
  assert.match(h.node('qpCategoryList').textContent,/Контракт/);
  await h.w.qPokoyLoadCategories(null);
  assert.equal(h.w.qPokoyGetCategories().length,0);
  assert.equal(categoryRequests,0);
  assert.deepEqual(h.errors,[]);
});
