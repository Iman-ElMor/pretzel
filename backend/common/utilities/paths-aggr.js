var ObjectID = require('mongodb').ObjectID;

/*----------------------------------------------------------------------------*/

/* global exports */

/* globals defined in mongo shell */
/* global db ObjectId print */
/*----------------------------------------------------------------------------*/


/** mongo shell script to calculate aliases,
 * doesn't check namespace, only outputs string2
 * 
 * example output :
TraesCS1B01G480400
TraesCS1B01G479800
TraesCS1B01G479700
...
 *
 * @param n to limit result size in testing;  use is commented-out
 * e.g. 
 */
function alias1(n) {

var b = db.Block.aggregate ( [
 { $match : { "_id" : ObjectId("5b7f8afd43a181430b81394e") } },
 {$lookup: { from: 'Feature', localField: '_id', foreignField: 'blockId', as: 'featureObjects' }}, {$unwind: '$featureObjects' } //, { $limit: n }
, { $group: { _id: null, features : { $addToSet: "$featureObjects.name" } }   }
] )

var bf = new Set();
b.forEach ( function (b0) {b0.features.forEach(function (f) { bf.add(f); }); });

var a = db.Block.aggregate ( [
 { $match : { "_id" : ObjectId("5b7f8afd43a181430b81394d") } },
 {$lookup: { from: 'Feature', localField: '_id', foreignField: 'blockId', as: 'featureObjects' }}, {$unwind: '$featureObjects' } // , { $limit: 2 }
, { $lookup: { from: "Alias", localField: "featureObjects.name", foreignField: "string1", as: "feature_aliases" } }, {$unwind: '$feature_aliases' } // , { $limit: 2 }
, { $group: { _id: null, aliased_features : { $addToSet: "$feature_aliases.string2" } }   }
 ] )

var i = 0;  a.forEach ( function (a0) {a0.aliased_features.forEach(function (f) { if (bf.has(f) && (i++ < 10)) { print(f);  } }); });
print(i);
}

/*----------------------------------------------------------------------------*/

/** Determine aliases of features of the given block.
 *
 * Usage in mongo shell   e.g. var a = alias2(ObjectId("5b7f8afd43a181430b81394d"), 3)
 * var blockCollection = db.Block
 * @return cursor	aliases
 */
function alias2(blockCollection, blockId, n) {
  /**
   * based on 2nd .aggregate from alias1()
   * developed 31 October  14:48 - 2018-10-31T05:21:57
   * commit [develop 452d7d7] in doc/mongo_functions_alias.js
   */
  var a = blockCollection.aggregate ( [
    { $match : { "_id" : blockId } },
    {$lookup: { from: 'Feature', localField: '_id', foreignField: 'blockId', as: 'featureObjects' }}, {$unwind: '$featureObjects' }, { $limit: n }
    , { $lookup: { from: "Alias", localField: "featureObjects.name", foreignField: "string1", as: "feature_aliases" } }
    , { "$project": {
      // "_id" : 0,
      "feature_aliases": { "$slice": ["$feature_aliases", n] },
      "scope" : 1,
      "name" : 1,
      "namespace" : 1,
      "datasetId" : 1,
      "featureType" : 1,
      "featureObjects" : 1
    } }
    //, {$unwind: '$feature_aliases' }, { $limit: n }
  ]);

  return a;
}

/*----------------------------------------------------------------------------*/

/**
 * Usage in mongo shell   e.g. var bfs = blockFeaturesSet(ObjectId("5b7f8afd43a181430b81394e"), 3);
 * var blockCollection = db.Block;
 */
function blockFeaturesSet(blockCollection, blockId, n) {
	// based on first half of alias1()
	var b = blockCollection.aggregate ( [
		{ $match : { "_id" : blockId } },
		{$lookup: { from: 'Feature', localField: '_id', foreignField: 'blockId', as: 'featureObjects' }}, {$unwind: '$featureObjects' }, { $limit: n }
		, { $group: { _id: null, features : { $addToSet: "$featureObjects.name" } }   }
	] );

	var bf = new Set();
	b.forEach ( function (b0) {b0.features.forEach(function (f) { bf.add(f); }); });
	return bf;
}

