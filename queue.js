const Datastore = require("nedb-promises");
const transformDuration = require("humanize-duration");
const path = require("path");
const queue = require("better-queue");
const uuid = require("uuid");
const scrapping = require("./scrapping");

let queueDatastore;
let logger;

const connectStore = async (cb) => {
    queueDatastore = Datastore.create(path.join(__dirname, "queue.dbne"));
    const tasks = await queueDatastore.find({});
    cb(null, tasks.length || 0);
    return;
};
const getRunningTaskFromStore = async (cb) => {
    try {
        const tasks = {};
        const tasksFromDatastore = await queueDatastore.find({});
        tasksFromDatastore.forEach((task) => {
            if (!task.lock) return;
            tasks[task.lock] = tasks[task.lock] || [];
            tasks[task.lock][task.id] = JSON.parse(task.task);
        });
        cb(null, tasks);
        return tasks;
    }
    catch (e) {
        cb(e);
    }
}
const getLockFromStore = async (lockId, cb) => {
    try {
        const tasks = {};
        const tasksFromStore = await queueDatastore.find({ lock: lockId }).project({ id: 1, task: 1 }).exec();
        tasksFromStore.forEach((task) => {
            tasks[task.id] = JSON.parse(task.task);
        });
        cb(null, tasks);
        return tasks;
    }
    catch (e) {
        cb(e);
    }
};
const getTaskFromStore = async (taskId, cb) => {
    let taskSaved;
    let task;
    try {
        task = await queueDatastore.findOne({ id: taskId, lock: "" });

        if (task === null || task === undefined) return cb();
        taskSaved = JSON.parse(task.task);
        cb(null, taskSaved);
        return taskSaved;
    }
    catch (e) {
        return cb(e);
    }
};
const putTaskInStore = async (taskId, task, priority, cb) => {
    let serializedTask;
    try {
        console.log(task);
        serializedTask = JSON.stringify(task);
        console.log({ id: taskId, task: serializedTask, priority: priority || 1, lock: "" })
        await queueDatastore.insert({ id: taskId, task: serializedTask, priority: priority || 1, lock: "" });
        cb();
        return task;
    }
    catch (e) {
        return cb(e);
    }
};
const takeNFromStore = (first) => {
    return function(n, cb) {
        const lockId = uuid.v4();
        queueDatastore.find({ lock: "" }).sort({ priority: -1, added: first ? 1 : -1 }).limit(n).project({ id: 1 }).then((ids) => {
            ids = ids.map((idValue) => idValue.id);
            queueDatastore.update({ lock: "", id: { $in: ids } }, { $set: { lock: lockId } }, { multi: true })
                .then((numUpdate) => {
                    const uuidValue = numUpdate > 0 ? lockId : "";
                    cb(null, uuidValue);
                    return uuidValue;
                })
                .catch(cb);
        }).catch(cb);
    };
};
const takeFirstNFromStore = takeNFromStore(true);
const takeLastNFromStore = takeNFromStore(false);
const releaseLockInStore = async (lockId, cb) => {
    try {
        await queueDatastore.remove({ lock: lockId });
        cb();
        return lockId;
    }
    catch (e) {
        cb(e);
    }
};

function Queue(opts = {}) {
    if (typeof(opts) === "object") {
        const wrappedDelegate = (input, cb) => {
            scrapping.delegateScrapping(input)
                .then((result) => cb(null, result))
                .catch((err) => cb(err));
        }
        const queueTemp = new queue(wrappedDelegate, { ...opts });

        queueTemp.use({
            connect: connectStore,
            getRunningTasks: getRunningTaskFromStore,
            getLock: getLockFromStore,
            getTask: getTaskFromStore,
            putTask: putTaskInStore,
            takeFirstN: takeFirstNFromStore,
            takeLastN: takeLastNFromStore,
            releaseLock: releaseLockInStore,
        });

        return queueTemp;
    }
    return null;
};
async function createJobQueue(opts = {}) {
    const jobs = Queue({ ...opts });

    jobs.on("task_accepted", (taskId) => logger?.info(`Job [${taskId}] added to the queue`));
    jobs.on("task_queued", (taskId) => logger?.info(`Job [${taskId}] waiting for process`));
    jobs.on("task_started", (taskId) => logger?.info(`Job [${taskId}] starting to be processed`));
    jobs.on("task_finish", (taskId, result, stats) => logger?.info(`Job [${taskId}] process finished in [${transformDuration(stats.elapsed)}]. Results : ${JSON.stringify(result)}`));
    jobs.on("task_failed", (taskId, error) => logger?.error(`Job terminated with some errors. ${error}`));
    jobs.on("empty", () => {});
    jobs.on("drain", () => {});

    return jobs;
};
async function setLoggerContext(loggerCtx) { logger = loggerCtx; return; }

module.exports = {
    Queue,
    createJobQueue,
    setLoggerContext,
}
