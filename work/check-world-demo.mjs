import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { chromium }=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// 在隔离的无头浏览器中检查演示闭环，不接入用户浏览器资料或真实服务。
async function main(){
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:940}});
 const page=await context.newPage();const errors=[];
 // 收集脚本异常，避免界面看起来正常却已有运行错误。
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///D:/VenerableP/pulse/outputs/pulse-world-demo.html');
 await page.waitForTimeout(500);
 const mapBox=await page.locator('#world').boundingBox();
 const oldCoord=await page.locator('#coord').textContent();
 await page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
 await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width/2+90,mapBox.y+mapBox.height/2+70,{steps:8});await page.mouse.up();await page.waitForTimeout(60);
 if(await page.locator('#coord').textContent()===oldCoord)throw new Error('Drag failed');
 await page.locator('#home').click();
 await page.screenshot({path:'work/world-desktop.png'});
 await page.locator('#nearby').click();await page.locator('#reader').waitFor({state:'visible'});
 if(await page.locator('#articleTitle').textContent()!=='今天没有什么大事发生')throw new Error('Reading failed');
 await page.locator('[data-close="reader"]').click();
 await page.locator('#build').click();await page.locator('#houseName').fill('测试书屋');await page.locator('#houseTheme').selectOption('blue');
 await page.locator('#postBody').fill('记录一次真实的本地保存。<script>测试不执行</script>');await page.locator('#saveHouse').click();
 await page.mouse.click(540,446);
 if(!(await page.locator('#toast').textContent()).includes('太近'))throw new Error('Overlap rejection failed');
 await page.locator('#world').focus();
 // 用公开键盘操作移到空地，检验相机平移后的选址坐标。
 for(let i=0;i<9;i++)await page.keyboard.press('ArrowRight');
 const box=await page.locator('#world').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await page.locator('#reader').waitFor({state:'visible'});
 if(!(await page.locator('#articleHouse').textContent()).includes('测试书屋'))throw new Error('Placement failed');
 await page.reload();await page.locator('#myHome').click();
 if(!(await page.locator('#articleBody').textContent()).includes('<script>'))throw new Error('Persistence or plain text failed');
 await page.locator('#editHouse').click();await page.locator('#postTitle').fill('保存之后再修改');await page.locator('#saveHouse').click();
 if(await page.locator('#articleTitle').textContent()!=='保存之后再修改')throw new Error('Edit failed');
 await page.locator('#address').fill('雨巷');await page.locator('#addressForm button').click();
 if(await page.locator('#myHome').isVisible())throw new Error('District storage leaked');
 await page.locator('#address').fill('夜航');await page.locator('#addressForm button').click();await page.locator('#myHome').click();
 await page.screenshot({path:'work/world-article.png'});
 await page.locator('[data-close="reader"]').click();await page.locator('#home').click();
 const before=await page.locator('#zoomValue').textContent();await page.locator('#zoomIn').click();await page.waitForTimeout(50);
 if(await page.locator('#zoomValue').textContent()===before)throw new Error('Zoom failed');
 await page.locator('#ghostToggle').click();if(await page.locator('#ghostToggle').getAttribute('aria-pressed')!=='false')throw new Error('Ghost toggle failed');
 await page.setViewportSize({width:390,height:844});await page.locator('#home').click();await page.waitForTimeout(200);await page.screenshot({path:'work/world-mobile.png'});
 await page.locator('#mobileBuild').click();await page.locator('#editor').waitFor({state:'visible'});await page.screenshot({path:'work/world-mobile-editor.png'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw new Error('Horizontal overflow');
 await browser.close();
 console.log(JSON.stringify({scenarios:['drag','read','overlap rejection','place','persist','edit','district isolation','zoom','ghost toggle','mobile editor'],errors,overflow}));
 if(errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exit(1);});