/*----------------------------------------------------------------------------*/

function aliasesTo(blockCollection, blockA, blockB)
{
  /** blockA : 1A : "5b7f8afd43a181430b81394d"
   * blockB : 1B : "5b7f8afd43a181430b81394e"
   */
  let a = alias2(blockCollection, blockA, 3 );
  let ai= a.next() ;
  let a2= a.next() ;

  let bfs = blockFeaturesSet(blockCollection, blockB, 30000);

  let aliases = [];
  a2.feature_aliases.forEach(
    function (fa) {
      if (bfs.has(fa.string2)) {
        aliases.push(fa);
        // print (fa.string2);
      }
    }
  );
  return aliases;
}
exports.paths = function(blockCollection, id0, id1, options) {
  /** also aliasesTo(id1, id0) */
  let aliases = aliasesTo(blockCollection, id0, id1),
  links = aliases.map(function (a) { return {
    // map to same format as task.js:add_link()
    featureA: a.string1, 
    featureB: a.string2, 
    aliases: [{evidence: a.evidence}]
  };});

  return links;
};

/*----------------------------------------------------------------------------*/

/** Calculations to support selecting a subset of the results, sized to meet the
 * screen display space.
 *
 * This calculation seems workable for getting a subset of features of a block,
 * because the # of features in a block can be determined efficiently using the
 * index, but getting a subset of paths between 2 blocks has the complication
 * that the # of paths can't be predicted.
 * So something like this will probably be used ... still a work in progress.
 *
user slider density factor : increase density by 1/2 * or 2 *
count = # features in domain interval / (screen pixel interval / 5px)
Want to take 1 feature per count.
Have count on both B0 & B1 so calc sqrt(count0 * count1), round to integer.
 */
function densityCount(totalCounts, intervals) {
  console.log('totalCounts DC => ', totalCounts);
  // console.log('intervals.axes => ', intervals.axes);
  let pixelspacing = 5;
  // using total in block instead of # features in domain interval.
  function blockCount(total, domain, range) {
    console.log('total, domain, range => ', total, domain, range);
    return total * pixelspacing / (range[1] - range[0]);
  }
  let count,
  counts = [0, 1].map(i => {
    return blockCount(totalCounts[i], intervals.axes[i].domain, intervals.axes[i].range);
  });
    /* intervals.axes.map(function (interval) {   })*/
  count = Math.sqrt(counts[0] * counts[1]);
  count = count / intervals.page.thresholdFactor;
  count = Math.round(count);
  console.log('densityCount', count, intervals);
  return count;
}

function blockFeatures(db, blockId) {
  let featureCollection = db.collection("Feature");
  // console.log('blockFeatures', db, featureCollection);
  let nFeatures = featureCollection
    // .countDocuments( )
    .aggregate([
      { $match: {blockId : ObjectID(blockId)} },
      { $group: { _id: null, n: { $sum: 1 } } }
    ]);
  nFeatures = nFeatures.toArray();
  nFeatures.then(function (v) { console.log(`Features for ${blockId} => `, v[0].n); });
  // .estimatedDocumentCount()
  return nFeatures;
}

/** Match features by name between the 2 given blocks.  The result is the alignment, for drawing paths between blocks.
 * Usage in mongo shell  e.g.
 *  db.Block.find({"scope" : "1A"})  to choose a pair of blockIds
 *  var blockId1 = ObjectId("5b74f4c5b73fd85c2bcbc660");
 *  var blockId0 = ObjectId("5b74f4c5b73fd85c2bcb97f9");
 *  var n = 10 ;
 *  var blockCollection = db.Block
 *  pathsDirect(blockCollection, blockId0, blockId1, n)
 *
 * @param blockCollection dataSource collection
 * @param blockId0, blockId1 If the paths sought are symmetric, then pass blockId0 < blockId1.
 * @param intervals  domain and range of axes, to limit the number of features in result.
 * If intervals.dbPathFilter then intervals.axes[{0,1}].domain[{0,1}] are included in the aggregrate filter.
 * The domain[] is in the same order as the feature.value[], i.e. increasing order : 
 * domain[0] < domain[1] (for all intervals.axes[]).
 * @return cursor	aliases
 */
