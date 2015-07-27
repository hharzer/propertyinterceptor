(function(exports) {
	//Copyright 2015, Simon Y. Blackwell
	//Distributed under the MIT License
	/*
	 * An increasing number of advanced Javascript developers make use of Object.getOwnPropertyDescriptor and Object.defineProperty. These methods can be tricky to use correctly
	 * and often result in a lot of repeated code patterns for redefining properties. This PropertyInterceptor abstracts out this capability.
	 * 
	 * PropertyInterceptor provides generic ability to add and remove chained callbacks that will be invoked as follows:
	 * 
	 * 1) After an object's key value is retrieved, but before returning it to the requesting code, e.g. var foo = object.bar could have a callback before foo is set
	 * and returned to the calling code. The callback can modify the value of bar, and thus foo, for a variety of reasons, the most likely of which would be for security.
	 * 
	 * 2) Before an object's key value is set and actually saved in Javascript internal storage, e.g. object.bar = 1 could have a callback before the value 1
	 * is saved as the value of bar. The callback can test or modify the value for a variety of reasons such as security, validity checking and type conversion. In the case 
	 * of security and validity checking the callback could return an error rather than allowing the change.
	 * 
	 * 3) After an object's key value is set and saved in Javascript internal storage. The primary use of these callbacks is similar to that of Observers except they are
	 * executed in the context of the current Javascript processing cycle. As a result they are potentially blocking, but also ensure timely, sequential execution of code
	 * where required. By convention, these callbacks should not modify the same property they are being called on.
	 * 
	 * Not yet implemented, but possible in the context of the current design is the removal of interceptors regardless of their position in the callback sequence
	 * if callback handles are saved by the code creating the intercept. 
	 * 
	 * For convenience and semantic/syntactic consistency with Object.observe the capability is currently exposed via a shim on the global Javascript Object. Usage is as follows:
	 * 
	 * Object.intercept.afterGet(someObject,someProperty,callback)
	 * Object.intercept.beforeSet(someObject,someProperty,callback) 
	 * Object.intercept.afterSet(someObject,someProperty,callback) where callback has the signature:
	 * 
	 * function(object,property,value) { ...; return value);
	 * 
	 * For future implementation: Object.intercept.remove(someObject,someProperty,callback)
	 */
	function PropertyInterceptor() {
		
	}
	
	function get(descriptor) {
		// if there was an existing get function, invoke that to get value; otherwise get the value we are going to store on the get function itself 
		var value = (descriptor.get.value===undefined && descriptor.get.oldGet ? descriptor.get.oldGet() : descriptor.get.value);
		// invoke all the afterGets
		descriptor.get.after.forEach(function(after) {
			value = after(value);
		});
		// store the final value and return to the caller
		descriptor.get.value = value;
		return value;
	}
	
	function set(descriptor,value) {
		// get the existing value
		var originalvalue = descriptor.get.value;
		// run the before set handlers which may modify the value passed in
		descriptor.set.before.forEach(function(before) {
			value = before(value);
		});
		// set the new value
		descriptor.get.value = value;
		// run the after set handlers only if the value has changed, this is efficient and also prevents some accidental infinite loops
		if(value!==originalvalue) {
			descriptor.set.after.forEach(function(after) {
				after(value);
			});
		}
		return value;
	}
	/*
	 * Install the callback(object,property,value) on the object and property provided so that it is called whenever an attempt to get the value of object.property. The
	 * callback is expected to return either the value is it provided or a modified value for use further down the callback chain or ultimately for assignment in the calling
	 * code, e.g. var foo = object.bar. The callback is added at the end of the callback chain.
	 */
	PropertyInterceptor.prototype.afterGet = function(object,property,callback) {
		var descriptor = Object.getOwnPropertyDescriptor(object,property);
		descriptor = (descriptor ? descriptor : {configurable:true,enumerable:true});
		var value = (descriptor.get ? descriptor.get() : descriptor.value);
		var handler = function(value) { return handler.callback(object,property,value); };
		handler.callback = callback; // create the handler that actually gets called, saving callback in a location we can get it later to uninstall intercept
		if(descriptor.get && descriptor.get.after) {
			descriptor.get.after.push(handler); // put the handler into the list of after handlers, if the descriptor.get is already configured to handle such
		} else { // configure a new descriptor.get
			var oldget = descriptor.get;
			descriptor.get = function() { return get(descriptor); };
			descriptor.get.value = value; // initialize with the value present at time afterGet processor is created
			descriptor.get.after = [handler]; // create the initial array of after handlers
			descriptor.get.oldGet = oldget; // save the old get for use or restoration (when implemented)
		}
		if(!descriptor.set) { // create a setter for data, if one does not exist Chrome will work with just a getter and no setter, Safari will not
			descriptor.set = function(value) { return set(descriptor,value); }
			// create storage for before and after set handlers
			descriptor.set.before = [];
			descriptor.set.after = [];
		}
		// object.property is no longer just data, it has get and set so delete the value and writable properties of descriptor
		delete descriptor.value;
		delete descriptor.writable;
		Object.defineProperty(object,property,descriptor);
		return object;
	}
	/*
	 * Install the callback with signature f(object,property,value) on the object and property provided so that it is called whenever an attempt to set the value of object.property. The
	 * callback is expected to return either the value it is provided or a modified value for use further down the callback chain or ultimately for assignment in the calling
	 * code, e.g. var foo = object.bar. The callback is added at the start of the callback chain.
	 */
	PropertyInterceptor.prototype.beforeSet = function(object,property,callback) {
		var descriptor = Object.getOwnPropertyDescriptor(object,property);
		descriptor = (descriptor ? descriptor : {configurable:true,enumerable:true});
		var value = (descriptor.get ? descriptor.get() : descriptor.value);
		if(typeof(value)==="function") {
			return false;
		}
		if(!descriptor.get || !descriptor.get.after) { // create a specialized get if one does not exist, since this is actually where property value is stored
			var oldget = descriptor.get;
			descriptor.get = function() { return get(descriptor); };
			descriptor.get.value = value;
			descriptor.get.after = [];
			descriptor.get.oldGet = oldget;
		}
		if(!descriptor.set) { // create a setter for data
			descriptor.set = function(value) { return set(descriptor,value); }
			descriptor.set.before = [];
			descriptor.set.after = [];
		}
		var handler = function(value) { return handler.callback(object,property,value); };
		handler.callback = callback; // create the handler that actually gets called, saving callback in a location we can get it later to uninstall intercept
		if(descriptor.set.before) { // use existing setter or one just created
			descriptor.set.before.unshift(handler); // most recent will get done first
		} else { // wrap old setter from somewhere else
			var oldset = descriptor.set;
			descriptor.set = function(value) { return set(descriptor,value); }
			descriptor.set.before = [handler];
			descriptor.set.after = [];
			descriptor.set.oldset = oldset;
		}
		// object.property is no longer just data, it has get and set so delete value and writable properties of descriptor
		delete descriptor.value;
		delete descriptor.writable;
		Object.defineProperty(object,property,descriptor);
		return object;
	}
	PropertyInterceptor.prototype.afterSet = function(object,property,callback) {
		var descriptor = Object.getOwnPropertyDescriptor(object,property);
		descriptor = (descriptor ? descriptor : {configurable:true,enumerable:true});
		var value = (descriptor.get ? descriptor.get() : descriptor.value);
		if(typeof(value)==="function") {
			return false;
		}
		if(!descriptor.get || !descriptor.get.after) { // create a specialized get if one does not exist, since this is actually where property value is stored
			var oldget = descriptor.get;
			descriptor.get = function() { return get(descriptor); };
			descriptor.get.value = value;
			descriptor.get.after = [];
			descriptor.get.oldGet = oldget;
		}
		if(!descriptor.set) { // create a setter for data
			descriptor.set = function(value) { return set(descriptor,value); }
			descriptor.set.before = [];
			descriptor.set.after = [];
		}
		var handler = function(value) { handler.callback(object,property,value); };
		handler.callback = callback;
		if(descriptor.set.after) { // use existing setter or one just created
			descriptor.set.after.push(handler);
		} else { // wrap old setter from somewhere else
			var oldset = descriptor.set;
			descriptor.set = function(value) { return set(descriptor,value); }
			descriptor.set.before = [];
			descriptor.set.after = [handler];
			descriptor.set.oldset = oldset;
		}
		delete descriptor.value;
		delete descriptor.writable;
		Object.defineProperty(object,property,descriptor);
		return object;
	}
	// patch the global Object
	exports.Object = Object;
	exports.Object.intercept = {
			afterGet: PropertyInterceptor.prototype.afterGet,
			beforeSet: PropertyInterceptor.prototype.beforeSet,
			afterSet: PropertyInterceptor.prototype.afterSet
	}
	exports.PropertyInterceptor = PropertyInterceptor;
	return exports.PropertyInterceptor
})("undefined"!==typeof exports&&"undefined"!==typeof global?global:window);