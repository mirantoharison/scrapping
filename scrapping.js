const path = require("path");

let logger;
let browser;

async function delegateScrapping(url) {
    // following is an object in which we will group all data of the page
    let pageDataObject = {};

    console.time("process-time");
    try {
        if (!browser) {
            console.error("Browser already closed");
            logger.error("Browser already closed");
            throw new Error("Browser already closed");
        }

        if (url) {
            logger.info("Starting to scrapp url : " + url);

            const page = await browser.newPage();
            page.setDefaultTimeout(120000);
            page.setDefaultNavigationTimeout(120000);

            logger.info("Opening a new page and waiting for network idle");
            await page.goto(url, { waitUntil: "networkidle0" });

            const mainContainer = await page.$("[role=main]");

            logger.info("Getting all necessary fields and datas for company general info");
            pageDataObject = await buildBasicDataForPage(page, mainContainer);

            logger.info(`Starting to load all ${pageDataObject.reviewCount} reviews`);
            pageDataObject["reviews"] = await clickOnReviewButtonAndLoadAllReviews(page, mainContainer);

            /*logger.info("Preparing all review fields");
            pageDataObject["reviews"] = await buildDataObjectForReviews(page);*/

            logger.info("Scrapping finished.");
            await page.close();
        }
        else {
            logger.warn("Nothing to scrapp");
            throw new Error("Nothing to scrapp");
        }
    }
    catch (err) {
        logger.error("Error while trying to scrapp : " + url);
        console.error(err);
        throw new Error("Error while trying to scrapp : " + url);
    }
    finally {
        console.timeEnd("process-time");
        return pageDataObject;
    }
}
async function setBrowserContext(ctx) { browser = ctx; return; }
async function removeBrowserContext() { browser = null; return; }
async function setLoggerContext(loggerCtx) { logger = loggerCtx; return; }

async function clickOnReviewButtonAndLoadAllReviews(page, mainContainer) {
    let reviewBlock;
    let reviewBlockCount;
    let reviewBlockIndex = 0;
    let reviewArrayObject = [];
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

                reviewBlock = await page.$$("[role=main] div[data-review-id][jslog][aria-label]:not([role=presentation])");
                reviewBlockCount = reviewBlock.length;

                if (reviewBlockIndex < reviewBlockCount) {
                    logger.info(`[Scrapping] Loading reviews from ${reviewBlockIndex} to ${reviewBlockCount}`);
                    for (let i = reviewBlockIndex; i < reviewBlockCount; i++) {
                        const data = await buildDataObjectForReviews(page, [reviewBlock[i]]);
                        reviewArrayObject = reviewArrayObject.concat(data);
                    }
                    reviewBlockIndex = reviewBlockCount;
                }
            } while (await reviewLoading.evaluate(el => el.innerHTML));
        }
        return reviewArrayObject;
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
async function buildDataObjectForReviews(page, reviewArray) {
    try {
        const reviewArrayOfObject = [];

        // when we finished loading all comments we need to get every data there
        if (reviewArray.length > 0) {
            for (const review of reviewArray) {
                const reviewId = await review.evaluate(el => el.getAttribute("data-review-id"));

                // getting all important element
                const userLink = await review.$("button[jsaction$='.review.reviewerLink']:not([aria-label])");
                const userName = await userLink.$("& > div:first-child");
                const userReviewCount = await userLink.$("& > div:first-child + div");
                const userReviewContainer = await review.$("& > div > div > :last-child");
                const userRating = await userReviewContainer.$("& > :first-child > :first-child, [role=img][aria-label$=star], [role=img][aria-label$=stars]");
                const userReviewDate = await userReviewContainer.$("div::-p-text(ago)");
                const userVisitedDate = await userReviewContainer.$("div::-p-text(Visited)");
                const userReviewText = await userReviewContainer.$("div[id]");
                const userReviewMoreText = await userReviewContainer.$("[aria-label='See more']");

                // waiting for whole review text to load
                if (userReviewMoreText) {
                    await userReviewMoreText.click();
                    await page.waitForNetworkIdle();
                }
                // pushing all data as object into an array
                reviewArrayOfObject.push({
                    name: await userName.evaluate(el => el.textContent),
                    link: await userLink.evaluate(el => el.getAttribute("data-href")),
                    rating: (await userRating.evaluate(el => el.getAttribute("aria-label") || el.textContent)).replace(/[^0-9/]/g, ""),
                    reviewDate: await userReviewDate.evaluate(el => el.textContent),
                    reviewCount: userReviewCount ? await userReviewCount.evaluate(el => el.textContent.replace(/[^0-9\s]/g, "").trim().split(" ").shift()) : null,
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
    delegateScrapping,
    setBrowserContext,
    setLoggerContext,
    removeBrowserContext,
};