exports.pathsDirect = function(db, blockId0, blockId1, intervals) {
  let featureCollection = db.collection("Feature");
  console.log('pathsDirect', /*featureCollection,*/ blockId0, blockId1, intervals);
  let ObjectId = ObjectID;
  if (false) {  // work in progress @see densityCount()
    let totalCounts = [blockId0, blockId1].map((blockId) => {
      return blockFeatures(db, blockId);
    });
    let count
    Promise.all(totalCounts)
    .then(totalCounts => {
      totalCounts = totalCounts.map(item => item[0].n)
      count = densityCount(totalCounts, intervals)
      console.log('count => ', count);
    })
    // Note: an "await" on this function will work if the whole method is an async method
    // console.log('count 2 => ', count);

  }
  /* Earlier version (until aa9c2ed) matched Blocks first, then did lookup() to
   * join to Features; changed so that the first step in .aggregate() filters
   * locations based on blockId, thus getting the benefit of the Feature index,
   * and also optionally Feature location, against intervals.axes[].domain[].
   */
  let
    matchBlock =
    [
	    { $match :  {
        $or : [{ "blockId" : ObjectId(blockId0) },
               { "blockId" : ObjectId(blockId1) }]}}
    ],
  keyValue = function (k,v) { let r = {}; r[k] = v; return r; },
  /** construct the expression for one end of the interval constraint on 1 block
   * @param b 0 for blockId0, axes[0]
   * @param l limit : 0 for domain[0] and lte, 1 for domain[1] and gte
   */
  valueBound = function (b, l) {
    let r = keyValue(
      l ? '$lte' : '$gte',
      [ keyValue('$arrayElemAt', ['$value', l ? -1 : 0]),
        +intervals.axes[b].domain[l]]
    );
    return r;
  },
  /** If axis b is zoomed, append conditions on location (value[]) to the given array eq.
   *
   * If the axis has not been zoomed then Stacked : zoomed will be undefined,
   * and the result of axisDimensions() will include zoomed:undefined, which is
   * omitted in the API URL, so a.hasOwnProperty('zoomed') can be false.
   *
   * @param eq  first part of block condition; append to this array and return result
   * @return array
   */
  blockFilter = function (eq, b) {
    let a = intervals.axes[b],
    r = a.zoomed ?
      eq.concat([valueBound(b, 0), valueBound(b, 1)]) :
      eq;
    return r;
  },
  /** filter : value[0] and value[1] should be within :
   * blockId0 : [intervals.axes[0].domain[0], intervals.axes[0].domain[1]]
   * blockId1 :  [intervals.axes[1].domain[0], intervals.axes[1].domain[1]]
   * This incorporates the blockId match - matchBlock, above.
   *
   * This tests if the feature interval is in the filter interval; a better test
   * would allow for part of the feature interval to lie outside the filter
   * interval; i.e. (f0 < d0) !== (f1 < d1) or-ed with (current) :
   * (f0 > d0) && (f1 < d1)
   */
  filterValue =
    [
      { $match : {$expr : {$or : [
        {$and : blockFilter([{$eq : [ "$blockId", ObjectId(blockId0) ]}], 0) },
        {$and : blockFilter([{$eq : [ "$blockId", ObjectId(blockId1) ]}], 1) },
      ]} }},
    ],
  group = 
    [
	    { $group: {
        _id: {name : '$name', blockId : '$blockId'},
        features : { $push: '$$ROOT' },
        count: { $sum: 1 },
      }   }

      , { $group: {
        _id: { name: "$_id.name" },
        alignment: { $push: { blockId: '$_id.blockId', repeats: "$$ROOT" }}
      }}

      , { $match : { alignment : { $size : 2 } }}
    ];
  let pipeline;
  if (intervals.dbPathFilter && (intervals.axes[0].zoomed || intervals.axes[1].zoomed)) {
    let l = ['filterValue', filterValue];
    [0, 1].map(function (axis) {
      /** log intervals.axes[axis].{zoomed,domain}  .domain may be undefined or [start,end]. */
      let a = intervals.axes[axis];
      l.push(a.zoomed);
      if (a.domain)
        l = l.concat([a.domain[0], '-', a.domain[1]]);
    });
    console.log.apply(undefined, l);
    pipeline = filterValue.concat(group);
  }
  else
    pipeline = matchBlock.concat(group);

  // console.log('intervals.nSamples => ', intervals.nSamples);
  // if (intervals.nSamples)
    // pipeline.push({ '$sample' : {size : +intervals.nSamples}});
  if (intervals.nFeatures !== undefined)
    pipeline.push({ $limit: +intervals.nFeatures });

  let result =
    featureCollection.aggregate ( pipeline );


  return result;
};

