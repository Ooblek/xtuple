/*jshint node:true, indent:2, curly:false, eqeqeq:true, immed:true, latedef:true, newcap:true, noarg:true,
regexp:true, undef:true, strict:true, trailing:true, white:true */
/*global X:true, Backbone:true, _:true, XM:true, XT:true*/

_ = require('underscore');

var async = require('async'),
  dataSource = require('../../node-datasource/lib/ext/datasource').dataSource,
  explodeManifest = require("./util/process_manifest").explodeManifest,
  fs = require('fs'),
  ormInstaller = require('./orm'),
  dictionaryBuilder = require('./build_dictionary'),
  clientBuilder = require('./build_client'),
  path = require('path'),
  sendToDatabase = require("./util/send_to_database").sendToDatabase;

(function () {
  "use strict";

  /**
    @param {Object} specs Specification for the build process, in the form:
      [ { extensions:
           [ '/home/user/git/xtuple',
             '/home/user/git/xtuple/enyo-client/extensions/source/crm',
             '/home/user/git/xtuple/enyo-client/extensions/source/sales',
             '/home/user/git/private-extensions/source/incident_plus' ],
          database: 'dev',
          orms: [] },
        { extensions:
           [ '/home/user/git/xtuple',
             '/home/user/git/xtuple/enyo-client/extensions/source/sales',
             '/home/user/git/xtuple/enyo-client/extensions/source/project' ],
          database: 'dev2',
          orms: [] }]

    @param {Object} creds Database credentials, in the form:
      { hostname: 'localhost',
        port: 5432,
        user: 'admin',
        password: 'admin',
        host: 'localhost' }
  */
  var buildDatabase = exports.buildDatabase = function (specs, creds, masterCallback) {
    /**
     * The function to generate all the scripts for a database
     */
    var installDatabase = function (spec, databaseCallback) {
      var extensions = spec.extensions,
          databaseName = spec.database,
          commercialRegexp = /inventory/,
          commercialPos    = _.reduce(extensions, function (memo, path, i) {
                              return commercialRegexp.test(path) ? i : memo;
                            }, -1),
          commercialcorePos = _.reduce(extensions, function (memo, path, i) {
                              return /commercialcore/.test(path) ? i : memo;
                            }, -1),
          commercialcorePath = extensions[commercialPos] // yes, "needs"
      ;

      // bug 25680 - we added dependencies on a new commercialcore extension.
      // make sure it's registered for installation if necessary
      if (commercialPos >= 0 && commercialcorePos < 0) {
        console.log(extensions);
        commercialcorePath = commercialcorePath.replace(commercialRegexp, "commercialcore");
        extensions.splice(commercialPos, 0, commercialcorePath);
        console.log(extensions);
      }

      //
      // The function to install all the scripts for an extension
      //
      var getExtensionSql = function (extension, extensionCallback) {
        if (spec.clientOnly) {
          extensionCallback(null, "");
          return;
        }
console.log("extension: " + extension);
        // deal with directory structure quirks. There is a lot of business logic
        // baked in here to deal with a lot of legacy baggage. This allows
        // process_manifest to just deal with a bunch of instructions as far as what
        // to do, without having to worry about the quirks that make those instructions
        // necessary
        var baseName = path.basename(extension),
          foundationExtensionRegexp = /commercialcore|inventory|manufacturing|distribution/,
          isFoundation = extension.indexOf("foundation-database") >= 0,
          isLibOrm = extension.indexOf("lib/orm") >= 0,
          isApplicationCore = /xtuple$/.test(extension),
          isCoreExtension = extension.indexOf("enyo-client") >= 0,
          isPublicExtension = extension.indexOf("xtuple-extensions") >= 0,
          isPrivateExtension = extension.indexOf("private-extensions") >= 0,
          isExtension = !isFoundation && !isLibOrm && !isApplicationCore,
          dbSourceRoot = (isFoundation) ? extension :
            isLibOrm ? path.join(extension, "source") :
            path.join(extension, "database/source"),
          rootPath = path.resolve(__dirname, "../../.."),
          extensionPath = isExtension ? path.resolve(dbSourceRoot, "../../") : undefined,
          manifestOptions = {
            manifestFilename: path.resolve(dbSourceRoot, "manifest.js"),
            extensionPath: extensionPath,
            useFrozenScripts: spec.frozen,
            useFoundationScripts: fs.existsSync(path.resolve(extension, "foundation-database")),
            registerExtension: isExtension,
            wipeViews: isFoundation && spec.wipeViews,
            wipeOrms: isApplicationCore && spec.wipeViews,
            extensionLocation: isCoreExtension ? "/core-extensions" :
              isPublicExtension ? "/xtuple-extensions" :
              isPrivateExtension ? "/private-extensions" :
              extensionPath ? extensionPath.substring(rootPath.length) :
              "not-applicable"
          };

        explodeManifest(manifestOptions, extensionCallback);
      };

      // We also need to get the sql that represents the queries to generate
      // the XM views from the ORMs. We use the old ORM installer for this,
      // which has been retooled to return the queryString instead of running
      // it itself.
      var getOrmSql = function (extension, callback) {
        if (spec.clientOnly) {
          callback(null, "");
          return;
        }
        var ormDir = path.join(extension, "database/orm");

        if (fs.existsSync(ormDir)) {
          var updateSpecs = function (err, res) {
            if (err) {
              callback(err);
            }
            // if the orm installer has added any new orms we want to know about them
            // so we can inform the next call to the installer.
            spec.orms = _.unique(_.union(spec.orms, res.orms), function (orm) {
              return orm.namespace + orm.type;
            });
            callback(err, res.query);
          };
          ormInstaller.run(ormDir, spec, updateSpecs);
        } else {
          // No ORM dir? No problem! Nothing to install.
          callback(null, "");
        }
      };

      // We also need to get the sql that represents the queries to put the
      // client source in the database.
      var getClientSql = function (extension, callback) {
        if (spec.databaseOnly) {
          callback(null, "");
          return;
        }
        clientBuilder.getClientSql(extension, callback);
      };

      /**
        The sql for each extension comprises the sql in the the source directory
        with the orm sql tacked on to the end. Note that an alternate methodology
        dictates that *all* source for all extensions should be run before *any*
        orm queries for any extensions, but that is not the way it works here.
       */
      var getAllSql = function (extension, masterCallback) {

        async.series([
          function (callback) {
            getExtensionSql(extension, callback);
          },
          function (callback) {
            if (spec.clientOnly) {
              callback(null, "");
              return;
            }
            dictionaryBuilder.getDictionarySql(extension, callback);
          },
          function (callback) {
            getOrmSql(extension, callback);
          },
          function (callback) {
            getClientSql(extension, callback);
          }
        ], function (err, results) {
          masterCallback(err, _.reduce(results, function (memo, sql) {
            return memo + sql;
          }, ""));
        });
      };


      //
      // Asyncronously run all the functions to all the extension sql for the database,
      // in series, and execute the query when they all have come back.
      //
      async.mapSeries(extensions, getAllSql, function (err, extensionSql) {
        var allSql,
          credsClone = JSON.parse(JSON.stringify(creds));

        if (err) {
          databaseCallback(err);
          return;
        }
        // each String of the scriptContents is the concatenated SQL for the extension.
        // join these all together into a single string for the whole database.
        allSql = _.reduce(extensionSql, function (memo, script) {
          return memo + script;
        }, "");

        // Without this, psql runs all input and returns success even if errors occurred
        allSql = "\\set ON_ERROR_STOP TRUE\n" + allSql;
        console.log("Applying build to database " + spec.database);
        credsClone.database = spec.database;
        sendToDatabase(allSql, credsClone, spec, function (err, res) {
          if (err) {
            // don't blaze on if the big exec failed!
            // also: report the error
            databaseCallback(err);
            return;
          }
          // If the user has included a -p flag to populate the data, parse
          // and insert any files found at ext/database/source/populate_data.js
          // This will get done after the rest of the database is built, and
          // in the load order of the extensions.

          // This method is more portable to hand-inserting the data, because it
          // makes no assumptions about the username and the encryption key

          // To generate the patches and posts that make up the populate_data.js
          // file, set 'capture: true' in config.js and then copy/paste the
          // logged contents of the datasource as you drive around the app creating
          // and editing objects.
          if (spec.populateData && creds.encryptionKeyFile) {
            var populateSql = "DO $$ " +
              "if (typeof XT === 'undefined') { plv8.execute('select xt.js_init();'); } " +
              "XT.disableLocks = true; " +
              "$$ language plv8;";
            var encryptionKey = fs.readFileSync(path.resolve(__dirname, "../../node-datasource",
              creds.encryptionKeyFile), "utf8");

            _.each(spec.extensions, function (ext) {
              if (fs.existsSync(path.resolve(ext, "database/source/populate_data.js"))) {
                // look for a populate_data.js file
                var populatedData = require(path.resolve(ext, "database/source/populate_data"));
                _.each(populatedData, function (query) {
                  var verb = query.patches ? "patch" : "post";
                  query.encryptionKey = encryptionKey;
                  query.username = creds.username;
                  populateSql += "select xt." + verb + "(\'" + JSON.stringify(query) + "\');";
                });
              }
              if (fs.existsSync(path.resolve(ext, "database/source/populate_data.sql"))) {
                // look for a populate_data.sql file
                populateSql += fs.readFileSync(path.resolve(ext, "database/source/populate_data.sql"));
              }

            });
            populateSql += "DO $$ XT.disableLocks = undefined; $$ language plv8;";
            dataSource.query(populateSql, credsClone, databaseCallback);
          } else {
            databaseCallback(err, res);
          }
        });
      });
    };


    /**
     * Step 1:
     * Before we install the database check that `plv8.start_proc = 'xt.js_init'`
     * is set in the postgresql.conf file.
     */
    var checkForPlv8StartProc = function (spec, callback) {
      var curSettingsSql =  "DO $$ " +
                            "DECLARE msg text = $m$Please add the line, plv8.start_proc = 'xt.js_init', to your postgresql.conf and restart the database server.$m$; " +
                            "BEGIN " +
                            "  IF NOT (current_setting('plv8.start_proc') = 'xt.js_init') THEN " +
                            "    raise exception '%', msg; " +
                            "  END IF; " +
                            "  EXCEPTION WHEN sqlstate '42704' THEN " +
                            "    RAISE EXCEPTION '%', msg; " +
                            "END; " +
                            "$$ LANGUAGE plpgsql",
          credsClone = JSON.parse(JSON.stringify(creds));

      credsClone.database = spec.database;

      dataSource.query(curSettingsSql, credsClone, function (err, res) {
        if (err) {
          callback(err);
        } else {
          preInstallDatabase(spec, callback);
        }
      });
    };

    /**
     * Step 2:
     * Okay, before we install the database there is ONE thing we need to check,
     * which is the pre-installed ORMs. Check that now.
     */
    var preInstallDatabase = function (spec, callback) {
      var existsSql = "select relname from pg_class where relname = 'orm'",
        credsClone = JSON.parse(JSON.stringify(creds)),
        ormTestSql = "select orm_namespace as namespace, " +
          " orm_type as type " +
          "from xt.orm " +
          "where not orm_ext;";

      credsClone.database = spec.database;

      dataSource.query(existsSql, credsClone, function (err, res) {
        if (err) {
          callback(err);
        }
        if (spec.wipeViews || res.rowCount === 0) {
          // xt.orm doesn't exist, because this is probably a brand-new DB.
          // No problem! That just means that there are no pre-existing ORMs.
          spec.orms = [];
          installDatabase(spec, callback);
        } else {
          dataSource.query(ormTestSql, credsClone, function (err, res) {
            if (err) {
              callback(err);
            }
            spec.orms = res.rows;
            installDatabase(spec, callback);
          });
        }
      });
    };

    /**
     * Install all the databases
     */
    async.map(specs, checkForPlv8StartProc, function (err, res) {
      if (err) {
        console.error(err.message, err.stack, err);
        if (masterCallback) {
          masterCallback(err);
        }
        return;
      }
      console.log("Success installing all scripts.");
      console.log("Cleaning up.");
      clientBuilder.cleanup(specs, function (err) {
        if (masterCallback) {
          masterCallback(err, res);
        }
      });
    });
  };

}());
