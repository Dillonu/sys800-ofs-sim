const async = require('asyncawait/async');
const await = require('asyncawait/await');
const spawn = require('child_process').spawn;
const path = require('path');
const SIM_INFO = {
    name: "ofspy",
    version: "1.0"
};
exports.SIM_INFO = SIM_INFO;
const DEFAULT_CONFIG = {
    turns: 24,
    oAlg: 'd6,a,1',
    fAlg: 'n'
};
exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
const REQUIRED_FIELDS = new Set(['federateIds']);
exports.REQUIRED_FIELDS = REQUIRED_FIELDS;
const build = {
    GROUND: function buildGround(ground, playerId, basePos) {
        return `${playerId + 1}.GroundSta@SUR${basePos},${ground.components.join(',')}`;
    },
    SAT: function (sat, playerId, satPos) {
        if (sat.components <= 2) {
            return `${playerId + 1}.SmallSat@MEO${satPos},${sat.components.join(',')}`;
        } else if (sat.components <= 4) {
            return `${playerId + 1}.MediumSat@MEO${satPos},${sat.components.join(',')}`;
        } else {
            return `${playerId + 1}.LargeSat@MEO${satPos},${sat.components.join(',')}`;
        }
    }
};
// Caches:
let federatesCache = {};
let designsCache = {};
// Manage max processes:
const PROCESS_COUNT_MAX = 20;
let curProcessCount = 0;
let waitingProcess = [];

function processRun(callback) {
    if (curProcessCount >= PROCESS_COUNT_MAX) return waitingProcess.push(callback);

    curProcessCount += 1;
    callback();
}

function processClose() {
    curProcessCount -= 1;

    while (curProcessCount < PROCESS_COUNT_MAX && waitingProcess.length > 0) {
        curProcessCount += 1;
        (waitingProcess.shift())();
    }
}

function getBasePos(playerId, federateIds) {
    // Evenly spaces the players:
    return Math.floor(playerId / federateIds.length * 6) + 1;
}

exports.run = async(function (db, config, seed = 0) {
    let designCollection = db.collection('designs');
    let federateCollection = db.collection('federates');

    const fetchFederate = async(function (federateId) {
        if (!federatesCache[federateId]) federatesCache[federateId] = await(federateCollection.findOne({ federateId: federateId }));

        return federatesCache[federateId];
    });

    const fetchDesign = async(function (designId) {
        if (!designsCache[designId]) designsCache[designId] = await(designCollection.findOne({ designId: designId }));

        return designsCache[designId];
    });

    // Check that all required fields are included:
    for (const field of REQUIRED_FIELDS) {
        if (config[field] == null) return console.error(`MISSING FIELD: ${field}`);
    }

    // Set defaults if missing field:
    for (const field in DEFAULT_CONFIG) {
        if (config[field] == null) config[field] = DEFAULT_CONFIG[field];
    }

    // Build federates:
    let playerId = 0;
    let designArgs = [];
    if (config.locations == null) config.locations = [];
    for (const federateId of config.federateIds) {
        const federate = await(fetchFederate(federateId));
        let designNum = 0;
        let designIndex = 0;
        if (config.locations[playerId] == null) config.locations[playerId] = [];

        for (const designId of federate.designIds) {
            const design = await(fetchDesign(designId));

            if (design.objectType === 'GROUND') {
                if (config.locations[playerId][designIndex] == null) config.locations[playerId][designIndex] = getBasePos(playerId, config.federateIds);

                designArgs.push(build[design.objectType](design, playerId, config.locations[playerId][designIndex]));
            } else {
                if (config.locations[playerId][designIndex] == null) config.locations[playerId][designIndex] = getBasePos(playerId, config.federateIds) + designNum;

                designArgs.push(build[design.objectType](design, playerId, config.locations[playerId][designIndex]));
                designNum += 1;
            }
            designIndex += 1;
        }
        playerId += 1;
    }

    // Run sim:
    let runArgs = [path.join(__dirname, 'ofspy', 'bin', 'ofs.py'), ...designArgs].concat([
        '-d', `${config.turns}`,
        '-s', `${seed}`,
        '-o', `${config.oAlg}`,
        '-f', `${config.fAlg}`
    ]);

    return new Promise((resolve, reject) => {
        processRun(() => {
            let process = spawn('python', runArgs, { cwd: path.join(__dirname, 'ofspy', 'bin') });
            let lines = [];
            let results = '';

            process.stdout.on('data', function (data) {
                results += data.toString();
            });

            process.stderr.on('data', (data) => {
                console.log(`stderr: ${data}`);
            });

            process.on('close', (code) => {
                //console.log('Connection closed');
                config.startCash = [];

                // Parse results:
                resolve(results.match(/[^\r\n]+/gi).reduce((res, fed) => {
                    cash = fed.split(':');

                    res.config.startCash.push(parseFloat(cash[0]));
                    res.results.endCash.push(parseFloat(cash[1]));

                    return res;
                }, {
                    sim: SIM_INFO,
                    seed: seed,
                    config: config,
                    results: {
                        endCash: []
                    }
                }));

                processClose();
            });
        });
    });
});