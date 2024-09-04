const path = require("path");
const fs = require("fs");

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
        await fs.writeFileSync("./result.json", JSON.stringify(pageDataObject));
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
    let reviewTimeout;
    let reviewFetchContinue = true;
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
                    clearTimeout(reviewTimeout);
                    reviewTimeout = null;
                    logger.info(`[Scrapping] Loading reviews from ${reviewBlockIndex} to ${reviewBlockCount}`);
                    for (let i = reviewBlockIndex; i < reviewBlockCount; i++) {
                        const data = await buildDataObjectForReviews(page, [reviewBlock[i]]);
                        reviewArrayObject = reviewArrayObject.concat(data);
                    }
                    reviewBlockIndex = reviewBlockCount;
                }
                else {
                    if (reviewTimeout === null)
                        reviewTimeout = setTimeout(() => reviewFetchContinue = false, 10000);
                }
            } while (reviewFetchContinue);
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
        const businessType = await generalInfoContainer.$("button[jsaction$=category]");

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
            businessType: businessType ? await businessType.evaluate(el => el.textContent) : null,
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




import { initBrowser } from '@lib/puppeteer';
import logger from '@utils/logger';
import { getFirstMacthNumber, transformRelativeDate } from '@utils/text';
import { Page, ElementHandle } from 'puppeteer';

