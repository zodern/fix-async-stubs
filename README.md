## zodern:fix-async-stubs

> This package is only needed for Meteor 2. The package's code has been integrated into Meteor 3.

A year ago Meteor added support for [async Method stubs](https://guide.meteor.com/2.8-migration.html#callasync). With the current implementation there are some limitations. Specifically, while an async stub is running, other code can not:

- call a method
- do a client side mutation with the [allow-deny package](https://docs.meteor.com/api/collections#Mongo-Collection-allow)
- use various other Meteor api's that do not allow themselves to be used in stubs

This is because Meteor creates a simulation when running a stub. This simulation is global - any code that runs is inside this simulation. With sync stubs, this was fine - no other code could run during a simulation. However, with async stubs it is much more difficult to ensure other code does not run, even if you carefully await each method.

This package modifies how stubs work to remove this limitation. Add this package with:
```
meteor add zodern:fix-async-stubs
```

Then use async stubs without worry. Call them or use any other Meteor api whenever you want, and it will work.

### Limitations

> Please note: this limitation already exists without this package. However, it is more important when using this package since it allows us to remove all other limitions.

There is no perfect solution to the problems with async stubs.

To ensure other code will not run while an async stub is running, async stubs can not use these api's:
- fetch/XMLHttpRequest
- setTimeout or setImmediate
- indexedDB
- web workers
- any other web api that schedules macrotasks

Using these api's could allow other code to run before the async stub finishes.

If one of these api's are used, a warning will be shown in the console:
```
Method stub (<method name>) took too long and could cause unexpected problems. Learn more at https://github.com/zodern/fix-async-stubs/#limitations
```

### How it works

We create a new macrotask to run each async method stub in. As long as the stub only schedules microtasks, it should be impossible for other code to run before it finishes. One resource to learn more is [this article](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide/In_depth) on MDN.
