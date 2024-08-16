const path = require("path");
const queue = require("better-queue");
const transformDuration = require("humanize-duration");

let logger;
let browser;
let jobs = new queue(async (input, cb) => {
    const result = await input();

    cb(null, result);
}, {
    maxRetries: 3,
    retryDelay: 60000,
    batchDelay: 5000,
    afterProcessDelay: 5000,
    store: {
        type: "sql",
        dialect: "sqlite",
        path: path.join(__dirname, "logger.db")
    }
});
jobs.on("task_accepted", (taskId) => logger.info(`Job [${taskId}] added to the queue`));
jobs.on("task_started", (taskId) => logger.info(`Job [${taskId}] starting to be processed`));
jobs.on("task_finish", (taskId, result, stats) => logger.info(`Job [${taskId}] process finished in [${transformDuration(stats.elapsed)}]. Results : ${JSON.stringify(result)}`));
jobs.on("task_failed", (taskId, error) => logger.error(`Job terminated with some errors. ${error}`));
jobs.on("empty", () => {});
jobs.on("drain", () => {});

async function delegateScrappping(url) {
    if (!browser) {
        console.error("Browser already closed");
        logger.error("Browser already closed");
        throw new Error("Browser already closed");
    }

    if (url) {
        try {
            logger.info("Starting to scrapp url : " + url);

            // following is an object in which we will group all data of the page
            let pageDataObject;

            const page = await browser.newPage();
            page.setDefaultTimeout(120000);
            page.setDefaultNavigationTimeout(120000);

            logger.info("Opening a new page and waiting for network idle");
            await page.goto(url, { waitUntil: "networkidle0" });

            const mainContainer = await page.$("[role=main]");

            logger.info("Getting all necessary fields and datas for company general info");
            pageDataObject = await buildBasicDataForPage(page, mainContainer);

            logger.info(`Starting to load all ${pageDataObject.reviewCount} reviews`);
            await clickOnReviewButtonAndLoadAllReviews(page, mainContainer);

            logger.info("Preparing all review fields");
            pageDataObject["reviews"] = await buildDataObjectForReviews(page);

            logger.info("Scrapping finished.");
            await page.close();

            return pageDataObject;
        }
        catch (err) {
            logger.error("Error while trying to scrapp : " + url);
            console.error(err);
            throw new Error("Error while trying to scrapp : " + url);
        }
    }
    else {
        logger.warn("Nothing to scrapp");
        throw new Error("Nothing to scrapp");
    }
}
async function pushNewJob(url) {
    jobs.push(async () => { return await delegateScrappping(url) });
    return;
}
async function setBrowserContext(ctx) { browser = ctx; return; }
async function removeBrowserContext() { browser = null; return; }
async function setLoggerContext(loggerCtx) { logger = loggerCtx; return; }

