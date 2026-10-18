'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('FileProvider exposes only the app-specific Capacitor Pictures directory',()=>{
  const dom=new JSDOM(read('android/app/src/main/res/xml/file_paths.xml'),{contentType:'text/xml'});
  try{
    const roots=[...dom.window.document.documentElement.children];
    assert.equal(roots.length,1);
    assert.equal(roots[0].tagName,'external-files-path');
    assert.equal(roots[0].getAttribute('path'),'Pictures/');
    assert.equal(roots[0].getAttribute('name'),'capacitor_pictures');
  }finally{dom.window.close();}
  const manifest=new JSDOM(read('android/app/src/main/AndroidManifest.xml'),{contentType:'text/xml'});
  try{
    const providers=[...manifest.window.document.querySelectorAll('provider')];
    assert.equal(providers.length,1);
    assert.equal(providers[0].getAttribute('android:name'),'androidx.core.content.FileProvider');
    assert.equal(providers[0].getAttribute('android:exported'),'false');
    assert.equal(providers[0].getAttribute('android:grantUriPermissions'),'true');
  }finally{manifest.window.close();}
});

test('restricted provider preserves Capacitor capture location and temporary URI grants',()=>{
  const chooser=read('node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java');
  assert.match(chooser,/getExternalFilesDir\(Environment.DIRECTORY_PICTURES\)/);
  assert.match(chooser,/FileProvider.getUriForFile/);
  assert.match(chooser,/FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(chooser,/FLAG_GRANT_WRITE_URI_PERMISSION/);
});

test('PDF and JSON use SAF and JSON import keeps the system file picker',()=>{
  const activity=read('android/app/src/main/java/ru/qpokoy/app/MainActivity.java');
  assert.match(activity,/Intent.ACTION_CREATE_DOCUMENT/);
  assert.match(activity,/getContentResolver\(\).openOutputStream/);
  assert.doesNotMatch(activity,/FileProvider|getUriForFile/);
  const adapter=read('android/app/src/main/assets/android-adapter.js');
  assert.match(adapter,/qPokoyAndroidDownload/);
  assert.match(read('www/js/backup-controls.js'),/IncomeBackup.importData\(file\)/);
  assert.match(read('www/index.html'),/type="file"[^>]*accept="[^"]*json/);
});
