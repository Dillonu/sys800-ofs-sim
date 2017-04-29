const async = require('asyncawait/async');
const await = require('asyncawait/await');
const bodyParser = require('body-parser');
const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const ofspy = require('./ofspy');
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/orbitalFederates';

MongoClient.connect(MONGO_URL, async(function (err, db) {
    if (err) return console.error('Unable to connect to the mongoDB server. Error:', err);
    console.log('Connection established to', MONGO_URL);
    let resultsCollection = db.collection('results');
    let app = express();

    app.use(bodyParser.json());
    app.use(express.static('public'));

    function generateMatchConfig(body) {
        let matchConfig = {};

        if (body.count != null) matchConfig.seed = { $gte: 0, $lt: body.count };

        // Handle simulation info:
        for (const field in ofspy.SIM_INFO) {
            matchConfig[`simulation.${field}`] = ofspy.SIM_INFO[field];
        }

        // TODO: Handle subfields
        // TBD: Is it necessary to have default values? Shouldn't the version of the sim account for this?
        for (const field in body.config) {
            matchConfig[`configuration.${field}`] = body.configuration[field];
        }

        // Set defaults if missing field:
        for (const field in ofspy.DEFAULT_CONFIG) {
            if (matchConfig[`configuration.${field}`] == null) matchConfig[`configuration.${field}`] = ofspy.DEFAULT_CONFIG[field];
        }

        return matchConfig;
    }

    app.post('/api/simulate', async(function (req, res) {
        req.body.count = req.body.count || 100;
        // TODO: Determine simulator to load.
        const matchConfig = generateMatchConfig(req.body);

        // Find seeds already executed:
        let alreadyExecutedSeeds = new Set(await(resultsCollection.find(matchConfig).project({ _id: 0, seed: 1 }).toArray()).map((obj) => { return obj.seed; }));

        // Start sims:
        let sims = [];
        for (let seed = 0; seed < req.body.count; seed += 1) {
            if (alreadyExecutedSeeds.has(seed)) continue; // If all done, skip

            sims.push(ofspy.run(db, req.body.configuration, seed, req.body.background));
        }

        // Wait for results to complete before returning:
        let results = await(sims);
        if (results.length > 0) {
            await(resultsCollection.insert(results));
        }

        res.json(await(resultsCollection.find(matchConfig).toArray()));
    }));

    app.get('/api/wipe', async(function (req, res) {
        let resultsCollection = db.collection('results');
        resultsCollection.drop();
        resultsCollection.createIndex({ "simulation.name": 1 });
        resultsCollection.createIndex({ "simulation.version": 1 });
        resultsCollection.createIndex({ "seed": 1 });
        resultsCollection.createIndex({ "configuration.federateIds": 1 });
        resultsCollection.createIndex({ "configuration.locations": 1 });
        resultsCollection.createIndex({ "configuration.oAlg": 1 });
        resultsCollection.createIndex({ "configuration.fAlg": 1 });
        resultsCollection.createIndex({ "configuration.turns": 1 });
        resultsCollection.createIndex({ "results.endCash": 1 });

        res.json("\"success\"");
    }));

    app.post('/api/statistics', async(function (req, res) {
        const matchConfig = generateMatchConfig(req.body);
        const field = req.body.field;
        let groupSettings = {
            _id: { federateId: "$federateId", federateIndex: "$federateIndex" }, // Aggregate federates
            count: { $sum: 1 }
        };
        let stats = req.body.statistics;

        if (stats.min == null && stats.max == null && stats.avg == null && stats.stdDev == null) {
            // If no settings are specified, default to show all:
            stats.min = true;
            stats.max = true;
            stats.avg = true;
            stats.stdDev = true;
        } else if (stats.min == false || stats.max == false || stats.avg == false || stats.stdDev == false) {
            // If one settings is false, default for all is true unless specified false:
            stats.min = (stats.min != false);
            stats.max = (stats.max != false);
            stats.avg = (stats.avg != false);
            stats.stdDev = (stats.stdDev != false);
        }

        // Based on settings, only return certain fields:
        if (stats.min) groupSettings.min = { $min: `$${field}` };
        if (stats.max) groupSettings.max = { $max: `$${field}` };
        if (stats.avg) groupSettings.avg = { $avg: `$${field}` };
        if (stats.stdDev) groupSettings.stdDev = { $stdDevPop: `$${field}` };

        const results = await(
            // TODO: Make it independent of the data structure of configuration and results.
            resultsCollection.aggregate()
                .match(matchConfig)
                .project({
                    _id: false,
                    federate: {
                        $zip: {
                            inputs: ["$configuration.federateIds", `$results.${field}`]
                        }
                    }
                })
                .unwind({
                    path: "$federate",
                    includeArrayIndex: "federateIndex"
                })
                .project({
                    federateId: { $arrayElemAt: ["$federate", 0] },
                    federateIndex: true,
                    [field]: { $arrayElemAt: ["$federate", 1] }
                })
                .group(groupSettings)
                .sort({
                    "_id.federateId": 1,
                    "_id.federateIndex": 1,
                })
                .toArray()
        );

        res.json(results);
    }));

    app.listen(3000, function () {
        console.log('Example app listening on port 3000!')
    });
}));