const puppeteer = require("puppeteer");
const fs = require("fs");
const { randomBytes } = require("crypto");

(async () => {
    if (!fs.existsSync("./tmp")) fs.mkdirSync("./tmp");

    const browser = await puppeteer.launch({
        headless: false,
        defaltViewport: false,
        userDataDir: "./tmp",
    });

    let link = ["https://maps.app.goo.gl/zYHvH97VjxaRd5cv7", "https://maps.app.goo.gl/yNx9t7yBqqjiBayx5", "https://maps.app.goo.gl/eJwT7PLSFvzJSH6i6"];
    let data = {};

    const scrappingFunc = async (linkToScrapp) => {
        try {
            const page = await browser.newPage();
            await page.goto(linkToScrapp);

            const itemCardHandle = await page.$$("div.w6VYqd div.aIFcqe div.m6QErb.WNBkOb");
            for (const itemCard of itemCardHandle) {
                const pageTitle = await page.evaluate(el => el.querySelector("div.lMbq3e h1.DUwDvf")?.textContent, itemCard);
                const pageRating = await page.evaluate(el => el.querySelector("div.lMbq3e div.LBgpqf div.F7nice > span:nth-child(1) > span")?.textContent, itemCard);
                const pageReviewCount = await page.evaluate(el => el.querySelector("div.lMbq3e div.LBgpqf div.F7nice > span:nth-child(2) > span")?.textContent, itemCard);
                const pageBusinessType = await page.evaluate(el => el.querySelector("div.lMbq3e div.LBgpqf > div.skqShb > div:nth-child(2) > span > span > button")?.textContent, itemCard);

                data = { pageTitle, pageRating, pageReviewCount, pageBusinessType };
            }

            const itemCoordsCardHandle = await page.$$("div.w6VYqd div.aIFcqe div.m6QErb.WNBkOb div.m6QErb.XiKgde div.RcCsl");
            const pageCoords = []
            for (const coordItemCard of itemCoordsCardHandle) {
                const coord = await page.evaluate((el) => el.querySelector("div.rogA2c")?.textContent, coordItemCard);
                pageCoords.push(coord);

                data = Object.assign(
                    {},
                    { ...data },
                    { pageCoords }
                );
            }

            await page.click("div.yx21af button:nth-child(2)");
            const pageReviews = [];

            let scrollLoadingIndicator;
            do {
                scrollLoadingIndicator = await page.$("div.w6VYqd div.aIFcqe div.m6QErb.WNBkOb > div.m6QErb.kA9KIf div.lXJj5c.Hk4XGb div.qjESne");
                scrollLoadingIndicator?.scrollIntoView();

                await page.waitForNetworkIdle();
                await page.waitForSelector("div.w6VYqd div.aIFcqe div.m6QErb.WNBkOb > div.m6QErb.kA9KIf div.m6QErb div.jftiEf");
                const reviewCard = await page.$$("div.w6VYqd div.aIFcqe div.m6QErb.WNBkOb > div.m6QErb.kA9KIf div.m6QErb div.jftiEf");
                for (const review of reviewCard) {
                    const reviewId = await page.evaluate(el => el.querySelector("div.jJc9Ad div.GHT2ce div.MyEned")?.getAttribute("id"), review);

                    const reviewUser = await page.evaluate(el => el.querySelector("div.jJc9Ad > div.GHT2ce.NsCY4 div.WNxzHc.qLhwHc button div.d4r55")?.textContent, review);
                    const reviewRating = await page.evaluate(el => el.querySelectorAll("div.jJc9Ad div.DU9Pgb span.kvMYJc span.hCCjke.NhBTye.elGi1d")?.length, review);
                    const reviewDate = await page.evaluate(el => el.querySelector("div.jJc9Ad div.DU9Pgb span.rsqaWe")?.textContent, review);

                    if (await page.$(`div.MyEned#${reviewId} button[data-review-id="${reviewId}"]`)) await page.click(`div.MyEned#${reviewId} button[data-review-id="${reviewId}"]`);

                    const reviewText = await page.evaluate(el => el.querySelector("div.jJc9Ad div.MyEned span.wiI7pd")?.textContent, review);
                    pageReviews.push({ reviewId, reviewUser, reviewRating, reviewDate, reviewText });
                }
            } while (scrollLoadingIndicator);

            data = Object.assign(
                {},
                { ...data },
                { pageReviews }
            );

            page.close();

            return data;
        }
        catch (err) {
            console.error(err);
        }
    }

    for (const linkToProcess of link) {
        fs.writeFileSync(`result-${randomBytes(8).toString("hex")}.json`, JSON.stringify(await scrappingFunc(linkToProcess)), "utf-8");
    }

    browser.close();
})();