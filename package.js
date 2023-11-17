Package.describe({
  name: 'zodern:fix-async-stubs',
  version: '1.0.0',
  summary: 'Fixes issues with async method stubs',
  git: '',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('2.13.3');
  api.use('ecmascript');
  api.use('ddp-client');
  api.mainModule('client.js', 'client');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('zodern:fix-async-stubs');
  api.addFiles('tests/server-setup.js', 'server');
  api.addFiles('tests/client.js', 'client');
});