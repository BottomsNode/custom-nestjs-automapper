const m = require('./ok.js');
const D = m.ReadUserDto, F = m.FIELDS;
const i = new D();
const ok = (n, c) => console.log((c ? 'PASS' : 'FAIL') + '  ' + n);

ok('is a function (usable as DI token)', typeof D === 'function');
ok('has prototype (Nest DI requirement)', typeof D.prototype === 'object');
ok('instanceof works', i instanceof D);
ok('runtime field registry populated', Array.isArray(D[F]) && D[F].length === 6);
ok("registry = picked + computed", JSON.stringify(D[F]) === JSON.stringify(['id','email','createdAt','fullName','city','note']));
ok('instance has REAL own props (v1 bug fixed)', Object.prototype.hasOwnProperty.call(i, 'id'));
ok("'id' in instance === true", 'id' in i);
ok('prototype chain intact', Object.getPrototypeOf(D.prototype) !== null);
ok('class name is diagnosable', /Pick\(User\)/.test(Object.getPrototypeOf(D).name));
ok('resolvers reachable at runtime', Object.keys(D.__resolvers).length === 3);
ok('resolver carries deps', JSON.stringify(D.__resolvers.city.deps) === '["address.city"]');
const src = { firstName:'Nishit', lastName:'Shivdasani', address:{city:'Pune'} };
ok('compute fn executes', D.__resolvers.fullName.fn(src) === 'Nishit Shivdasani');
ok('nested dep resolver executes', D.__resolvers.city.fn(src) === 'Pune');
