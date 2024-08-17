const express = require("express");
const puppeteer = require("puppeteer");
const helmet = require("helmet");
const pino = require("pino");
const pinoHttp = require("pino-http");
const path = require("path");

const scrapping = require("./scrapping");
const queue = require("./queue");
const app = express();

let browser;
//let loggerDatastore = Datastore.create(path.join(__dirname, "logger.db"));
let logger = pino({
    transport: {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "SYS:dd-mm-yyyy HH:MM:ss"
        }
    },
});
let appLogger = pinoHttp({ ...logger });
let appQueue = queue.Queue({
    maxRetries: 3,
    retryDelay: 60000,
    batchDelay: 5000,
    afterProcessDelay: 5000,
});

//app.use(appLogger);
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

scrapping.setLoggerContext(logger);
queue.setLoggerContext(logger);

app.get("/start", async (req, res) => {
    try {
        logger.info("🧓👳✨🛒🍱🍣🍰🚋");
        logger.info("Welcome");
        logger.info("Starting browser");
        browser = await puppeteer.launch({
            headless: true,
            args: ['--lang=en-US,en'],
            timeout: 120000,
        });
        await scrapping.setBrowserContext(browser);
        logger.info("Browser started");
        res.send("Browser started");
    }
    catch (err) {
        logger.error("Error when trying to start headless browser : " + JSON.stringify({ ...err }));
        res.send({ ...err });
    }
});
app.get("/start/scrapp", async (req, res) => {
    const query = { ...req.query };
    const url = query.url;
    if (url) {
        await appQueue.push(url);
        res.send("Scrapping : " + url);
    }
    else {
        logger.warn("Nothing to scrapp");
        res.send("Nothing to scrapp");
    }
});
app.get("/close", async (req, res) => {
    await scrapping.removeBrowserContext();
    await browser.close();
    browser = null;
    logger.info("Browser closed");
    res.send("Browser Closed");
});
app.get("/terminate", async (req, res) => {
    logger.warn("Process is being terminated");
    if (!browser) {
        await serverListener.close();
        logger.info("Process terminated");
        res.send("Process terminated. Any other query will not be processed anymore.");
    }
    else {
        logger.error("Browser is still connected. Close browser first");
        res.send("Browser is still connected. Close browser first ")
    }
});
app.get("/", (req, res) => {
    logger.info("🐭🌈🌍🌏🧑👨👵👳️🤶🧔🌈🐭");
    res.send({ message: "🐭🌈🌍🌏🧑👨👵👳️🤶🧔🌈" });
});

const serverListener = app.listen(process.env.PORT || 8080, "0.0.0.0", () => {
    const address = serverListener.address();
    console.log(`Server running on port : ${address.port}`);
});