async function clickOnReviewButtonAndLoadAllReviews(page, mainContainer) {
    try {
        // then we simulate the click action on review button before gathering all the reviews
        await page.click("[aria-label^=Reviews");
        await page.click("button[aria-label='Sort reviews'][data-value=Sort]");
        await page.waitForSelector("[id='action-menu'] [data-index='1']");
        await page.click("[id='action-menu'] [data-index='1']");
        await page.waitForNetworkIdle();

        // we are scrolling to the loading animation so as to load all reviews
        const reviewLoading = await mainContainer.$("& > :last-child > :last-child");
        if (reviewLoading) {
            do {
                await reviewLoading.scrollIntoView();
                await page.waitForNetworkIdle();
            } while (await reviewLoading.evaluate(el => el.innerHTML));
        }
        return;
    }
    catch (err) {
        throw err;
    }
}
async function buildBasicDataForPage(page, mainContainer) {
    try {
        // first we need to scrapp general info about the company
        // we locate every important field
        const generalInfoContainer = await mainContainer.$("& > :nth-child(2)");
        const aboutContainer = await page.$("[aria-label^=About][role=region]");
        const companyContainer = await page.$("[aria-label^='Information for']");
        const reviewSummaryContainer = await page.$("[jsaction='pane.reviewChart.moreReviews']");

        // these are needed container to locate easily all the next field
        const title = await mainContainer.evaluate(el => el.getAttribute("aria-label"));
        const titleContainer = await generalInfoContainer.$(`h1::-p-text(${title})`);
        const businessTypeContainer = await (await titleContainer.evaluateHandle(el => el.parentElement.nextElementSibling)).$$(".fontBodyMedium");
        const businessType = businessTypeContainer[1] || null;

        // these are all the container for the needed data
        const companyDataObject = {};
        const addressContainer = await companyContainer.$("[data-item-id=address]");
        const websiteContainer = await companyContainer.$("[data-item-id=authority]");
        const openHoursContainer = await companyContainer.$("[jsaction^='pane.openhours']");
        const phoneContainer = await companyContainer.$("[data-item-id^=phone]");
        const plusCodeContainer = await companyContainer.$("[data-item-id=oloc]");

        const detailedReview = await reviewSummaryContainer.$$("table tbody tr");
        const totalReviewCount = await reviewSummaryContainer.$("button[jsaction$='.reviewChart.moreReviews']");
        const scoreReview = await totalReviewCount.evaluateHandle(el => el.parentElement.querySelector("& > :first-child"));

        const rating = {}
        for (const ratingItem of detailedReview) {
            let ratingItemValue = await ratingItem.evaluate(el => el.getAttribute("aria-label"));
            ratingItemValue = ratingItemValue.split(",");
            ratingItemValue = ratingItemValue.map(value => Number(value.replace(/[^0-9]/g, "")));
            rating[ratingItemValue[0]] = ratingItemValue[1];
        }

        return {
            title,
            businessType: businessType ? await businessType.evaluate(el => el.querySelector("& > :first-child").textContent) : null,
            description: aboutContainer ? await aboutContainer.evaluate(el => el.textContent) : null,
            info: {
                address: addressContainer ? await addressContainer.evaluate(el => el.getAttribute("aria-label").split(":")[1].trim()) : null,
                website: websiteContainer ? await websiteContainer.evaluate(el => el.getAttribute("href")) : null,
                phone: phoneContainer ? await phoneContainer.evaluate(el => el.getAttribute("aria-label").split(":")[1].trim()) : null,
                plusCode: plusCodeContainer ? await plusCodeContainer.evaluate(el => el.getAttribute("aria-label").split(":")[1].trim()) : null,
                openHours: openHoursContainer ? await openHoursContainer.evaluate(el => el.nextElementSibling.getAttribute("aria-label").split(";").map(value => value.trim())) : [],
            },
            averageRating: await scoreReview.evaluate(el => el.textContent),
            ratingDetails: { ...rating },
            reviewCount: await totalReviewCount.evaluate(el => el.textContent.replace(/[^0-9]/g, "")),
        }
    }
    catch (err) {
        throw err;
    }
}
async function buildDataObjectForReviews(page) {
    try {
        const reviewArray = await page.$$("div[data-review-id][jslog][aria-label]:not([role=presentation])");
        const reviewArrayOfObject = [];

        // when we finished loading all comments we need to get every data there
        if (reviewArray.length > 0) {
            logger.info("Scrapping all available data for the reviews");
            for (const review of reviewArray) {
                const reviewId = await review.evaluate(el => el.getAttribute("data-review-id"));

                // getting all important element
                const userLink = await review.$("button[jsaction$='.review.reviewerLink']:not([aria-label])");
                const userName = await userLink.$("& > div:first-child");
                const userReviewCount = await userLink.$("& > div:first-child + div");
                const userReviewContainer = await review.$("& > div > div > :last-child");
                const userRating = await userReviewContainer.$("& > :first-child > :first-child, [role=img][aria-label$=star], [role=img][aria-label$=stars]");
                const userReviewDate = await userRating.evaluateHandle(el => el.nextElementSibling);
                const userVisitedDate = await userReviewContainer.$("div::-p-text(Visited)");
                const userReviewText = await userReviewContainer.$("div[id]");

                // waiting for whole review text to load
                if (await page.$(`div#${reviewId} button[aria-controls][aria-label='See more']`)) {
                    await page.click(`div#${reviewId} button[aria-controls][aria-label='See more']`);
                    await page.waitForNetworkIdle();
                }

                // pushing all data as object into an array
                reviewArrayOfObject.push({
                    name: await userName.evaluate(el => el.textContent),
                    link: await userLink.evaluate(el => el.getAttribute("data-href")),
                    rating: (await userRating.evaluate(el => el.getAttribute("aria-label") || el.textContent)).replace(/[^0-9/]/g, ""),
                    reviewDate: await userReviewDate.evaluate(el => el.textContent),
                    reviewCount: userReviewCount ? await userReviewCount.evaluate(el => el.textContent.split(" ").shift()) : null,
                    visitDate: userVisitedDate ? await userVisitedDate.evaluate(el => el.textContent) : null,
                    text: userReviewText ? await userReviewText.evaluate(el => el.textContent.replace(/\n/g, " ")) : null,
                });
            }
        }
        return reviewArrayOfObject;
    }
    catch (err) {
        throw err;
    }
}

module.exports = {
    setBrowserContext,
    setLoggerContext,
    removeBrowserContext,
    pushNewJob,
};
