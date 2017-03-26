const spawn = require("child_process").spawn;
const MongoClient = require("mongodb").MongoClient;
const async = require('asyncawait/async');
const await = require('asyncawait/await');
const express = require('express');
const bodyParser = require('body-parser');
const url = 'mongodb://localhost:27017/orbitalFederates';
const build = {
    GROUND: function buildGround(ground, playerId) {
        return `${playerId}.GroundSta@SUR${playerId},${ground.components.join(",")}`;
    },
    SAT: function (sat, playerId, randomPosition) {
        if (sat.components <= 2) {
            return `${playerId}.SmallSat@MEO${randomPosition},${sat.components.join(",")}`;
        } else if (sat.components <= 4) {
            return `${playerId}.MediumSat@MEO${randomPosition},${sat.components.join(",")}`;
        } else {
            return `${playerId}.LargeSat@MEO${randomPosition},${sat.components.join(",")}`;
        }
    }
};

MongoClient.connect(url, async(function (err, db) {
    if (err) return console.error('Unable to connect to the mongoDB server. Error:', err);
    console.log('Connection established to', url);
    let app = express();

    app.use(bodyParser.json());
    app.use(express.static('public'));

    const runOfs = async(function (args) {
        return new Promise((resolve, reject) => {
            let process = spawn('python', args);
            let lines = [];

            process.stdout.on('data', function (data) {
                // TODO: Make sure to store seed, locations, algorithms, and design.
                lines.push(data.toString());
            });

            process.stderr.on('data', (data) => {
                console.log(`stderr: ${data}`);
            });

            process.on('close', (code) => {
                //console.log("Connection closed");
                console.log(lines);
                resolve(lines);
            });
        });
    });

    const runSim = async(function (federateIds, count) {
        let designCollection = db.collection('designs');
        let federateCollection = db.collection('federates');
        let sims = [];
        // Caches:
        let federatesCache = {};
        let designsCache = {};

        const fetchFederate = async(function (federateId) {
            if (!federatesCache[federateId]) federatesCache[federateId] = await(federateCollection.findOne({ federateId: federateId }));

            return federatesCache[federateId];
        });

        const fetchDesign = async(function (designId) {
            if (!designsCache[designId]) designsCache[designId] = await(designCollection.findOne({ designId: designId }));

            return designsCache[designId];
        });

        for (let seed = 0; seed < count; seed += 1) {
            let rand = require('random-seed').create(seed);
            let args = [".ofspy/bin/ofs.py"];
            let playerId = 0;

            // Build sats:
            for (const federateId of federateIds) {
                playerId += 1;
                const federate = await(fetchFederate(federateId));

                for (const designId of federate.designIds) {
                    const design = await(fetchDesign(designId));

                    args.push(build[design.objectType](design, playerId, rand(6) + 1));
                }
            }

            // Run sim:
            let runArgs = args.concat([
                "-d", "24",
                "-s", `${seed}`,
                "-o", "d6,a,1",
                "-f", "n"
            ]);

            //console.log(args);
            sims.push(runOfs(runArgs));
        }

        return await(sims); // Wait for them to complete before returning
    });

    app.post('/runsim', async(function (req, res) {
        const federateIds = req.body.federateIds || [];
        const count = req.body.count || 100;

        console.log(req.body);

        res.json(await(runSim(federateIds, count)));
    }));

    app.listen(3000, function () {
        console.log('Example app listening on port 3000!')
    });
}));