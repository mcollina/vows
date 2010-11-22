
// launcher for vows

var path = require('path'),
    sys = require('sys'),
    fs = require('fs');
var stylize = require('vows/console').stylize;
var vows_console = require('vows/console');

var inspect = require('eyes').inspector({
    stream: null,
    styles: { string: 'grey', regexp: 'grey' }
});

var launcher = module.exports = function(options) {

  if(!options) {
    options = {};
  }

  if (! options.matcher) {
    options.matcher = /.*/
  }

  //
  // Attempt to load Coffee-Script. If it's not available, continue on our
  // merry way, if it is available, set it up so we can include `*.coffee`
  // scripts and start searching for them.
  //

  try {
      var coffee = require('coffee-script');
      require.registerExtension('.coffee', function (content) { return coffee.compile(content) });
      this.fileExt     = /\.(js|coffee)$/;
      this.specFileExt = /(-|\.)(test|spec)\.(js|coffee)$/;
  } catch (_) {
      this.fileExt     = /\.js$/;
      this.specFileExt = /(-|\.)(test|spec)\.js$/;
  }

  var _reporter = options.reporter;
  if(!_reporter) {
    _reporter = require('vows/reporters/dot-matrix');
  }
  var reporter = options.reporter = {
      name: _reporter.name,
  };

  if (options.watch) {
      reporter = options.reporter = require('vows/reporters/watch');
  }

  this.options = options;
  this._reporter = _reporter;
}

//
// Recursively traverse a hierarchy, returning
// a list of all relevant .js files.
//
launcher.prototype.paths = function (dir) {
    var paths = [];

    try { fs.statSync(dir) }
    catch (e) { return [] }

    var fileExt = this.fileExt;
    (function traverse(dir, stack) {
        stack.push(dir);
        fs.readdirSync(stack.join('/')).forEach(function (file) {
            var path = stack.concat([file]).join('/'),
                stat = fs.statSync(path);

            if (file[0] == '.' || file === 'vendor') {
                return;
            } else if (stat.isFile() && fileExt.test(file)) {
                paths.push(path);
            } else if (stat.isDirectory()) {
                traverse(file, stack);
            }
        });
        stack.pop();
    })(dir || '.', []);

    return paths;
}

launcher.prototype.msg = function msg(cmd, subject, str, p) {
    if (this.options.verbose) {
        sys[p ? 'print' : 'puts']( stylize('vows ', 'green')
              + stylize(cmd, 'bold')
              + ' ' + subject + ' '
              + (str ? (typeof(str) === 'string' ? str : inspect(str)) : '')
              );
    }
};

launcher.prototype.runSuites = function (suites, callback) {
    var results = {
        honored: 0,
        broken:  0,
        errored: 0,
        pending: 0,
        total:   0,
        time:    0
    };
    this.options.reporter.reset();

    var options = this.options;
    var l = this;
    (function run(suites, callback) {
        var suite = suites.shift();
        if (suite) {
            if(typeof suite.run == 'function') {
              l.msg('runner', "running", suite.subject + ' ', options.watch ? false : true);
              suite.run(options, function (result) {
                  Object.keys(result).forEach(function (k) {
                      results[k] += result[k];
                  });
                  run(suites, callback);
              });
            } else {
              run(suites, callback);
            }
        } else {
            callback(results);
        }
    })(suites, callback);
};

launcher.prototype.importSuites = function (files) {
    this.msg(this.options.watcher ? 'watcher' : 'runner', 'loading', files);

    return files.reduce(function (suites, f) {
        var obj = require(f);
        return suites.concat(Object.keys(obj).map(function (s) {
            return obj[s];
        }));
    }, [])
};