//const url =
//  'https://www.google.fr/maps/place/Pandora/@48.6904009,6.1782173,17z/data=!3m1!4b1!4m6!3m5!1s0x4794986ded71845b:0x8ff05666343f284f!8m2!3d48.6903974!4d6.1807922!16s%2Fg%2F11dfgflr6z?entry=ttu';
export const scrappGmbByUrl = async (url: string) => {
  const browser = await initBrowser(30000);
  let companyInfo;
  let reviews: any[] = [];

  try {
    const page = await browser.newPage();
    logger.info(`[Scrapping] Goto: ${url}`);

    // Attempt to navigate to the URL with a longer timeout
    await page.goto(url, { timeout: 30000 });

    // Fetch company information
    logger.info(`[Scrapping] Getting company info`);
    companyInfo = await _getCompanyInfo(page);

    // Log the number of reviews to be scraped
    logger.info(`[Scrapping] Loading all ${companyInfo?.reviewCount} reviews...`);

    // Proceed with scraping if there are reviews
    if (companyInfo && companyInfo.reviewCount > 0) {
      await _clicMoreReviewsAndSort(page);
      reviews = await _scrollReviewsContent(page);
    }
  } catch (e) {
    console.error(e);
    logger.error(`[Scrapping]: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  } finally {
    // Ensure the browser is closed regardless of success or failure
    await browser.close();
  }

  return {
    companyInfo,
    reviewsCount: reviews.length,
    reviews,
  };
};

// Utility function to safely evaluate element attributes
const _getElementAttribute = async (
  element: ElementHandle,
  attribute: string
): Promise<string | null> => {
  try {
    const result = await element.evaluate((el, attr) => el.getAttribute(attr), attribute);
    return result !== null && result !== '' ? result : null;
  } catch (error) {
    console.error(`Failed to get element attribute: ${error}`);
    return null;
  }
};

const _splitAndTrimAttribute = async (
  element: ElementHandle,
  separator: string
): Promise<string[] | null> => {
  try {
    const attribute = await _getElementAttribute(element, 'aria-label');
    return attribute ? attribute.split(separator).map((s) => s.trim()) : null;
  } catch (error) {
    console.error(`Failed to split and trim attribute: ${error}`);
    return null;
  }
};

const _getTextContent = async (element: ElementHandle): Promise<string | null> => {
  try {
    return element ? await element.evaluate((el) => el.textContent) : null;
  } catch (error) {
    console.error(`Failed to get text content: ${error}`);
    return null;
  }
};

const _handleClick = async (page: Page, element: ElementHandle | null): Promise<void> => {
  try {
    if (element) {
      await element.click();
      await page.waitForNetworkIdle({ idleTime: 2000 });
      return;
    } else return;
  } catch (error) {
    console.error(`Failed to click element: ${error}`);
  }
};

const _scrollReviewsContent = async (page: Page): Promise<any[]> => {
  let reviewBlock;
  let reviewBlockCount;
  let reviewBlockIndex = 0;
  let reviewArrayObject: any[] = [];
  let reviewTimeout: any;
  let reviewFetchContinue: boolean = true;

  const reviewLoading = await page.$('[role=main] > :last-child > :last-child');
  if (reviewLoading) {
    do {
      await _scrollToElement(page, reviewLoading);

      reviewBlock = await page.$$(
        '[role=main] div[data-review-id][jslog][aria-label]:not([role=presentation])'
      );
      reviewBlockCount = reviewBlock.length;

      if (reviewBlockIndex < reviewBlockCount) {
        clearTimeout(reviewTimeout);
        reviewTimeout = null;
        logger.info(`[Scrapping] Loading reviews from ${reviewBlockIndex} to ${reviewBlockCount}`);
        for (let i = reviewBlockIndex; i < reviewBlockCount; i++) {
          const data = await _loopBlocksAndGetAllData(page, [reviewBlock[i]]);
          reviewArrayObject = reviewArrayObject.concat(data);
        }
        reviewBlockIndex = reviewBlockCount;
      } else {
        if (reviewTimeout === null)
          reviewTimeout = setTimeout(() => (reviewFetchContinue = false), 10000);
      }
    } while (reviewFetchContinue && (await reviewLoading.evaluate((el) => el.innerHTML)) !== ''); // if there is no loading animation, exit the loop
  }

  return reviewArrayObject;
};

const _scrollToElement = async (page: Page, element: ElementHandle): Promise<void> => {
  try {
    if (element) {
      await element.scrollIntoView();
      await page.waitForNetworkIdle();
    }
  } catch (error) {
    console.error(`Failed to scroll to element: ${error}`);
  }
};

const _clicMoreReviewsAndSort = async (page: Page) => {
  await _handleClick(page, await page.$('button[jsaction*="reviewChart.moreReviews"]')); // click more reviews button
  await page.waitForSelector('[aria-label="Sort reviews"], [aria-label="Most relevant"]');
  await _handleClick(
    page,
    await page.$('[aria-label="Sort reviews"], [aria-label="Most relevant"]')
  ); // click on Sort button or on Sort select field
  await page.waitForSelector('#action-menu [role="menuitemradio"][data-index="1"]');
  await _handleClick(page, await page.$('#action-menu [role="menuitemradio"][data-index="1"]')); // click on Newest sort type
};

const _loopBlocksAndGetAllData = async (page: Page, reviewsBlock: any[]) => {
  const reviewArrayOfObject = [];

  if (reviewsBlock.length > 0) {
    for (const review of reviewsBlock) {
      const userLink = await review.$('button[jsaction$=".review.reviewerLink"]:has(div)');
      const userName = await userLink.$('div:first-child');
      const userReviewCount = await userLink.$('div:first-child + div');
      const userReviewContainer = await review.$('& > div > div > :last-child');
      const userRating = await userReviewContainer.$('& > :first-child > :first-child');
      const userReviewDate = await userReviewContainer.$('span::-p-text(ago)');
      const userVisitedDate = await userReviewContainer.$('div::-p-text(Visited)');
      const userReviewText = await userReviewContainer.$('div[id]');
      const userReviewMoreText = await userReviewContainer.$(
        '[aria-label="See more"]:not([data-href])'
      );

      if (userReviewMoreText) await _handleClick(page, userReviewMoreText);

      reviewArrayOfObject.push({
        reviewerName: await _getTextContent(userName),
        reviewerLink: await userLink?.evaluate(
          (el: ElementHandle) => el.getAttribute('data-href') ?? ''
        ),
        reviewerStar: getFirstMacthNumber(
          (await _getElementAttribute(userRating, 'aria-label')) ??
            (await _getTextContent(userRating)) ??
            '0'
        ),
        reviewDateText: await _getTextContent(userReviewDate),
        reviewDate: transformRelativeDate(
          ((await _getTextContent(userReviewDate)) ?? '').replace(/on google/gi, '')
        ),
        reviewerReviewsCount: getFirstMacthNumber((await _getTextContent(userReviewCount)) ?? ''),
        reviewerVisitedDate: (await _getTextContent(userVisitedDate)) ?? '',
        reviewsNote: ((await _getTextContent(userReviewText)) ?? '').replace(/\n/g, ' '),
      });
    }
  }

  return reviewArrayOfObject;
};

/** get company info
 * @param: Page
 */
const _getCompanyInfo = async (page: Page) => {
  // Initial setup
  const mainContainer = await page.$('[role=main]');
  const aboutContainer = await page.$('[aria-label^=About][role=region]');
  const companyContainer = await page.$("[aria-label^='Information for']");
  const reviewSummaryContainer = await page.$("[jsaction='pane.reviewChart.moreReviews']");
  const generalInfoContainer = await mainContainer?.$('& > :nth-child(2)');

  // Optimized container retrieval
  const titleContainer = await generalInfoContainer?.$(`h1:last-child`);
  const businessType = await generalInfoContainer?.$('[jsaction$=category]');

  // Company information containers
  const addressContainer = await companyContainer?.$('[data-item-id=address]');
  const websiteContainer = await companyContainer?.$('[data-item-id=authority]');
  const openHoursContainer = await companyContainer?.$("[jsaction^='pane.openhours']");
  const phoneContainer = await companyContainer?.$('[data-item-id^=phone]');
  const plusCodeContainer = await companyContainer?.$('[data-item-id=oloc]');

  // Detailed review processing
  const detailedReview = (await reviewSummaryContainer?.$$('table tbody tr')) || [];
  const totalReviewCount = await reviewSummaryContainer?.$(
    "button[jsaction$='.reviewChart.moreReviews']"
  );
  const scoreReview = await totalReviewCount?.evaluateHandle((el) =>
    el.parentElement?.querySelector(':first-child')
  );

  // Rating details extraction
  const rating: { [key: string]: string | number } = {};
  for (const review of detailedReview) {
    const ariaLabel = await _getElementAttribute(review, 'aria-label');
    if (ariaLabel) {
      const [number, label] = ariaLabel.split(',').map((s) => s.trim());
      rating[number] = Number(getFirstMacthNumber(label) ?? '0');
    }
  }

  // Constructing return object
  return {
    title: (await titleContainer?.evaluate((el: any) => el.textContent)) ?? '',
    businessType: (await businessType?.evaluate((el: any) => el.textContent)) ?? '',
    description: (await aboutContainer?.evaluate((el: any) => el.textContent)) ?? '',
    info: {
      address: addressContainer
        ? (((await _splitAndTrimAttribute(addressContainer, ':')) || []).pop() ?? '')
        : null,
      website: websiteContainer
        ? ((await _getElementAttribute(websiteContainer, 'href')) ?? '')
        : null,
      phone: phoneContainer
        ? (((await _splitAndTrimAttribute(phoneContainer, ':')) || []).pop() ?? '')
        : null,
      plusCode: plusCodeContainer
        ? (((await _splitAndTrimAttribute(plusCodeContainer, ':')) || []).pop() ?? '')
        : null,
      openHours: openHoursContainer
        ? (((await _splitAndTrimAttribute(openHoursContainer, ';')) || []).pop() ?? '')
        : null,
    },
    averageRating: Number((await scoreReview?.evaluate((el) => el?.textContent)) ?? '0'),
    ratingDetails: { ...rating },
    reviewCount: Number(
      (await totalReviewCount?.evaluate((el) => el.textContent?.replace(/[^0-9]/g, ''))) ?? '0'
    ),
  };
};

