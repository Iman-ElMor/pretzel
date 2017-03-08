import Ember from 'ember';

/* jshint curly : false */
/*global d3 */


export default Ember.Component.extend({

  actions: {
    updatedSelectedMarkers: function(markers) {
      let markersAsArray = d3.keys(markers)
        .map(function (key) {
          return markers[key].map(function(marker) {
            //marker contains marker name and position, separated by " ".
            var info = marker.split(" ");
            return {Map:key,Marker:info[0],Position:info[1]};
          });
        })
        .reduce(function(a, b) { 
          return a.concat(b);
        }, []);
      // console.log(markersAsArray);
      // console.log("updatedSelectedMarkers in draw-map component");
      this.sendAction('updatedSelectedMarkers', markersAsArray);
    },

    updatedStacks: function(stacks) {
      let stacksText = stacks.toString();
      // stacks.log();
      // console.log("updatedStacks in draw-map component");
      // no effect :
      this.sendAction('updatedSelectedMarkers', stacksText);  // tacks
    },

    resizeView : function()
    {
      console.log("resizeView()");
      // resize();
    }
  },

  /** Draw the maps and paths between them.
   * @param myData array indexed by myMaps[*]; each value is a hash indexed by
   * <mapName>_<chromosomeName>, whose values are an array of markers {location,
   * map:<mapName>_<chromosomeName>, marker: markerName}
   *
   * @param myMaps array of map names
   */
  draw: function(myData, myMaps) {

    // Draw functionality goes here.
    let me = this;

    /** d3Data[] is a flattened form of myData[].  Each array elt
     * is an instance of a marker in a map.
     * convert myData into format like: {map:1,marker:1,location:1}
     */
    let d3Data = [];
    /** Each stack contains 1 or more maps.
     * stacks are numbered from 0 at the left.
     * stack[i] is an array of Stack, which contains an array of Stacked,
     * which contains mapID & portion.
     */
    let stacks = [];
    /** Reference to all (Stacked) maps by mapName.
     */
    let maps = {};
    //myMaps should contain map IDs instead of mapset IDs.
    //mapIDs will be used to store map IDs
    /// mapIDs are <mapName>_<chromosomeName>
    let mapIDs = [];

/** Plan for layout of stacked axes.

graph : {chromosome{linkageGroup{}+}*}

graph : >=0  chromosome-s layed out horizontally

chromosome : >=1 linkageGroup-s layed out vertically:
  catenated, use all the space, split space equally by default,
  can adjust space assigned to each linkageGroup (thumb drag) 
*/

    /// width in pixels of the axisHeaderText, which is
    /// 30 chars when the map name contains the 24 hex char mongodb numeric id,
    /// e.g. 58a29c715a9b3a3d3242fe70_MyChr
    let axisHeaderTextLen = 203.5;
    //margins, width and height (defined but not be used)
    let m = [10+14+1, 10, 10, 10],	// margins : top right bottom left
    marginIndex = {top:0, right:1, bottom:2, left:3},	// indices into m[]; standard CSS sequence.
    viewPort = {w: document.documentElement.clientWidth, h:document.documentElement.clientHeight},

	  /// small offset from axis end so it can be visually distinguished.
    dropTargetYMargin = 10,
    dropTargetXMargin = 10,

    /// Width and Height.  viewport dimensions - margins.
    w = viewPort.w  - m[marginIndex.right] - m[marginIndex.left],
    h = viewPort.h - m[marginIndex.top] - m[marginIndex.bottom],
    /// approx height of map / chromosome selection buttons above graph
    mapSelectionHeight = 140,
    /// approx height of text name of map+chromosome displayed above axis.
    mapNameHeight = 14,
    /// approx height of text block below graph which says 'n selected markers'
    selectedMarkersTextHeight = 14,
    /// dimensions of the graph border
    graphDim = {w: w*0.6, h: h - 2 * dropTargetYMargin - mapSelectionHeight - mapNameHeight - selectedMarkersTextHeight},
    /// yRange is the axis length
    yRange = graphDim.h - 40,
    /// left and right limits of dragging the axes / chromosomes / linkage-groups.
    dragLimit = {min:-50, max:graphDim.w+70};
    console.log("viewPort=", viewPort, ", w=", w, ", h=", h, ", graphDim=", graphDim, ", yRange=", yRange);
    /// pixels.  can calculate this from map name * font width
    let
    /// x range of the axis centres. left space at left and right for
    /// axisHeaderTextLen which is centred on the axis.
    /// index: 0:left, 1:right
    axisXRange = [0 + axisHeaderTextLen/2, graphDim.w - axisHeaderTextLen/2];

    /** y[mapID] is the scale for map
     */
    let y = {},
        /** z[mapId] is a hash for map mapId mapping marker name to location.
         * i.e. z[d.map][d.marker] is the location of d.marker in d.map.
         */
        z = {}, // will contain map/marker information
        /** All marker names.
         * Initially a set (to determine unique names), then converted to an array.
         */
        d3Markers = new Set(),
        showAll = false;

    let line = d3.line(),
        axis = d3.axisLeft(),
        foreground,
        // brushActives = [],
        brushExtents = [];

    /**
     * @return true if a is in the closed interval range[]
     * @param a value
     * @param range array of 2 values - limits of range.
     */
    function inRange(a, range)
    {
      return range[0] <= a && a <= range[1];
    }

    /** Used for group element, class "map"; required because id may start with
     * numeric mongodb id (of geneticmap) and element id cannot start with
     * numeric.
     * Not required for axis element ids because they have "m" suffix.
     */
    function eltId(name)
    {
      return "id" + name;
    }

    /*------------------------------------------------------------------------*/
    function Stacked(mapName, portion) {
      this.mapName = mapName;
      /** Portion of the Stack height which this map axis occupies. */
      this.portion = portion;
      // The following are derived attributes.
      /** .position is accumulated from .portion.
       * .position is [start, end], relative to the same space as portion.
       * i.e. .portion = (end - start) / (sum of .portion for all maps in the same Stack).
       * Initially, each map is in a Stack by itself, .portion === 1, so
       * .position is the whole axis [0, 1].
       */
      this.position = (portion === 1) ? [0, 1] : undefined;
      /** Reference to parent stack.  Set in Stack.prototype.{add,insert}(). */
      this.stack = undefined;
      /* map objects persist through being dragged in and out of Stacks. */
      maps[mapName] = this;
    };
    Stacked.prototype.mapName = undefined;
    Stacked.prototype.portion = undefined;
    function positionToString(p) { return (p === undefined) ? "" : "[" + p[0] + ", " + p[1] + "]"; }
    Stacked.prototype.toString = function ()
    {
      let a =
        [ "{mapName=", this.mapName, ", portion=" + this.portion,
          positionToString(this.position) + this.stack.length, "}" ];
      return a.join("");
    };
    Stacked.prototype.log = function ()
    {
      console.log
      ("{mapName=", this.mapName, ", portion=", this.portion,
       this.position, this.stack,  "}");
    };
    Stacked.mapName_match =
      function (mapName)
    { return function (s) { return s.mapName == mapName; };};
    Stacked.prototype.yOffset = function ()
    {
      let yOffset = yRange * this.position[0];
      if (Number.isNaN(yOffset))
      {
        console.log("Stacked#yOffset", yRange, this.position);
        debugger;
      }
      return yOffset;
    };
    Stacked.prototype.yRange = function ()
    {
      return yRange * this.portion;
    };
    /** Constructor for Stack type.
     * Construct a Stacked containing 1 map (mapName, portion),
     * and push onto this Stack.
     */
    function Stack(stackable) {
      /** The map object (Stacked) has a reference to its parent stack which is the inverse of this reference : 
       * maps{mapName}->stack->maps[i] == maps{mapName} for some i.
       */
      this.maps = [];
      Stack.prototype.add = Stack_add;
      this.add(stackable);
    };
    /** undefined, or references to the map (Stack) which is currently dropped
     * and the Stack which it is dropped into
     * static
     */
    Stack.prototype.currentDrop = undefined;
    /** @return true if this.maps[] is empty. */
    Stack.prototype.empty = function ()
    {
      return this.maps.length == 0;
    };
    Stack.prototype.toString = function ()
    {
      let a =
        [
        "{maps=[",
        this.maps.map(function(s){return s.toString();}),
        "] length=" + this.maps.length + "}"
        ];
      return a.join("");
    };
    Stack.prototype.log = function ()
    {
      console.log("{maps=[");
      this.maps.forEach(function(s){s.log();});
      console.log("] length=", this.maps.length, "}");
    };
    /** Log all stacks. static. */
    stacks.log = 
    Stack.log = function()
    {
      console.log("{stacks=[");
      stacks.forEach(function(s){s.log();});
      console.log("] length=", stacks.length, "}");
    };
    /** Append the given stack to stacks[]. */
    stacks.append = function(stack)
    {
      stacks.push(stack);
    };
    /** Insert the given stack into stacks[] at index i. */
    stacks.insert = function(stack, i)
    {
      stacks = stacks.insertAt(i, stack);
    };
    Stack.prototype.add = function(stackable)
    {
      this.maps.push(stackable);
      stackable.stack = this;
      maps[stackable.mapName] = stackable;
    };
    Stack.prototype.addMap = function(mapName, portion)
    {
      let sd = new Stacked(mapName, portion);
      this.add(sd);
    };
    /** Method of Stack.  @see Stack.prototype.add().
     * Add the given map to this Stack.
     * @param sd  (stackable) Stacked / map to add
     */
    function Stack_add (sd)
    {
      this.maps.push(sd);
      sd.stack = this;
    };
    /** Insert stacked into maps[] at i, moving i..maps.length up
     * @param i  same as param start of Array.splice()
     * @see {@link https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Array/splice | MDN Array Splice}
     */
    Stack.prototype.insert = function (stacked, i)
    {
      let len = this.maps.length;
      // this is supported via splice, and may be useful later, but initially it
      // would indicate an error.
      if ((i < 0) || (i > len))
        console.log("insert", stacked, i, len);

      this.maps = this.maps.insertAt(i, stacked);
      /* this did not work (in Chrome) : .splice(i, 0, stacked);
       * That is based on :
       * https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
       * Similarly in 2 other instances in this file, .removeAt() is used instead of .splice().
       */

      stacked.stack = this;
    };
    /** Find mapName in this.maps[]. */
    Stack.prototype.findIndex = function (mapName)
    {
      let mi = this.maps.findIndex(Stacked.mapName_match(mapName));
      return mi;
    };
    /** Find mapName in this.maps[] and remove it.
     * @return the map, or undefined if not found
     */
    Stack.prototype.remove = function (mapName)
    {
      let si = this.findIndex(mapName);
      if (si < 0)
      {
        console.log("Stack#remove named map not in this stack", this, mapName);
        return undefined;
      }
      else
      {
        let s = this.maps[si];
        this.maps = this.maps.removeAt(si, 1);
          // .splice(si, 1);
        return s;
      }
    };
    /** Remove this Stack from stacks[].
     * @return false if not found, otherwise it is removed
     */
    Stack.prototype.delete = function ()
    {
      let si = stacks.indexOf(this);
      let ok = false;
      if (si < 0)
        console.log("Stack#delete program error: not found", this, stacks);
      else if (this !== stacks[si])
        console.log("Stack#delete program error: found value doesn't match",
                    this, stacks, si, stacks[si]);
      else
      {
        stacks = stacks.removeAt(si, 1);
          // .splice(si, 1);
        ok = true;
      }
      return ok;
    };
    /**
     * move map from one stack to another
     * first stack is empty - delete it
     * 2nd stack is new - create it (gui ? drag outside of top/bottom drop zones.)
     * @param mapName name of map to move
     * @param toStack stack to move map to
     * @param insertIndex  index in toStack.maps[] to insert

     * if toStack is undefined, create a new Stack to move the map into;

     * the following is not done, instead dragged() assigns x location to new stack and sorts :
     * it is placed at maps[0], so insertIndex is re-purposed to indicate the position
     * in stacks[] to insert the new Stack.
     * @return the map, or undefined if not found
     */
    Stack.prototype.move = function (mapName, toStack, insertIndex)
    {
      let s = this.remove(mapName);
      // if mapName is not in this.maps[], do nothing
      let ok = s !== undefined;
      if (ok)
      {
        if (toStack === undefined)
        {
          toStack = new Stack(s);
          stacks.append(toStack);
        }
        else
          toStack.insert(s, insertIndex);
        if (this.empty())
          this.delete();
        me.send('updatedStacks', stacks);
      }
      return ok;
    };
    /** Shift named map to a different position within this Stack.
     * Portions will be unchanged, positions will be re-calculated.
     * Find mapName in this.maps[] and move it.

     * @param mapName name of map to move
     * @param insertIndex  index in toStack.maps[] to insert
     * @return the map, or undefined if not found
     */
    Stack.prototype.shift = function (mapName, insertIndex)
    {
      let si = this.findIndex(mapName);
      if (si < 0)
      {
        console.log("Stack#remove named map not in this stack", this, mapName);
        return undefined;
      }
      else
      {
        let s = this.maps[si];
        console.log("shift(), before removeAt()", this, mapName, insertIndex, this.maps.length, s);
        this.log();
        this.maps = this.maps.removeAt(si, 1);
        let len = this.maps.length;
        this.log();
        if (insertIndex >= len)
          console.log("shift()", this, mapName, insertIndex, " >= ", len, s);
        let insertIndexPos = (insertIndex < 0) ? len + insertIndex : insertIndex;
        // splice() supports insertIndex<0; if we support that, this condition need
        if (si < insertIndexPos)
          insertIndexPos--;
        this.maps = this.maps.insertAt(insertIndexPos, s);
        console.log("shift(), after insertAt()", insertIndexPos, this.maps.length);
        this.log();
        return s;
      }
    };
    /** @return true if this Stack contains mapName
     */
    Stack.prototype.contains = function (mapName)
    {
      return this === maps[mapName].stack;
    };
    /** Insert the named map into this.maps[] at insertIndex (before if top, after
     * if ! top).
     * Preserve the sum of this.maps[*].portion (which is designed to be 1).
     * Give the new map a portion of 1/n, where n == this.maps.length after insertion.
     *
     * share yRange among maps in stack
     * (retain ratio among existing maps in stack)
     *
     * @param mapName name of map to move
     * @param insertIndex position in stack to insert at.
     * @param true for the DropTarget at the top of the axis, false for bottom.
     */
    Stack.prototype.dropIn = function (mapName, insertIndex, top)
    {
      console.log("dropIn", this, mapName, insertIndex, top);
      // can now use  maps[mapName].stack
      let fromStack = Stack.mapStack(mapName);
      /* It is valid to drop a map into the stack it is in, e.g. to re-order the maps.
       * No change to portion, recalc position.
       */
      if (this === fromStack)
      {
        console.log("Stack dropIn() map ", mapName, " is already in this stack");
        this.shift(mapName, insertIndex);
        return;
      }
      Stack.prototype.currentDrop = {stack: this, 'mapName': mapName, dropInTime : Date.now()};
      if (! top)
        insertIndex++;
      let ok =
        fromStack.move(mapName, this, insertIndex);
      if (ok)
      {
        /** the inserted map */
        let inserted = this.maps[insertIndex];
        inserted.stack = this;
        // apart from the inserted map,
        // reduce this.maps[*].portion by factor (n-1)/n
        let n = this.maps.length,
        factor = (n-1)/n;
        inserted.portion = 1/n;
        this.maps.forEach(
          function (m, index) { if (index != insertIndex) m.portion *= factor; });
        this.calculatePositions();
      }
    };
    /** Drag the named map out of this Stack.
     * Create a new Stack containing just the map.
     *
     * re-allocate portions among remaining maps in stack
     * (retain ratio among existing maps in stack)
     *
     * @param mapName name of map to move
     */
    Stack.prototype.dropOut = function (mapName)
    {
      console.log("dropOut", this, mapName);
      /* passing toStack===undefined to signify moving map out into a new Stack,
       * and hence insertIndex is also undefined (not used since map is only map
       * in newly-created Stack).
      */
      let ok =
      this.move(mapName, undefined, undefined);
      /* move() will create a new Stack for the map which was moved out, and
       * add that to Stacks.  dragged() will assign it a location and sort.
       */

      if (ok)
      {
        // mapName goes to full height. other maps in the stack take up the released height proportionately
        let map = maps[mapName],
        released = map.portion;
        map.portion = 1;
        let n = this.maps.length,
        factor = 1 + released/n;
        this.maps.forEach(
          function (m, index) { m.portion *= factor; });
        this.calculatePositions();
      }
    };
    /** Calculate the positions of the maps in this stack
     * Position is a proportion of yRange.
     */
    Stack.prototype.calculatePositions = function ()
    {
      let sumPortion = 0;
      this.maps.forEach(
        function (m, index)
        {
          m.position = [sumPortion,  sumPortion += m.portion];
        });
    };
    /** find / lookup Stack of given map.
     * static
     */
    Stack.mapStack = function (mapName)
    {
      // could use a cached structure such as mapStack[mapName].
      // can now use : maps{mapName}->stack
      let ms = stacks.filter(
        function (s) {
          let i = s.findIndex(mapName);
          return i >= 0;
        });
      if (ms.length != 1)
        console.log("mapStack()", mapName, ms, ms.length);
      return ms[0];
    };
    /** find / lookup Stack of given map.
     * static
     * @return an array (because reduce() doesn't stop at 1)
     * of {stackIndex: number, mapIndex: number}.
     * It will only accumulate the first match (mapIndex) in each stack,
     * but by design there should be just 1 match across all stacks.
     */
    Stack.mapStackIndex = function (mapName)
    {
      /** called by stacks.reduce() */
      function findIndex_mapName
      (accumulator, currentValue, currentIndex /*,array*/)
      {
        let i = currentValue.findIndex(mapName);
        if (i >= 0)
          accumulator.push({stackIndex: currentIndex, mapIndex: i});
        return accumulator;
      };
      let ms = stacks.reduce(findIndex_mapName, []);
      if (ms.length != 1)
      {
        console.log("mapStackIndex()", mapName, ms, ms.length);
      }
      return ms[0];
    };
    /** @return transform : translation, calculated from map position within stack.
     */
    Stacked.prototype.mapTransform = function ()
    {
      if (this.position === undefined || yRange === undefined)
      {
        console.log("mapTransform()", this.mapName, this, yRange);
        debugger;
      }
      let yOffset = this.yOffset(),
      yOffsetText = Number.isNaN(yOffset) ? "" : "," + this.yOffset();
      let scale = this.portion,
      scaleText = Number.isNaN(scale) ? "" : " scale(" + scale + ")";
      let transform =
        [
          "translate(" + x(this.mapName), yOffsetText, ")",
          scaleText
        ].join("");
      console.log("mapTransform", this, transform);
      return transform;
    };
    /** Get stack of map, return transform. */
    Stack.prototype.mapTransform = function (mapName)
    {
      let m = maps[mapName];
      return m.mapTransform();
    };
    /** For each map in this Stack, redraw axis, brush, foreground paths.
     * @param mapName is redrawn by dragged, so skip it.
     */
    Stack.prototype.redraw = function (mapName)
    {
      let t = d3.transition().duration(500);
      // only 2 stacks are modified, but others will re-position.
      if (false)
      {
      this.maps.forEach(
        function (m, index)
        {
          // m.mapTransform()
        });
      }
      t.selectAll(".map").attr("transform", Stack.prototype.mapTransform);
    };

    /*------------------------------------------------------------------------*/

    // Unpack data from myData[] into d3Data[], mapIDs[];
    // cache of locations z[] is cleared here, and accumulated in d3Data.forEach() below.
    //Convert the data into proper format
    //myMaps mapset ID
    myMaps.forEach(function(i){
      //map ID
      let mIDs = Object.keys(myData[i]);
      //List of objects 
      //e.g.
      //location:36.2288
      //map:"1-1A"
      //marker:"IWB6476"
      mIDs.forEach(function(mapID) {
        /// array of markers
        let dataToArray = myData[i][mapID].toArray();
        //Push the values from the array to d3Data.
        d3Data.push.apply(d3Data, dataToArray);
        mapIDs.push(mapID);
        z[mapID] = {};
      });
    });
    /** x scale which maps from mapIDs[] to equidistant points in axisXRange
     */
    //d3 v4 scalePoint replace the rangePoint
    //let x = d3.scaleOrdinal().domain(mapIDs).range([0, w]);
    function xScale() {
      return d3.scalePoint().domain(mapIDs).range(axisXRange);
    }
    let x = xScale();
    /** scaled x value of each map, indexed by mapIDs */
    let o = {};

    let zoomSwitch,resetSwitch;
    let zoomed = false;
    // let reset = false;

    let pathMarkers = {}; //For tool tip

    let selectedMaps = [];
    let selectedMarkers = {};
    let brushedRegions = {};

    //Reset the selected Marker region, everytime a map gets deleted
    me.send('updatedSelectedMarkers', selectedMarkers);

    function collateO() {
      mapIDs.forEach(function(d){
        o[d] = x(d);
      });
    }
    collateO();
    mapIDs.forEach(function(d){
      // initial stacking : 1 map per stack, but later when db contains Linkage
      // Groups, can automatically stack maps.
      let sd = new Stacked(d, 1),
      stack = new Stack(sd);
      stacks.append(stack);
      stack.calculatePositions();
    });
    //let dynamic = d3.scaleLinear().domain([0,1000]).range([0,1000]);

    // Compile positions of all markers, and a hash of marker names.
    d3Data.forEach(function(d) {
      z[d.map][d.marker] = +d.location;
      //console.log(d.map + " " + d.marker + " " + d.location);
      // If d3Markers does not contain d.marker then add it.
      d3Markers.add(d.marker);
    });
    
    //creates a new Array instance from an array-like or iterable object.
    d3Markers = Array.from(d3Markers);
    //console.log(axis.scale(y[mapIDs))
    
    mapIDs.forEach(function(d) {
      /** Find the max of locations of all markers of map name d. */
      let yDomainMax = d3.max(Object.keys(z[d]), function(a) { return z[d][a]; } );
      let m = maps[d], myRange = m.yRange();
      y[d] = d3.scaleLinear()
               .domain([0, yDomainMax])
               .range([0, myRange]); // set scales for each map
      
      //console.log("OOO " + y[d].domain);
      y[d].flipped = false;
      y[d].brush = d3.brushY()
                     .extent([[-8,0],[8,myRange]])
                     .on("end", brushended);
    });

    d3.select("svg").remove();
    d3.select("div.d3-tip").remove();
    let translateTransform = "translate(" + m[marginIndex.left] + "," + m[marginIndex.top] + ")";
    let svgContainer = d3.select('#holder').append('svg')
                         .attr("viewBox", "0 0 " + graphDim.w + " " + graphDim.h)
                         .attr("preserveAspectRatio", "xMinYMin meet")
                         .attr('width', "100%" /*graphDim.w*/)
                         .attr('height', graphDim.h /*"auto"*/)
                         .append("svg:g")
                         .attr("transform", translateTransform);

    //User shortcut from the keybroad to manipulate the maps
    d3.select("#holder").on("keydown", function() {
      if ((String.fromCharCode(d3.event.keyCode)) == "D") {
        console.log("Delete Map (not implemented)");
        // deleteMap();
      }
      else if ((String.fromCharCode(d3.event.keyCode)) == "Z") {
        zoomMap();
      }
      else if ((String.fromCharCode(d3.event.keyCode)) == "R") {
        refreshMap();
      }
      else if ((String.fromCharCode(d3.event.keyCode)) == "A") {
        showAll = !showAll;
        refreshMap();
      }
      else if ((String.fromCharCode(d3.event.keyCode)) == " ") {
        console.log("space");
      }
    });

    //Add foreground lines.
    foreground = svgContainer.append("g") // foreground has as elements "paths" that correspond to markers
                .attr("class", "foreground")
                .selectAll("g")
                .data(d3Markers) // insert map data into path elements (each line of the "map" is a path)
                .enter()
                .append("g")
                .attr("class", function(d) { return d; });
    
    
    d3Markers.forEach(function(m) { 
      d3.selectAll("."+m)
        .selectAll("path")
        .data(path(m))
        .enter()
        .append("path")
        .attr("d", function(d) { return d; });
    });

    // Add a group element for each stack.
    // Stacks contain 1 or more maps.
    /** selection of stacks */
    let stackS = svgContainer.selectAll(".stack")
        .data([stacks])
        .enter().append("g")
        .attr("class", "stack");

    // Add a group element for each map.
    // Stacks are selection groups in the result of this .selectAll()
    let g = stackS.selectAll(".map")
        .data(mapIDs)
        .enter().append("g")
        .attr("class", "map")
        .attr("id", function(d) { return eltId(d); })
        .attr("transform", Stack.prototype.mapTransform)
        .call(d3.drag()
          .subject(function(d) { return {x: x(d)}; }) //origin replaced by subject
          .on("start", dragstarted) //start instead of dragstart in v4. 
          .on("drag", dragged)
          .on("end", dragended));//function(d) { dragend(d); d3.event.sourceEvent.stopPropagation(); }))

    /*------------------------------------------------------------------------*/
    /** the DropTarget which the cursor is in, recorded via mouseover/out events
     * on the DropTarget-s.  While dragging this is used to know the DropTarget
     * into which the cursor is dragged.
     */
    let currentDropTarget /*= undefined*/;

	  function DropTarget() {
      let size = {
      w : Math.min(axisHeaderTextLen, viewPort.w/7),
      // height of dropTarget at the end of an axis
      h : Math.min(80, viewPort.h/10),
      // height of dropTarget covering the adjacent ends of two stacked axes
      h2 : Math.min(80, viewPort.h/10) * 2 /* + axis gap */
      },
	    posn = {
	    X : size.w/2,
      Y : /*YMargin*/10 + size.h
	    },
      /** top and bottom edges relative to the map's transform. bottom depends
       * on the map's portion
       */
      edge = {
        top : size.h,
        bottom : function (map) { return map.yRange() - size.h; }
      };
      DropTarget.prototype.map = function ()
      {
        let mapName = this.datum(),
        map = maps[mapName];
      };
      /// @parameter top  true or false to indicate zone is positioned at top or
      /// bottom of axis
      /// uses g, a selection <g> of all maps
      DropTarget.prototype.add = function (top)
      {
        // Add a target zone for axis stacking drag&drop
        let stackDropTarget = 
          g.append("g")
          .attr("class", "stackDropTarget" + " end " + (top ? "top" : "bottom"));
        let
          dropTargetY = function (datum, index, group) {
            let mapName = datum,
            map = maps[mapName],
            yVal = top ? -dropTargetYMargin : edge.bottom(map);
          return yVal;
        };
        stackDropTarget
          .append("rect")
          .attr("x", -posn.X)
          .attr("y", dropTargetY)
          .attr("width", 2 * posn.X)
          .attr("height", posn.Y)
        ;

      stackDropTarget
        .on("mouseover", dropTargetMouseOver)
        .on("mouseout", dropTargetMouseOut);
      };

      /// @parameter left  true or false to indicate zone is positioned at left or
      /// right of axis
      DropTarget.prototype.addMiddle = function (left)
      {
        // Add a target zone for axis stacking drag&drop
        let stackDropTarget = 
          g.append("g")
          .attr("class", "stackDropTarget" + " middle " + (left ? "left" : "right"));
        function dropTargetHeight(datum, index, group)
        {
          console.log("dropTargetHeight", datum, index, group);
          let mapName = datum,
          map = maps[mapName];
          return map.yRange() - 2 * size.h;
        }
        stackDropTarget
          .append("rect")
          .attr("x", left ? -1 * (dropTargetXMargin + posn.X) : dropTargetXMargin )
          .attr("y", edge.top)
          .attr("width", posn.X /*- dropTargetXMargin*/)
          .attr("height", dropTargetHeight)
        ;

      stackDropTarget
        .on("mouseover", dropTargetMouseOver)
        .on("mouseout", dropTargetMouseOut);
      };

      function storeDropTarget(mapName, classList)
      {
        currentDropTarget = {mapName: mapName, classList: classList};
      }

      function dropTargetMouseOver(data, index, group){
        console.log("dropTargetMouseOver() ", this, data, index, group);
        console.log(data);
        this.classList.add("dragHover");
        storeDropTarget(data, this.classList);
      }
      function dropTargetMouseOut(d){
        console.log("dropTargetMouseOut", d);
        console.log(d);
        this.classList.remove("dragHover");
        currentDropTarget = undefined;
      }

    };
    let dropTarget = new DropTarget();

    [true, false].forEach(function (i) {
       dropTarget.add(i);
      dropTarget.addMiddle(i);
    });



    // Add an axis and title
    g.append("g")
     .attr("class", "axis")
      .each(function(d) { d3.select(this).attr("id","m"+d).call(axis.scale(y[d])); });  

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", -12)
      .style("font-size",12)
      .text(String);

      
    // Add a brush for each axis.
    g.append("g")
      .attr("class", "brush")
      .each(function(d) { d3.select(this).call(y[d].brush); });

    //Setup the tool tip.
    let toolTip = d3.select("body").append("div")
                    .attr("class", "toolTip")
                    .attr("id","toolTip")
                    .style("opacity", 0);
    //Probably leave the delete function to Ember
    //function deleteMap(){
    //  console.log("Delete");
    //}


//d3.selectAll(".foreground g").selectAll("path")
    /* (Don, 2017Mar03) my reading of handleMouse{Over,Out}() is that they are
     * intended only for the paths connecting markers in adjacent maps, not
     * e.g. the path in the y axis. So I have narrowed the selector to exclude
     * the axis path.  More exactly, these are the paths to include and exclude,
     * respectively :
     *   svgContainer > g.foreground > g.<markerName> >  path
     *   svgContainer > g.stack > g.map > g.axis#m<mapName> > path
     * (mapName is e.g. 58b504ef5230723e534cd35c_MyChr).
     * This matters because axis path does not have data (observed issue : a
     * call to handleMouseOver() with d===null; reproduced by brushing a region
     * on an axis then moving cursor over that axis).
     */
    d3.selectAll(".foreground > g > path")
      .on("mouseover",handleMouseOver)
      .on("mouseout",handleMouseOut);

    /**
     * @param d   SVG path data string of path
     * @param this  path element
     */
    function handleMouseOver(d){
      //console.log(pathMarkers[d]);
       let t = d3.transition()
                 .duration(800)
                 .ease(d3.easeElastic);
       let listMarkers  = "";
       d3.select(this).transition(t)
          .style("stroke", "#880044")
          .style("stroke-width", "6px")
          .style("stroke-opacity", 1)
          .style("fill", "none");       
       toolTip.style("height","auto")
         .style("width","auto")
         .style("opacity", 0.9)
         .style("display","inline");  
       Object.keys(pathMarkers[d]).map(function(m){
         listMarkers = listMarkers + m + "<br />";
       });
       toolTip.html(listMarkers)     
         .style("left", (d3.event.pageX) + "px")             
         .style("top", (d3.event.pageY - 28) + "px");
    }

    function handleMouseOut(/*d*/){
      let t = d3.transition()
                .duration(800)
                .ease(d3.easeElastic);
      //Simple solution is to set all styles to null, which will fix the confusion display with brush. Note: tried css class, maybe my way is not right, but it didn't work.
      d3.select(this).transition(t)
           .style("stroke", null)
           .style("stroke-width", null)
           .style("stroke-opacity",null)
           .style("fill", null);
      toolTip.style("display","none");
    }


    function zoomMap(){
      console.log("Zoom");
    }
    function refreshMap(){
      console.log("Refresh");
    }
    /** A line between a marker's location in adjacent maps.
     * @param k1, k2 indices into mapIDs[]
     * @param d marker name
     */
    function markerLine2(k1, k2, d)
    {
      let mk1 = mapIDs[k1],
          mk2 = mapIDs[k2];
      return line([[o[mk1], markerY(k1, d)],
                   [o[mk2], markerY(k2, d)]]);
    }
    /** Similar to @see markerLine2().
     * @param k index into mapIDs[]
     * @param d marker name
     * @param xOffset add&subtract to x value, measured in pixels
     */
    function markerLine(k, d, xOffset)
    {
      let mk = mapIDs[k],
      mkY = markerY(k, d);
      return line([[o[mk]-xOffset, mkY],
                   [o[mk]+xOffset, mkY]]);
    }
    // Returns an array of paths (links between maps) for a given marker.
    function path(d) { // d is a marker
        let r = [];

        for (let k=0; k<mapIDs.length-1; k++) {
          let m_k  = mapIDs[k],
              m_k1 = mapIDs[k+1];
            if (d in z[m_k] && d in z[m_k1]) { // if markers is in both maps
                 //Multiple markers can be in the same path
              let sLine = markerLine2(k, k+1, d);
                //pathMarkers[sLine][d] = 1;
                if(pathMarkers[sLine] != null){
                   pathMarkers[sLine][d] = 1;
                } else {
                   pathMarkers[sLine]= {};
                   pathMarkers[sLine][d] = 1;
                }
                r.push(sLine);
            }
            else if (showAll) {
                if (d in z[m_k]) { 
                  r.push(markerLine(k, d, 5));
                }
                if (d in z[m_k1]) {
                    r.push(markerLine(k+1, d, 5));
                }
            }
        }
        return r;
    }

    /** Calculate relative marker location in the map
     * @param k index into mapIDs[]
     * @param d marker name
     */
    function markerY(k, d)
    {
      return y[mapIDs[k]](z[mapIDs[k]][d]);
    }

    // Returns an array of paths (links between maps) for a given marker when zoom in starts.
    function zoomPath(d) { // d is a marker
        let r = [];
        for (let k=0; k<mapIDs.length-1; k++) {
           //y[p].domain
           //z[mapIDs[k]][d] marker location

            if (d in z[mapIDs[k]] && d in z[mapIDs[k+1]]) { // if markers is in both maps
              /** relative marker location in the map of 2 markers, k and k+1 :
               * k  : markerYk[0]
               * k+1: markerYk[1]
               */
              let markerYk = [markerY(k, d), markerY(k+1, d)];
              // Filter out those paths that either side locates out of the svg
              if (inRange(markerYk[0], [0, yRange]) &&
                  inRange(markerYk[1], [0, yRange])) {
                        let sLine = line([[o[mapIDs[k]], markerYk[0]],
                             [o[mapIDs[k+1]], markerYk[1]]]);
                        if(pathMarkers[sLine] != null){
                          pathMarkers[sLine][d] = 1;
                        } else {
                          pathMarkers[sLine]= {};
                          pathMarkers[sLine][d] = 1;
                        }
                        r.push(line([[o[mapIDs[k]], markerYk[0]],
                             [o[mapIDs[k+1]], markerYk[1]]]));
                  } 
              
            } 
        }
        return r;
    }

    function brushHelper(that) {
      //Map name, e.g. 32-1B
      let name = d3.select(that).data();

      //Remove old circles.
      svgContainer.selectAll("circle").remove();

      if (d3.event.selection == null) {
        selectedMaps.removeObject(name[0]);
      }
      else {
        selectedMaps.addObject(name[0]); 
      }

      // selectedMaps is an array containing the IDs of the maps that
      // have been selected.
      
      if (selectedMaps.length > 0) {
        console.log("Selected: ", " ", selectedMaps.length);
        // Maps have been selected - now work out selected markers.
        brushedRegions[name[0]] = d3.event.selection;
        brushExtents = selectedMaps.map(function(p) { return brushedRegions[p]; }); // extents of active brushes

        selectedMarkers = {};
        selectedMaps.forEach(function(p, i) {
          selectedMarkers[p] = [];
          d3.keys(z[p]).forEach(function(m) {
            if ((z[p][m] >= y[p].invert(brushExtents[i][0])) &&
                (z[p][m] <= y[p].invert(brushExtents[i][1]))) {
              //selectedMarkers[p].push(m);    
              selectedMarkers[p].push(m + " " + z[p][m]);
              //Highlight the markers in the brushed regions
              //o[p], the map location, z[p][m], actuall marker position in the map, 
              //y[p](z[p][m]) is the relative marker position in the svg
              let dot = svgContainer.append("circle")
                                    .attr("class", m)
                                    .attr("cx",o[p])
                                    .attr("cy",y[p](z[p][m]))
                                    .attr("r",2)
                                    .style("fill", "red");

        
            } else {
              svgContainer.selectAll("circle." + m).remove();
            }
          });
        });
        me.send('updatedSelectedMarkers', selectedMarkers);

        d3.selectAll(".foreground g").classed("faded", function(d){
         //d3.event.selection [min,min] or [max,max] should consider as non selection.
         //maybe alternatively use brush.clear or (brush.move, null) given a mouse event
          return !d3.keys(selectedMarkers).every(function(p) {
            //Maybe there is a better way to do the checking. 
            //d is the marker name, where selectedMarkers[p][ma] contains marker name and postion, separated by " "
            for (var ma=0; ma<selectedMarkers[p].length; ma++){
              if (selectedMarkers[p][ma].includes(d+" ")){
                 return true;
              }
            }
            return false;
            //return selectedMarkers[p].contains(d);
          });
        
        });

        svgContainer.selectAll(".btn").remove();

          zoomSwitch = svgContainer.selectAll("#" + eltId(name[0]))
                  .append('g')
                  .attr('class', 'btn')
                  .attr('transform', 'translate(10)');
        zoomSwitch.append('rect')
                  .attr('width', 60).attr('height', 30)
                  .attr('rx', 3).attr('ry', 3)
                  .attr('fill', '#eee').attr('stroke', '#ddd');
        zoomSwitch.append('text')
                  .attr('x', 30).attr('y', 20).attr('text-anchor', 'middle')
                  .text('Zoom');
        
        zoomSwitch.on('click', function () {
           zoom(that,brushExtents);
           zoomed = true;

           //reset function
           svgContainer.selectAll(".btn").remove();
           //Remove all the existing circles
           svgContainer.selectAll("circle").remove();
            resetSwitch = svgContainer.selectAll("#" + eltId(name[0]))
                                    .append('g')
                                    .attr('class', 'btn')
                                    .attr('transform', 'translate(10)');
           resetSwitch.append('rect')
                  .attr('width', 60).attr('height', 30)
                  .attr('rx', 3).attr('ry', 3)
                  .attr('fill', '#eee').attr('stroke', '#ddd');
           resetSwitch.append('text')
                      .attr('x', 30).attr('y', 20).attr('text-anchor', 'middle')
                      .text('Reset');

           resetSwitch.on('click',function(){
             let t = svgContainer.transition().duration(750);
             
             mapIDs.forEach(function(d) {
               let idName = "m"+d; // axis ids have "m" suffix
               let yDomainMax = d3.max(Object.keys(z[d]), function(a) { return z[d][a]; } );
               y[d].domain([0, yDomainMax]);
               let yAxis = d3.axisLeft(y[d]).ticks(10);
               svgContainer.select("#"+idName).transition(t).call(yAxis);
             });
             d3.selectAll(".foreground g").selectAll("path").remove();
             d3.selectAll(".foreground g").selectAll("path").data(path).enter().append("path");
             t.selectAll(".foreground path").attr("d", function(d) {return d; });
             d3.selectAll(".foreground > g > path")
              .on("mouseover",handleMouseOver)
              .on("mouseout",handleMouseOut);
               d3.selectAll("#" + eltId(name[0])).selectAll(".btn").remove();
             selectedMarkers = {};
             me.send('updatedSelectedMarkers', selectedMarkers);
             zoomed = false;
           });
        });
        
      } else {
        // No axis selected so reset fading of paths or circles.
        svgContainer.selectAll(".btn").remove();
        svgContainer.selectAll("circle").remove();
        d3.selectAll(".foreground g").classed("faded", false);
        selectedMarkers = {};
        me.send('updatedSelectedMarkers', selectedMarkers);
        brushedRegions = {};
      }

    } // brushHelper

    function zoom(that, brushExtents) {
      let mapName = d3.select(that).data();
      let t = svgContainer.transition().duration(750);
      selectedMaps.map(function(p, i) {
        if(p == mapName){
          y[p].domain([y[p].invert(brushExtents[i][0]), y[p].invert(brushExtents[i][1])]);
          let yAxis = d3.axisLeft(y[p]).ticks(10);
          let idName = "m"+p;
          svgContainer.selectAll(".btn").remove();
          svgContainer.select("#"+idName).transition(t).call(yAxis);
          d3.selectAll(".foreground g").selectAll("path").remove();
          d3.selectAll(".foreground g").selectAll("path").data(zoomPath).enter().append("path");
          t.selectAll(".foreground path").attr("d", function(d) {return d; });
          d3.selectAll(".foreground > g > path")
            .on("mouseover",handleMouseOver)
            .on("mouseout",handleMouseOut);
          //that refers to the brush g element
          d3.select(that).call(y[p].brush.move,null);
        }
      });
    }

    function brushended() {
      //console.log("brush event ended");
      brushHelper(this);
    }


    function dragstarted(start_d /*, start_index, start_group*/) {
      console.log("dragstarted", this, start_d/*, start_index, start_group*/);
      let cl = {/*self: this,*/ d: start_d/*, index: start_index, group: start_group, mapIDs: mapIDs*/};
      svgContainer.classed("axisDrag", true);
      d3.select(this).classed("active", true);
      d3.event.subject.fx = d3.event.subject.x;
      /* Assign class current to dropTarget-s depending on their relation to drag subject.
       add class 'current' to indicate which zones to get .dragHover
       axis being dragged does not get .current
       middle targets on side towards dragged axis don't
       axes i in 1..n,  dragged axis : dg
       current if dg != i && (! middle || ((side == left) == (i < dg)))
       * for (i < dg), use x(d) < startx
       */
      g.selectAll('g.map > g.stackDropTarget').classed
      ("current",
       function(d, index, group)
       {
         let xd = x(d),
         /** d3.event has various x,y values, which are sufficient for this
          * purpose, e.g. x, subject.x, sourceEvent.clientX, sourceEvent.x */
         startX = d3.event.x,
         middle = this.classList.contains("middle"),
         left = this.classList.contains("left"),
         isCurrent =
           (d != cl.d) &&  (! middle || ((left) == (xd < startX)));
         // console.log("current classed", this, d3.event, d, index, group, cl, xd, startX, middle, left, isCurrent);
         return isCurrent;
       });
    }

    /** @param  d (datum) name of map being dragged.
     */
    function dragged(d) {
      // if cursor is in top or bottom dropTarget-s, stack the map,
      // otherwise set map x to cursor x, and sort.
      let dropTargetEnd = currentDropTarget && currentDropTarget.classList.contains("end");
      if (dropTargetEnd)
      {
        let targetMapName = currentDropTarget.mapName,
        top = currentDropTarget.classList.contains("top"),
        zoneParent = Stack.mapStackIndex(targetMapName);
        let stack = stacks[zoneParent.stackIndex];
        if (! stack.contains(d))
        {
          stack.dropIn(d, zoneParent.mapIndex, top);
          Stack.log();
          stack.redraw();
        }
        // set x of dropped mapID
      }
      // For the case : drag ended in a middle zone (or outside any DropTarget zone)
      // else if d is in a >1 stack then remove it else move the stack
      else
      {
        const dropDelaySeconds = 3, milli = 1000;
        let currentDrop = Stack.prototype.currentDrop,
            now = Date.now();
        // console.log("dragged", currentDrop, d);
        if (currentDrop && (now - currentDrop.dropInTime > dropDelaySeconds * milli))
        {
          currentDrop.stack.dropOut(d);
          currentDrop.stack.redraw();
          /* if d is not in currentDrop.stack, dropOut() will return false; in
           * that case redraw() may have no effect;  it seems sensible to clear currentDrop anyway.
           */
          Stack.prototype.currentDrop = undefined;
          /* Following code will set o[d] and sort the Stack into location. */
        }
        /*
        else
          console.log("no currentDrop", d); */
      }

      if (! dropTargetEnd)
      {
        o[d] = d3.event.x;
        // Now impose boundaries on the x-range you can drag.
        // The boundary values are in dragLimit, defined previously.
        if (o[d] < dragLimit.min) { o[d] = dragLimit.min; }
        else if (o[d] > dragLimit.max) { o[d] = dragLimit.max; }
        mapIDs.sort(function(a, b) { return o[a] - o[b]; });
      }
      //console.log(mapIDs + " " + o[d]);
      d3.select(this).attr("transform", function() {return "translate(" + o[d] + ")";});
      d3.selectAll(".foreground g").selectAll("path").remove();
      if(zoomed){
        d3.selectAll(".foreground g").selectAll("path").data(zoomPath).enter().append("path");
      } else {
        d3.selectAll(".foreground g").selectAll("path").data(path).enter().append("path");
      }
      d3.selectAll(".foreground g").selectAll("path").attr("d", function(d) { return d; });
      d3.selectAll(".foreground > g > path")
        .on("mouseover",handleMouseOver)
        .on("mouseout",handleMouseOut);
      //Do we need to keep the brushed region when we drag the map? probably not.
      //The highlighted markers together with the brushed regions will be removed once the dragging triggered.
      d3.select(this).select(".brush").call(y[d].brush.move,null);
      //Remove all highlighted Markers.
      svgContainer.selectAll("circle").remove();
    }

    function dragended(/*d*/) {
      // Order of mapIDs may have changed so need to redefine x and o.
      x = xScale();
      // if caching, recalc : collateMapPositions();
      
      mapIDs.forEach(function(d){
        o[d] = x(d);
      });
      // already done in xScale()
      // x.domain(mapIDs).range(axisXRange);
      if(zoomed){
        d3.selectAll(".foreground g").selectAll("path").data(zoomPath).enter().append("path");  
      } else {
        d3.selectAll(".foreground g").selectAll("path").data(path).enter().append("path");
      }
      
      let t = d3.transition().duration(500);
      t.selectAll(".map").attr("transform", Stack.prototype.mapTransform);
      t.selectAll(".foreground path").attr("d", function(d) { return d; });
      d3.select(this).classed("active", false);
      svgContainer.classed("axisDrag", false);
      d3.selectAll(".foreground > g > path")
        .on("mouseover",handleMouseOver)
        .on("mouseout",handleMouseOut);
      d3.event.subject.fx = null;
    }
    

  /*function click(d) {
     if (y[d].flipped) {
         y[d] = d3.scale.linear()
              .domain([0,d3.max(Object.keys(z[d]), function(x) { return z[d][x]; } )])
              .range([0, yRange]); // set scales for each map
          y[d].flipped = false;
          var t = d3.transition().duration(500);
          t.selectAll("#"+d).select(".axis")
            .attr("class", "axis")
            .each(function(d) { d3.select(this).call(axis.scale(y[d])); })
      }
      else {
          y[d] = d3.scale.linear()
              .domain([0,d3.max(Object.keys(z[d]), function(x) { return z[d][x]; } )])
              .range([yRange, 0]); // set scales for each map
          y[d].flipped = true;
          var t = d3.transition().duration(500);
          t.selectAll("#"+d).select(".axis")
            .attr("class", "axis")
            .each(function(d) { d3.select(this).call(axis.scale(y[d])); })
      }
      y[d].brush = d3.svg.brush()
          .y(y[d])
          .on("brush", brush);
      d3.selectAll(".foreground g").selectAll("path").data(path).enter().append("path");
      var t = d3.transition().duration(500);
      t.selectAll(".foreground path").attr("d", function(d) { return d; });
  }
       let zoomedMarkers = [];

    //console.log(myMaps.start + " " + myMaps.end);
    //d3.select('#grid')
      //.datum(d3Data)
      //.call(grid);
     function refresh() {
    d3.selectAll(".foreground g").selectAll("path").remove();
    d3.selectAll(".foreground g").selectAll("path").data(path).enter().append("path");
    foreground.selectAll("path").attr("d", function(d) { return d; })
  }
*/
  },

  didInsertElement() {
  },

  didRender() {
    // Called on re-render (eg: add another map) so should call
    // draw each time.
    //
    let data = this.get('data');
    let maps = d3.keys(data);
    this.draw(data, maps);
  },

  resize() {
    // rerender each individual element with the new width+height of the parent node
    d3.select('svg')
    // need to recalc viewPort{} and all the sizes, (from document.documentElement.clientWidth,Height)
    // .attr('width', newWidth)
    ;
    //etc... and many lines of code depending upon how complex my visualisation is
  }

});
