const async = require('asyncawait/async');
const await = require('asyncawait/await');
const bodyParser = require('body-parser');
const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const ofspy = require('./ofspy');
const url = 'mongodb://localhost:27017/orbitalFederates';//'mongodb://155.246.39.17:27017/orbitalFederates';

MongoClient.connect(url, async(function (err, db) {
    if (err) return console.error('Unable to connect to the mongoDB server. Error:', err);
    console.log('Connection established to', url);
    let resultsCollection = db.collection('results');
    let app = express();

    app.use(bodyParser.json());
    app.use(express.static('public'));

    function generateMatchConfig(body) {
        let matchConfig = {};

        if (body.count != null) matchConfig.seed = { $gte: 0, $lt: body.count };

        // Handle simulation info:
        for (const field in ofspy.SIM_INFO) {
            matchConfig[`sim.${field}`] = ofspy.SIM_INFO[field];
        }

        // TODO: Handle subfields
        // TBD: Is it necessary to have default values? Shouldn't the version of the sim account for this?
        for (const field in body.config) {
            matchConfig[`config.${field}`] = body.config[field];
        }

        // Set defaults if missing field:
        for (const field in ofspy.DEFAULT_CONFIG) {
            if (matchConfig[`config.${field}`] == null) matchConfig[`config.${field}`] = ofspy.DEFAULT_CONFIG[field];
        }

        return matchConfig;
    }

    app.post('/api/simulate', async(function (req, res) {
        req.body.count = req.body.count || 100;
        // TODO: Determine simulator to load.
        const matchConfig = generateMatchConfig(req.body);

        // Find seeds already executed:
        let alreadyExecutedSeeds = new Set(await(resultsCollection.find(matchConfig).project({ _id: 0, seed: 1 }).toArray()));

        // Start sims:
        let sims = [];
        for (let seed = 0; seed < req.body.count; seed += 1) {
            if (alreadyExecutedSeeds[seed]) continue; // If all done, skip

            sims.push(ofspy.run(db, req.body.config, seed));
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
        resultsCollection.createIndex({ "sim.name": 1 });
        resultsCollection.createIndex({ "sim.version": 1 });
        resultsCollection.createIndex({ "seed": 1 });
        resultsCollection.createIndex({ "config.federateIds": 1 });
        resultsCollection.createIndex({ "config.locations": 1 });
        resultsCollection.createIndex({ "config.oAlg": 1 });
        resultsCollection.createIndex({ "config.fAlg": 1 });
        resultsCollection.createIndex({ "config.turns": 1 });
        resultsCollection.createIndex({ "results.endCash": 1 });

        res.json("\"success\"");
    }));

    app.post('/api/statistics', async(function (req, res) {
        const matchConfig = generateMatchConfig(req.body);
        let groupSettings = {
            _id: { federateId: "$federateId", federateIndex: "$federateIndex" } // Aggregate federates
        };

        if (req.body.min == null && req.body.max == null && req.body.avg == null && req.body.stdDev == null) {
            // If no settings are specified, default to show all:
            req.body.min = true;
            req.body.max = true;
            req.body.avg = true;
            req.body.stdDev = true;
        } else if (req.body.min == false || req.body.max == false || req.body.avg == false || req.body.stdDev == false) {
            // If one settings is false, default for all is true unless specified false:
            req.body.min = (req.body.min != false);
            req.body.max = (req.body.max != false);
            req.body.avg = (req.body.avg != false);
            req.body.stdDev = (req.body.stdDev != false);
        }

        // Based on settings, only return certain fields:
        if (req.body.min) groupSettings.endCashMin = { $min: "$endCash" };
        if (req.body.max) groupSettings.endCashMax = { $max: "$endCash" };
        if (req.body.avg) groupSettings.endCashAvg = { $avg: "$endCash" };
        if (req.body.stdDev) groupSettings.endCashStdDev = { $stdDevPop: "$endCash" };

        const results = await(
            resultsCollection.aggregate()
                .match(matchConfig)
                .project({
                    _id: false,
                    federate: {
                        $zip: {
                            inputs: ["$config.federateIds", "$results.endCash"]
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
                    endCash: { $arrayElemAt: ["$federate", 1] }
                })
                .group(groupSettings)
                .sort({
                    "_id.federateId": 1,
                    "_id.federateIndex": 1,
                })
                .toArray()
        );

        res.json(results);

        /*let results = await(resultsCollection.find(matchConfig).project({ _id: 0, "config.federateIds": 1, "results.endCash": 1 }).toArray());


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
        }, { seeds: results.length }));*/
    }));

    app.listen(3000, function () {
        console.log('Example app listening on port 3000!')
    });
}));