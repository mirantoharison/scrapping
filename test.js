const puppeteer = require("puppeteer");
const fs = require("fs");
const { randomBytes } = require("crypto");

(async () => {
    if (!fs.existsSync("./tmp")) fs.mkdirSync("./tmp");

    const browser = await puppeteer.launch({
        headless: false,
        defaltViewport: false,
        userDataDir: "./tmp",
        timeout: 10000,
    });

    let link = [
        "https://maps.app.goo.gl/zYHvH97VjxaRd5cv7",
        "https://maps.app.goo.gl/yNx9t7yBqqjiBayx5",
        "https://maps.app.goo.gl/eJwT7PLSFvzJSH6i6",
        "https://maps.app.goo.gl/6XKpEUykY5aqgbj17",
        "https://maps.app.goo.gl/42CKmpoLLKfZDamm6",
        "https://maps.app.goo.gl/TXCM5E3xBvzF17cn8",
        "https://maps.app.goo.gl/7HxQwQc1PccqRcem6"
    ]

    const scrappingFunc = async (linkToScrapp) => {
        try {
            const page = await browser.newPage();
            await page.goto(linkToScrapp);
            await page.waitForNetworkIdle();

            const body = await page.$("body");
            const mainContainer = await body.$("div:not([aria-hidden]) #app-container #content-container #pane+div > div > div");
            const pageContainer = await mainContainer.$("div[role='main']");

            const pageBasicInfo = await pageContainer.$("div:nth-child(2) > div > div");
            const pageTitle = await page.evaluate(el => {
                let titleElement;
                titleElement = Array.from(el.querySelectorAll("h1"));
                titleElement = titleElement.pop();
                return titleElement.textContent;
            }, pageBasicInfo);

            const { pageRating, pageBusinessType } = await page.evaluate(el => {
                let element = el.querySelectorAll("div:nth-child(2) div.fontBodyMedium");
                return {
                    pageRating: element[0].querySelector("span span").textContent,
                    pageBusinessType: element[1]?.querySelector("span:first-child").textContent,
                }
            }, pageBasicInfo);

            const pageCoords = await page.evaluate(el => {
                let coordsElementcontainer = el.querySelector("div[ve-visible='cf']").parentElement;
                let coordsElement;
                coordsElement = Array.from(coordsElementcontainer.querySelectorAll("& > div:not([ve-visible='cf'])"));
                coordsElement = coordsElement.map(element => element.querySelector(":nth-child(2) .fontBodyMedium"))
                return coordsElement.map(value => value.textContent);
            }, pageContainer);

            await page.click(`div[role='tablist'] button[aria-label^='Reviews']`);
            await page.waitForNetworkIdle();
            await pageContainer.waitForSelector("& > :nth-child(2) > :last-child");

            const pageReviews = [];
            const scrollLoadingIndicator = await pageContainer.$("& > :last-child > :last-child");
            do {
                scrollLoadingIndicator.scrollIntoView();
                await page.waitForNetworkIdle();
            } while (scrollLoadingIndicator && await page.evaluate(el => el.innerHTML, scrollLoadingIndicator));

            await page.waitForNetworkIdle();
            const reviewCard = await page.$$("div[data-review-id][aria-label]");
            for (const review of reviewCard) {
                const reviewId = await page.evaluate(el => el.getAttribute("data-review-id"), review);
                console.log(reviewId)

                if (await page.$(`div#${reviewId} button`)) await page.click(`div#${reviewId} button:not([data-href])`);

                const reviewText = await page.evaluate((el, reviewId) => el.querySelector(`div#${reviewId} span`)?.textContent, review, reviewId);
                const reviewUser = await page.evaluate(el => el.querySelector("& > div > div > :nth-child(2) > :last-child button > :first-child").textContent, review);
                const reviewRating = await page.evaluate(el => el.querySelector("& > div > div > :last-child > :first-child > :first-child").getAttribute("aria-label"), review);
                const reviewDate = await page.evaluate(el => el.querySelector("& > div > div > :last-child > :first-child > :nth-child(2)").textContent, review);

                pageReviews.push({ reviewId, reviewUser, reviewRating, reviewDate, reviewText });
            }
            console.log(reviewCard.length);

            return Object.assign({},
                {
                    pageTitle,
                    pageRating,
                    pageBusinessType
                },
                { pageCoords: [...pageCoords] },
                { pageReviews: [...pageReviews] }
            );
        }
        catch (err) {
            console.error(err);
        }
    }

    //await scrappingFunc(link[6]);
    for (const linkToProcess of link) {
        await scrappingFunc(linkToProcess);
        //fs.writeFileSync(`result-${randomBytes(8).toString("hex")}.json`, JSON.stringify(await scrappingFunc(linkToProcess)), "utf-8");
    }

    //browser.close();
})();