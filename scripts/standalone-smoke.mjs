import assert from 'node:assert/strict';
export async function smokeStandalone(browser,baseUrl){
  const context=await browser.newContext();
  await context.addInitScript(()=>{localStorage.setItem('confluon-control-layout','xl3');window.midiRequests=0;Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>{window.midiRequests++;throw Error('Unexpected MIDI request');}});});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(new URL('/?controller=1&seed=424242&renderer=canvas&life=600',baseUrl).href);
    await page.waitForFunction(()=>!!window.confluon);
    const initial=await page.evaluate(()=>window.confluon.settings());
    assert.equal(await page.locator('#xl3-panel,[data-interface]').count(),0);
    await page.locator('#controls-toggle').click();
    assert.equal(await page.locator('#controls-toggle').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#controls-body').isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>window.confluon.settings()),initial);
    assert.equal(await page.evaluate(()=>window.midiRequests),0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
