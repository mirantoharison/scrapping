const puppeteer = require("puppeteer");

(async() => {
const browser = await puppeteer.launch();
const page = await browser.newPage();

await page.goto("https://www.google.com/maps/place/Pandora/@48.6903974,6.1807922,17z/data=!4m6!3m5!1s0x4794986ded71845b:0x8ff05666343f284f!8m2!3d48.6903974!4d6.1807922!16s%2Fg%2F11dfgflr6z?entry=ttu");
await page.waitForNetworkIdle();
const mainContainer = await page.$("[role=main]");
const mainAttribute = await mainContainer.evaluate((el, attr) => {return el.getAttribute(attr)}, 'role');
console.log(mainAttribute);
await page.close();
await browser.close();
    
})();