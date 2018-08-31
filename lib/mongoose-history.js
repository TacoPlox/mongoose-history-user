"use strict";
const mongoose = require('mongoose');
const hm = require('./history-model');
const async = require('async');
const contextService = require('request-context');
const deepDiff = require('./deepDiff');

function historyPlugin(schema, options) {
    const customCollectionName = options && options.customCollectionName;
    const customDiffAlgo = (options && options.customDiffAlgo) || defaultDiffAlgo;
    const diffOnly = options && options.diffOnly;
    const metadata = options && options.metadata;
    const modifiedBy = options && options.modifiedBy;
    const includeCollectionName = options && options.includeCollectionName;
    let currentUser = null;

    //------------------------------------------------------
    // Statics
    //------------------------------------------------------

    // Clear all history collection from Schema
    schema.statics.historyModel = function () {
        return hm.HistoryModel(hm.historyCollectionName(this.collection.name, customCollectionName), options);
    };

    /**
     * Clears all the history related documents from the corresponding collection.
     *
     * @param next {Function} function to call the next middleware
     */
    schema.statics.clearHistory = function (next) {
        const History = hm.HistoryModel(hm.historyCollectionName(this.collection.name, customCollectionName), options);
        History.remove({}, function (err) {
            next(err);
        });
    };

    //Manually create based on a doc + patch (e.g. for findOneAndUpdate)
    // /**
    //  * Manually create a history document, based off a given document, an optional patch to apply as a "modification".
    //  * 
    //  * @param doc {Object} the document object. This will be saved as the 'doc' property in the history
    //  * @param [patchBeforeDiff=null] {Object} an optional object with changes to apply to the object before creating the history document.
    //  * @param next {Function} function to call the next middleware
    //  */
    // schema.statics.historyPatch = function(doc, patchBeforeDiff = null, next) {
    // // _updateHook(doc, patchBeforeDiff, next);
    //
    //
    // let historyDoc = createHistoryDoc(set, 'u');
    //
    // saveHistoryModel(doc.toObject, set, historyDoc, doc.mongooseCollection.collectionName, next);
    // };


    //------------------------------------------------------
    // Middleware
    //------------------------------------------------------

    /**
     * After a model is initialized, save a copy of the original document inside '_original'. This is only called if
     * the 'diffOnly' option is truthy. The saved copy is based on calling #toObject on the model.
     */
    schema.post('init', function () {
        if (diffOnly) {
            this._original = this.toObject();
        }
    });


    /**
     * Before a model is saved, register the history for the document. This middleware is triggered on both insert and
     * updates.
     */
    schema.pre('save', function (next) {
        let operation = this.isNew ? 'i' : 'u';
        _saveHistory(this, operation, this.collection.name, null, next);
    });

    /**
     * Before a model is updated, registers a history for the document.
     */
    schema.pre('update', function (next) {
        let set = this._update.$set;

        let additionalFields = {};
        let query = this.getQuery();
        if (query) {
            query = sanitizeObj(query);

            //Add query as an additional field
            // additionalFields.query = query;
        } else {
            query = {};
        }

        let collectionName;
        if (this.mongooseCollection) {
            collectionName = this.mongooseCollection.collectionName;
        } else {
            collectionName = this.collection.name;
        }

        let historyDoc = createHistoryDoc(query, set, 'u', collectionName, additionalFields);
        saveHistoryModel(query, set, historyDoc, collectionName, next);
    });

    // Create a copy on remove
    /**
     * Before a model is removed (deleted), registers a history with the last copy available.
     */
    schema.pre('remove', function (next) {
        let doc = this.toObject();
        let historyDoc = createHistoryDoc(doc, {}, 'r', this.collection.name);

        saveHistoryModel(this.toObject(), doc, historyDoc, this.collection.name, next);
    });


    //If configured to save the current user in the history documents, add a middleware
    if (modifiedBy) {

        //Populate the modifiedBy in the find because it is not working in save
        /**
         * Before #findOne, saved a local copy of the 'current user'. The user will be queried again when creating a
         * history, with this value as fallback. This is done because querying the current user during a 'save' may
         * have issued.
         */
        schema.pre('findOne', function (next) {
            currentUser = contextService.get(modifiedBy.contextPath);
            next();
        });
    }


    //------------------------------------------------------
    // Main functions
    //------------------------------------------------------

    function _saveHistory(doc, operation, collectionName, patchBeforeDiff = null, next) {
        let historyDoc = {};

        let originalDoc = doc._original;
        delete doc._original;

        let newDoc = {};

        //When diffOnly option is truthy and it's an update, only save the diff
        if (diffOnly && !doc.isNew) {

            newDoc = doc.toObject();

            if (patchBeforeDiff) {
                applyObjectPatch(newDoc, patchBeforeDiff);
            }


            let diff = {};
            diff['_id'] = newDoc['_id'];
            for (let key in newDoc) {
                let customDiff = customDiffAlgo(key, newDoc[key], originalDoc[key]);
                if (customDiff) {
                    //HACK: To handle field deletion (when the diff would return null), we receive a String with 'null'
                    if (customDiff === 'null') {
                        customDiff = null;
                    }
                    diff[key] = customDiff
                }
            }

            historyDoc = createHistoryDoc(originalDoc, diff, 'u', collectionName);
        } else {
            newDoc = doc.toObject();
            historyDoc = createHistoryDoc(originalDoc, newDoc, operation, collectionName);
        }

        saveHistoryModel(originalDoc, newDoc, historyDoc, doc.collection.name, next);
    }


    // function _updateHook(doc, query, set, next) {
    //     // let set = _this._update.$set;
    //     let historyDoc = createHistoryUpdate(query, set, 'u');
    //
    //     saveHistoryModel(doc.toObject, set, historyDoc, doc.mongooseCollection.collectionName, next);
    // }

    function addModifiedByInfo(historyDoc) {
        if (modifiedBy) {

            //Try to fetch current user; might not work
            let _modifiedBy = contextService.get(modifiedBy.contextPath);
            if (!_modifiedBy) {
                //Fallback to user registered on init middleware
                _modifiedBy = currentUser;
            }

            //Ignore blacklisted fields
            if (modifiedBy.blacklist && modifiedBy.blacklist.length) {
                for (let i = 0; i < modifiedBy.blacklist.length; i++) {
                    let key = modifiedBy.blacklist[i];
                    _modifiedBy[key] = undefined;
                }
            }

            historyDoc['modifiedBy'] = _modifiedBy;
        }
    }

    /**
     * Creates a new basic history document object, without saving it to the database.
     *
     * @param doc {Object} document to be saved as the 'doc' field in the history
     * @param diff {Object} document to be saved as the 'diff' field in the history
     * @param operation {String} type of operation to be saved as the 'op' field in the history
     * @param collectionName {String} Name of the collection for the current model
     * @param [additionalFields=null] {Object} optional object with additional fields to add to the history document
     * root. These fields will be saved inside a 'additionalFields' field
     * @returns {{}} the created history document.
     */
    function createHistoryDoc(doc, diff, operation, collectionName, additionalFields = null) {
        //Ensure not undefined
        doc = doc || {};
        diff = diff || {};

        //Ensure no invalid keys (e.g. '$in' is not allowed in MongoDB)
        doc = sanitizeObj(doc);
        diff = sanitizeObj(diff);

        //Unset version
        doc.__v = undefined;
        diff.__v = undefined;

        let historyDoc = {};
        historyDoc['doc'] = doc;
        historyDoc['diff'] = diff;
        historyDoc['op'] = operation;
        historyDoc['date'] = new Date();
        if (includeCollectionName) {
            historyDoc['col'] = collectionName;
        }
        let docId = doc._id || diff._id || null;
        if (docId) {
            //Sometimes the "_id" field is an object. When this happens, use stringify to avoid saving "[object Object]"
            //For example:
            //{"_id":{"$in":["5b118cdccdbf3f0010a9ac51"]}}
            let emptyObj = {};
            if (docId.toString() === emptyObj.toString()) {
                historyDoc['docId'] = JSON.stringify(docId);
            } else {
                historyDoc['docId'] = docId.toString();
            }
        }

        addModifiedByInfo(historyDoc);

        if (additionalFields) {
            historyDoc['additionalFields'] = {};
            for (let key in additionalFields) {
                if (additionalFields.hasOwnProperty(key)) {
                    historyDoc['additionalFields'][key] = additionalFields[key];
                }
            }
        }

        return historyDoc;
    }

    // function createHistoryUpdate(query, set, operation) {
    //     let historyQuery = {};
    //     historyQuery['date'] = new Date();
    //     historyQuery['op'] = operation;
    //     historyQuery['doc'] = query;
    //     historyQuery['query'] = set;
    //
    //
    //     addModifiedByInfo(historyQuery);
    //    
    //     return historyQuery;
    // }

    /**
     * Saves a history model to the database. If any metadata is configured, add it to the model before saving it.
     *
     * @param originalDoc {Object} original document
     * @param newDoc {Object} new document
     * @param historyDoc {Object} the history document to save
     * @param collectionName {String} the name of the collection where the history document will be saved
     * @param next {Function} function to call the next middleware
     */
    function saveHistoryModel(originalDoc, newDoc, historyDoc, collectionName, next) {
        if (metadata) {
            setMetadata(originalDoc, newDoc, historyDoc.doc, (err) => {
                if (err) return next(err);
                let history = new hm.HistoryModel(hm.historyCollectionName(collectionName, customCollectionName), options)(historyDoc);
                history.save(next);
            });
        } else {
            let history = new hm.HistoryModel(hm.historyCollectionName(collectionName, customCollectionName), options)(historyDoc);
            history.save((err, something) => {
                next(err, something);
            });
        }
    }


    //------------------------------------------------------
    // Utils
    //------------------------------------------------------


    function applyObjectPatch(doc, patch) {
        for (var key in patch) {
            doc[key] = patch[key];
        }
    }

    function setMetadata(originalDoc, newDoc, historyDoc, callback) {
        if (!historyDoc) {
            return callback();
        }
        async.each(metadata, (keyValuePair, cb) => {
            if (typeof(keyValuePair.value) === 'function') {
                if (keyValuePair.value.length === 3) {
                    /** async function */
                    keyValuePair.value(originalDoc, newDoc, function (err, data) {
                        if (err) cb(err);
                        historyDoc[keyValuePair.key] = data;
                        cb();
                    })
                } else {
                    historyDoc[keyValuePair.key] = keyValuePair.value(originalDoc, newDoc);
                    cb();
                }
            } else {
                historyDoc[keyValuePair.key] = newDoc ? newDoc[keyValuePair.value] : null;
                cb();
            }
        }, callback)
    }

    /**
     * Ensures an object can be saved to MongoDB, replacing any invalid keys with valid ones. This is required since
     * MongoDB does not allow keys to have '$' at the start, since it's reserved for MongoDB commands
     * (e.g. '$in' is not allowed as a key, but 'in' is)
     *
     * @param obj {Object} object to sanitize
     */
    function sanitizeObj(obj) {
        //Simple approach
        return JSON.parse(
            JSON.stringify(obj)
                .replace("\"\$", "\"")
                .replace("\'\$", "\'")
        );

        //Manual approach (complex, currently doesn't work)
        // if (obj) {
        //     for (let key in obj) {
        //         if (obj.hasOwnProperty(key)) {
        //             if (key.startsWith('$')) {
        //                 let newKey = key.substr(1, key.length);
        //                 obj[newKey] = sanitizeQuery(obj[key]);
        //                 delete obj[key];
        //             } else {
        //                 obj[key] = sanitizeQuery(obj[key]);
        //             }
        //         }
        //     }
        // }
    }

    // Need this algorithm by default
    function defaultDiffAlgo(key, newValue, originalValue) {
        if (key === 'updatedAt') {
            return null;
        }
        if (originalValue && !newValue) {
            //Field was deleted
            //HACK: Returns a dummy value, to be transformed from String into null
            return 'null';
        } else if (!originalValue && newValue) {
            //Field was added
            return newValue;
        } else if (newValue instanceof Date && originalValue instanceof Date) {
            //Date change
            if (newValue.getTime() !== originalValue.getTime()) {
                return newValue;
            }
        } else if (typeof newValue === 'object' && typeof originalValue === 'object') {
            //Objects require a per field diff
            return deepDiff(originalValue, newValue, true);
        } else {
            //If any change was detected, return the new value
            if (newValue !== originalValue) {
                return newValue;
            }
        }
        return null;
    }

};

module.exports = historyPlugin;