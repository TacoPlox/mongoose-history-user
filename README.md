# Mongoose History Plugin

Keeps a history of all changes of a document (And the user who made those).

THIS IS A FORK FROM [mongoose-history-user](https://www.npmjs.com/package/mongoose-history-user)

## Installation

Currently not available as an npm module. Please install it as a local npm package.

## Usage

For starting history of your collection, you need to simply add the mongoose-history plugin:

```javascript
var mongoose        = require('mongoose')
  , mongooseHistory = require('./path-to-your-folder/mongoose-history-v2')
  , Schema          = mongoose.Schema

var Post = new Schema({
    title:       String
  , message:     String
  , updated_for: String
})

Post.plugin(mongooseHistory)
```
This will generate a log from al your changes on this schema.

The plugin will create a new collection with format: originalCollectionName +  **_history**, in example: __posts_history__. You can also change the name of the collection by setting the configuration customCollectionName:

```javascript
var options = {customCollectionName: "post_hst"}
Post.plugin(mongooseHistory, options)
```

if you want to include the collection name in the history, you can use the option `includeCollectionName` as any truthy value. This will add an additional `col` value to you history documents.

```javascript
var options = {includeCollectionName: true}
Post.plugin(mongooseHistory, options)
```

The history documents have the format:

```javascript
{
    _id:  ObjectId,
    date: Date // when history was made
    op: Operation type; "i" for insert, "u" for update, and "r" when removed.
    doc: Original document
    col: Collection name. Only if the option `includeCollectionName` is truthy!
    diff: {  // changed document data; for example:
        _id:         ObjectId
      , title:       String
      , message:     String
      , updated_for: String
    }
}
```

### Indexes
To improve queries perfomance in history collection you can define indexes, for example:

```javascript
var options = {indexes: [{'date': -1, 'doc._id': 1}]};
Post.plugin(mongooseHistory, options)
```

### Send history to another database
You can keep your history collection far away from your primary database or replica set. This can be useful for improve the architecture of your system.

Just create another connection to the new database and link the reference in __historyConnection__:

```javascript
var secondConn = mongoose.createConnection('mongodb://localhost/another_conn');
var options = {historyConnection: secondConn}
Post.plugin(mongooseHistory, options)
```

### Store metadata
If you need to store additional data, use the ```metadata``` option
It accepts a collection of objects. The parameters ```key``` and ```value``` are required. 
You can specify mongoose options using the parameter ```schema``` (defaults to ```{type: mongoose.Schema.Types.Mixed}```)
```value``` can be either a String (resolved from the updated object), or a function, sync or async

```javascript
var options = {
  metadata: [
    {key: 'title', value: 'title'},
    {key: 'titleFunc', value: function(original, newObject){return newObject.title}},
    {key: 'titleAsync', value: function(original, newObject, cb){cb(null, newObject.title)}}
  ]
};
PostSchema.plugin(history,options);
module.exports = mongoose.model('Post_meta', PostSchema);
```

### Store the user that made the change (from req.user)
This will add a modifiedBy field to your documents in the history model.

First set a context in any middleware: 

```javascript
var contextService = require('request-context');
 
// wrap requests in the 'request' namespace
app.use(contextService.middleware('request'));
 
// set some object from the request object on the context
// to automatically save it when a document changes
app.use(function (req, res, next) {
    contextService.setContext('request:userInfo', req.user);
    next();
});
```

Set the type of the 'modifiedBy' field and the contextPath setted before (You can set all the user object or a reference, it's up to you):

```javascript
var options = {
    modifiedBy: {
        schemaType: mongoose.Schema.Types.ObjectId, // Can be String, ObjectId, etc.
        contextPath: 'request:userInfo',
        blacklist: [ //Optionally blacklist fields from being saved; field is optional
            'password',
            'personalInfo',
            'hugeField'
        ]
    }
};

PostSchema.plugin(mongooseHistory, options);
```

### Statics
All modules with history plugin have following methods:

#### Model.historyModel()
Get History Model of Model;

#### Model.clearHistory()
Clear all History collection;

## Development

### Testing

The tests run against a local mongodb installation and use the following databases: `mongoose-history-test` and `mongoose-history-test-second`.

Custom connection uris can be provided via environment variables for e.g. using a username and password:
```
CONNECTION_URI='mongodb://username:password@localhost/mongoose-history-test' SECONDARY_CONNECTION_URI='mongodb://username:password@localhost/mongoose-history-test-second' mocha
```

### In progress
* Plugin rewriting.
* update, findOneAndUpdate, findOneAndRemove support.

## TODO
* **TTL documents**

## LICENSE

Copyright (c) 2013-2016, Nassor Paulino da Silva <nassor@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
