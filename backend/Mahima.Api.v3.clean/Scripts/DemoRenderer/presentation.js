const fs = require('fs/promises');
const path = require('path');

const PRESENTATION_BUILD = '2026.09.19-cinema-v1';
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const theme = '#071722';

function presentationTiming(seconds) {
  const total = Math.min(1800, Math.max(30, Number(seconds) || 90));
  const bookend = total <= 90 ? 3 : 4;
  return { total, intro: bookend, outro: bookend, content: total - bookend * 2 };
}

function chapterHtml(title, index, count) {
  return `<html><style>*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:transparent;color:#edf3f5;font:24px Arial,sans-serif}.top{position:absolute;top:13px;left:96px;right:96px;display:flex;justify-content:space-between;font-size:18px;letter-spacing:4px}.brand{color:#d9b875}.frame{position:absolute;left:94px;top:52px;width:1732px;height:976px;border:2px solid #d9b87588;border-radius:4px}.bottom{position:absolute;bottom:13px;left:96px;right:96px;display:flex;align-items:center;gap:22px}.number{color:#d9b875;font-size:18px;letter-spacing:2px}.title{font-size:24px;max-width:1250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rail{position:absolute;bottom:0;left:0;height:3px;width:${100*(index+1)/count}%;background:#d9b875}</style><body><div class="top"><span class="brand">MAHIMA MINISTRY</span><span>FAITH · SERVICE · COMMUNITY</span></div><div class="frame"></div><div class="bottom"><span class="number">${String(index+1).padStart(2,'0')} / ${count}</span><span class="title">${escape(title)}</span></div><div class="rail"></div></body></html>`;
}

function bookendHtml(logoUrl, closing) {
  return `<html><style>*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:transparent;color:#fff;font-family:Arial,sans-serif}.rule{position:absolute;inset:42px;border:1px solid #dab86e66}.panel{position:absolute;right:115px;top:135px;width:780px;height:810px;text-align:center;display:flex;align-items:center;flex-direction:column;justify-content:center;background:linear-gradient(145deg,#071722cc,#07172277);border:1px solid #dcc18a55;border-radius:28px;box-shadow:0 30px 100px #0008}.logo{width:286px;height:286px;object-fit:contain;border-radius:50%;border:2px solid #d9b875;box-shadow:0 0 65px #e1b56b44}.eyebrow{color:#dcc18a;letter-spacing:6px;font-size:18px;margin-top:35px}.title{font-size:64px;font-weight:600;letter-spacing:-2px;margin-top:20px}.line{width:90px;height:2px;background:#d9b875;margin:28px}.copy{color:#c8d5dc;font-size:28px;line-height:1.5}.footer{position:absolute;bottom:67px;left:80px;color:#ead6b0;font-size:18px;letter-spacing:4px}</style><body><div class="rule"></div><div class="panel"><img class="logo" src="${logoUrl}"><div class="eyebrow">${closing ? 'ONE COMMUNITY. SHARED PURPOSE.' : 'A CONNECTED MINISTRY'}</div><div class="title">${closing ? 'Together in service.' : 'Faith in action.'}</div><div class="line"></div><div class="copy">${closing ? 'Care for people. Grow together.' : 'People, prayer and purpose.<br>Beautifully connected.'}</div></div><div class="footer">MAHIMA MINISTRY</div></body></html>`;
}

async function createPresentationAssets(directory, routes) {
  const { chromium } = require('playwright');
  const assets = path.join(__dirname, 'assets');
  const logo = await fs.readFile(path.join(assets, 'mahima-logo.png'));
  const church = path.join(assets, 'church-background.png');
  await fs.access(church);
  await fs.mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
    const screenshot = async (html, name) => {
      await page.setContent(html, {waitUntil:'load'});
      await page.evaluate(() => document.fonts.ready);
      const output = path.join(directory,name);
      await page.screenshot({path:output,omitBackground:true});
      return output;
    };
    const intro = await screenshot(bookendHtml(`data:image/png;base64,${logo.toString('base64')}`,false),'intro-overlay.png');
    const outro = await screenshot(bookendHtml(`data:image/png;base64,${logo.toString('base64')}`,true),'outro-overlay.png');
    const chapters=[];
    for(let i=0;i<routes.length;i++) chapters.push(await screenshot(chapterHtml(routes[i].title,i,routes.length),`chapter-${i}.png`));
    return { intro,outro,chapters,church };
  } finally { await browser.close(); }
}

function framedScreenFilter(duration) {
  // Full screen remains visible; transitions sit inside a persistent branded frame.
  const fade = Math.min(0.18,duration/10);
  return `scale=1728:972:flags=lanczos,fade=t=in:st=0:d=${fade}:color=0x071722,fade=t=out:st=${Math.max(0,duration-fade)}:d=${fade}:color=0x071722,pad=1920:1080:96:54:color=0x071722,setsar=1`;
}

function markerTime(output) {
  const match = String(output).match(/pts_time:([\d.]+)/);
  if (!match) throw new Error('Loaded-screen recording marker was not found; refusing an unsynchronized recording.');
  return Number(match[1]);
}

module.exports={PRESENTATION_BUILD,presentationTiming,chapterHtml,bookendHtml,createPresentationAssets,framedScreenFilter,markerTime,theme};
