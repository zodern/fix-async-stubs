import { isEmpty, last } from "meteor/ddp-common/utils.js";

let queueSize = 0;
let queue = Promise.resolve();

function queueFunction(fn) {
  queueSize += 1;

  let resolve;
  let reject;
  let promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
    
  });
  queue = queue.finally(() => {
    fn(resolve, reject);
    return promise;
  });

  promise.finally(() => {
    queueSize -= 1;
    if (queueSize === 0) {
      Meteor.connection._maybeMigrate();
    }
  });

  return promise;
}

let oldReadyToMigrate = Meteor.connection._readyToMigrate;
Meteor.connection._readyToMigrate = function () {
  if (queueSize > 0) {
    return false;
  }

  return oldReadyToMigrate.apply(this, arguments);
}


let currentMethodInvocation = null;;

/**
 * Meteor sets CurrentMethodInvocation to undefined for the reasons explained at
 * https://github.com/meteor/meteor/blob/c9e3551b9673a7ed607f18cb1128563ff49ca96f/packages/ddp-client/common/livedata_connection.js#L578-L605
 * The app code could call `.then` on a promise while the async stub is running,
 * causing the `then` callback to think it is inside the stub.
 * 
 * With the queueing we are doing, this is no longer necessary. The point 
 * of the queueing is to prevent app/package code from running while
 * the stub is running, so we don't need to worry about this.
 */
let oldCallAsync = Meteor.connection.callAsync;
Meteor.connection.callAsync = function () {
  currentMethodInvocation = DDP._CurrentMethodInvocation.get();

  return oldCallAsync.apply(this, arguments);
}

let oldApplyAsync = Meteor.connection.applyAsync;
Meteor.connection.applyAsync = function () {
  let args = arguments;

  if (currentMethodInvocation) {
    DDP._CurrentMethodInvocation._set(currentMethodInvocation);
    currentMethodInvocation = null;
  }

  // code outside of the stub shouldn't be able to create a then callback
  // while the stub is running
  // 

  const enclosing = DDP._CurrentMethodInvocation.get();
  const alreadyInSimulation = enclosing?.isSimulation;
  const isFromCallAsync = enclosing?._isFromCallAsync;

  let name = args[0];

  if (Meteor.connection._getIsSimulation({
    isFromCallAsync, alreadyInSimulation
  })) {
    // In stub - call immediately
    return oldApplyAsync.apply(this, args);
  }

  return queueFunction((resolve, reject) => {
    let finished = false;
    Meteor._setImmediate(() => {
      oldApplyAsync.apply(this, args).then((result) => {
        finished = true;
        resolve(result);
      }, (err) => {
        finished = true;
        reject(err);
      });
    });

    Meteor._setImmediate(() => {
      if (!finished) {
        console.warn(`Method stub (${name}) took too long and could cause unexpected problems`);
      }
    });
  });
};

let oldApply = Meteor.connection.apply;
Meteor.connection.apply = function () {
  // [name, args, options]
  let options = arguments[2] || {};
  let wait = options.wait;

  // Apply runs the stub before synchronously returning.
  //
  // However, we want the server to run the methods in the original call order
  // so we have to queue sending the message to the server until any previous async
  // methods run.
  // This does mean the stubs run in a different order than the methods on the
  // server
  // TODO: can we queue Meteor.apply in some situations instead of running
  // immediately?

  let oldOutstandingMethodBlocks = Meteor.connection._outstandingMethodBlocks;
  // Meteor only sends the method if _outstandingMethodBlocks.length is 1
  // Add a wait block to force Meteor to  put the new method in a second object.
  let outstandingMethodBlocks = [{ wait: true, methods: [] }];
  Meteor.connection._outstandingMethodBlocks = outstandingMethodBlocks;

  let result;
  try {
    result = oldApply.apply(this, arguments);
  } finally {
    Meteor.connection._outstandingMethodBlocks = oldOutstandingMethodBlocks;
  }

  if (outstandingMethodBlocks[1]) {
    let methodInvoker = outstandingMethodBlocks[1].methods[0];

    if (methodInvoker) {
      queueMethodInvoker(methodInvoker, wait);
    }
  }

  return result;
};

function queueMethodInvoker(methodInvoker, wait) {
  queueFunction((resolve) => {
    let self = Meteor.connection;
    // based on https://github.com/meteor/meteor/blob/e0631738f2a8a914d8a50b1060e8f40cb0873680/packages/ddp-client/common/livedata_connection.js#L833-L853C1
    if (wait) {
      // It's a wait method! Wait methods go in their own block.
      self._outstandingMethodBlocks.push({
        wait: true,
        methods: [methodInvoker]
      });
    } else {
      // Not a wait method. Start a new block if the previous block was a wait
      // block, and add it to the last block of methods.
      if (isEmpty(self._outstandingMethodBlocks) ||
        last(self._outstandingMethodBlocks).wait) {
        self._outstandingMethodBlocks.push({
          wait: false,
          methods: [],
        });
      }

      last(self._outstandingMethodBlocks).methods.push(methodInvoker);

      // If we added it to the first block, send it out now.
      if (self._outstandingMethodBlocks.length === 1) methodInvoker.sendMessage();

      resolve();
    }
  });
}

// Re-create these proxied functions to use our wrapper
[
  'callAsync',
  'apply',
  'applyAsync',
].forEach(name => {
  Meteor[name] = Meteor.connection[name].bind(Meteor.connection);
});
