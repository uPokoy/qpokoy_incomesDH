const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../android/app/src/main');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
test('reminders are Android-only local inexact alarms with stable identity',()=>{
 const source=read('java/ru/qpokoy/app/ReminderNotifications.java');
 assert.match(source,/setAndAllowWhileIdle/);assert.match(source,/RTC_WAKEUP/);
 assert.match(source,/FLAG_UPDATE_CURRENT\\|PendingIntent.FLAG_IMMUTABLE/);
 assert.doesNotMatch(source,/setExact|setRepeating|fetch|https:|qPokoyApi|ReadCacheDatabase|OAuth/);
});
test('manifest restores reminders without exact alarm or push permissions',()=>{
 const xml=read('AndroidManifest.xml');
 for(const action of ['BOOT_COMPLETED','MY_PACKAGE_REPLACED','TIME_SET','TIMEZONE_CHANGED'])assert.ok(xml.includes(action));
 for(const permission of ['POST_NOTIFICATIONS','RECEIVE_BOOT_COMPLETED','VIBRATE'])assert.ok(xml.includes(permission));
 assert.doesNotMatch(xml,/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|firebase/);
 assert.match(xml,/<receiver android:name=".ReminderReceiver" android:exported="false">/);
});
test('reminders keep required text, default sound/vibration and standard app tap',()=>{
 const source=read('java/ru/qpokoy/app/ReminderNotifications.java'),activity=read('java/ru/qpokoy/app/MainActivity.java');
 assert.ok(source.includes('TITLE="Просто напоминаем"'));
 assert.ok(source.includes('TEXT="Вы уже внесли свои доходы?"'));
 for(const text of ['IMPORTANCE_DEFAULT','enableVibration(true)','TYPE_NOTIFICATION','MainActivity.class','FLAG_ACTIVITY_CLEAR_TOP','FLAG_ACTIVITY_SINGLE_TOP'])assert.ok(source.includes(text));
 assert.match(activity,/RequestPermission/);assert.match(source,/permission_requested/);
 assert.ok(source.indexOf('putBoolean("permission_requested",true)')>0);
 assert.match(read('AndroidManifest.xml'),/launchMode="singleTask"/);
});
