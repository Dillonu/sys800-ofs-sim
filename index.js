const async = require('asyncawait/async');
const await = require('asyncawait/await');
const bodyParser = require('body-parser');
const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const path = require('path');
const spawn = require('child_process').spawn;
const url = 'mongodb://155.246.39.17:27017/orbitalFederates';
const build = {
    GROUND: function buildGround(ground, playerId, basePos) {
        return `${playerId}.GroundSta@SUR${basePos},${ground.components.join(',')}`;
    },
    SAT: function (sat, playerId, satPos) {
        if (sat.components <= 2) {
            return `${playerId}.SmallSat@MEO${satPos},${sat.components.join(',')}`;
        } else if (sat.components <= 4) {
            return `${playerId}.MediumSat@MEO${satPos},${sat.components.join(',')}`;
        } else {
            return `${playerId}.LargeSat@MEO${satPos},${sat.components.join(',')}`;
        }
    }
};

MongoClient.connect(url, async(function (err, db) {
    if (err) return console.error('Unable to connect to the mongoDB server. Error:', err);
    console.log('Connection established to', url);
    let app = express();

    app.use(bodyParser.json());
    app.use(express.static('public'));

    const runOfs = async(function (args, config) {
        return new Promise((resolve, reject) => {
            let process = spawn('python', args, { cwd: path.join(__dirname, 'ofspy', 'bin') });
            let lines = [];
            let result = '';

            process.stdout.on('data', function (data) {
                // TODO: Make sure to store seed, locations, algorithms, and design.
                result += data.toString();
            });

            process.stderr.on('data', (data) => {
                console.log(`stderr: ${data}`);
            });

            process.on('close', (code) => {
                //console.log('Connection closed');
                resolve({
                    results: result,
                    config: config
                });
            });
        });
    });

    const runSim = async(function (federateIds, count) {
        let designCollection = db.collection('designs');
        let federateCollection = db.collection('federates');
        let resultsCollection = db.collection('results');
        let sims = [];
        // Caches:
        let federatesCache = {};
        let designsCache = {};

        function getBasePos(playerId) {
            // Evenly spaces the players:
            return Math.floor((playerId - 1) / federateIds.length * 6) + 1;
        }

        const fetchFederate = async(function (federateId) {
            if (!federatesCache[federateId]) federatesCache[federateId] = await(federateCollection.findOne({ federateId: federateId }));

            return federatesCache[federateId];
        });

        const fetchDesign = async(function (designId) {
            if (!designsCache[designId]) designsCache[designId] = await(designCollection.findOne({ designId: designId }));

            return designsCache[designId];
        });

        let seeds = await(resultsCollection.find({
            'config.federateIds': federateIds,
            'config.turns': 24,
            'config.seed': { $gte: 0, $lt: count },
            'config.o': 'd6,a,1',
            'config.f': 'n'
        }).project({ _id: 0, "config.seed": 1 }).toArray()).reduce((o, s) => {
            o[s.config.seed] = true; return o;
        }, {});

        for (let seed = 0; seed < count; seed += 1) {
            if (seeds[seed]) continue; // If all done, skip

            let rand = require('random-seed').create(seed);
            let args = [path.join(__dirname, 'ofspy', 'bin', 'ofs.py')];
            let playerId = 0;

            // Build sats:
            for (const federateId of federateIds) {
                playerId += 1;
                const federate = await(fetchFederate(federateId));
                let designNum = 0;

                for (const designId of federate.designIds) {
                    const design = await(fetchDesign(designId));

                    if (design.objectType === 'GROUND') {
                        args.push(build[design.objectType](design, playerId, getBasePos(playerId)));
                    } else {
                        args.push(build[design.objectType](design, playerId, getBasePos(playerId) + designNum));
                        designNum += 1;
                    }
                }
            }

            // Run sim:
            let runArgs = args.concat([
                '-d', '24',
                '-s', `${seed}`,
                '-o', 'd6,a,1',
                '-f', 'n'
            ]);

            let config = {
                federateIds: federateIds,
                turns: 24,
                seed: seed,
                o: 'd6,a,1',
                f: 'n'
            };

            //console.log(args);
            sims.push(runOfs(runArgs, config));
        }

        // Wait for them to complete before returning
        let results = await(sims).map((result, seed) => {
            result.config.startCash = [];

            // Parse results:
            return result.results.match(/[^\r\n]+/gi).reduce((res, fed) => {
                cash = fed.split(':');

                res.config.startCash.push(parseFloat(cash[0]));
                res.results.endCash.push(parseFloat(cash[1]));

                return res;
            }, {
                config: result.config,
                results: {
                    endCash: []
                }
            });
        });

        if (results.length > 0) {
            await(resultsCollection.insert(results));
            //console.log("new", results);
        }

        console.log(federateIds);
        return await(resultsCollection.find({
            'config.federateIds': federateIds,
            'config.seed': { $gte: 0, $lt: count }
        }).toArray());
    });

    app.post('/runsim', async(function (req, res) {
        res.json(await(runSim(req.body.federateIds, req.body.count)));
    }));

    app.post('/mean', async(function (req, res) {
        let resultsCollection = db.collection('results');
        let match = {};

        for (const field of Object.keys(req.body.config)) {
            match['config.' + field] = req.body.config[field];
        }

        let results = await(resultsCollection.find(match).toArray());

        res.json(results.reduce((result, res, index, array) => {
            if (result.federateIds == null) {
                result.federateIds = res.config.federateIds;
                result.endCash = new Array(result.federateIds.length);

                for (let i = 0; i < res.config.federateIds.length; i += 1) {
                    result.endCash[i] = res.results.endCash[i] / array.length;
                }
            } else {
                for (let i = 0; i < res.config.federateIds.length; i += 1) {
                    result.endCash[i] += res.results.endCash[i] / array.length;
                }
            }

            return result;
        }, {}));
    }));

    app.listen(3000, function () {
        console.log('Example app listening on port 3000!')
    });
}));