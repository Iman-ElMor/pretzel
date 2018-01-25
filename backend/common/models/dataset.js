'use strict';

var _ = require('lodash')

var acl = require('../utilities/acl')
var identity = require('../utilities/identity')
var upload = require('../utilities/upload')
var load = require('../utilities/load')

module.exports = function(Dataset) {

  Dataset.upload = function(msg, options, cb) {
    var models = this.app.models;
    if (msg.fileName.endsWith('.json')) {
      try {
        var jsonMap = JSON.parse(msg.data);
      } catch (e) {
        console.log(e);
        cb(Error("Failed to parse JSON"));
      }
      upload.json(jsonMap, models, options)
      .then(function(data) {
        cb(null, 'Success');
      })
      .catch(function(err) {
        console.log(err);
        cb(err);
      })
    } else if (msg.fileName.endsWith('.gz')) {
      var buffer = new Buffer(msg.data, 'binary');
      load.gzip(buffer).then(function(json) {
        jsonMap = json;
        upload.json(jsonMap, models)
        .then(function(data) {
          cb(null, 'Success');
        })
        .catch(function(err) {
          console.log(err);
          cb(err);
        })
      })
      .catch(function(err) {
        console.log(err);
        cb(Error("Failed to read gz file"));
      })
    } else {
      cb(Error('Unsupported file type'));
    }
  }

  Dataset.tableUpload = function(data, options, cb) {
    var models = this.app.models;
    var blocks = {};
    var datasetGroup = null;
    var blocks_by_name = [];
    var existing_blocks = [];

    models.Dataset.findById(data.dataset_id, {include: "blocks"}, options)
    .then(function(dataset) {
      if (dataset) {
        datasetGroup = dataset;
        data.features.forEach(function(feature) {
          blocks[feature.block] = false;
        });
        dataset.blocks().forEach(function(block) {
          if (block.name in blocks) {
            blocks[block.name] = true;
            existing_blocks.push(block.id);
            blocks_by_name[block.name] = block.id;
          }
        });
        // delete old features
        return models.Feature.deleteAll({blockId: {inq: existing_blocks}}, options)
      } else {
        cb(Error("Dataset not found"));
      }
    })
    .then(function(deleted_features) {
      return models.Block.updateAll({id: {inq: existing_blocks}}, {updatedAt: new Date()}, options)
    }).then(function(updated_blocks) {
      var new_blocks = [];
      Object.keys(blocks).forEach(function(name) {
        if (blocks[name] === false) {
          let payload = {
            name: name,
            datasetId: datasetGroup.id
          }
          new_blocks.push(payload);
        }
      });
      // create new blocks
      return models.Block.create(new_blocks, options);
    })
    .then(function(new_blocks) {
      new_blocks.forEach(function(block) {
        blocks_by_name[block.name] = block.id;
      });
      var array_features = [];
      data.features.forEach(function(feature) {
        array_features.push({
          name: feature.name,
          position: feature.pos,
          blockId: blocks_by_name[feature.block],
          aliases: []
        });
      });
      // create new features
      return models.Feature.create(array_features);
    })
    .then(function(new_features) {
      cb(null, "Successfully uploaded " + new_features.length + " features");
    });
  }

  Dataset.createComplete = function(data, options, cb) {
    var models = this.app.models

    //create dataset
    models.Dataset.create(data, options)
    .then(function(dataset) {
      if (dataset.__cachedRelations.blocks) {
        dataset.__cachedRelations.blocks.forEach(function(json_block) {
          json_block.datasetId = dataset.id
        })
        //create blocks
        models.Block.create(dataset.__cachedRelations.blocks, options)
        .then(function(blocks) {
          let json_workspaces = []
          blocks.forEach(function(block) {
            if (block.__cachedRelations.workspaces) {
              block.__cachedRelations.workspaces.forEach(function(json_workspace) {
                json_workspace.blockId = block.id
                json_workspaces.push(json_workspace)
              })
            }
          })
          if (json_workspaces.length > 0) {
            //create workspaces
            models.Workspace.create(json_workspaces, options)
            .then(function(workspaces) {
              let json_features = [];
              workspaces.forEach(function(workspace) {
                if (workspace.__cachedRelations.features) {
                  workspace.__cachedRelations.features.forEach(function(json_feature) {
                    json_feature.workspaceId = workspace.id
                    json_features.push(json_feature)
                  })
                }
              })
              if (json_features.length > 0) {
                //create features
                models.Feature.create(json_features, options)
                .then(function(features) {
                  cb(null, dataset.id)
                })
              } else {
                cb(null, dataset.id)
              }
            })
          } else {
            cb(null, dataset.id)
          }
        })
      } else {
        cb(null, dataset.id)
      }
    })
  }

  Dataset.remoteMethod('upload', {
    accepts: [
      {arg: 'msg', type: 'object', required: true, http: {source: 'body'}},
      {arg: "options", type: "object", http: "optionsFromRequest"}
    ],
    returns: {arg: 'status', type: 'string'},
    description: "Perform a bulk upload of a dataset with associated blocks and features"
  });
  Dataset.remoteMethod('tableUpload', {
    accepts: [
      {arg: 'data', type: 'object', required: true, http: {source: 'body'}},
      {arg: "options", type: "object", http: "optionsFromRequest"}
    ],
    returns: {arg: 'status', type: 'string'},
    description: "Perform a bulk upload of a features from tabular form"
  });
  Dataset.remoteMethod('createComplete', {
    accepts: [
      {arg: 'data', type: 'object', required: true, http: {source: 'body'}},
      {arg: "options", type: "object", http: "optionsFromRequest"}
    ],
    returns: {arg: 'id', type: 'string'},
    description: "Creates a dataset and all of its children"
  });

  acl.assignRulesRecord(Dataset)
  acl.limitRemoteMethods(Dataset)
  acl.limitRemoteMethodsRelated(Dataset)
};
