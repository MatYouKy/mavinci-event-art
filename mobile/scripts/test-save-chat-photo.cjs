const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/services/saveChatPhoto.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function setup({granted=true,status=200,downloadError=false,saveError=false,os='ios',version=16}={}) {
 const calls=[]; const out={exports:{}};
 const media={requestPermissionsAsync:async(...args)=>{calls.push(['permission',...args]);return {granted};},saveToLibraryAsync:async(uri)=>{calls.push(['save',uri]);if(saveError)throw Error('disk');}};
 const files={cacheDirectory:'file:///cache/',downloadAsync:async(url,uri)=>{calls.push(['download',url,uri]);if(downloadError)throw Error('offline');return {status,uri};},deleteAsync:async(uri)=>{calls.push(['delete',uri]);}};
 new Function('require','exports',source)(name=>name==='expo-media-library'?media:name==='react-native'?{Platform:{OS:os,Version:version}}:files,out.exports);
 return {calls,...out.exports};
}
(async()=>{
 let t=setup();await t.saveChatPhoto('https://example.test/photo.png?token=x');assert.deepEqual(t.calls.map(c=>c[0]),['permission','download','save','delete']);assert.deepEqual(t.calls[0],['permission',true,['photo']]);assert.ok(t.calls[2][1].endsWith('.png'));assert.equal(t.calls[2][1],t.calls[3][1]);
 t=setup({granted:false});await assert.rejects(t.saveChatPhoto('https://example.test/a.jpg'),t.PhotoPermissionError);assert.equal(t.calls.length,1);
 for(const options of [{status:403},{downloadError:true},{saveError:true}]) {t=setup(options);await assert.rejects(t.saveChatPhoto('https://example.test/a.jpg'));assert.equal(t.calls.at(-1)[0],'delete');if(!options.saveError)assert.ok(!t.calls.some(c=>c[0]==='save'));}
 t=setup({os:'android',version:33});await t.saveChatPhoto('https://example.test/a.jpg');assert.ok(!t.calls.some(c=>c[0]==='permission'));
 console.log('6 photo saving scenarios passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