launcher.prototype.run = function(args) {

  if (args.length === 0 || this.options.watch) {
    this.msg('bin', 'discovering', 'folder structure');
    root = fs.readdirSync('.');

    if (root.indexOf('test') !== -1) {
        testFolder = 'test';
    } else if (root.indexOf('spec') !== -1) {
        testFolder = 'spec';
    } else {
        this.abort("runner", "couldn't find test folder");
    }

    this.msg('bin', 'discovered', "./" + testFolder);

    if (args.length === 0) {
        args = this.paths(testFolder);

        if (this.options.watch) {
            args = args.concat(this.paths('lib'),
                               this.paths('src'));
        }
    }
  }

  var reporter = this.options.reporter;
  var _reporter = this._reporter;
  var options = this.options;
  var l = this;
  if (! this.options.watch) {
      reporter.report = function (data) {
          switch (data[0]) {
              case 'subject':
              case 'vow':
              case 'context':
              case 'error':
                  _reporter.report(data);
                  break;
              case 'end':
                  (options.verbose || _reporter.name === 'json') && _reporter.report(data);
                  break;
              case 'finish':
                  options.verbose ? _reporter.print('\n') : _reporter.print(' ');
                  break;
          }
      };
      reporter.reset = function () { _reporter.reset && _reporter.reset() };

      files = args.map(function (a) {
          return path.join(process.cwd(), a.replace(this.fileExt, ''));
      });

      this.runSuites(this.importSuites(files), function (results) {
          !options.verbose && _reporter.print('\n');
          l.msg('runner', 'finish');
          _reporter.report(['finish', results], {
              write: function (str) {
                  sys.print(str.replace(/^\n\n/, '\n'));
              }
          });
          process.stdout.addListener('drain', function () {
              process.exit(results.honored + results.pending == results.total ? 0 : 1);
          });
      });
  } else {
      //
      // Watch mode
      //
      (function () {
          var pendulum = [
              '.   ', '..  ', '... ', ' ...',
              '  ..', '   .', '   .', '  ..',
              '... ', '..  ', '.   '
          ];
          var strobe = ['.', ' '];
          var status = { honored: 0, broken: 0, errored: 0, pending: 0 },
              cue,
              current = 0,
              running = 0,
              lastRun,
              colors = ['32m', '33m', '31m'];

          //
          // Utility functions
          //
          function print(str)      { sys.print(str) }
          function esc(str)        { print("\x1b[" + str) }
          function eraseLine()     { esc("0K") }
          function cursorRestore() { esc("0G") }
          function cursorHide()    { esc("?25l") }
          function cursorShow()    { esc("?25h") }

          // Run every 100ms
          function tick() {
              if (running > 0 && (cue !== strobe)) {
                  cue = strobe, current = 0;
              } else if (running == 0 && (cue !== pendulum)) {
                  cue = pendulum, current = 0;
              }

              eraseLine();
              lastRun && running > 0 && esc(colors[status.errored ? 2 : (status.broken ? 1 : 0)]);
              print(cue[current]);

              if (current == cue.length - 1) { current = -1 }

              current ++;
              esc('39m');
              cursorRestore();
          }

          var timer = setInterval(tick, 100);

          function cleanup()       { eraseLine(), cursorShow(), clearInterval(timer), print('\n') }

          cursorHide();

          process.addListener('uncaughtException', function(err) {
              cleanup();
              console.log(err.stack);
          });
          process.addListener('exit', cleanup);
          process.addListener('SIGINT', function () {
              clearInterval(timer);
              args.forEach(function(file) {
                fs.unwatchFile(file);
              });
              process.exit(0);
          });
          process.addListener('SIGQUIT', function () {
              changed();
          });

          //
          // Called when a file has been modified.
          // Run the matching tests and change the status.
          //
          function changed(file) {
              status = { honored: 0, broken: 0, errored: 0, pending: 0 };

              l.msg('watcher', 'detected change in', file);

              file = (l.specFileExt.test(file) ? path.join(testFolder, file)
                                               : path.join(testFolder, file + '-' + testFolder));

              try {
                  fs.statSync(file);
              } catch (e) {
                  l.msg('watcher', 'no equivalence found, running all tests.');
                  file = null;
              }

              var files = (l.specFileExt.test(file) ? [file] : l.paths(testFolder)).map(function (p) {
                  return path.join(process.cwd(), p);
              }).map(function (p) {
                  var cache = (require.main.moduleCache) ? require.main.moduleCache : require.cache;
                  if(cache[p]) {
                     delete(cache[p]);
                  }
                  return p;
              }).map(function (p) {
                  return p.replace(l.fileExt, '');
              });

              running ++;

              l.runSuites(l.importSuites(files), function (results) {
                  delete(results.time);
                  print(vows_console.result(results).join('') + '\n\n');
                  lastRun = new(Date);
                  status = results;
                  running --;
              });
          }

          l.msg('watcher', 'watching', args);

          //
          // Watch all relevant files,
          // and call `changed()` on change.
          //
          args.forEach(function (p) {
              fs.watchFile(p, function (current, previous) {
                  if (new(Date)(current.mtime).valueOf() ===
                      new(Date)(previous.mtime).valueOf()) { return }
                  else {
                      changed(p);
                  }
              });
          });

      })();
  }
}

launcher.prototype.abort = function(cmd, str) {
    sys.puts(stylize('vows ', 'red') + stylize(cmd, 'bold') + ' ' + str);
    sys.puts(stylize('vows ', 'red') + stylize(cmd, 'bold') + ' exiting');
    process.exit(-1);
}

launcher.config = function(options) {
  return new launcher(options);
}