/* example output; contains ObjectId() which is defined in mongo shell, not in
 * node.js, so wrap with if (false) { } */
if (false) {
var example_output_pathsDirect = 
  { "_id" : { "name" : "RAC875_rep_c72774_131" },
    "alignment" : [
      { "blockId" : ObjectId("5b74f4c5b73fd85c2bcb97f9"), "repeats" : {
        "_id" : { "name" : "RAC875_rep_c72774_131", "blockId" : ObjectId("5b74f4c5b73fd85c2bcb97f9") },
        "features" : [
          /* When the data is cleaned up it won't contain these duplicates, but if the .aggregrate can filter them out without a significant performance cost it should do so. */
          { "_id" : ObjectId("5b74f4c5b73fd85c2bcb98f4"), "name" : "RAC875_rep_c72774_131", "value" : [ 37.07 ], "blockId" : ObjectId("5b74f4c5b73fd85c2bcb97f9") },
          { "_id" : ObjectId("5b74f4c5b73fd85c2bcb98f9"), "name" : "RAC875_rep_c72774_131", "value" : [ 37.07 ], "blockId" : ObjectId("5b74f4c5b73fd85c2bcb97f9") },
          { "_id" : ObjectId("5b74f4c5b73fd85c2bcb98fa"), "name" : "RAC875_rep_c72774_131", "value" : [ 37.07 ], "blockId" : ObjectId("5b74f4c5b73fd85c2bcb97f9") } ], "count" : 3 } },
      { "blockId" : ObjectId("5b74f4c5b73fd85c2bcbc660"), "repeats" : {
        "_id" : { "name" : "RAC875_rep_c72774_131", "blockId" : ObjectId("5b74f4c5b73fd85c2bcbc660") },
        "features" : [ {
          "_id" : ObjectId("5b74f4c5b73fd85c2bcbc7bb"), "value" : [ 98 ], "name" : "RAC875_rep_c72774_131", "blockId" : ObjectId("5b74f4c5b73fd85c2bcbc660") } ], "count" : 1 } } ] }
/* { "_id" : { "name" : "wsnp_Ex_c4612_8254533" },
   ...  } */
  ;
}


/*----------------------------------------------------------------------------*/

/** Count Features within evenly sized bins (buckets) on the given block.
 * Usage e.g.
 *  var blockId="5b74f4c5b73fd85c2bcb97f9";
 *  ...
 *  var blockCollection = db.Block
 *  blockBinFeatureCount(blockCollection, blockId, 200)
 * Defaults for nBuckets and granularity are 200 and 'E192', which produces a reasonable number of buckets.
 *
 * @param blockCollection db.Block or dataSource.connector.collection("Block")
 * @param blockId
 * @param nBuckets
 * @param granularity
 * @return cursor	aliases
 */
function blockBinFeatureCount(blockCollection, blockId, nBuckets, granularity) {
  if (nBuckets === undefined)
    nBuckets = 200;
  if (granularity)
    granularity = 'E192';
  let result =
    blockCollection.aggregate ( [
	    {$match : { "_id" : ObjectId(blockId) } },
	    {$lookup: { from: 'Feature', localField: '_id', foreignField: 'blockId', as: 'featureObjects' }},
      {$unwind: '$featureObjects' },
      { $bucketAuto: { groupBy: {$arrayElemAt : ['$featureObjects.value', 0]}, buckets: nBuckets, granularity : granularity}  }
      , { $limit: 3 } // remove or comment-out after devel.
    ] );
  return result;
}


/*----------------------------------------------------------------------------*/
