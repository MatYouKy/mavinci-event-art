const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const fixture = `<main class="p-6 space-y-6"><div class="border-b border-white/10 p-4 space-y-4">
<nav class="flex gap-2"><button id="tab" data-crm-tab-active="true" class="px-4 py-3 text-[#d3bb73]">Rozliczenia</button><button id="inactive" data-crm-tab-active="false" class="px-4 py-3">Dokumenty</button></nav>
<div class="flex flex-wrap gap-3"><button id="draft" data-crm-action="secondary" class="rounded-lg px-3 py-2 text-xs text-[#d3bb73]">Zapisz szkic do uzupełnienia</button><button id="primary" class="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]">Zapisz</button><button id="plain" class="rounded-lg px-3 py-2 text-[#d3bb73]">Eksport</button><button id="disabled" data-crm-action="secondary" disabled class="rounded-lg px-3 py-2 text-[#d3bb73] disabled:opacity-40">Niedostępne</button></div></div></main>`;
(async () => {
 const config = require('../../tailwind.config.js');
 const css = (await postcss([tailwind({...config,content:[{raw:fixture,extension:'html'}]})]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css;
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  for(const width of [390,1280]) {
   await page.setViewportSize({width,height:640});
   await page.setContent(`<style>${css}</style><body class="brand-theme brand-theme--crm">${fixture}</body>`);
   const style=id=>page.locator('#'+id).evaluate(el=>{const c=getComputedStyle(el);return {bottom:c.borderBottomLeftRadius,top:c.borderTopLeftRadius,shadow:c.boxShadow,background:c.backgroundImage,cursor:c.cursor};});
   for(const id of ['draft','primary','plain','disabled']) {const c=await style(id);assert.notEqual(c.bottom,'0px',id);assert.equal(c.shadow,'none',id);assert.equal(c.background,'none',id);}
   const tab=await style('tab');assert.equal(tab.bottom,'0px');assert.notEqual(tab.shadow,'none');assert.match(tab.background,/linear-gradient/);
   await page.locator('#draft').hover();assert.equal((await style('draft')).shadow,'none');
   await page.locator('#draft').focus();assert.equal(await page.locator('#draft').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
   assert.equal((await style('disabled')).cursor,'not-allowed');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:`/tmp/mavinci-controls-${width}.png`});
  }
  console.log('PASS: actions do not inherit tab styling inside bordered containers; active/inactive tabs; hover/focus/disabled; 390px and 1280px.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
