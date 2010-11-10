
// launcher for vows

var launcher = exports;
var path = require('path'),
    sys = require('sys'),
    fs = require('fs');
var stylize = require('vows/console').stylize;

var inspect = require('eyes').inspector({
    stream: null,
    styles: { string: 'grey', regexp: 'grey' }
});

launcher.config = function(options, _reporter) {
  if ( launcher.msg != null) {
    return;
  }

  //
  // Attempt to load Coffee-Script. If it's not available, continue on our
  // merry way, if it is available, set it up so we can include `*.coffee`
  // scripts and start searching for them.
  //
  var fileExt, specFileExt;

  try {
      var coffee = require('coffee-script');
      require.registerExtension('.coffee', function (content) { return coffee.compile(content) });
      fileExt     = /\.(js|coffee)$/;
      specFileExt = /-(test|spec)\.(js|coffee)$/;
  } catch (_) {
      fileExt     = /\.js$/;
      specFileExt = /-(test|spec)\.js$/;
  }

  var reporter = options.reporter = {
      name: _reporter.name,
  };

  if (options.watch) {
      reporter = options.reporter = require('vows/reporters/watch');
  }

  //
  // Recursively traverse a hierarchy, returning
  // a list of all relevant .js files.
  //
  launcher.paths = function (dir) {
      var paths = [];

      try { fs.statSync(dir) }
      catch (e) { return [] }

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

  var msg = launcher.msg = function msg(cmd, subject, str, p) {
      if (options.verbose) {
          sys[p ? 'print' : 'puts']( stylize('vows ', 'green')
                + stylize(cmd, 'bold')
                + ' ' + subject + ' '
                + (str ? (typeof(str) === 'string' ? str : inspect(str)) : '')
                );
      }
  };

  launcher.runSuites = function (suites, callback) {
      var results = {
          honored: 0,
          broken:  0,
          errored: 0,
          pending: 0,
          total:   0,
          time:    0
      };
      reporter.reset();

      (function run(suites, callback) {
          var suite = suites.shift();
          if (suite) {
              launcher.msg('runner', "running", suite.subject + ' ', options.watch ? false : true);
              suite.run(options, function (result) {
                  Object.keys(result).forEach(function (k) {
                      results[k] += result[k];
                  });
                  run(suites, callback);
              });
          } else {
              callback(results);
          }
      })(suites, callback);
  };

  launcher.importSuites = function (files) {
      launcher.msg(options.watcher ? 'watcher' : 'runner', 'loading', files);

      return files.reduce(function (suites, f) {
          var obj = require(f);
          return suites.concat(Object.keys(obj).map(function (s) {
              return obj[s];
          }));
      }, [])
  };

  launcher.run = function(args) {

    if (args.length === 0 || options.watch) {
      msg('bin', 'discovering', 'folder structure');
      root = fs.readdirSync('.');

      if (root.indexOf('test') !== -1) {
          testFolder = 'test';
      } else if (root.indexOf('spec') !== -1) {
          testFolder = 'spec';
      } else {
          abort("runner", "couldn't find test folder");
      }

      msg('bin', 'discovered', "./" + testFolder);

      if (args.length === 0) {
          args = launcher.paths(testFolder);

          if (options.watch) {
              args = args.concat(launcher.paths('lib'),
                                 launcher.paths('src'));
          }
      }
    }

    if (! options.watch) {
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
            return path.join(process.cwd(), a.replace(fileExt, ''));
        });

        launcher.runSuites(launcher.importSuites(files), function (results) {
            !options.verbose && _reporter.print('\n');
            msg('runner', 'finish');
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
            var status,
                cue,
                current = 0,
                running = 0,
                lastRun,
                colors = ['32m', '33m', '31m'],
                timer = setInterval(tick, 100);

            process.addListener('uncaughtException', cleanup);
            process.addListener('exit', cleanup);
            process.addListener('SIGINT', function () {
                process.exit(0);
            });
            process.addListener('SIGQUIT', function () {
                changed();
            });

            cursorHide();

            // Run every 100ms
            function tick() {
                if (running && (cue !== strobe)) {
                    cue = strobe, current = 0;
                } else if (!running && (cue !== pendulum)) {
                    cue = pendulum, current = 0;
                }

                eraseLine();
                lastRun && !running && esc(colors[status.errored ? 2 : (status.broken ? 1 : 0)]);
                print(cue[current]);

                if (current == cue.length - 1) { current = -1 }

                current ++;
                esc('39m');
                cursorRestore();
            }

            //
            // Utility functions
            //
            function print(str)      { sys.print(str) }
            function esc(str)        { print("\x1b[" + str) }
            function eraseLine()     { esc("0K") }
            function cursorRestore() { esc("0G") }
            function cursorHide()    { esc("?25l") }
            function cursorShow()    { esc("?25h") }
            function cleanup()       { eraseLine(), cursorShow(), clearInterval(timer), print('\n') }

            //
            // Called when a file has been modified.
            // Run the matching tests and change the status.
            //
            function changed(file) {
                status = { honored: 0, broken: 0, errored: 0, pending: 0 };

                msg('watcher', 'detected change in', file);

                file = (specFileExt.test(file) ? path.join(testFolder, file)
                                               : path.join(testFolder, file + '-' + testFolder));

                try {
                    fs.statSync(file);
                } catch (e) {
                    msg('watcher', 'no equivalence found, running all tests.');
                    file = null;
                }

                var files = (specFileExt.test(file) ? [file] : launcher.paths(testFolder)).map(function (p) {
                    return path.join(process.cwd(), p.replace(fileExt, ''));
                }).map(function (p) {
                    delete(require.main.moduleCache[p]);
                    return p;
                });

                running ++;

                launcher.runSuites(launcher.importSuites(files), function (results) {
                    delete(results.time);
                    print(console.result(results).join('') + '\n\n');
                    lastRun = new(Date);
                    status = results;
                    running --;
                });
            }

            msg('watcher', 'watching', args);

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
}
