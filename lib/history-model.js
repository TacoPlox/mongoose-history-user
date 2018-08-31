"use strict";

const mongoose = require('mongoose');
const historyModels = {};

/**
 * Create and cache a history mongoose model
 * @param {string} collectionName Name of history collection
 * @return {mongoose.Model} History Model
 */
module.exports.HistoryModel = function (collectionName, options) {
    const indexes = options && options.indexes;
    const historyConnection = options && options.historyConnection;
    const metadata = options && options.metadata;
    const addUserWhoModifies = options && options.modifiedBy;

    let schemaObject = {
        date: { type: Date, required: true },
        op: { type: String, required: true },
        doc: { type: mongoose.Schema.Types.Mixed, required: true },
        diff: { type: mongoose.Schema.Types.Mixed, required: false },
        additionalFields: { type: mongoose.Schema.Types.Mixed, required: false },
        docId: {type: String, required: false},
        col: {type: String, required: false}
    };

    if (addUserWhoModifies) {
        schemaObject.modifiedBy = { type: addUserWhoModifies.schemaType }
    }
    if (metadata) {
        metadata.forEach((m) => {
            schemaObject[m.key] = m.schema || { type: mongoose.Schema.Types.Mixed }
        })
    }
    if (!(collectionName in historyModels)) {
        let schema = new mongoose.Schema(schemaObject, { id: true, versionKey: false });

        if (indexes) {
            indexes.forEach(function (idx) {
                schema.index(idx);
            });
        }

        if (historyConnection) {
            historyModels[collectionName] = historyConnection.model(collectionName, schema, collectionName);
        } else {
            historyModels[collectionName] = mongoose.model(collectionName, schema, collectionName);
        }

    }

    return historyModels[collectionName];
};

/**
 * Set name of history collection
 * @param {string} collectionName history collection name
 * @param {string} customCollectionName history collection name defined by user
 * @return {string} Collection name of history
 */
module.exports.historyCollectionName = function (collectionName, customCollectionName) {
    if (customCollectionName !== undefined) {
        return customCollectionName;
    } else {
        return collectionName + '_history';
    }
};
