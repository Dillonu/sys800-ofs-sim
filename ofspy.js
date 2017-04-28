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

// Contains all of the functions to convert the JSON input into command-line input for the ofspy simulator:
const BUILD = {
    GROUND: function (ground, playerId, basePos) {
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
// Below are the catches. These are used to reduce how many times the same data is requested from the MongoDB server.
let federatesCache = {};
let designsCache = {};
// Manage max processes, to reduce the number of parallel simulations (to prevent running thousands):
const PROCESS_COUNT_MAX = 20;
let curProcessCount = 0;
let waitingProcess = [];
let waitingBackgroundProcess = [];

function processRun(callback, isBackground) {
    // Queue process if there is currently too many running:
    if (curProcessCount >= PROCESS_COUNT_MAX) {
        return (isBackground ? waitingBackgroundProcess : waitingProcess).push(callback);
    }

    curProcessCount += 1;
    // Run process:
    callback();
}

function processClose() {
    curProcessCount -= 1;

    // Run processes that are in the queue:
    while (curProcessCount < PROCESS_COUNT_MAX && waitingProcess.length > 0) {
        curProcessCount += 1;
        (waitingProcess.shift())();
    }
    // Run background processes that are in the queue:
    while (curProcessCount < PROCESS_COUNT_MAX && waitingBackgroundProcess.length > 0) {
        curProcessCount += 1;
        (waitingBackgroundProcess.shift())();
    }
}

exports.run = async(function (db, config, seed = 0, isBackground = false) {
    let designCollection = db.collection('designs');
    let federateCollection = db.collection('federates');

    const fetchFederate = async(function (federateId) {
        // Fetch the federate if we don't have it cached already:
        if (!federatesCache[federateId]) federatesCache[federateId] = await(federateCollection.findOne({ federateId: federateId }));

        return federatesCache[federateId];
    });

    const fetchDesign = async(function (designId) {
        // Fetch the design if we don't have it cached already:
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
    const locationAlgorithm = (config.locations === 'string' ? config.locations : '');
    let location = 1;
    let playerId = 0;
    let designArgs = [];
    if (!(config.locations instanceof Array)) config.locations = [];

    for (const federate of await(config.federateIds.map(fetchFederate))) {
        if (config.locations[playerId] == null) config.locations[playerId] = [];
        let federateLocations = config.locations[playerId];

        // In symmetrical mode, set the base offsets symmetric to give equal distance between players:
        if (locationAlgorithm === 'symmetric') location = Math.floor(playerId / federateIds.length * 6) + 1;

        // Fetch design objects based on ID:
        let designs = await(federate.designIds.map(fetchDesign));
        // Sort bases first:
        designs.sort((a, b) => {
            return a.objectType === b.objectType ? 0 : (a.objectType === 'GROUND' ? -1 : 1);
        });

        // Iterate through designs:
        for (const [index, design] of designs.entries()) {
            if (design.objectType === 'SAT') {
                location -= 1;
                if (location <= 0) location = 6;
            }

            if (federateLocations[index] == null) federateLocations[index] = location;

            designArgs.push(BUILD[design.objectType](design, playerId, federateLocations[index]));
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
            // Spawn process:
            let process = spawn('python', runArgs, { cwd: path.join(__dirname, 'ofspy', 'bin') });
            let lines = [];
            let results = '';

            process.stdout.on('data', function (data) {
                // Store result:
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

                    res.configuration.startCash.push(parseFloat(cash[0]));
                    res.results.endCash.push(parseFloat(cash[1]));

                    return res;
                }, {
                    simulation: SIM_INFO,
                    seed: seed,
                    configuration: config,
                    results: {
                        endCash: []
                    }
                }));

                // Let the process manager know this process is done:
                processClose();
            });
        }, isBackground);
    });
});